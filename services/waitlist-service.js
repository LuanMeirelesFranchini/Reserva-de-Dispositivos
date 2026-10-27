const {
  toMySQLDateTime,
  formatarDataBR,
  escapeHtml,
} = require("../helpers/app-helpers");
const { simularAtendimentoFila } = require("./reservation-service");
const { gerarICS, gerarLinkGoogleCalendar } = require("./calendar-service");
const createEmailService = require("./email-service");

// Instancia única do serviço de e-mail no módulo
const defaultEmailService = createEmailService();

/**
 * Processa a fila de espera para um determinado carrinho.
 * Abre sua própria conexão e transação a partir do pool (não aceita conexão externa).
 * Utiliza SELECT ... FOR UPDATE para lock concorrente.
 * Utiliza a função pura simularAtendimentoFila para determinar os itens atendidos.
 *
 * @param {Object} db - Instância do banco de dados (deve conter db.pool)
 * @param {number} carrinhoId - ID do carrinho a ser processado
 * @param {Object} [ator={}] - Dados do operador responsável pela ação { id, nome, role, ip }
 * @param {Object} [options={}] - Dependências injetáveis opcionais para testes
 * @returns {Promise<{ atendidos: Array<Object> }>}
 */
async function processarFilaEspera(db, carrinhoId, ator = {}, options = {}) {
  const cid = parseInt(carrinhoId, 10);
  if (!Number.isInteger(cid) || cid <= 0) {
    return { atendidos: [] };
  }

  const emailService = options.emailService || defaultEmailService;
  const fnGerarICS = options.gerarICS || gerarICS;
  const fnGerarLinkCalendar =
    options.gerarLinkGoogleCalendar || gerarLinkGoogleCalendar;
  const agora = options.agora || new Date();
  const agoraStr = toMySQLDateTime(agora);

  let connection = null;
  let carrinho = null;
  let itensAtendidos = [];

  try {
    connection = await db.pool.getConnection();
    await connection.beginTransaction();

    // 1. Lock exclusivo do carrinho (mesmo lock do POST /reservar)
    const [cartRows] = await connection.execute(
      "SELECT id, capacidade, indisponiveis, nome, ativo FROM carrinhos WHERE id = ? FOR UPDATE",
      [cid],
    );

    if (!cartRows || cartRows.length === 0) {
      await connection.rollback();
      return { atendidos: [] };
    }

    carrinho = cartRows[0];
    if (carrinho.ativo === 0) {
      await connection.rollback();
      return { atendidos: [] };
    }

    // 2. Expirar pedidos da fila cuja data de retirada já ficou no passado
    await connection.execute(
      "UPDATE lista_espera SET status = 'Expirada' WHERE carrinho_id = ? AND status = 'Aguardando' AND data_retirada <= ?",
      [cid, agoraStr],
    );

    // 3. Ler a fila (ORDER BY criado_em ASC, id ASC) apenas de usuários ativos
    const [fila] = await connection.execute(
      `SELECT f.id, f.carrinho_id, f.quantidade, f.usuario_id, f.data_retirada, f.data_devolucao, f.sala, f.criado_em,
              u.nome as usuario_nome, u.email as usuario_email
       FROM lista_espera f
       JOIN usuarios u ON f.usuario_id = u.id
       WHERE f.carrinho_id = ? AND f.status = 'Aguardando' AND f.data_retirada > ? AND u.ativo = 1
       ORDER BY f.criado_em ASC, f.id ASC`,
      [cid, agoraStr],
    );

    if (!fila || fila.length === 0) {
      await connection.commit();
      return { atendidos: [] };
    }

    // 4. Determina a janela total coberta pelos itens da fila
    let minInicio = fila[0].data_retirada;
    let maxFim = fila[0].data_devolucao;
    for (const item of fila) {
      if (new Date(item.data_retirada) < new Date(minInicio)) {
        minInicio = item.data_retirada;
      }
      if (new Date(item.data_devolucao) > new Date(maxFim)) {
        maxFim = item.data_devolucao;
      }
    }

    // 5. Ler reservas ('Ativa' e 'Retirada') e bloqueios que cobrem essa janela
    const [reservasExistentes] = await connection.execute(
      `SELECT id, quantidade, data_retirada, data_devolucao, status
       FROM reservas
       WHERE carrinho_id = ? AND status IN ('Ativa', 'Retirada') AND data_retirada < ? AND data_devolucao > ?`,
      [cid, toMySQLDateTime(maxFim), toMySQLDateTime(minInicio)],
    );

    const [bloqueiosExistentes] = await connection.execute(
      `SELECT id, quantidade, data_inicio, data_fim
       FROM carrinho_bloqueios
       WHERE carrinho_id = ? AND data_inicio < ? AND data_fim > ?`,
      [cid, toMySQLDateTime(maxFim), toMySQLDateTime(minInicio)],
    );

    // 6. Decisão pura via simularAtendimentoFila
    itensAtendidos = simularAtendimentoFila({
      carrinho,
      fila,
      reservasExistentes,
      bloqueiosExistentes,
      agora,
    });

    // 7. Para cada item atendido: INSERT da reserva + UPDATE da fila para 'Atendida'
    for (const item of itensAtendidos) {
      const [insertResult] = await connection.execute(
        `INSERT INTO reservas (carrinho_id, quantidade, usuario_id, data_retirada, data_devolucao, sala, status)
         VALUES (?, ?, ?, ?, ?, ?, 'Ativa')`,
        [
          cid,
          item.quantidade,
          item.usuario_id,
          toMySQLDateTime(item.data_retirada),
          toMySQLDateTime(item.data_devolucao),
          item.sala,
        ],
      );

      item.reserva_id = insertResult.insertId;

      await connection.execute(
        "UPDATE lista_espera SET status = 'Atendida' WHERE id = ?",
        [item.id],
      );
    }

    // 8. Commit único de toda a transação
    await connection.commit();
  } catch (err) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error("Erro no rollback da fila de espera:", rollbackErr.message);
      }
    }
    throw err;
  } finally {
    if (connection) {
      connection.release();
    }
  }

  // 9. E-mails e auditoria pós-commit em try/catch independente
  for (const item of itensAtendidos) {
    // Auditoria
    try {
      const atorAuditoria = ator || {};
      const detalhesAuditoria = {
        fila_id: item.id,
        reserva_id: item.reserva_id,
        carrinho_id: cid,
        carrinho_nome: carrinho?.nome || "",
        usuario_id_atendido: item.usuario_id,
        usuario_nome_atendido: item.usuario_nome || "",
        quantidade: item.quantidade,
        data_retirada: item.data_retirada,
        data_devolucao: item.data_devolucao,
        sala: item.sala,
      };

      await db.run(
        `INSERT INTO audit_logs (
          usuario_id, usuario_nome, usuario_role, acao, entidade, entidade_id, detalhes_json, ip, user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          atorAuditoria.id || null,
          atorAuditoria.nome || "Sistema",
          atorAuditoria.role || "sistema",
          "RESERVA_CRIADA_FILA",
          "reserva",
          item.reserva_id,
          JSON.stringify(detalhesAuditoria),
          atorAuditoria.ip || null,
          null,
        ],
      );
    } catch (auditErr) {
      console.error(
        "Erro ao registrar auditoria de atendimento da fila:",
        auditErr.message,
      );
    }

    // E-mail de notificação com template original protegido por escapeHtml
    try {
      if (item.usuario_email) {
        const tituloEvento = `Reserva de ${item.quantidade} Chromebooks (${carrinho?.nome || ""})`;
        const descricaoEvento = `Reserva confirmada via fila de espera para ${item.usuario_nome || ""}.`;
        const localEvento = `${item.sala}, Colegio La Salle`;
        const arquivoICS = fnGerarICS(
          tituloEvento,
          descricaoEvento,
          localEvento,
          item.data_retirada,
          item.data_devolucao,
        );
        const linkGoogleCalendar = fnGerarLinkCalendar(
          tituloEvento,
          descricaoEvento,
          localEvento,
          item.data_retirada,
          item.data_devolucao,
        );

        await emailService.sendReservationEmail({
          to: item.usuario_email,
          subject: "Boa notícia! Sua reserva da fila de espera foi confirmada",
          text: `Olá ${item.usuario_nome}, uma vaga abriu no carrinho ${carrinho?.nome || ""} e sua reserva para ${formatarDataBR(item.data_retirada)} foi confirmada automaticamente!`,
          html: `
<p>Olá <b>${escapeHtml(item.usuario_nome)}</b>, uma vaga abriu e sua reserva na fila de espera foi <b>confirmada automaticamente</b>!</p>
<p><b>Detalhes:</b><br>
Carrinho: ${escapeHtml(carrinho?.nome || "")}<br>
Quantidade: ${escapeHtml(item.quantidade)}<br>
Data de Retirada: ${escapeHtml(formatarDataBR(item.data_retirada))}<br>
Data de Devolução: ${escapeHtml(formatarDataBR(item.data_devolucao))}<br>
Sala: ${escapeHtml(item.sala)}</p>
<p>Adicione à sua agenda: <a href="${linkGoogleCalendar}">Google Calendar</a><br>
Ou abra o anexo .ics para Outlook/Apple Calendar.</p>
<br>
<p><b>Equipe de Tecnologia - Colégio La Salle</b><br>
(11) 2793.1444<br>
<a href="https://www.lasalle.edu.br/saopaulo">https://www.lasalle.edu.br/saopaulo</a></p>`,
          attachments: [{ filename: "reserva.ics", content: arquivoICS }],
        });
      }
    } catch (emailErr) {
      console.error(
        "Erro ao enviar e-mail de atendimento da fila:",
        emailErr.message,
      );
    }
  }

  return { atendidos: itensAtendidos };
}

module.exports = {
  processarFilaEspera,
};
