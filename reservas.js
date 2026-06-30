const express = require("express");
const { google } = require("googleapis");
const { dbAll, dbGet, dbRun } = require("./database");
const { decryptToken } = require("./helpers/token-crypto");
const {
  calcularDisponiveisComBloqueios,
  calcularPicoBloqueado,
  calcularPicoDeUso,
} = require("./services/reservation-service");

module.exports = (db, middlewares, helpers) => {
  const router = express.Router();
  const { isAuthenticated, ensureAuthenticatedApi, canManageReservations } =
    middlewares;
  const {
    normalizarCarrinho,
    registrarAuditoria,
    toMySQLDateTime,
    formatarLocal,
    montarSalasParaView,
    gerarLinkGoogleCalendar,
    gerarICS,
    sendReservationEmail,
    appendFlashMessage,
  } = helpers;

  router.get("/", isAuthenticated, async (req, res) => {
    try {
      const carrinhosDb = await dbAll(db, "SELECT * FROM carrinhos");
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
        "SELECT r.*, c.nome as nome_carrinho FROM reservas r JOIN carrinhos c ON r.carrinho_id = c.id WHERE r.usuario_id = ? AND r.status = 'Ativa' ORDER BY r.data_retirada ASC";
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
      { req.session.sucesso = "Reserva cancelada com sucesso."; res.redirect("/minhas-reservas"); }
    } catch (err) {
      res.status(500).send("Erro ao cancelar reserva.");
    }
  });

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

        if (reserva.status !== "Ativa") {
          return res
            .status(409)
            .send("Apenas reservas ativas podem ser concluidas.");
        }

        const result = await dbRun(
          db,
          "UPDATE reservas SET status = 'Concluida', concluido_por = ? WHERE id = ? AND status = 'Ativa'",
          [nomeQuemConcluiu, reservaId],
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
          },
        });
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
        "SELECT capacidade, indisponiveis FROM carrinhos WHERE id = ?",
        [carrinhoId],
      );
      const carrinho = carrinhoDb ? normalizarCarrinho(carrinhoDb) : null;
      if (!carrinho) {
        return res.status(404).json({ error: "Carrinho nao encontrado." });
      }

      const reservasAtivas = await dbAll(
        db,
        "SELECT quantidade, data_retirada, data_devolucao FROM reservas WHERE carrinho_id = ? AND status = 'Ativa' AND data_retirada < ? AND data_devolucao > ?",
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

      res.json({
        disponiveis: calcularDisponiveisComBloqueios(
          carrinho,
          reservasAtivas,
          bloqueiosAtivos,
          inicioNovaReserva,
          fimNovaReserva,
        ),
      });
    } catch (err) {
      res.status(500).json({ error: "Erro interno no servidor." });
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
        "SELECT capacidade, indisponiveis, nome FROM carrinhos WHERE id = ? FOR UPDATE",
        [carrinhoId],
      );
      if (!cartRows.length) throw new Error("Carrinho nao encontrado.");
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
        "SELECT quantidade, data_retirada, data_devolucao FROM reservas WHERE carrinho_id = ? AND status = 'Ativa' AND data_retirada < ? AND data_devolucao > ?",
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
        text: `Sua reserva foi feita com sucesso. Adicione a sua agenda: ${linkGoogleCalendar}`,
        html: "<p>Sua reserva foi feita com sucesso!</p>",
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

    let redirectUrl =
      "/?sucesso=" + encodeURIComponent("Sua reserva foi feita com sucesso!");
    if (avisos.length > 0) {
      redirectUrl = appendFlashMessage(redirectUrl, "erro", avisos.join(" "));
    }
    res.redirect(redirectUrl);
  });

  return router;
};
