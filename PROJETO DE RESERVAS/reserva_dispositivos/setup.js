const sqlite3 = require('sqlite3').verbose();

// Cria ou abre o arquivo de banco de dados
const db = new sqlite3.Database('./reservas.db', (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Conectado ao banco de dados de reservas.');
});

// Garante que os comandos rodem em ordem
db.serialize(() => {
  // Comando SQL para criar a tabela com todas as suas colunas
  const sqlCommand = `
    CREATE TABLE IF NOT EXISTS reservas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome_professor TEXT NOT NULL,
      quantidade INTEGER NOT NULL,
      data_retirada TEXT NOT NULL,
      data_devolucao TEXT NOT NULL,
      sala TEXT NOT NULL,
      status TEXT NOT NULL
    )
  `;

  // Executa o comando
  db.run(sqlCommand, (err) => {
    if (err) {
      return console.error(err.message);
    }
    console.log("Tabela 'reservas' criada com sucesso!");
  });
});

// Fecha a conexão
db.close((err) => {
  if (err) {
    return console.error(err.message);
  }
  console.log('Conexão com o banco de dados fechada.');
});