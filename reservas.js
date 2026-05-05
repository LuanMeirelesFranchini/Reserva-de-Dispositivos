const express = require("express");
const { google } = require("googleapis");

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
      const carrinhosDb = await new Promise((r, j) =>
        db.all("SELECT * FROM carrinhos", [], (e, rows) =>
          e ? j(e) : r(rows),
        ),
      );
      const carrinhos = carrinhosDb.map(normalizarCarrinho);
      const salas = await new Promise((r, j) =>
        db.all("SELECT bloco, nome FROM salas", [], (e, rows) =>
          e ? j(e) : r(rows),
        ),
      );
      const blocosSalas = montarSalasParaView(salas);
      res.render("index", {
        carrinhos,
        blocosSalas,
        user: req.user,
        erro: req.query.erro || "",
        sucesso: req.query.sucesso || "",
      });
    } catch (err) {
      res.status(500).send("Erro ao carregar a página: " + err.message);
    }
  });

  router.get("/minhas-reservas", isAuthenticated, async (req, res) => {
    try {
      const sql = `SELECT r.*, c.nome as nome_carrinho FROM reservas r JOIN carrinhos c ON r.carrinho_id = c.id WHERE r.usuario_id = ? AND r.status = 'Ativa' ORDER BY r.data_retirada ASC`;
      const reservas = await new Promise((r, j) =>
        db.all(sql, [req.user.id], (e, rows) => (e ? j(e) : r(rows))),
      );
      res.render("minhas-reservas", {
        reservas,
        user: req.user,
        erro: req.query.erro || "",
        sucesso: req.query.sucesso || "",
      });
    } catch (err) {
      res.status(500).send("Erro ao carregar suas reservas.");
    }
  });

  router.post("/reservas/cancelar/:id", isAuthenticated, async (req, res) => {
    const reservaId = req.params.id;
    try {
      const reserva = await new Promise((r, j) =>
        db.get(
          `SELECT r.*, c.nome as nome_carrinho FROM reservas r LEFT JOIN carrinhos c ON r.carrinho_id = c.id WHERE r.id = ?`,
          [reservaId],
          (e, row) => (e ? j(e) : r(row)),
        ),
      );
      if (
        !reserva ||
        (reserva.usuario_id !== req.user.id && req.user.role !== "admin")
      )
        return res
          .status(403)
          .send("Você não tem permissão para cancelar esta reserva.");
      await new Promise((r, j) =>
        db.run(
          "UPDATE reservas SET status = 'Cancelada' WHERE id = ?",
          [reservaId],
          (e) => (e ? j(e) : r()),
        ),
      );
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
      res.redirect("/minhas-reservas?sucesso=Reserva cancelada com sucesso.");
    } catch (err) {
      res.status(500).send("Erro ao cancelar reserva.");
    }
  });

  router.post(
    "/reservas/concluir/:id",
    canManageReservations,
    async (req, res) => {
      const reservaId = req.params.id;
      const nomeQuemConcluiu = req.user.nome;
      try {
        const reserva = await new Promise((resolve, reject) => {
          db.get(
            `SELECT r.*, c.nome as nome_carrinho, u.nome as nome_professor FROM reservas r LEFT JOIN carrinhos c ON r.carrinho_id = c.id LEFT JOIN usuarios u ON r.usuario_id = u.id WHERE r.id = ?`,
            [reservaId],
            (err, row) => (err ? reject(err) : resolve(row)),
          );
        });
        if (!reserva) return res.status(404).send("Reserva não encontrada.");
        await new Promise((resolve, reject) => {
          db.run(
            "UPDATE reservas SET status = 'Concluida', concluido_por = ? WHERE id = ?",
            [nomeQuemConcluiu, reservaId],
            function (err) {
              err ? reject(err) : resolve();
            },
          );
        });
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
        res.status(500).send("Erro ao concluir reserva: " + err.message);
      }
    },
  );

  router.post("/reservar-recorrente", isAuthenticated, async (req, res) =>
    res.redirect(
      "/?erro=" +
        encodeURIComponent("Reservas recorrentes ainda não estão ativas."),
    ),
  );

  router.get("/api/availability", ensureAuthenticatedApi, async (req, res) => {
    const { carrinho_id, data_retirada, data_devolucao } = req.query;
    if (!carrinho_id || !data_retirada || !data_devolucao)
      return res.status(400).json({ error: "Parâmetros faltando." });

    const inicioNovaReserva = new Date(data_retirada);
    const fimNovaReserva = new Date(data_devolucao);
    if (
      isNaN(inicioNovaReserva) ||
      isNaN(fimNovaReserva) ||
      fimNovaReserva <= inicioNovaReserva
    )
      return res.status(400).json({ error: "Datas inválidas." });

    try {
      const carrinhoDb = await new Promise((resolve, reject) => {
        db.get(
          "SELECT capacidade, indisponiveis FROM carrinhos WHERE id = ?",
          [carrinho_id],
          (err, row) => (err ? reject(err) : resolve(row)),
        );
      });
      const carrinho = carrinhoDb ? normalizarCarrinho(carrinhoDb) : null;
      if (!carrinho)
        return res.status(404).json({ error: "Carrinho não encontrado." });

      // Query Otimizada: Traz apenas reservas que se sobrepõem ao período solicitado
      const reservasAtivas = await new Promise((resolve, reject) => {
        db.all(
          "SELECT quantidade, data_retirada, data_devolucao FROM reservas WHERE carrinho_id = ? AND status = 'Ativa' AND data_retirada < ? AND data_devolucao > ?",
          [
            carrinho_id,
            toMySQLDateTime(data_devolucao),
            toMySQLDateTime(data_retirada),
          ],
          (err, rows) => (err ? reject(err) : resolve(rows)),
        );
      });

      let picoDeUso = 0;
      for (
        let t = inicioNovaReserva.getTime();
        t < fimNovaReserva.getTime();
        t += 60000
      ) {
        let emUso = 0;
        for (const r of reservasAtivas) {
          if (
            t >= new Date(r.data_retirada).getTime() &&
            t < new Date(r.data_devolucao).getTime()
          )
            emUso += r.quantidade;
        }
        if (emUso > picoDeUso) picoDeUso = emUso;
      }
      res.json({ disponiveis: Math.max(carrinho.disponiveis - picoDeUso, 0) });
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
    const quantidadeNum = parseInt(quantidade, 10);
    const usuario_id = req.user.id;
    const blocoSelecionado = (bloco || "").trim();
    const salaSelecionada = (sala || "").trim();

    if (!Number.isInteger(quantidadeNum) || quantidadeNum <= 0)
      return res.redirect(
        "/?erro=" + encodeURIComponent("Quantidade invalida."),
      );
    if (!blocoSelecionado || !salaSelecionada)
      return res.redirect(
        "/?erro=" +
          encodeURIComponent("Selecione o bloco e a sala da reserva."),
      );

    const inicioSolicitado = new Date(data_retirada);
    const fimSolicitado = new Date(data_devolucao);
    const agora = new Date();

    if (
      isNaN(inicioSolicitado.getTime()) ||
      isNaN(fimSolicitado.getTime()) ||
      fimSolicitado <= inicioSolicitado
    )
      return res.redirect("/?erro=" + encodeURIComponent("Periodo invalido."));
    if (inicioSolicitado < agora)
      return res.redirect(
        "/?erro=" +
          encodeURIComponent("A data de retirada nao pode estar no passado."),
      );

    if (req.user.role !== "admin") {
      const minimo = new Date(agora.getTime() + 24 * 60 * 60 * 1000);
      const maximo = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);
      if (inicioSolicitado < minimo)
        return res.redirect(
          "/?erro=" +
            encodeURIComponent(
              "As reservas devem ser feitas com pelo menos 24 horas de antecedencia.",
            ),
        );
      if (inicioSolicitado > maximo || fimSolicitado > maximo)
        return res.redirect(
          "/?erro=" + encodeURIComponent("Máximo de 30 dias de antecedencia."),
        );
    }

    let lastID = null;
    let carrinho = null;
    let salaFormatada = "";

    // ==== TRANSAÇÃO PARA EVITAR RACE CONDITION ====
    const connection = await db.pool.getConnection();
    await connection.beginTransaction();
    try {
      const [cartRows] = await connection.execute(
        "SELECT capacidade, indisponiveis, nome FROM carrinhos WHERE id = ? FOR UPDATE",
        [carrinho_id],
      );
      if (!cartRows.length) throw new Error("Carrinho não encontrado.");
      carrinho = normalizarCarrinho(cartRows[0]);

      const [salaRows] = await connection.execute(
        "SELECT bloco, nome FROM salas WHERE bloco = ? AND nome = ?",
        [blocoSelecionado, salaSelecionada],
      );
      if (!salaRows.length)
        throw new Error("A sala selecionada nao pertence ao bloco informado.");
      salaFormatada = `${formatarLocal(salaRows[0].bloco)} - ${formatarLocal(salaRows[0].nome)}`;

      const [reservasAtivas] = await connection.execute(
        "SELECT quantidade, data_retirada, data_devolucao FROM reservas WHERE carrinho_id = ? AND status = 'Ativa' AND data_retirada < ? AND data_devolucao > ?",
        [
          carrinho_id,
          toMySQLDateTime(data_devolucao),
          toMySQLDateTime(data_retirada),
        ],
      );

      let picoDeUso = 0;
      for (
        let t = inicioSolicitado.getTime();
        t < fimSolicitado.getTime();
        t += 60000
      ) {
        let u = 0;
        for (const R of reservasAtivas) {
          if (
            t >= new Date(R.data_retirada).getTime() &&
            t < new Date(R.data_devolucao).getTime()
          )
            u += R.quantidade;
        }
        if (u > picoDeUso) picoDeUso = u;
      }

      if (quantidadeNum > carrinho.disponiveis - picoDeUso)
        throw new Error(
          `Erro: só há ${Math.max(carrinho.disponiveis - picoDeUso, 0)} disponíveis.`,
        );

      const [result] = await connection.execute(
        `INSERT INTO reservas (carrinho_id, quantidade, usuario_id, data_retirada, data_devolucao, sala, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          carrinho_id,
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
      connection.release();
      return res.redirect("/?erro=" + encodeURIComponent(err.message));
    }
    connection.release();
    // ==============================================

    // Ações secundárias fora da transação
    await registrarAuditoria(req, {
      acao: "RESERVA_CRIADA",
      entidade: "reserva",
      entidadeId: lastID,
      detalhes: {
        carrinho_id,
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
    const localEvento = `${salaFormatada}, Colégio La Salle`;
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
        subject: "Confirmação da sua reserva",
        text: `Sua reserva foi feita com sucesso. Adicione à sua agenda: ${linkGoogleCalendar}`,
        html: `<p>Sua reserva foi feita com sucesso!</p>`,
        attachments: [{ filename: "reserva.ics", content: arquivoICS }],
      });
    } catch (emailErr) {
      avisos.push("O e-mail de confirmação não pôde ser enviado.");
    }

    if (addToCalendar === "true" && req.user.google_refresh_token) {
      try {
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          "/auth/google/callback",
        );
        oauth2Client.setCredentials({
          refresh_token: req.user.google_refresh_token,
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
    if (avisos.length > 0)
      redirectUrl = appendFlashMessage(redirectUrl, "erro", avisos.join(" "));
    res.redirect(redirectUrl);
  });

  return router;
};
