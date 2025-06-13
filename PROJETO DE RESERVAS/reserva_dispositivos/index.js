const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const PORT = 3000;

// Configura o EJS como o "motor de visualização"
app.set('view engine', 'ejs');

const db = new sqlite3.Database('./reservas.db', (err) => {
  if (err) { console.error("Erro ao abrir o banco de dados", err.message); } 
  else { console.log("Conectado ao banco de dados SQLite."); }
});

// Middlewares
app.use(express.static('public')); 
app.use(express.urlencoded({ extended: true }));

// ROTA GET PARA A PÁGINA INICIAL ('/')
app.get('/', (req, res) => {
  const sql = `SELECT * FROM reservas WHERE status = 'Ativa' ORDER BY data_retirada ASC`;
  db.all(sql, [], (err, rows) => {
    if (err) { return res.status(500).send("Erro ao consultar o banco de dados."); }
    
    let totalReservado = 0;
    rows.forEach(row => { totalReservado += row.quantidade; });
    const totalDisponivel = 174 - totalReservado;

    res.render('index', { 
      reservas: rows, 
      disponiveis: totalDisponivel 
    });
  });
});

// ROTA POST PARA CRIAR UMA RESERVA
app.post('/reservar', (req, res) => {
  const { nome_professor, quantidade, data_retirada, data_devolucao, sala } = req.body;
  const status = "Ativa";
  const sql = `INSERT INTO reservas (nome_professor, quantidade, data_retirada, data_devolucao, sala, status) VALUES (?, ?, ?, ?, ?, ?)`;

  db.run(sql, [nome_professor, quantidade, data_retirada, data_devolucao, sala, status], (err) => {
    if (err) { return res.status(500).send("Erro ao processar sua reserva."); }
    res.redirect('/');
  });
});

// ROTA PARA CONCLUIR UMA RESERVA
app.post('/reservas/concluir/:id', (req, res) => {
 
  const idParaConcluir = req.params.id;


  const sql = `UPDATE reservas SET status = 'Concluída' WHERE id = ?`;


  db.run(sql, [idParaConcluir], (err) => {
    if (err) {
      console.error("Erro ao concluir reserva:", err.message);
      return res.status(500).send("Erro ao concluir a reserva.");
    }
    console.log(`Reserva ${idParaConcluir} concluída com sucesso!`);

  
  
    //Redirecionando para a pagina home depois que concluir a reserva
    res.redirect('/');
  });
});
// Inicia o Servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}. Acesse http://localhost:${PORT}`);
});