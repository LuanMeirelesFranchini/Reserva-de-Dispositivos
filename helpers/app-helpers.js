const { formatarLocal, montarSalasParaView } = require("../salas-data");
const { gerarICS, gerarLinkGoogleCalendar } = require("../services/calendar-service");
const createEmailService = require("../services/email-service");

function appendFlashMessage(urlBase, field, message) {
  const separator = urlBase.includes("?") ? "&" : "?";
  return `${urlBase}${separator}${field}=${encodeURIComponent(message)}`;
}

function toMySQLDateTime(value) {
  if (!value) return value;
  return String(value).slice(0, 19).replace("T", " ");
}

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

function createAppHelpers(db) {
  const { sendReservationEmail } = createEmailService();

  async function registrarAuditoria(
    req,
    { acao, entidade = null, entidadeId = null, detalhes = null },
  ) {
    const usuario = req.user || {};
    const detalhesJson = detalhes ? JSON.stringify(detalhes) : null;
    const ip =
      req.ip ||
      req.headers["x-forwarded-for"] ||
      req.socket?.remoteAddress ||
      null;
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
