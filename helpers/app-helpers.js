const { formatarLocal, montarSalasParaView } = require("../salas-data");
const {
  gerarICS,
  gerarLinkGoogleCalendar,
} = require("../services/calendar-service");
const createEmailService = require("../services/email-service");

/**
 * Adiciona uma mensagem de flash (querystring) a uma URL de redirecionamento.
 *
 * @param {string} urlBase - URL original.
 * @param {string} field - Nome do campo (ex: 'erro', 'sucesso').
 * @param {string} message - A mensagem a ser exibida.
 * @returns {string} A URL modificada.
 */
function appendFlashMessage(urlBase, field, message) {
  const separator = urlBase.includes("?") ? "&" : "?";
  return `${urlBase}${separator}${field}=${encodeURIComponent(message)}`;
}

/**
 * Converte um valor de data para o formato padrão do MySQL (YYYY-MM-DD HH:MM:SS).
 *
 * @param {string|Date} value - A data a ser convertida.
 * @returns {string|null} A data formatada ou null caso seja inválida.
 */
function toMySQLDateTime(value) {
  if (!value) return null;
  if (
    typeof value === "string" &&
    (/Z$/i.test(value.trim()) || /[+-]\d{2}:\d{2}$/.test(value.trim()))
  ) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      value = d;
    }
  }
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const pad = (n) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
  return String(value).slice(0, 19).replace("T", " ");
}

/**
 * Determina se uma reserva está em atraso com base no status e data de devolução.
 * Regra: status deve ser 'Ativa' ou 'Retirada' E data_devolucao estritamente menor que agora.
 *
 * @param {Object} reserva - Objeto contendo status e data_devolucao.
 * @param {Date|string} [agora=new Date()] - Data/hora de corte para comparação.
 * @returns {boolean} True se a reserva estiver em atraso.
 */
function estaEmAtraso(reserva, agora = new Date()) {
  if (!reserva || !reserva.status || !reserva.data_devolucao) return false;
  if (!["Ativa", "Retirada"].includes(reserva.status)) return false;

  let dataDevolucao = reserva.data_devolucao;
  if (typeof dataDevolucao === "string") {
    dataDevolucao = new Date(dataDevolucao.trim().replace(" ", "T"));
  } else if (!(dataDevolucao instanceof Date)) {
    dataDevolucao = new Date(dataDevolucao);
  }
  if (isNaN(dataDevolucao.getTime())) return false;

  let refAgora = agora;
  if (typeof refAgora === "string") {
    refAgora = new Date(refAgora.trim().replace(" ", "T"));
  } else if (!(refAgora instanceof Date)) {
    refAgora = new Date(refAgora);
  }
  if (isNaN(refAgora.getTime())) return false;

  return dataDevolucao.getTime() < refAgora.getTime();
}



/**
 * Converte uma data padrão ISO/MySQL para o formato brasileiro (DD/MM/YYYY HH:MM).
 *
 * @param {string|Date} value - A data a ser convertida.
 * @returns {string} A data formatada em PT-BR.
 */
function formatarDataBR(value) {
  if (!value) return '';
  const str = String(value);
  // Espera formato YYYY-MM-DD HH:MM:SS ou similar
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}`;
  }
  return str;
}

/**
 * Normaliza os dados do carrinho garantindo que capacidade e indisponíveis
 * sejam números inteiros, e calcula os dispositivos disponíveis.
 *
 * @param {Object} carrinho - Objeto do carrinho vindo do banco de dados.
 * @param {number|string} carrinho.capacidade - Capacidade total.
 * @param {number|string} carrinho.indisponiveis - Dispositivos em manutenção.
 * @returns {Object} Objeto do carrinho com a propriedade `disponiveis` calculada.
 */
function normalizarCarrinho(carrinho) {
  const capacidade = Number.isInteger(carrinho.capacidade)
    ? carrinho.capacidade
    : parseInt(carrinho.capacidade, 10) || 0;
  const indisponiveis = Number.isInteger(carrinho.indisponiveis)
    ? carrinho.indisponiveis
    : parseInt(carrinho.indisponiveis, 10) || 0;

  return {
    ...carrinho,
    capacidade,
    indisponiveis,
    disponiveis: Math.max(capacidade - indisponiveis, 0),
  };
}

/**
 * Cria e retorna os helpers da aplicação com injeção de dependência do banco.
 *
 * @param {Object} db - Instância do banco de dados MySQL.
 * @returns {Object} Um objeto contendo todas as funções auxiliares.
 */
function createAppHelpers(db) {
  const { sendReservationEmail } = createEmailService();

  /**
   * Registra uma ação no log de auditoria.
   *
   * @param {Object} req - Objeto de requisição do Express (para extrair user, IP, user-agent).
   * @param {Object} payload - Dados da ação.
   * @param {string} payload.acao - O nome da ação executada (ex: 'RESERVA_CRIADA').
   * @param {string} [payload.entidade] - A entidade afetada (ex: 'reserva').
   * @param {number} [payload.entidadeId] - O ID da entidade afetada.
   * @param {Object} [payload.detalhes] - Detalhes adicionais em formato JSON.
   */
  async function registrarAuditoria(
    req,
    { acao, entidade = null, entidadeId = null, detalhes = null },
  ) {
    const usuario = req.user || {};
    const detalhesJson = detalhes ? JSON.stringify(detalhes) : null;
    const ip = req.ip || req.socket?.remoteAddress || null;
    const userAgent = req.get("user-agent") || null;

    try {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO audit_logs (
            usuario_id, usuario_nome, usuario_role, acao, entidade, entidade_id, detalhes_json, ip, user_agent
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            usuario.id || null,
            usuario.nome || null,
            usuario.role || null,
            acao,
            entidade,
            entidadeId,
            detalhesJson,
            ip,
            userAgent,
          ],
          (err) => (err ? reject(err) : resolve()),
        );
      });
    } catch (err) {
      console.error("Erro ao registrar auditoria:", err.message);
    }
  }

  return {
    appendFlashMessage,
    formatarLocal,
    formatarDataBR,
    gerarICS,
    gerarLinkGoogleCalendar,
    montarSalasParaView,
    normalizarCarrinho,
    registrarAuditoria,
    sendReservationEmail,
    toMySQLDateTime,
    estaEmAtraso,
    escapeHtml,
  };
}

/**
 * Escapa caracteres HTML perigosos para evitar Cross-Site Scripting (XSS) e HTML Injection.
 *
 * @param {string} str - Texto a ser escapado.
 * @returns {string} Texto seguro com caracteres especiais substituídos por entidades HTML.
 */
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

createAppHelpers.toMySQLDateTime = toMySQLDateTime;
createAppHelpers.normalizarCarrinho = normalizarCarrinho;
createAppHelpers.estaEmAtraso = estaEmAtraso;
createAppHelpers.formatarDataBR = formatarDataBR;
createAppHelpers.escapeHtml = escapeHtml;
module.exports = createAppHelpers;

