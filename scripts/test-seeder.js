require("dotenv").config();
const { MySQLDatabase } = require("../database");
const db = new MySQLDatabase();

const salas = [
  "BLOCO A - Sala 1",
  "BLOCO C - Tecnologia",
  "BLOCO E - Sala 10",
  "ESPACOS - Patio",
];
const status = ["Ativa", "Concluida", "Cancelada"];
const emailsTeste = [
  "prof.paulo@lasalle.org.br",
  "admin.teste@lasalle.org.br",
  "ana.tecnologia@prof.soulasalle.com.br",
];

function getRandomDate(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - Math.floor(Math.random() * daysAgo));
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function main() {
  console.log("🚀 Bot: Iniciando preparação para 150 reservas...");

  // 1. Garantir que existam usuários de teste (Cria se não existirem)
  for (const email of emailsTeste) {
    await new Promise((resolve) => {
      db.run(
        "INSERT IGNORE INTO usuarios (nome, email, role) VALUES (?, ?, ?)",
        [email.split("@")[0].toUpperCase(), email, "professor"],
        () => resolve(),
      );
    });
  }

  // 2. Buscar IDs reais que agora certamente existem
  const usersRows = await new Promise((r, j) =>
    db.all("SELECT id FROM usuarios", [], (e, rows) => (e ? j(e) : r(rows))),
  );
  const cartsRows = await new Promise((r, j) =>
    db.all("SELECT id FROM carrinhos", [], (e, rows) => (e ? j(e) : r(rows))),
  );

  const usuariosIds = usersRows.map((u) => u.id);
  const carrinhosIds = cartsRows.map((c) => c.id);

  if (carrinhosIds.length === 0) {
    throw new Error(
      "❌ ERRO: Cadastre ao menos um CARRINHO no painel antes de rodar o teste.",
    );
  }

  const stmt = db.prepare(`
        INSERT INTO reservas (carrinho_id, quantidade, usuario_id, data_retirada, data_devolucao, sala, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

  console.log("📝 Gerando 150 registros...");

  for (let i = 0; i < 150; i++) {
    const dataRetirada = getRandomDate(15); // Últimos 15 dias
    const dataDevolucao = new Date(
      new Date(dataRetirada).getTime() + (Math.random() * 3 + 1) * 3600000,
    )
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");

    await new Promise((resolve, reject) =>
      stmt.run(
        carrinhosIds[Math.floor(Math.random() * carrinhosIds.length)],
        Math.floor(Math.random() * 20) + 5, // Quantidade entre 5 e 25
        usuariosIds[Math.floor(Math.random() * usuariosIds.length)],
        dataRetirada,
        dataDevolucao,
        salas[Math.floor(Math.random() * salas.length)],
        status[Math.floor(Math.random() * status.length)],
        (err) => (err ? reject(err) : resolve()),
      ),
    );
  }

  await new Promise((resolve, reject) =>
    stmt.finalize((err) => (err ? reject(err) : resolve())),
  );
  console.log("✅ Sucesso: 150 reservas geradas para teste!");
}

main()
  .then(() => db.close())
  .catch((err) => {
    console.error("❌ Falha no Seeder:", err.message);
    process.exit(1);
  });
