const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const PORT = 3000;

app.set('view engine', 'ejs');
const db = new sqlite3.Database('./reservas.db');

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));


// --- ROTA PRINCIPAL (GET /) ---
app.get('/', async (req, res) => {
  try {
    const erroMsg = req.query.erro || ''; // Pega msg de erro da URL, se houver

    // 1. Pegar todos os carrinhos
    const carrinhos = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM carrinhos", [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // 2. Para cada carrinho, calcular quantos estão reservados
    for (const carrinho of carrinhos) {
      const result = await new Promise((resolve, reject) => {
        const sql = "SELECT SUM(quantidade) as total FROM reservas WHERE carrinho_id = ? AND status = 'Ativa'";
        db.get(sql, [carrinho.id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      const reservados = result.total || 0;
      carrinho.disponiveis = carrinho.capacidade - reservados;
    }

    // 3. Pegar todas as reservas ativas para mostrar na lista
    const reservas = await new Promise((resolve, reject) => {
      // Usamos um JOIN para pegar o nome do carrinho junto com a reserva
      const sql = `
        SELECT r.*, c.nome as nome_carrinho 
        FROM reservas r 
        JOIN carrinhos c ON r.carrinho_id = c.id 
        WHERE r.status = 'Ativa' 
        ORDER BY r.data_retirada ASC
      `;
      db.all(sql, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    // 4. Renderizar a página com todos os dados
    res.render('index', { carrinhos, reservas, erro: erroMsg });

  } catch (err) {
    res.status(500).send("Erro ao carregar a página: " + err.message);
  }
});


// --- ROTA PARA CRIAR RESERVA (POST /reservar) ---
app.post('/reservar', async (req, res) => {
  const { carrinho_id, quantidade, nome_professor, data_retirada, data_devolucao, sala } = req.body;
  const quantidadeNum = parseInt(quantidade, 10);

  try {
    // VALIDAÇÃO ANTI-OVERBOOKING
    // 1. Pega a capacidade do carrinho escolhido
    const carrinho = await new Promise((resolve, reject) => {
      db.get("SELECT capacidade FROM carrinhos WHERE id = ?", [carrinho_id], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });

    // 2. Calcula quantos já estão reservados para esse carrinho
    const reservadosRow = await new Promise((resolve, reject) => {
      const sql = "SELECT SUM(quantidade) as total FROM reservas WHERE carrinho_id = ? AND status = 'Ativa'";
      db.get(sql, [carrinho_id], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });

    const disponiveis = carrinho.capacidade - (reservadosRow.total || 0);

    // 3. Verifica se a quantidade solicitada é maior que a disponível
    if (quantidadeNum > disponiveis) {
      // Se for, redireciona para a página inicial com uma mensagem de erro na URL
      const msg = `Erro: Você tentou reservar ${quantidadeNum}, mas só há ${disponiveis} disponíveis nesse carrinho.`;
      return res.redirect('/?erro=' + encodeURIComponent(msg));
    }

    // Se a validação passar, insere a reserva no banco
    const status = "Ativa";
    const sqlInsert = `INSERT INTO reservas (carrinho_id, quantidade, nome_professor, data_retirada, data_devolucao, sala, status) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    await new Promise((resolve, reject) => {
        db.run(sqlInsert, [carrinho_id, quantidadeNum, nome_professor, data_retirada, data_devolucao, sala, status], function(err) {
            if (err) reject(err); else resolve(this);
        });
    });

    // Redireciona para a página inicial (sem erro)
    res.redirect('/');

  } catch (err) {
    res.status(500).send("Erro ao processar reserva: " + err.message);
  }
});


// ROTA PARA CONCLUIR RESERVA (sem mudanças)
app.post('/reservas/concluir/:id', (req, res) => {
  const idParaConcluir = req.params.id;
  const sql = `UPDATE reservas SET status = 'Concluída' WHERE id = ?`;
  db.run(sql, [idParaConcluir], (err) => {
    if (err) return res.status(500).send("Erro ao concluir a reserva.");
    res.redirect('/');
  });
});


// --- Inicia o Servidor ---
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));