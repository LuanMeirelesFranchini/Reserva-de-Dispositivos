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
  return String(value).slice(0, 19).replace("T", " ");
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
    gerarICS,
    gerarLinkGoogleCalendar,
    montarSalasParaView,
    normalizarCarrinho,
    registrarAuditoria,
    sendReservationEmail,
    toMySQLDateTime,
  };
}

module.exports = createAppHelpers;
