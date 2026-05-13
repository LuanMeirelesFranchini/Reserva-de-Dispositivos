const express = require("express");
const { dbAll, dbGet, dbRun } = require("./database");

module.exports = (db, middlewares, helpers) => {
  const router = express.Router();
  const { isAdmin, canManageReservations } = middlewares;
  const { normalizarCarrinho, registrarAuditoria } = helpers;

  router.get("/", canManageReservations, async (req, res) => {
    try {
      const dataFiltro = req.query.data;
      const params = [];
      let sql = `
        SELECT r.*, c.nome as nome_carrinho, u.nome as nome_professor
        FROM reservas r
        JOIN carrinhos c ON r.carrinho_id = c.id
        JOIN usuarios u ON r.usuario_id = u.id
        WHERE r.status = 'Ativa'
      `;

      if (dataFiltro) {
        sql += " AND DATE(r.data_retirada) = DATE(?)";
        params.push(dataFiltro);
      }

      sql += " ORDER BY r.data_retirada ASC";

      const reservas = await dbAll(db, sql, params);
      res.render("admin", {
        reservas,
        user: req.user,
        dataFiltro: dataFiltro || "",
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
      const reservas = await dbAll(
        db,
        `SELECT r.*, c.nome as nome_carrinho, u.nome as nome_professor
         FROM reservas r
         JOIN carrinhos c ON r.carrinho_id = c.id
         JOIN usuarios u ON r.usuario_id = u.id
         WHERE r.status = 'Concluida'
         ORDER BY r.data_devolucao DESC`,
      );
      res.render("admin-history", { reservas, user: req.user });
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
      const carrinhos = await dbAll(db, "SELECT * FROM carrinhos");
      res.render("admin-inventario", {
        user: req.user,
        carrinhos: carrinhos.map(normalizarCarrinho),
      });
    } catch (err) {
      res.status(500).send("Erro ao carregar inventario.");
    }
  });

  router.post("/inventario/update", isAdmin, async (req, res) => {
    const id = parseInt(req.body.id, 10);
    const capacidade = parseInt(req.body.capacidade, 10);
    const indisponiveis = parseInt(req.body.indisponiveis, 10);

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
        "SELECT id, nome, capacidade, indisponiveis FROM carrinhos WHERE id = ?",
        [id],
      );

      if (!carrinhoAnterior) {
        return res.status(404).json({ message: "Carrinho nao encontrado." });
      }

      await dbRun(
        db,
        "UPDATE carrinhos SET capacidade = ?, indisponiveis = ? WHERE id = ?",
        [capacidade, indisponiveis, id],
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
          },
          depois: { capacidade, indisponiveis },
        },
      });

      res.json({
        message: "Sucesso!",
        disponiveis: Math.max(capacidade - indisponiveis, 0),
      });
    } catch (err) {
      res.status(500).json({ message: "Erro ao atualizar banco." });
    }
  });

  router.get("/dashboard", canManageReservations, async (req, res) => {
    try {
      const statsStatus = await dbAll(
        db,
        "SELECT status, COUNT(*) as qtd FROM reservas GROUP BY status",
      );
      const statsCarrinhos = await dbAll(
        db,
        `SELECT c.nome, COUNT(r.id) as total
         FROM reservas r
         JOIN carrinhos c ON r.carrinho_id = c.id
         GROUP BY c.id
         ORDER BY total DESC
         LIMIT 5`,
      );
      const statsProfessores = await dbAll(
        db,
        `SELECT u.nome, COUNT(r.id) as total
         FROM reservas r
         JOIN usuarios u ON r.usuario_id = u.id
         GROUP BY u.id
         ORDER BY total DESC
         LIMIT 5`,
      );
      const statsDias = await dbAll(
        db,
        `SELECT DATE(data_retirada) as data, COUNT(*) as qtd
         FROM reservas
         WHERE data_retirada >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
         GROUP BY DATE(data_retirada)
         ORDER BY data ASC`,
      );
      const statsSalas = await dbAll(
        db,
        `SELECT sala, COUNT(*) as total
         FROM reservas
         WHERE sala IS NOT NULL AND trim(sala) <> ''
         GROUP BY sala
         ORDER BY total DESC
         LIMIT 5`,
      );
      const statsHorarios = await dbAll(
        db,
        `SELECT DATE_FORMAT(data_retirada, '%H:00') as hora, COUNT(*) as total
         FROM reservas
         GROUP BY hora
         ORDER BY total DESC, hora ASC
         LIMIT 6`,
      );
      const statsResumo = await dbGet(
        db,
        `SELECT
            COUNT(*) as totalReservas,
            COALESCE(SUM(quantidade), 0) as totalChromebooks,
            ROUND(AVG(TIMESTAMPDIFF(MINUTE, data_retirada, data_devolucao) / 60), 1) as mediaHoras
         FROM reservas`,
      );

      const statusMap = statsStatus.reduce((acc, item) => {
        acc[item.status] = item.qtd;
        return acc;
      }, {});
      const totalCanceladas = statusMap.Cancelada || 0;
      const totalReservas = statsResumo.totalReservas || 0;
      const taxaCancelamento = totalReservas
        ? Number(((totalCanceladas / totalReservas) * 100).toFixed(1))
        : 0;

      res.render("admin-dashboard", {
        user: req.user,
        statsStatus,
        statsCarrinhos,
        statsProfessores,
        statsDias,
        statsSalas,
        statsHorarios,
        resumo: {
          totalReservas,
          totalChromebooks: statsResumo.totalChromebooks || 0,
          mediaHoras: statsResumo.mediaHoras || 0,
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
    const userId = req.params.id;

    if (req.user.id == userId) {
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
    const userId = req.params.id;

    if (req.user.id == userId) {
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

      const resumoReservas = await dbGet(
        db,
        `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'Ativa' THEN 1 ELSE 0 END) as ativas
         FROM reservas
         WHERE usuario_id = ?`,
        [userId],
      );

      const emailAnonimizado = `usuario-excluido-${usuarioExcluido.id}-${Date.now()}@local.invalid`;

      await dbRun(
        db,
        `UPDATE usuarios
         SET ativo = 0,
             nome = ?,
             email = ?,
             google_access_token = NULL,
             google_refresh_token = NULL,
             senha_hash = NULL
         WHERE id = ?`,
        [`Usuario excluido #${usuarioExcluido.id}`, emailAnonimizado, userId],
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
