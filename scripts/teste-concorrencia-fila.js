/**
 * Script de Verificação de Concorrência da Fila de Espera
 *
 * Simula duas chamadas concorrentes simultâneas de processarFilaEspera()
 * disputando a última vaga livre do carrinho.
 * Valida que o lock SELECT ... FOR UPDATE garante atomicidade e
 * que exatamente 1 item da fila é atendido sem estourar a capacidade.
 */
require("dotenv").config();
const assert = require("node:assert/strict");
const { MySQLDatabase } = require("../database");
const { processarFilaEspera } = require("../services/waitlist-service");
const { toMySQLDateTime } = require("../helpers/app-helpers");

// --- GUARDA-CORPOS DE SEGURANÇA ---

if (process.env.NODE_ENV === "production") {
  console.error("ERRO: Este script de teste de concorrência NÃO pode ser executado em ambiente de produção!");
  process.exit(1);
}

const host = (process.env.DB_HOST || "localhost").trim().toLowerCase();
if (host !== "localhost" && host !== "127.0.0.1") {
  console.error(`ERRO: DB_HOST deve ser 'localhost' ou '127.0.0.1' para executar testes locais. Atual: "${host}"`);
  process.exit(1);
}

if (process.env.EMAIL_ENABLED !== "false") {
  console.error(`ERRO: EMAIL_ENABLED deve ser explicitamente "false" para evitar disparos acidentais de e-mail. Atual: "${process.env.EMAIL_ENABLED}"`);
  process.exit(1);
}

async function executarTesteConcorrencia() {
  console.log("Iniciando teste de concorrência da fila de espera...");
  const db = new MySQLDatabase();

  let carrinhoId = null;
  let usuario1Id = null;
  let usuario2Id = null;
  let fila1Id = null;
  let fila2Id = null;

  try {
    // 1. Datas dinâmicas: hoje + 10 dias
    const dataHoje = new Date();
    const dataRetirada = new Date(dataHoje.getTime() + 10 * 24 * 60 * 60 * 1000);
    dataRetirada.setHours(14, 0, 0, 0);
    const dataDevolucao = new Date(dataHoje.getTime() + 10 * 24 * 60 * 60 * 1000);
    dataDevolucao.setHours(16, 0, 0, 0);

    const retiradaStr = toMySQLDateTime(dataRetirada);
    const devolucaoStr = toMySQLDateTime(dataDevolucao);

    // 2. Criação de carrinho de teste com capacidade 1 (apenas 1 vaga)
    const cartRes = await db.run(
      "INSERT INTO carrinhos (nome, localizacao, capacidade, indisponiveis, ativo) VALUES (?, ?, ?, ?, ?)",
      ["Carrinho Concorrencia Teste", "Laboratorio de Teste", 1, 0, 1]
    );
    carrinhoId = cartRes.lastID;
    console.log(`Carrinho de teste criado: ID ${carrinhoId} (Capacidade: 1)`);

    // 3. Criação de 2 usuários fictícios com domínio @teste.invalid
    const user1Res = await db.run(
      "INSERT INTO usuarios (nome, email, role, ativo) VALUES (?, ?, ?, ?)",
      ["Usuario Concorrente 1", `user-conc-1-${Date.now()}@teste.invalid`, "professor", 1]
    );
    usuario1Id = user1Res.lastID;

    const user2Res = await db.run(
      "INSERT INTO usuarios (nome, email, role, ativo) VALUES (?, ?, ?, ?)",
      ["Usuario Concorrente 2", `user-conc-2-${Date.now()}@teste.invalid`, "professor", 1]
    );
    usuario2Id = user2Res.lastID;
    console.log(`Usuários de teste criados: IDs ${usuario1Id} e ${usuario2Id}`);

    // 4. Criação de 2 itens na fila de espera para a mesma vaga
    // Item 1 foi criado 1 minuto antes do Item 2
    const dataCriacao1 = new Date(Date.now() - 60000);
    const dataCriacao2 = new Date();

    const fila1Res = await db.run(
      `INSERT INTO lista_espera (carrinho_id, usuario_id, quantidade, data_retirada, data_devolucao, sala, status, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, 'Aguardando', ?)`,
      [carrinhoId, usuario1Id, 1, retiradaStr, devolucaoStr, "Sala 101", toMySQLDateTime(dataCriacao1)]
    );
    fila1Id = fila1Res.lastID;

    const fila2Res = await db.run(
      `INSERT INTO lista_espera (carrinho_id, usuario_id, quantidade, data_retirada, data_devolucao, sala, status, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, 'Aguardando', ?)`,
      [carrinhoId, usuario2Id, 1, retiradaStr, devolucaoStr, "Sala 102", toMySQLDateTime(dataCriacao2)]
    );
    fila2Id = fila2Res.lastID;
    console.log(`Fila de espera criada: Item ${fila1Id} (primeiro) e Item ${fila2Id} (segundo)`);

    // 5. Chamada CONCORRENTE via Promise.all
    console.log("Disparando chamadas simultâneas de processarFilaEspera()...");
    const [resultado1, resultado2] = await Promise.all([
      processarFilaEspera(db, carrinhoId, { id: null, nome: "Ator Concorrente A", role: "sistema", ip: "127.0.0.1" }),
      processarFilaEspera(db, carrinhoId, { id: null, nome: "Ator Concorrente B", role: "sistema", ip: "127.0.0.1" }),
    ]);

    const totalAtendidosRetorno = resultado1.atendidos.length + resultado2.atendidos.length;
    console.log(`Retornos das execuções: ${resultado1.atendidos.length} e ${resultado2.atendidos.length} atendidos.`);

    // 6. Validações de integridade no banco
    const [reservasCriadas] = await db.pool.execute(
      "SELECT id, usuario_id, quantidade, status FROM reservas WHERE carrinho_id = ?",
      [carrinhoId]
    );

    console.log(`Reservas criadas no banco para o carrinho: ${reservasCriadas.length}`);
    assert.equal(
      reservasCriadas.length,
      1,
      `ERRO CRÍTICO: Deveria existir exatamente 1 reserva criada, mas foram encontradas ${reservasCriadas.length}!`
    );

    assert.equal(
      totalAtendidosRetorno,
      1,
      `ERRO: O total de itens reportados como atendidos no retorno das duas chamadas deve ser 1, foi ${totalAtendidosRetorno}`
    );

    assert.equal(
      reservasCriadas[0].usuario_id,
      usuario1Id,
      `ERRO DE ORDEM: O primeiro item da fila (usuário ${usuario1Id}) deveria ter sido atendido, mas foi o usuário ${reservasCriadas[0].usuario_id}`
    );

    const [filaStatus] = await db.pool.execute(
      "SELECT id, status FROM lista_espera WHERE id IN (?, ?) ORDER BY id ASC",
      [fila1Id, fila2Id]
    );

    const item1 = filaStatus.find((f) => f.id === fila1Id);
    const item2 = filaStatus.find((f) => f.id === fila2Id);

    assert.equal(item1.status, "Atendida", `O Item 1 deveria estar 'Atendida', status atual: ${item1.status}`);
    assert.equal(item2.status, "Aguardando", `O Item 2 deveria continuar 'Aguardando', status atual: ${item2.status}`);

    // Valida que auditoria foi gerada
    const [auditRows] = await db.pool.execute(
      "SELECT id, acao, entidade_id FROM audit_logs WHERE acao = 'RESERVA_CRIADA_FILA' AND entidade_id = ?",
      [reservasCriadas[0].id]
    );
    assert.equal(auditRows.length, 1, "Deveria existir exatamente 1 registro de auditoria para a reserva atendida via fila.");

    console.log("\n✅ SUCESSO: Teste de concorrência passou com perfeição!");
    console.log("- Lock FOR UPDATE evitou double-booking.");
    console.log("- Apenas 1 reserva foi criada para a vaga única.");
    console.log("- Item 1 foi promovido a 'Atendida'; Item 2 permaneceu 'Aguardando'.");
    console.log("- Capacidade do carrinho foi rigorosamente respeitada.");
  } finally {
    // 7. LIMPEZA TOTAL DE DADOS FICTÍCIOS NO FINALLY
    console.log("\nIniciando limpeza dos dados de teste...");
    try {
      if (carrinhoId) {
        const [resRows] = await db.pool.execute(
          "SELECT id FROM reservas WHERE carrinho_id = ?",
          [carrinhoId]
        );
        for (const r of resRows) {
          await db.run(
            "DELETE FROM audit_logs WHERE entidade = 'reserva' AND entidade_id = ?",
            [r.id]
          );
        }
        await db.run("DELETE FROM reservas WHERE carrinho_id = ?", [carrinhoId]);
        await db.run("DELETE FROM lista_espera WHERE carrinho_id = ?", [carrinhoId]);
        await db.run("DELETE FROM carrinhos WHERE id = ?", [carrinhoId]);
      }
      if (usuario1Id) {
        await db.run("DELETE FROM usuarios WHERE id = ?", [usuario1Id]);
      }
      if (usuario2Id) {
        await db.run("DELETE FROM usuarios WHERE id = ?", [usuario2Id]);
      }
      console.log("Limpeza concluída com sucesso.");
    } catch (cleanErr) {
      console.error("Falha durante limpeza de teste:", cleanErr.message);
    }
  }
}

executarTesteConcorrencia()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ FALHA NO TESTE DE CONCORRÊNCIA:", err);
    process.exit(1);
  });
