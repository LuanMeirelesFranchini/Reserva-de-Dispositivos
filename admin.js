const express = require("express");
const { dbAll, dbGet, dbRun } = require("./database");
const {
  calcularPicoBloqueado,
  calcularPicoDeUso,
} = require("./services/reservation-service");
const { montarSalasParaView } = require("./salas-data");
const { escaparLike, calcularPaginacao } = require("./helpers/pagination-helper");
const { podeAlterarOuDesativarAdmin } = require("./helpers/user-rules");
const { processarFilaEspera } = require("./services/waitlist-service");


const MONTH_NAMES_PT_BR = [
  "Janeiro",
  "Fevereiro",
  "Marco",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonthParam(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseMonthReference(monthParam) {
  if (typeof monthParam === "string" && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [year, month] = monthParam.split("-").map(Number);
    const parsed = new Date(year, month - 1, 1);

    if (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === 1
    ) {
      return parsed;
    }
  }

  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function getMonthContext(monthParam) {
  const monthStart = parseMonthReference(monthParam);
  const monthEnd = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth() + 1,
    1,
  );
  const previousMonth = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth() - 1,
    1,
  );
  const nextMonth = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth() + 1,
    1,
  );

  return {
    monthStart,
    monthEnd,
    monthParam: formatMonthParam(monthStart),
    previousMonthParam: formatMonthParam(previousMonth),
    nextMonthParam: formatMonthParam(nextMonth),
    label: `${MONTH_NAMES_PT_BR[monthStart.getMonth()]} de ${monthStart.getFullYear()}`,
  };
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function overlapsPeriod(item, inicio, fim, startKey, endKey) {
  return (
    new Date(item[startKey]).getTime() < fim.getTime() &&
    new Date(item[endKey]).getTime() > inicio.getTime()
  );
}

function buildCalendarData({
  monthStart,
  monthEnd,
  reservas,
  bloqueios,
  capacidadeBase,
}) {
  const todayKey = formatDateKey(new Date());
  const days = [];

  for (
    let cursor = new Date(monthStart);
    cursor < monthEnd;
    cursor = addDays(cursor, 1)
  ) {
    const dayStart = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate(),
      0,
      0,
      0,
      0,
    );
    const dayEnd = addDays(dayStart, 1);
    const reservasDoDia = reservas.filter((reserva) =>
      overlapsPeriod(reserva, dayStart, dayEnd, "data_retirada", "data_devolucao"),
    );
    const bloqueiosDoDia = bloqueios.filter((bloqueio) =>
      overlapsPeriod(bloqueio, dayStart, dayEnd, "data_inicio", "data_fim"),
    );
    const reservadoNoPico = reservasDoDia.length
      ? calcularPicoDeUso(reservasDoDia, dayStart, dayEnd)
      : 0;
    const bloqueadoNoPico = bloqueiosDoDia.length
      ? calcularPicoBloqueado(bloqueiosDoDia, dayStart, dayEnd)
      : 0;
    const capacidadeEfetiva = Math.max(capacidadeBase - bloqueadoNoPico, 0);
    const ocupacao = capacidadeEfetiva
      ? Number(((reservadoNoPico / capacidadeEfetiva) * 100).toFixed(1))
      : 0;

    let nivel = "green";
    if (ocupacao > 85) {
      nivel = "red";
    } else if (ocupacao > 60) {
      nivel = "yellow";
    }

    days.push({
      dayNumber: cursor.getDate(),
      dateKey: formatDateKey(cursor),
      isToday: formatDateKey(cursor) === todayKey,
      reservadoNoPico,
      bloqueadoNoPico,
      capacidadeEfetiva,
      ocupacao,
      reservasAtivas: reservasDoDia.length,
      nivel,
    });
  }

  const weeks = [];
  const firstDayOffset = (monthStart.getDay() + 6) % 7;
  let currentWeek = Array(firstDayOffset).fill(null);

  for (const day of days) {
    currentWeek.push(day);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push(null);
    weeks.push(currentWeek);
  }

  const worstDay = days.reduce(
    (highest, day) => (day.ocupacao > highest.ocupacao ? day : highest),
    { ocupacao: -1, reservadoNoPico: 0, dateKey: null, bloqueadoNoPico: 0 },
  );
  const occupiedDays = days.filter((day) => day.reservadoNoPico > 0);
  const criticalDays = days.filter((day) => day.nivel === "red").length;
  const warningDays = days.filter((day) => day.nivel === "yellow").length;
  const mediaOcupacao = days.length
    ? Number(
        (
          days.reduce((sum, day) => sum + day.ocupacao, 0) / days.length
        ).toFixed(1),
      )
    : 0;

  return {
    weeks,
    days,
    summary: {
      capacidadeBase,
      occupiedDays: occupiedDays.length,
      criticalDays,
      warningDays,
      mediaOcupacao,
      worstDay:
        worstDay.dateKey === null
          ? null
          : {
              dateKey: worstDay.dateKey,
              ocupacao: worstDay.ocupacao,
              reservadoNoPico: worstDay.reservadoNoPico,
              bloqueadoNoPico: worstDay.bloqueadoNoPico,
            },
    },
  };
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

module.exports = (db, middlewares, helpers) => {
  const router = express.Router();
  const { isAdmin, canManageReservations } = middlewares;
  const {
    normalizarCarrinho,
    registrarAuditoria,
    toMySQLDateTime,
    estaEmAtraso,
  } = helpers;

  router.get("/", canManageReservations, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const statusFiltro = String(req.query.status || "").trim();
      
      // Trata parâmetro legado ?data=X como data_inicio=X e data_fim=X
      const dataLegado = String(req.query.data || "").trim();
      const dataInicioFiltro = String(req.query.data_inicio || dataLegado || "").trim();
      const dataFimFiltro = String(req.query.data_fim || dataLegado || "").trim();
      
      const blocoFiltro = String(req.query.bloco || "").trim();
      // Padrão de ordenação: 'antigas' (ASC: hoje ➔ futuro)
      const ordemFiltro = req.query.ordem === "recentes" ? "recentes" : "antigas";
      const ordemSql = ordemFiltro === "recentes" ? "DESC" : "ASC";

      const countParams = [];
      const dataParams = [];
      const whereClauses = [];

      // Status
      if (statusFiltro === "Atrasada") {
        const agoraStr = toMySQLDateTime(new Date());
        whereClauses.push("r.status IN ('Ativa', 'Retirada') AND r.data_devolucao < ?");
        countParams.push(agoraStr);
        dataParams.push(agoraStr);
      } else if (statusFiltro && ["Ativa", "Retirada", "Concluida", "Cancelada"].includes(statusFiltro)) {
        whereClauses.push("r.status = ?");
        countParams.push(statusFiltro);
        dataParams.push(statusFiltro);
      } else {
        whereClauses.push("r.status IN ('Ativa', 'Retirada')");
      }

      // Busca por professor com LIKE parametrizado
      if (q) {
        whereClauses.push("u.nome LIKE ?");
        const likeTerm = `%${escaparLike(q)}%`;
        countParams.push(likeTerm);
        dataParams.push(likeTerm);
      }

      // Semântica de sobreposição de intervalos:
      // [r.data_retirada, r.data_devolucao] intersecta [data_inicio, data_fim]
      if (dataInicioFiltro && dataFimFiltro) {
        whereClauses.push("DATE(r.data_retirada) <= DATE(?) AND DATE(r.data_devolucao) >= DATE(?)");
        countParams.push(dataFimFiltro, dataInicioFiltro);
        dataParams.push(dataFimFiltro, dataInicioFiltro);
      } else if (dataInicioFiltro) {
        whereClauses.push("DATE(r.data_devolucao) >= DATE(?)");
        countParams.push(dataInicioFiltro);
        dataParams.push(dataInicioFiltro);
      } else if (dataFimFiltro) {
        whereClauses.push("DATE(r.data_retirada) <= DATE(?)");
        countParams.push(dataFimFiltro);
        dataParams.push(dataFimFiltro);
      }

      // Bloco
      if (blocoFiltro) {
        whereClauses.push("r.sala LIKE ?");
        const blocoTerm = `${escaparLike(blocoFiltro)}%`;
        countParams.push(blocoTerm);
        dataParams.push(blocoTerm);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
      const countSql = `
        SELECT COUNT(*) as count
        FROM reservas r
        JOIN carrinhos c ON r.carrinho_id = c.id
        JOIN usuarios u ON r.usuario_id = u.id
        ${whereSql}
      `;
      const totalResult = await dbGet(db, countSql, countParams);
      const totalCount = totalResult ? totalResult.count : 0;

      const paginacao = calcularPaginacao({
        totalItems: totalCount,
        currentPage: req.query.page,
        pageSize: req.query.limit,
      });

      const dataSql = `
        SELECT r.*, c.nome as nome_carrinho, u.nome as nome_professor
        FROM reservas r
        JOIN carrinhos c ON r.carrinho_id = c.id
        JOIN usuarios u ON r.usuario_id = u.id
        ${whereSql}
        ORDER BY r.data_retirada ${ordemSql}
        LIMIT ${paginacao.pageSize} OFFSET ${paginacao.offset}
      `;
      const reservas = await dbAll(db, dataSql, dataParams);
      const blocosSalas = montarSalasParaView();

      res.render("admin", {
        reservas,
        user: req.user,
        q,
        statusFiltro,
        dataFiltro: dataLegado,
        dataInicioFiltro,
        dataFimFiltro,
        blocoFiltro,
        blocosSalas,
        paginacao,
        currentPage: paginacao.currentPage,
        totalPages: paginacao.totalPages,
        currentLimit: paginacao.pageSize,
        ordemFiltro,
        estaEmAtraso,
      });
    } catch (err) {
      console.error("Erro interno em GET /admin:", err);
      res.status(500).send("Erro ao carregar a pagina de admin.");
    }
  });


  router.get("/users", isAdmin, async (req, res) => {
    try {
      const usuarios = await dbAll(
        db,
        "SELECT id, nome, email, role FROM usuarios WHERE ativo = 1 ORDER BY nome ASC",
      );
      res.render("admin-users", { usuarios, user: req.user });
    } catch (err) {
      console.error("Erro interno em GET /admin/users:", err);
      res.status(500).send("Erro ao carregar utilizadores.");
    }
  });

  router.get("/history", canManageReservations, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const dataLegado = String(req.query.data || "").trim();
      const dataInicioFiltro = String(req.query.data_inicio || dataLegado || "").trim();
      const dataFimFiltro = String(req.query.data_fim || dataLegado || "").trim();
      const ordemFiltro = req.query.ordem === 'antigas' ? 'antigas' : 'recentes';
      const ordemSql = ordemFiltro === 'antigas' ? 'ASC' : 'DESC';

      const countParams = [];
      const dataParams = [];
      const whereClauses = ["r.status = 'Concluida'"];

      if (q) {
        whereClauses.push("(u.nome LIKE ? OR r.sala LIKE ?)");
        const likeTerm = `%${escaparLike(q)}%`;
        countParams.push(likeTerm, likeTerm);
        dataParams.push(likeTerm, likeTerm);
      }

      if (dataInicioFiltro && dataFimFiltro) {
        whereClauses.push("DATE(r.data_retirada) <= DATE(?) AND DATE(r.data_devolucao) >= DATE(?)");
        countParams.push(dataFimFiltro, dataInicioFiltro);
        dataParams.push(dataFimFiltro, dataInicioFiltro);
      } else if (dataInicioFiltro) {
        whereClauses.push("DATE(r.data_devolucao) >= DATE(?)");
        countParams.push(dataInicioFiltro);
        dataParams.push(dataInicioFiltro);
      } else if (dataFimFiltro) {
        whereClauses.push("DATE(r.data_retirada) <= DATE(?)");
        countParams.push(dataFimFiltro);
        dataParams.push(dataFimFiltro);
      }

      const whereSql = `WHERE ${whereClauses.join(" AND ")}`;
      const countSql = `
        SELECT COUNT(*) as count
        FROM reservas r
        JOIN carrinhos c ON r.carrinho_id = c.id
        JOIN usuarios u ON r.usuario_id = u.id
        ${whereSql}
      `;
      const totalResult = await dbGet(db, countSql, countParams);
      const totalCount = totalResult ? totalResult.count : 0;

      const paginacao = calcularPaginacao({
        totalItems: totalCount,
        currentPage: req.query.page,
        pageSize: req.query.limit,
      });

      const dataSql = `
        SELECT r.*, c.nome as nome_carrinho, u.nome as nome_professor
        FROM reservas r
        JOIN carrinhos c ON r.carrinho_id = c.id
        JOIN usuarios u ON r.usuario_id = u.id
        ${whereSql}
        ORDER BY r.data_devolucao ${ordemSql}
        LIMIT ${paginacao.pageSize} OFFSET ${paginacao.offset}
      `;
      const reservas = await dbAll(db, dataSql, dataParams);

      res.render("admin-history", {
        reservas,
        user: req.user,
        q,
        dataFiltro: dataLegado,
        dataInicioFiltro,
        dataFimFiltro,
        paginacao,
        currentPage: paginacao.currentPage,
        totalPages: paginacao.totalPages,
        currentLimit: paginacao.pageSize,
        ordemFiltro,
      });
    } catch (err) {
      console.error("Erro interno em GET /admin/history:", err);
      res.status(500).send("Erro ao carregar historico.");
    }
  });

  router.get("/audit", isAdmin, async (req, res) => {
    try {
      const acaoFiltro = (req.query.acao || "").trim();
      const params = [];
      let sql = "SELECT * FROM audit_logs";

      if (acaoFiltro) {
        sql += " WHERE acao = ?";
        params.push(acaoFiltro);
      }

      sql += " ORDER BY criado_em DESC, id DESC LIMIT 300";

      const logs = await dbAll(db, sql, params);
      const acoesRows = await dbAll(
        db,
        "SELECT DISTINCT acao FROM audit_logs ORDER BY acao ASC",
      );
      const acoes = acoesRows.map((row) => row.acao);

      res.render("admin-audit", { logs, acoes, acaoFiltro, user: req.user });
    } catch (err) {
      console.error("Erro interno em GET /admin/audit:", err);
      res.status(500).send("Erro ao carregar auditoria.");
    }
  });

  router.get("/inventario", isAdmin, async (req, res) => {
    try {
      const [carrinhos, bloqueiosProgramados, resumoAtual] = await Promise.all([
        dbAll(db, "SELECT * FROM carrinhos ORDER BY nome ASC"),
        dbAll(
          db,
          `SELECT b.*, c.nome as nome_carrinho
           FROM carrinho_bloqueios b
           JOIN carrinhos c ON c.id = b.carrinho_id
           WHERE b.data_fim >= NOW()
           ORDER BY b.data_inicio ASC, b.id ASC`,
        ),
        dbGet(
          db,
          `SELECT
              COUNT(*) as total,
              COALESCE(SUM(CASE WHEN data_inicio <= NOW() AND data_fim > NOW() THEN quantidade ELSE 0 END), 0) as bloqueadosAgora
           FROM carrinho_bloqueios
           WHERE data_fim >= NOW()`,
        ),
      ]);

      res.render("admin-inventario", {
        user: req.user,
        carrinhos: carrinhos.map(normalizarCarrinho),
        bloqueiosProgramados,
        resumoBloqueios: {
          total: resumoAtual?.total || 0,
          bloqueadosAgora: resumoAtual?.bloqueadosAgora || 0,
        },
      });
    } catch (err) {
      res.status(500).send("Erro ao carregar inventario.");
    }
  });

  router.post("/inventario/update", isAdmin, async (req, res) => {
    const id = parseInt(req.body.id, 10);
    const capacidade = parseInt(req.body.capacidade, 10);
    const indisponiveis = parseInt(req.body.indisponiveis, 10);
    const ativo = parseInt(req.body.ativo, 10) === 1 ? 1 : 0;

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Carrinho invalido." });
    }

    if (!Number.isInteger(capacidade) || capacidade < 0) {
      return res.status(400).json({ message: "Capacidade invalida." });
    }

    if (!Number.isInteger(indisponiveis) || indisponiveis < 0) {
      return res
        .status(400)
        .json({ message: "Quantidade em manutencao invalida." });
    }

    if (indisponiveis > capacidade) {
      return res.status(400).json({
        message: "Indisponiveis nao pode ser maior que a capacidade total.",
      });
    }

    try {
      const carrinhoAnterior = await dbGet(
        db,
        "SELECT id, nome, capacidade, indisponiveis, ativo FROM carrinhos WHERE id = ?",
        [id],
      );

      if (!carrinhoAnterior) {
        return res.status(404).json({ message: "Carrinho nao encontrado." });
      }

      await dbRun(
        db,
        "UPDATE carrinhos SET capacidade = ?, indisponiveis = ?, ativo = ? WHERE id = ?",
        [capacidade, indisponiveis, ativo, id],
      );

      await registrarAuditoria(req, {
        acao: "INVENTARIO_ATUALIZADO",
        entidade: "carrinho",
        entidadeId: id,
        detalhes: {
          carrinho: carrinhoAnterior.nome,
          antes: {
            capacidade: carrinhoAnterior.capacidade,
            indisponiveis: carrinhoAnterior.indisponiveis,
            ativo: carrinhoAnterior.ativo,
          },
          depois: { capacidade, indisponiveis, ativo },
        },
      });

      const capacidadeAumentou =
        Number(capacidade) > Number(carrinhoAnterior.capacidade);
      const indisponiveisDiminuiram =
        Number(indisponiveis) < Number(carrinhoAnterior.indisponiveis);

      if (capacidadeAumentou || indisponiveisDiminuiram) {
        try {
          await processarFilaEspera(db, id, {
            id: req.user?.id,
            nome: req.user?.nome,
            role: req.user?.role,
            ip: req.ip || req.socket?.remoteAddress || null,
          });
        } catch (filaErr) {
          console.error(
            "Erro ao processar fila de espera apos atualizar inventario:",
            filaErr.message,
          );
        }
      }

      res.json({
        message: "Sucesso!",
        disponiveis: Math.max(capacidade - indisponiveis, 0),
      });
    } catch (err) {
      res.status(500).json({ message: "Erro ao atualizar banco." });
    }
  });

  router.post("/inventario/bloqueios", isAdmin, async (req, res) => {
    const carrinhoId = parseInt(req.body.carrinho_id, 10);
    const quantidade = parseInt(req.body.quantidade, 10);
    const motivo = String(req.body.motivo || "").trim();
    const dataInicio = new Date(req.body.data_inicio);
    const dataFim = new Date(req.body.data_fim);

    if (!Number.isInteger(carrinhoId) || carrinhoId <= 0) {
      req.session.erro = "Selecione um carrinho valido para o bloqueio.";
      return res.redirect("/admin/inventario");
    }
    if (!Number.isInteger(quantidade) || quantidade <= 0) {
      req.session.erro = "A quantidade de dispositivos a bloquear deve ser maior que zero.";
      return res.redirect("/admin/inventario");
    }
    if (!motivo) {
      req.session.erro = "Informe o motivo do bloqueio para registro.";
      return res.redirect("/admin/inventario");
    }
    if (isNaN(dataInicio.getTime()) || isNaN(dataFim.getTime())) {
      req.session.erro = "Datas de inicio ou fim invalidas.";
      return res.redirect("/admin/inventario");
    }
    if (dataFim <= dataInicio) {
      req.session.erro = "A data final do bloqueio deve ser posterior a data inicial.";
      return res.redirect("/admin/inventario");
    }

    try {
      const carrinho = await dbGet(
        db,
        "SELECT id, nome, capacidade FROM carrinhos WHERE id = ?",
        [carrinhoId],
      );

      if (!carrinho) {
        req.session.erro = "Carrinho nao encontrado.";
        return res.redirect("/admin/inventario");
      }
      if (quantidade > carrinho.capacidade) {
        req.session.erro = `A quantidade do bloqueio (${quantidade}) nao pode ser maior que a capacidade total do carrinho (${carrinho.capacidade}).`;
        return res.redirect("/admin/inventario");
      }

      const result = await dbRun(
        db,
        `INSERT INTO carrinho_bloqueios (
            carrinho_id, quantidade, data_inicio, data_fim, motivo, criado_por_usuario_id
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          carrinhoId,
          quantidade,
          toMySQLDateTime(dataInicio),
          toMySQLDateTime(dataFim),
          motivo,
          req.user.id,
        ],
      );

      await registrarAuditoria(req, {
        acao: "BLOQUEIO_AGENDADO_CRIADO",
        entidade: "carrinho_bloqueio",
        entidadeId: result.lastID,
        detalhes: {
          carrinho: carrinho.nome,
          quantidade,
          data_inicio: toMySQLDateTime(dataInicio),
          data_fim: toMySQLDateTime(dataFim),
          motivo,
        },
      });

      req.session.sucesso = "Bloqueio programado salvo com sucesso.";
      res.redirect("/admin/inventario");
    } catch (err) {
      console.error("Erro interno ao salvar bloqueio programado:", err.message, err.stack);
      req.session.erro = "Nao foi possivel salvar o bloqueio: " + err.message;
      res.redirect("/admin/inventario");
    }
  });


  router.post("/inventario/bloqueios/:id/delete", isAdmin, async (req, res) => {
    const bloqueioId = parseInt(req.params.id, 10);
    if (!Number.isInteger(bloqueioId) || bloqueioId <= 0) {
      { req.session.erro = "Bloqueio invalido."; return res.redirect("/admin/inventario"); }
    }

    try {
      const bloqueio = await dbGet(
        db,
        `SELECT b.*, c.nome as nome_carrinho
         FROM carrinho_bloqueios b
         JOIN carrinhos c ON c.id = b.carrinho_id
         WHERE b.id = ?`,
        [bloqueioId],
      );

      if (!bloqueio) {
        { req.session.erro = "Bloqueio nao encontrado."; return res.redirect("/admin/inventario"); }
      }

      await dbRun(db, "DELETE FROM carrinho_bloqueios WHERE id = ?", [bloqueioId]);

      await registrarAuditoria(req, {
        acao: "BLOQUEIO_AGENDADO_EXCLUIDO",
        entidade: "carrinho_bloqueio",
        entidadeId: bloqueioId,
        detalhes: {
          carrinho: bloqueio.nome_carrinho,
          quantidade: bloqueio.quantidade,
          data_inicio: bloqueio.data_inicio,
          data_fim: bloqueio.data_fim,
          motivo: bloqueio.motivo,
        },
      });

      // Processar fila de espera apos liberacao do carrinho por exclusao de bloqueio
      try {
        await processarFilaEspera(db, bloqueio.carrinho_id, {
          id: req.user?.id,
          nome: req.user?.nome,
          role: req.user?.role,
          ip: req.ip || req.socket?.remoteAddress || null,
        });
      } catch (filaErr) {
        console.error(
          "Erro ao processar fila de espera apos remover bloqueio:",
          filaErr.message,
        );
      }

      req.session.sucesso = "Bloqueio removido com sucesso.";
      res.redirect("/admin/inventario");
    } catch (err) {
      { req.session.erro = "Nao foi possivel remover o bloqueio."; res.redirect("/admin/inventario"); }
    }
  });

  router.get("/dashboard", canManageReservations, async (req, res) => {
    try {
      const monthContext = getMonthContext(req.query.month);
      const today = startOfToday();
      const nextSevenDays = addDays(today, 7);
      const nextFourteenDays = addDays(today, 14);

      const [
        statsStatus,
        statsCarrinhos,
        statsProfessores,
        statsDias,
        statsSalas,
        statsHorarios,
        statsResumo,
        carrinhos,
        reservasCalendario,
        bloqueiosCalendario,
        retiradasHoje,
        bloqueiosProximos,
      ] = await Promise.all([
        dbAll(
          db,
          `SELECT status, COUNT(*) as qtd
           FROM reservas
           WHERE data_retirada >= ? AND data_retirada < ?
           GROUP BY status`,
          [monthContext.monthStart, monthContext.monthEnd],
        ),
        dbAll(
          db,
          `SELECT c.nome, COUNT(r.id) as total
           FROM reservas r
           JOIN carrinhos c ON r.carrinho_id = c.id
           WHERE r.data_retirada >= ? AND r.data_retirada < ?
           GROUP BY c.id, c.nome
           ORDER BY total DESC, c.nome ASC
           LIMIT 5`,
          [monthContext.monthStart, monthContext.monthEnd],
        ),
        dbAll(
          db,
          `SELECT u.nome, COUNT(r.id) as total
           FROM reservas r
           JOIN usuarios u ON r.usuario_id = u.id
           WHERE r.data_retirada >= ? AND r.data_retirada < ?
           GROUP BY u.id, u.nome
           ORDER BY total DESC, u.nome ASC
           LIMIT 5`,
          [monthContext.monthStart, monthContext.monthEnd],
        ),
        dbAll(
          db,
          `SELECT DATE(data_retirada) as data, COUNT(*) as qtd
           FROM reservas
           WHERE data_retirada >= ? AND data_retirada < ?
           GROUP BY DATE(data_retirada)
           ORDER BY data ASC`,
          [monthContext.monthStart, monthContext.monthEnd],
        ),
        dbAll(
          db,
          `SELECT sala, COUNT(*) as total
           FROM reservas
           WHERE data_retirada >= ? AND data_retirada < ?
             AND sala IS NOT NULL AND TRIM(sala) <> ''
           GROUP BY sala
           ORDER BY total DESC, sala ASC
           LIMIT 5`,
          [monthContext.monthStart, monthContext.monthEnd],
        ),
        dbAll(
          db,
          `SELECT DATE_FORMAT(data_retirada, '%H:00') as hora, COUNT(*) as total
           FROM reservas
           WHERE data_retirada >= ? AND data_retirada < ?
           GROUP BY hora
           ORDER BY total DESC, hora ASC
           LIMIT 6`,
          [monthContext.monthStart, monthContext.monthEnd],
        ),
        dbGet(
          db,
          `SELECT
              COUNT(*) as totalReservas,
              COALESCE(SUM(quantidade), 0) as totalChromebooks,
              ROUND(AVG(TIMESTAMPDIFF(MINUTE, data_retirada, data_devolucao) / 60), 1) as mediaHoras
           FROM reservas
           WHERE data_retirada >= ? AND data_retirada < ?`,
          [monthContext.monthStart, monthContext.monthEnd],
        ),
        dbAll(db, "SELECT * FROM carrinhos ORDER BY nome ASC"),
        dbAll(
          db,
          `SELECT carrinho_id, quantidade, data_retirada, data_devolucao
           FROM reservas
           WHERE status IN ('Ativa', 'Concluida')
             AND data_retirada < ?
             AND data_devolucao > ?`,
          [monthContext.monthEnd, monthContext.monthStart],
        ),
        dbAll(
          db,
          `SELECT carrinho_id, quantidade, data_inicio, data_fim
           FROM carrinho_bloqueios
           WHERE data_inicio < ?
             AND data_fim > ?`,
          [monthContext.monthEnd, monthContext.monthStart],
        ),
        dbAll(
          db,
          `SELECT r.id, r.quantidade, r.data_retirada, c.nome as nome_carrinho, u.nome as nome_professor
           FROM reservas r
           JOIN carrinhos c ON c.id = r.carrinho_id
           JOIN usuarios u ON u.id = r.usuario_id
           WHERE r.status = 'Ativa'
             AND r.data_retirada >= ?
             AND r.data_retirada < ?
           ORDER BY r.data_retirada ASC
           LIMIT 6`,
          [today, addDays(today, 1)],
        ),
        dbAll(
          db,
          `SELECT b.id, b.quantidade, b.data_inicio, b.data_fim, b.motivo, c.nome as nome_carrinho
           FROM carrinho_bloqueios b
           JOIN carrinhos c ON c.id = b.carrinho_id
           WHERE b.data_fim >= ?
             AND b.data_inicio < ?
           ORDER BY b.data_inicio ASC
           LIMIT 6`,
          [today, nextFourteenDays],
        ),
      ]);

      const carrinhosNormalizados = carrinhos.map(normalizarCarrinho);
      const capacidadeBase = carrinhosNormalizados.reduce(
        (sum, carrinho) => sum + carrinho.disponiveis,
        0,
      );
      const occupancyCalendar = buildCalendarData({
        monthStart: monthContext.monthStart,
        monthEnd: monthContext.monthEnd,
        reservas: reservasCalendario,
        bloqueios: bloqueiosCalendario,
        capacidadeBase,
      });

      const statusMap = statsStatus.reduce((acc, item) => {
        acc[item.status] = item.qtd;
        return acc;
      }, {});
      const totalCanceladas = statusMap.Cancelada || 0;
      const totalReservas = statsResumo?.totalReservas || 0;
      const taxaCancelamento = totalReservas
        ? Number(((totalCanceladas / totalReservas) * 100).toFixed(1))
        : 0;

      const alertWindow = occupancyCalendar.days.filter((day) => {
        const date = new Date(`${day.dateKey}T00:00:00`);
        return date >= today && date < nextSevenDays;
      });

      const alertas = {
        criticosProximos: alertWindow
          .filter((day) => day.nivel === "red")
          .slice(0, 5),
        atencaoProxima: alertWindow
          .filter((day) => day.nivel === "yellow")
          .slice(0, 5),
        retiradasHoje,
        bloqueiosProximos,
      };

      res.render("admin-dashboard", {
        user: req.user,
        statsStatus,
        statsCarrinhos,
        statsProfessores,
        statsDias,
        statsSalas,
        statsHorarios,
        occupancyCalendar,
        calendarMonth: monthContext,
        alertas,
        resumo: {
          totalReservas,
          totalChromebooks: statsResumo?.totalChromebooks || 0,
          mediaHoras: statsResumo?.mediaHoras || 0,
          totalAtivas: statusMap.Ativa || 0,
          totalConcluidas: statusMap.Concluida || 0,
          totalCanceladas,
          taxaCancelamento,
        },
      });
    } catch (err) {
      console.error("Erro interno em GET /admin/dashboard:", err);
      res.status(500).send("Erro ao carregar o dashboard.");
    }
  });

  router.post("/set-role/:id", isAdmin, async (req, res) => {
    const { role } = req.body;
    const userId = parseInt(req.params.id, 10);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).send("Utilizador invalido.");
    }

    if (Number(req.user.id) === userId) {
      return res.status(400).send("Voce nao pode alterar seu proprio papel.");
    }

    const allowedRoles = ["professor", "operacional", "admin"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).send("Papel invalido.");
    }

    try {
      const usuarioAlterado = await dbGet(
        db,
        "SELECT id, nome, email, role FROM usuarios WHERE id = ? AND ativo = 1",
        [userId],
      );

      if (!usuarioAlterado) {
        return res.status(404).send("Utilizador nao encontrado.");
      }

      if (usuarioAlterado.role === "admin" && role !== "admin") {
        const outrosAdmins = await dbGet(
          db,
          "SELECT COUNT(*) as total FROM usuarios WHERE role = 'admin' AND ativo = 1 AND id != ?",
          [userId],
        );

        const validacao = podeAlterarOuDesativarAdmin({
          acao: "rebaixar",
          roleAtual: usuarioAlterado.role,
          novoRole: role,
          outrosAdminsAtivos: outrosAdmins ? outrosAdmins.total : 0,
        });

        if (!validacao.permitido) {
          return res.status(400).send(validacao.motivo);
        }
      }

      await dbRun(db, "UPDATE usuarios SET role = ? WHERE id = ?", [
        role,
        userId,
      ]);

      await registrarAuditoria(req, {
        acao: "USUARIO_PERFIL_ALTERADO",
        entidade: "usuario",
        entidadeId: userId,
        detalhes: {
          usuario: usuarioAlterado.nome,
          email: usuarioAlterado.email,
          role_anterior: usuarioAlterado.role,
          role_novo: role,
        },
      });

      res.redirect("/admin/users");
    } catch (err) {
      res.status(500).send("Erro ao atualizar papel do utilizador.");
    }
  });

  router.post("/delete/:id", isAdmin, async (req, res) => {
    const userId = parseInt(req.params.id, 10);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).send("Utilizador invalido.");
    }

    if (Number(req.user.id) === userId) {
      return res.status(400).send("Voce nao pode excluir a si mesmo.");
    }

    try {
      const usuarioExcluido = await dbGet(
        db,
        "SELECT id, nome, email, role FROM usuarios WHERE id = ? AND ativo = 1",
        [userId],
      );

      if (!usuarioExcluido) {
        return res.status(404).send("Utilizador nao encontrado.");
      }

      if (usuarioExcluido.role === "admin") {
        const outrosAdmins = await dbGet(
          db,
          "SELECT COUNT(*) as total FROM usuarios WHERE role = 'admin' AND ativo = 1 AND id != ?",
          [userId],
        );

        const validacao = podeAlterarOuDesativarAdmin({
          acao: "desativar",
          roleAtual: usuarioExcluido.role,
          outrosAdminsAtivos: outrosAdmins ? outrosAdmins.total : 0,
        });

        if (!validacao.permitido) {
          return res.status(400).send(validacao.motivo);
        }
      }

      const resumoReservas = await dbGet(
        db,
        `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'Ativa' THEN 1 ELSE 0 END) as ativas
         FROM reservas
         WHERE usuario_id = ?`,
        [userId],
      );

      // Cancela reservas ativas e pedidos na fila de espera para liberar os aparelhos
      await dbRun(
        db,
        "UPDATE reservas SET status = 'Cancelada' WHERE usuario_id = ? AND status = 'Ativa'",
        [userId],
      );
      await dbRun(
        db,
        "UPDATE lista_espera SET status = 'Cancelada' WHERE usuario_id = ? AND status = 'Aguardando'",
        [userId],
      );

      // Mantem o email original com ativo = 0 para que tentativas futuras de login via Google encontrem o usuario inativo
      await dbRun(
        db,
        `UPDATE usuarios
         SET ativo = 0,
             google_access_token = NULL,
             google_refresh_token = NULL,
             senha_hash = NULL
         WHERE id = ?`,
        [userId],
      );

      await registrarAuditoria(req, {
        acao: "USUARIO_EXCLUIDO",
        entidade: "usuario",
        entidadeId: userId,
        detalhes: {
          usuario: usuarioExcluido.nome,
          email: usuarioExcluido.email,
          role: usuarioExcluido.role,
          exclusao_logica: true,
          reservas_total: resumoReservas.total || 0,
          reservas_ativas: resumoReservas.ativas || 0,
        },
      });

      res.redirect("/admin/users");
    } catch (err) {
      res.status(500).send("Erro ao excluir utilizador.");
    }
  });

  return router;
};
