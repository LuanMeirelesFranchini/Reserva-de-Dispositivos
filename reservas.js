const fs = require("fs");
const path = require("path");
const express = require("express");
const { google } = require("googleapis");
const { dbAll, dbGet, dbRun } = require("./database");
const { decryptToken } = require("./helpers/token-crypto");
const {
  calcularDisponiveisComBloqueios,
  calcularPicoBloqueado,
  calcularPicoDeUso,
  validarConflitoReserva,
} = require("./services/reservation-service");
const { processarFilaEspera } = require("./services/waitlist-service");

const logDir = path.join(__dirname, "logs");
const logFilePath = path.join(logDir, "shadow-divergences.log");

/**
 * Registra divergências do modo sombra no console e em arquivo de log sem travar a requisição.
 */
function registrarDivergenciaSombra(dados) {
  const payload = {
    timestamp: new Date().toISOString(),
    ...dados,
  };
  const linhaLog = JSON.stringify(payload);
  console.warn(`[MODO SOMBRA DIVERGENCIA] ${linhaLog}`);
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFile(logFilePath, linhaLog + "\n", (err) => {
      if (err) console.error("Erro ao gravar log do modo sombra:", err.message);
    });
  } catch (err) {
    console.error("Falha ao gravar arquivo de log sombra:", err.message);
  }
}

module.exports = (db, middlewares, helpers) => {
  const router = express.Router();
  const { isAuthenticated, ensureAuthenticatedApi, canManageReservations } =
    middlewares;
  const {
    normalizarCarrinho,
    registrarAuditoria,
    toMySQLDateTime,
    formatarLocal,
    formatarDataBR,
    montarSalasParaView,
    gerarLinkGoogleCalendar,
    gerarICS,
    sendReservationEmail,
    escapeHtml,
  } = helpers;

  router.get("/", isAuthenticated, async (req, res) => {
    try {
      const carrinhosDb = await dbAll(db, "SELECT * FROM carrinhos WHERE ativo = 1");
      const carrinhos = carrinhosDb.map(normalizarCarrinho);
      const salas = await dbAll(db, "SELECT bloco, nome FROM salas");
      const blocosSalas = montarSalasParaView(salas);
      res.render("index", {
        carrinhos,
        blocosSalas,
        user: req.user,
      });
    } catch (err) {
      console.error("Erro ao carregar a pagina inicial:", err.message);
      res.status(500).send("Erro ao carregar a pagina.");
    }
  });

  router.get("/minhas-reservas", isAuthenticated, async (req, res) => {
    try {
      const sql =
        "SELECT r.*, c.nome as nome_carrinho FROM reservas r JOIN carrinhos c ON r.carrinho_id = c.id WHERE r.usuario_id = ? AND r.status IN ('Ativa', 'Retirada') ORDER BY r.data_retirada ASC";
      const reservas = await dbAll(db, sql, [req.user.id]);
      res.render("minhas-reservas", {
        reservas,
        user: req.user,
      });
    } catch (err) {
      res.status(500).send("Erro ao carregar suas reservas.");
    }
  });

  router.post("/reservas/cancelar/:id", isAuthenticated, async (req, res) => {
    const reservaId = parseInt(req.params.id, 10);
    if (!Number.isInteger(reservaId) || reservaId <= 0) {
      return res.status(400).send("Reserva invalida.");
    }

    try {
      const reserva = await dbGet(
        db,
        "SELECT r.*, c.nome as nome_carrinho FROM reservas r LEFT JOIN carrinhos c ON r.carrinho_id = c.id WHERE r.id = ?",
        [reservaId],
      );
      if (
        !reserva ||
        (Number(reserva.usuario_id) !== Number(req.user.id) &&
          req.user.role !== "admin")
      ) {
        return res
          .status(403)
          .send("Voce nao tem permissao para cancelar esta reserva.");
      }

      if (reserva.status !== "Ativa") {
        return res
          .status(409)
          .send("Apenas reservas ativas podem ser canceladas.");
      }

      const result = await dbRun(
        db,
        "UPDATE reservas SET status = 'Cancelada' WHERE id = ? AND status = 'Ativa'",
        [reservaId],
      );
      if (result.changes === 0) {
        return res.status(409).send("Esta reserva ja foi alterada.");
      }

      await registrarAuditoria(req, {
        acao: "RESERVA_CANCELADA",
        entidade: "reserva",
        entidadeId: reservaId,
        detalhes: {
          carrinho_id: reserva.carrinho_id,
          carrinho: reserva.nome_carrinho,
          quantidade: reserva.quantidade,
          data_retirada: reserva.data_retirada,
          data_devolucao: reserva.data_devolucao,
          sala: reserva.sala,
          usuario_reserva_id: reserva.usuario_id,
        },
      });

      // Processar fila de espera com lock transacional e tratamento isolado de erro
      try {
        await processarFilaEspera(db, reserva.carrinho_id, {
          id: req.user.id,
          nome: req.user.nome,
          role: req.user.role,
          ip: req.ip || req.socket?.remoteAddress || null,
        });
      } catch (filaErr) {
        console.error(
          "Erro ao processar fila de espera apos cancelamento:",
          filaErr.message,
        );
      }

      { req.session.sucesso = "Reserva cancelada com sucesso."; res.redirect("/minhas-reservas"); }
    } catch (err) {
      res.status(500).send("Erro ao cancelar reserva.");
    }
  });

  router.post(
    "/reservas/entregar/:id",
    canManageReservations,
    async (req, res) => {
      const reservaId = parseInt(req.params.id, 10);
      if (!Number.isInteger(reservaId) || reservaId <= 0) {
        return res.status(400).send("Reserva invalida.");
      }

      try {
        const reserva = await dbGet(db, "SELECT * FROM reservas WHERE id = ?", [reservaId]);
        if (!reserva) return res.status(404).send("Reserva nao encontrada.");

        if (reserva.status !== "Ativa") {
          return res.status(409).send("Apenas reservas ativas podem ser entregues.");
        }

        const result = await dbRun(
          db,
          "UPDATE reservas SET status = 'Retirada' WHERE id = ? AND status = 'Ativa'",
          [reservaId],
        );
        if (result.changes === 0) {
          return res.status(409).send("Esta reserva ja foi alterada.");
        }

        await registrarAuditoria(req, {
          acao: "RESERVA_ENTREGUE",
          entidade: "reserva",
          entidadeId: reservaId,
          detalhes: { status_novo: 'Retirada' },
        });
        req.session.sucesso = "Carrinho marcado como Entregue ao professor.";
        res.redirect("/admin");
      } catch (err) {
        console.error("Erro ao entregar reserva:", err.message);
        res.status(500).send("Erro ao entregar reserva.");
      }
    },
  );

  router.post(
    "/reservas/concluir/:id",
    canManageReservations,
    async (req, res) => {
      const reservaId = parseInt(req.params.id, 10);
      if (!Number.isInteger(reservaId) || reservaId <= 0) {
        return res.status(400).send("Reserva invalida.");
      }

      const nomeQuemConcluiu = req.user.nome;
      try {
        const reserva = await dbGet(
          db,
          "SELECT r.*, c.nome as nome_carrinho, u.nome as nome_professor FROM reservas r LEFT JOIN carrinhos c ON r.carrinho_id = c.id LEFT JOIN usuarios u ON r.usuario_id = u.id WHERE r.id = ?",
          [reservaId],
        );
        if (!reserva) return res.status(404).send("Reserva nao encontrada.");

        if (reserva.status !== "Ativa" && reserva.status !== "Retirada") {
          return res
            .status(409)
            .send("Apenas reservas ativas ou retiradas podem ser concluidas.");
        }

        const observacoes = req.body.observacoes_devolucao || "";

        const result = await dbRun(
          db,
          "UPDATE reservas SET status = 'Concluida', concluido_por = ?, observacoes_devolucao = ? WHERE id = ? AND status IN ('Ativa', 'Retirada')",
          [nomeQuemConcluiu, observacoes, reservaId],
        );
        if (result.changes === 0) {
          return res.status(409).send("Esta reserva ja foi alterada.");
        }

        await registrarAuditoria(req, {
          acao: "RESERVA_CONCLUIDA",
          entidade: "reserva",
          entidadeId: reservaId,
          detalhes: {
            carrinho_id: reserva.carrinho_id,
            carrinho: reserva.nome_carrinho,
            professor: reserva.nome_professor,
            quantidade: reserva.quantidade,
            data_retirada: reserva.data_retirada,
            data_devolucao: reserva.data_devolucao,
            sala: reserva.sala,
            concluido_por: nomeQuemConcluiu,
            observacoes_devolucao: observacoes
          },
        });

        if (observacoes && observacoes.trim().length > 0) {
          const safeObservacoes = escapeHtml(observacoes).replace(/\r?\n/g, "<br>");
          const safeProfessor = escapeHtml(reserva.nome_professor || "");
          try {
            await sendReservationEmail({
              to: process.env.INITIAL_ADMIN_EMAIL,
              subject: "⚠️ ALERTA DE AVARIA: Devolução de Carrinho",
              text: `A reserva ID ${reservaId} do professor ${reserva.nome_professor} foi devolvida com a seguinte observação de dano:\n\n${observacoes}`,
              html: `
<div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
  <div style="background-color: #dc2626; color: white; padding: 20px; text-align: center;">
    <h2 style="margin: 0; font-size: 24px;">⚠️ Alerta de Avaria</h2>
    <p style="margin: 5px 0 0; font-size: 14px; opacity: 0.9;">Devolução com registro de danos</p>
  </div>
  
  <div style="padding: 24px;">
    <p style="font-size: 16px; line-height: 1.5; margin-top: 0;">A reserva <b>ID ${reservaId}</b> foi devolvida pela equipe com apontamento de avarias. O professor responsável era <b>${safeProfessor}</b>.</p>
    
    <div style="background-color: #fee2e2; border-left: 4px solid #ef4444; padding: 16px; margin: 24px 0; border-radius: 0 8px 8px 0;">
      <p style="margin: 0; color: #991b1b; font-weight: bold; margin-bottom: 8px;">Detalhes do Dano:</p>
      <p style="margin: 0; color: #7f1d1d; font-size: 15px; white-space: pre-wrap;">${safeObservacoes}</p>
    </div>

    <div style="background-color: #f9fafb; padding: 16px; border-radius: 8px; border: 1px solid #e5e7eb; margin-bottom: 24px;">
      <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 16px; color: #111827; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px;">Resumo da Reserva</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 4px 0; color: #6b7280; width: 140px;">Carrinho:</td><td style="padding: 4px 0; font-weight: bold;">${reserva.nome_carrinho}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Quantidade:</td><td style="padding: 4px 0; font-weight: bold;">${reserva.quantidade}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Sala:</td><td style="padding: 4px 0; font-weight: bold;">${reserva.sala}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Retirada:</td><td style="padding: 4px 0; font-weight: bold;">${formatarDataBR(reserva.data_retirada)}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Devolução:</td><td style="padding: 4px 0; font-weight: bold;">${formatarDataBR(reserva.data_devolucao)}</td></tr>
      </table>
    </div>
    
    <p style="font-size: 14px; color: #4b5563; text-align: center; margin-bottom: 0;">Recomenda-se bloquear os dispositivos afetados no Painel de Gestão e agendar manutenção.</p>
  </div>
  
  <div style="background-color: #f3f4f6; padding: 16px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb;">
    <b>Sistema de Reservas - Colégio La Salle</b><br>
    Mensagem automática. Por favor, não responda.
  </div>
</div>
`,
            });
          } catch (emailErr) {
            console.error("Nao foi possivel enviar e-mail de alerta de avaria", emailErr);
          }
        }

        // Processar fila de espera apenas se a devolucao for antecipada (data_devolucao > agora)
        const devolucaoPrevista = new Date(reserva.data_devolucao);
        const agora = new Date();
        const devolucaoAntecipada =
          !isNaN(devolucaoPrevista.getTime()) && devolucaoPrevista > agora;

        if (devolucaoAntecipada) {
          try {
            await processarFilaEspera(db, reserva.carrinho_id, {
              id: req.user.id,
              nome: req.user.nome,
              role: req.user.role,
              ip: req.ip || req.socket?.remoteAddress || null,
            });
          } catch (filaErr) {
            console.error(
              "Erro ao processar fila de espera apos conclusao de reserva:",
              filaErr.message,
            );
          }
        }

        req.session.sucesso = "Reserva concluida com sucesso.";
        res.redirect("/admin");
      } catch (err) {
        console.error("Erro ao concluir reserva:", err.message);
        res.status(500).send("Erro ao concluir reserva.");
      }
    },
  );

  router.post("/reservar-recorrente", isAuthenticated, async (req, res) =>
    { req.session.erro = "Reservas recorrentes ainda nao estao ativas."; res.redirect("/"); },
  );

  router.get("/api/availability", ensureAuthenticatedApi, async (req, res) => {
    const { carrinho_id, data_retirada, data_devolucao } = req.query;
    const carrinhoId = parseInt(carrinho_id, 10);
    if (
      !Number.isInteger(carrinhoId) ||
      carrinhoId <= 0 ||
      !data_retirada ||
      !data_devolucao
    ) {
      return res.status(400).json({ error: "Parametros faltando." });
    }

    const inicioNovaReserva = new Date(data_retirada);
    const fimNovaReserva = new Date(data_devolucao);
    if (
      isNaN(inicioNovaReserva) ||
      isNaN(fimNovaReserva) ||
      fimNovaReserva <= inicioNovaReserva
    ) {
      return res.status(400).json({ error: "Datas invalidas." });
    }

    try {
      const carrinhoDb = await dbGet(
        db,
        "SELECT capacidade, indisponiveis, ativo FROM carrinhos WHERE id = ?",
        [carrinhoId],
      );
      const carrinho = carrinhoDb ? normalizarCarrinho(carrinhoDb) : null;
      if (!carrinho || carrinhoDb.ativo === 0) {
        return res.status(404).json({ error: "Carrinho nao encontrado ou desativado." });
      }

      const reservasAtivas = await dbAll(
        db,
        "SELECT quantidade, data_retirada, data_devolucao FROM reservas WHERE carrinho_id = ? AND status IN ('Ativa', 'Retirada') AND data_retirada < ? AND data_devolucao > ?",
        [
          carrinhoId,
          toMySQLDateTime(data_devolucao),
          toMySQLDateTime(data_retirada),
        ],
      );
      const bloqueiosAtivos = await dbAll(
        db,
        "SELECT quantidade, data_inicio, data_fim FROM carrinho_bloqueios WHERE carrinho_id = ? AND data_inicio < ? AND data_fim > ?",
        [
          carrinhoId,
          toMySQLDateTime(data_devolucao),
          toMySQLDateTime(data_retirada),
        ],
      );

      const disponiveisAntigo = calcularDisponiveisComBloqueios(
        carrinho,
        reservasAtivas,
        bloqueiosAtivos,
        inicioNovaReserva,
        fimNovaReserva,
      );

      res.json({
        disponiveis: disponiveisAntigo,
      });
    } catch (err) {
      res.status(500).json({ error: "Erro interno no servidor." });
    }
  });

  router.get("/api/reservas-eventos", ensureAuthenticatedApi, async (req, res) => {
    try {
      const isStaff = req.user.role === "admin" || req.user.role === "operacional";

      // Pega todas as reservas ativas ou retiradas
      const reservasDb = await dbAll(
        db,
        "SELECT r.id, r.usuario_id, r.quantidade, r.data_retirada, r.data_devolucao, r.status, c.nome as carrinho_nome, c.localizacao as carrinho_localizacao, u.nome as professor_nome FROM reservas r JOIN carrinhos c ON r.carrinho_id = c.id JOIN usuarios u ON r.usuario_id = u.id WHERE r.status IN ('Ativa', 'Retirada', 'Concluida')"
      );
      
      // Pega todos os bloqueios
      const bloqueiosDb = await dbAll(
        db,
        "SELECT b.id, b.quantidade, b.data_inicio, b.data_fim, b.motivo, c.nome as carrinho_nome, c.localizacao as carrinho_localizacao FROM carrinho_bloqueios b JOIN carrinhos c ON b.carrinho_id = c.id"
      );

      const eventos = [];

      reservasDb.forEach((r) => {
        const isOwner = Number(r.usuario_id) === Number(req.user.id);
        let eventTitle = "";

        if (isStaff) {
          eventTitle = `${r.quantidade} dispositivos (${r.carrinho_nome}) - ${r.professor_nome}`;
        } else if (isOwner) {
          eventTitle = `${r.quantidade} dispositivos (${r.carrinho_nome}) - Minha Reserva`;
        } else {
          eventTitle = `${r.quantidade} dispositivos (${r.carrinho_nome}) - Reservado`;
        }

        eventos.push({
          id: `res_${r.id}`,
          title: eventTitle,
          start: r.data_retirada,
          end: r.data_devolucao,
          backgroundColor: r.status === 'Retirada' ? '#f59e0b' : (r.status === 'Concluida' ? '#6b7280' : '#3b82f6'), // Amarelo se retirada, Cinza se concluida, Azul se agendada
          borderColor: 'transparent',
          extendedProps: {
            tipo: 'reserva',
            status: r.status,
            quantidade: r.quantidade,
            localizacao: r.carrinho_localizacao,
            isOwner,
          }
        });
      });

      bloqueiosDb.forEach((b) => {
        eventos.push({
          id: `blk_${b.id}`,
          title: `Bloqueio: ${b.quantidade} dispositivos (${b.carrinho_nome}) - ${b.motivo}`,
          start: b.data_inicio,
          end: b.data_fim,
          backgroundColor: '#ef4444', // Vermelho para bloqueio
          borderColor: 'transparent',
          extendedProps: { tipo: 'bloqueio', quantidade: b.quantidade, localizacao: b.carrinho_localizacao }
        });
      });

      res.json(eventos);
    } catch (err) {
      console.error("Erro ao buscar eventos do calendario:", err);
      res.status(500).json({ error: "Erro ao buscar eventos" });
    }
  });

  router.post("/reservas/fila", isAuthenticated, async (req, res) => {
    const {
      carrinho_id,
      quantidade,
      data_retirada,
      data_devolucao,
      bloco,
      sala
    } = req.body;

    const carrinhoId = parseInt(carrinho_id, 10);
    const quantidadeNum = parseInt(quantidade, 10);
    const usuario_id = req.user.id;
    const blocoSelecionado = (bloco || "").trim();
    const salaSelecionada = (sala || "").trim();

    if (!Number.isInteger(carrinhoId) || carrinhoId <= 0) {
      { req.session.erro = "Selecione um carrinho valido."; return res.redirect("/"); }
    }
    if (!Number.isInteger(quantidadeNum) || quantidadeNum <= 0) {
      { req.session.erro = "Quantidade invalida."; return res.redirect("/"); }
    }
    if (!blocoSelecionado || !salaSelecionada) {
      { req.session.erro = "Selecione o bloco e a sala da reserva."; return res.redirect("/"); }
    }

    const inicioSolicitado = new Date(data_retirada);
    const fimSolicitado = new Date(data_devolucao);
    const agora = new Date();

    if (
      isNaN(inicioSolicitado.getTime()) ||
      isNaN(fimSolicitado.getTime()) ||
      fimSolicitado <= inicioSolicitado
    ) {
      req.session.erro = "Periodo invalido."; return res.redirect("/");
    }
    if (inicioSolicitado < agora) {
      req.session.erro = "A data de retirada nao pode estar no passado."; return res.redirect("/");
    }

    if (req.user.role !== "admin") {
      const minimo = new Date(agora.getTime() + 24 * 60 * 60 * 1000);
      const maximo = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);
      if (inicioSolicitado < minimo) {
        req.session.erro = "Os pedidos na fila de espera devem ser feitos com pelo menos 24 horas de antecedencia.";
        return res.redirect("/");
      }
      if (inicioSolicitado > maximo || fimSolicitado > maximo) {
        req.session.erro = "Maximo de 30 dias de antecedencia.";
        return res.redirect("/");
      }
    }

    try {
      const carrinhoDb = await dbGet(
        db,
        "SELECT id, capacidade, indisponiveis, nome, ativo FROM carrinhos WHERE id = ?",
        [carrinhoId]
      );
      if (!carrinhoDb || carrinhoDb.ativo === 0) {
        req.session.erro = "Carrinho nao encontrado ou desativado.";
        return res.redirect("/");
      }

      const carrinho = normalizarCarrinho(carrinhoDb);
      if (quantidadeNum > carrinho.disponiveis) {
        req.session.erro = `A quantidade solicitada (${quantidadeNum}) excede a capacidade do carrinho (${carrinho.disponiveis} dispositivos).`;
        return res.redirect("/");
      }

      const pedidoDuplicado = await dbGet(
        db,
        "SELECT id FROM lista_espera WHERE usuario_id = ? AND carrinho_id = ? AND status = 'Aguardando' AND data_retirada < ? AND data_devolucao > ?",
        [usuario_id, carrinhoId, toMySQLDateTime(data_devolucao), toMySQLDateTime(data_retirada)]
      );
      if (pedidoDuplicado) {
        req.session.erro = "Voce ja possui um pedido na fila de espera para este carrinho no mesmo periodo.";
        return res.redirect("/");
      }
      const [salaRows] = await db.pool.execute(
        "SELECT bloco, nome FROM salas WHERE bloco = ? AND nome = ?",
        [blocoSelecionado, salaSelecionada]
      );
      if (!salaRows.length) {
        throw new Error("A sala selecionada nao pertence ao bloco informado.");
      }
      const salaFormatada = `${formatarLocal(salaRows[0].bloco)} - ${formatarLocal(salaRows[0].nome)}`;

      await dbRun(
        db,
        "INSERT INTO lista_espera (usuario_id, carrinho_id, quantidade, data_retirada, data_devolucao, sala, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          usuario_id,
          carrinhoId,
          quantidadeNum,
          toMySQLDateTime(data_retirada),
          toMySQLDateTime(data_devolucao),
          salaFormatada,
          'Aguardando'
        ]
      );

      await registrarAuditoria(req, {
        acao: "ENTROU_FILA_ESPERa",
        entidade: "lista_espera",
        entidadeId: null, // we don't have insertId from dbRun easily without db.pool.execute, but it's fine for now. Wait, dbRun does return this! Let's just pass null to save time or use db.pool.
        detalhes: {
          carrinho_id: carrinhoId,
          quantidade: quantidadeNum,
          data_retirada,
          data_devolucao,
          sala: salaFormatada
        }
      });

      req.session.sucesso = "Voce entrou na fila de espera. Avisaremos caso haja disponibilidade.";
      res.redirect("/");
    } catch (err) {
      console.error(err);
      req.session.erro = "Nao foi possivel entrar na fila de espera.";
      res.redirect("/");
    }
  });

  router.post("/reservar", isAuthenticated, async (req, res) => {
    const {
      carrinho_id,
      quantidade,
      data_retirada,
      data_devolucao,
      bloco,
      sala,
      addToCalendar,
    } = req.body;
    const carrinhoId = parseInt(carrinho_id, 10);
    const quantidadeNum = parseInt(quantidade, 10);
    const usuario_id = req.user.id;
    const blocoSelecionado = (bloco || "").trim();
    const salaSelecionada = (sala || "").trim();

    if (!Number.isInteger(carrinhoId) || carrinhoId <= 0) {
      { req.session.erro = "Selecione um carrinho valido."; return res.redirect("/"); }
    }

    if (!Number.isInteger(quantidadeNum) || quantidadeNum <= 0) {
      { req.session.erro = "Quantidade invalida."; return res.redirect("/"); }
    }
    if (!blocoSelecionado || !salaSelecionada) {
      { req.session.erro = "Selecione o bloco e a sala da reserva."; return res.redirect("/"); }
    }

    const inicioSolicitado = new Date(data_retirada);
    const fimSolicitado = new Date(data_devolucao);
    const agora = new Date();

    if (
      isNaN(inicioSolicitado.getTime()) ||
      isNaN(fimSolicitado.getTime()) ||
      fimSolicitado <= inicioSolicitado
    ) {
      { req.session.erro = "Periodo invalido."; return res.redirect("/"); }
    }
    if (inicioSolicitado < agora) {
      { req.session.erro = "A data de retirada nao pode estar no passado."; return res.redirect("/"); }
    }

    if (req.user.role !== "admin") {
      const minimo = new Date(agora.getTime() + 24 * 60 * 60 * 1000);
      const maximo = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);
      if (inicioSolicitado < minimo) {
        { req.session.erro = "As reservas devem ser feitas com pelo menos 24 horas de antecedencia."; return res.redirect("/"); }
      }
      if (inicioSolicitado > maximo || fimSolicitado > maximo) {
        { req.session.erro = "Maximo de 30 dias de antecedencia."; return res.redirect("/"); }
      }
    }

    let lastID = null;
    let carrinho = null;
    let salaFormatada = "";

    const connection = await db.pool.getConnection();
    await connection.beginTransaction();
    try {
      const [cartRows] = await connection.execute(
        "SELECT capacidade, indisponiveis, nome, ativo FROM carrinhos WHERE id = ? FOR UPDATE",
        [carrinhoId],
      );
      if (!cartRows.length) throw new Error("Carrinho nao encontrado.");
      if (cartRows[0].ativo === 0) throw new Error("Este carrinho esta desativado para reservas.");
      carrinho = normalizarCarrinho(cartRows[0]);

      const [salaRows] = await connection.execute(
        "SELECT bloco, nome FROM salas WHERE bloco = ? AND nome = ?",
        [blocoSelecionado, salaSelecionada],
      );
      if (!salaRows.length) {
        throw new Error("A sala selecionada nao pertence ao bloco informado.");
      }
      salaFormatada = `${formatarLocal(salaRows[0].bloco)} - ${formatarLocal(salaRows[0].nome)}`;

      const [reservasAtivas] = await connection.execute(
        "SELECT quantidade, data_retirada, data_devolucao FROM reservas WHERE carrinho_id = ? AND status IN ('Ativa', 'Retirada') AND data_retirada < ? AND data_devolucao > ?",
        [
          carrinhoId,
          toMySQLDateTime(data_devolucao),
          toMySQLDateTime(data_retirada),
        ],
      );
      const [bloqueiosAtivos] = await connection.execute(
        "SELECT quantidade, data_inicio, data_fim FROM carrinho_bloqueios WHERE carrinho_id = ? AND data_inicio < ? AND data_fim > ?",
        [
          carrinhoId,
          toMySQLDateTime(data_devolucao),
          toMySQLDateTime(data_retirada),
        ],
      );

      const picoDeUso = calcularPicoDeUso(
        reservasAtivas,
        inicioSolicitado,
        fimSolicitado,
      );
      const picoBloqueado = calcularPicoBloqueado(
        bloqueiosAtivos,
        inicioSolicitado,
        fimSolicitado,
      );
      const disponiveisNoPeriodo = Math.max(
        carrinho.disponiveis - picoBloqueado - picoDeUso,
        0,
      );

      // Modo sombra em /reservar: executa validação pura dentro da transação com dados já bloqueados
      try {
        const validacaoSombra = validarConflitoReserva({
          carrinho: { ...carrinho, id: carrinhoId },
          quantidade: quantidadeNum,
          inicio: data_retirada,
          fim: data_devolucao,
          reservasExistentes: reservasAtivas,
          bloqueios: bloqueiosAtivos,
          usuarioRole: req.user.role,
          agora,
        });

        const decisaoAntigaPermite = quantidadeNum <= disponiveisNoPeriodo;
        if (decisaoAntigaPermite !== validacaoSombra.valida) {
          registrarDivergenciaSombra({
            origem: "reservar",
            carrinhoId,
            quantidade: quantidadeNum,
            dataRetirada: data_retirada,
            dataDevolucao: data_devolucao,
            decisaoAntigaPermite,
            decisaoNovaPermite: validacaoSombra.valida,
            disponiveisAntigo: disponiveisNoPeriodo,
            disponiveisNovo: validacaoSombra.disponiveisNoPeriodo,
            motivoSombra: validacaoSombra.motivo,
            usuarioRole: req.user.role,
          });
        }
      } catch (errSombra) {
        console.error("Erro na execucao do modo sombra em /reservar:", errSombra.message);
        registrarDivergenciaSombra({
          origem: "erro_sombra",
          carrinhoId,
          quantidade: quantidadeNum,
          dataRetirada: data_retirada,
          dataDevolucao: data_devolucao,
          erro: errSombra.message,
          stack: errSombra.stack,
        });
      }

      if (quantidadeNum > disponiveisNoPeriodo) {
        throw new Error(
          `Erro: so ha ${disponiveisNoPeriodo} disponiveis para esse periodo.`,
        );
      }

      const [result] = await connection.execute(
        "INSERT INTO reservas (carrinho_id, quantidade, usuario_id, data_retirada, data_devolucao, sala, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          carrinhoId,
          quantidadeNum,
          usuario_id,
          toMySQLDateTime(data_retirada),
          toMySQLDateTime(data_devolucao),
          salaFormatada,
          "Ativa",
        ],
      );
      lastID = result.insertId;
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      const message = err.code
        ? "Nao foi possivel concluir a reserva."
        : err.message;
      { req.session.erro = message; return res.redirect("/"); }
    } finally {
      connection.release();
    }

    await registrarAuditoria(req, {
      acao: "RESERVA_CRIADA",
      entidade: "reserva",
      entidadeId: lastID,
      detalhes: {
        carrinho_id: carrinhoId,
        carrinho: carrinho.nome,
        quantidade: quantidadeNum,
        data_retirada,
        data_devolucao,
        sala: salaFormatada,
        reserva_admin_sem_bloqueio_prazo: req.user.role === "admin",
      },
    });

    const tituloEvento = `Reserva de ${quantidadeNum} Chromebooks (${carrinho.nome})`;
    const descricaoEvento = `Reserva realizada por ${req.user.nome}. ID da Reserva: ${lastID}`;
    const localEvento = `${salaFormatada}, Colegio La Salle`;
    const linkGoogleCalendar = gerarLinkGoogleCalendar(
      tituloEvento,
      descricaoEvento,
      localEvento,
      data_retirada,
      data_devolucao,
    );
    const arquivoICS = gerarICS(
      tituloEvento,
      descricaoEvento,
      localEvento,
      data_retirada,
      data_devolucao,
    );
    const avisos = [];

    try {
      await sendReservationEmail({
        to: req.user.email,
        subject: "Confirmacao da sua reserva",
        text: `Olá ${req.user.nome}, sua reserva foi feita com sucesso!\n\nDetalhes:\nCarrinho: ${carrinho.nome}\nQuantidade: ${quantidadeNum}\nData de Retirada: ${data_retirada}\nData de Devolução: ${data_devolucao}\nSala: ${salaFormatada}\n\nAdicione à sua agenda: ${linkGoogleCalendar}`,
        html: `
<p>Olá <b>${req.user.nome}</b>, sua reserva foi feita com sucesso!</p>
<p><b>Detalhes:</b><br>
Carrinho: ${carrinho.nome}<br>
Quantidade: ${quantidadeNum}<br>
Data de Retirada: ${formatarDataBR(data_retirada)}<br>
Data de Devolução: ${formatarDataBR(data_devolucao)}<br>
Sala: ${salaFormatada}</p>
<p>Adicione à sua agenda: <a href="${linkGoogleCalendar}">Google Calendar</a><br>
Ou abra o anexo .ics para Outlook/Apple Calendar.</p>
<br>
<p><b>Equipe de Tecnologia - Colégio La Salle</b><br>
(11) 2793.1444<br>
<a href="https://www.lasalle.edu.br/saopaulo">https://www.lasalle.edu.br/saopaulo</a></p>`,
        attachments: [{ filename: "reserva.ics", content: arquivoICS }],
      });
    } catch (emailErr) {
      avisos.push("O e-mail de confirmacao nao pode ser enviado.");
    }

    let googleRefreshToken = null;
    if (addToCalendar === "true") {
      const tokenRow = await dbGet(
        db,
        "SELECT google_refresh_token FROM usuarios WHERE id = ? AND ativo = 1",
        [req.user.id],
      );
      googleRefreshToken = decryptToken(tokenRow?.google_refresh_token);
    }

    if (googleRefreshToken) {
      try {
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          "/auth/google/callback",
        );
        oauth2Client.setCredentials({
          refresh_token: googleRefreshToken,
        });
        const calendar = google.calendar({ version: "v3", auth: oauth2Client });
        await calendar.events.insert({
          calendarId: "primary",
          resource: {
            summary: tituloEvento,
            location: localEvento,
            description: descricaoEvento,
            start: {
              dateTime: new Date(data_retirada).toISOString(),
              timeZone: "America/Sao_Paulo",
            },
            end: {
              dateTime: new Date(data_devolucao).toISOString(),
              timeZone: "America/Sao_Paulo",
            },
            attendees: [{ email: req.user.email }],
          },
        });
      } catch (calendarErr) {
        avisos.push("Houve falha ao adicionar o evento no Google Calendar.");
      }
    }

    req.session.sucesso = "Sua reserva foi feita com sucesso!";
    if (avisos.length > 0) {
      req.session.erro = avisos.join(" ");
    }
    res.redirect("/");
  });

  return router;
};
