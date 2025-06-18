const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const PORT = 3000;

app.set('view engine', 'ejs');
const db = new sqlite3.Database('./reservas.db', (err) => {
    if (err) {
        return console.error("FATAL: Erro ao conectar ao banco de dados", err.message);
    }
    console.log("Conectado ao banco de dados SQLite.");
});

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// ROTA PRINCIPAL (GET /)
app.get('/', async (req, res) => {
  try {
    const erroMsg = req.query.erro || '';
    const carrinhos = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM carrinhos", [], (err, rows) => {
        if (err) reject(err); else resolve(rows);
      });
    });

    const reservas = await new Promise((resolve, reject) => {
      const sql = `SELECT r.*, c.nome as nome_carrinho 
                   FROM reservas r JOIN carrinhos c ON r.carrinho_id = c.id 
                   WHERE r.status = 'Ativa' ORDER BY r.data_retirada ASC`;
      db.all(sql, [], (err, rows) => {
        if (err) reject(err); else resolve(rows);
      });
    });
    
    res.render('index', { carrinhos, reservas, erro: erroMsg });
  } catch (err) {
    res.status(500).send("Erro ao carregar a página: " + err.message);
  }
});

// ROTA DA API PARA VERIFICAR DISPONIBILIDADE
app.get('/api/availability', async (req, res) => {
    const { carrinho_id, data_retirada, data_devolucao } = req.query;
  
    if (!carrinho_id || !data_retirada || !data_devolucao) {
      return res.status(400).json({ error: 'Parâmetros faltando (carrinho, data de retirada ou devolução).' });
    }
  
    const inicioNovaReserva = new Date(data_retirada);
    const fimNovaReserva = new Date(data_devolucao);
  
    if (isNaN(inicioNovaReserva) || isNaN(fimNovaReserva) || fimNovaReserva <= inicioNovaReserva) {
        return res.status(400).json({ error: 'Datas inválidas ou data de devolução anterior à de retirada.' });
    }

    try {
      const carrinho = await new Promise((resolve, reject) => {
        db.get("SELECT capacidade FROM carrinhos WHERE id = ?", [carrinho_id], (err, row) => {
          if (err) reject(err); else resolve(row);
        });
      });
  
      if (!carrinho) {
          return res.status(404).json({ error: 'Carrinho não encontrado.'});
      }
      const capacidadeTotal = carrinho.capacidade;
  
      const reservasAtivas = await new Promise((resolve, reject) => {
        const sql = "SELECT quantidade, data_retirada, data_devolucao FROM reservas WHERE carrinho_id = ? AND status = 'Ativa'";
        db.all(sql, [carrinho_id], (err, rows) => {
          if (err) reject(err); else resolve(rows);
        });
      });
  
      let picoDeUso = 0;
      for (let tempoAtual = inicioNovaReserva.getTime(); tempoAtual < fimNovaReserva.getTime(); tempoAtual += 60000) { // Checa minuto a minuto
          let chromesUsadosNesteMinuto = 0;
          for (const reserva of reservasAtivas) {
              const inicioReservaExistente = new Date(reserva.data_retirada).getTime();
              const fimReservaExistente = new Date(reserva.data_devolucao).getTime();
              if (tempoAtual >= inicioReservaExistente && tempoAtual < fimReservaExistente) {
                  chromesUsadosNesteMinuto += reserva.quantidade;
              }
          }
          if (chromesUsadosNesteMinuto > picoDeUso) {
              picoDeUso = chromesUsadosNesteMinuto;
          }
      }
  
      const disponiveisNoHorario = capacidadeTotal - picoDeUso;
      res.json({ disponiveis: disponiveisNoHorario });
  
    } catch (err) {
      console.error("ERRO NA API /api/availability:", err);
      res.status(500).json({ error: "Erro interno no servidor ao verificar disponibilidade." });
    }
  });

// ROTA POST PARA CRIAR RESERVA
app.post('/reservar', async (req, res) => {
    // ... (O resto do seu código post /reservar continua aqui, sem alterações)
    const { carrinho_id, quantidade, nome_professor, data_retirada, data_devolucao, sala } = req.body;
    const quantidadeNum = parseInt(quantidade, 10);
    const inicioNovaReserva = new Date(data_retirada);
    const fimNovaReserva = new Date(data_devolucao);

    // Reutilizar a mesma lógica da API para validação
    try {
        const carrinho = await new Promise((resolve, reject) => {
            db.get("SELECT capacidade FROM carrinhos WHERE id = ?", [carrinho_id], (err, row) => {
              if (err) reject(err); else resolve(row);
            });
          });
          const capacidadeTotal = carrinho.capacidade;
      
          const reservasAtivas = await new Promise((resolve, reject) => {
            const sql = "SELECT quantidade, data_retirada, data_devolucao FROM reservas WHERE carrinho_id = ? AND status = 'Ativa'";
            db.all(sql, [carrinho_id], (err, rows) => {
              if (err) reject(err); else resolve(rows);
            });
          });
      
          let picoDeUso = 0;
          for (let tempoAtual = inicioNovaReserva.getTime(); tempoAtual < fimNovaReserva.getTime(); tempoAtual += 60000) {
              let chromesUsadosNesteMinuto = 0;
              for (const reserva of reservasAtivas) {
                  const inicioReservaExistente = new Date(reserva.data_retirada).getTime();
                  const fimReservaExistente = new Date(reserva.data_devolucao).getTime();
                  if (tempoAtual >= inicioReservaExistente && tempoAtual < fimReservaExistente) {
                      chromesUsadosNesteMinuto += reserva.quantidade;
                  }
              }
              if (chromesUsadosNesteMinuto > picoDeUso) {
                  picoDeUso = chromesUsadosNesteMinuto;
              }
          }
      
          const disponiveisNoHorario = capacidadeTotal - picoDeUso;

        if (quantidadeNum > disponiveisNoHorario) {
          const msg = `Erro: Você tentou reservar ${quantidadeNum}, mas só há ${disponiveisNoHorario} disponíveis nesse carrinho para o horário solicitado.`;
          return res.redirect('/?erro=' + encodeURIComponent(msg));
        }

        const status = "Ativa";
        const sqlInsert = `INSERT INTO reservas (carrinho_id, quantidade, nome_professor, data_retirada, data_devolucao, sala, status) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        await new Promise((resolve, reject) => {
            db.run(sqlInsert, [carrinho_id, quantidadeNum, nome_professor, data_retirada, data_devolucao, sala, status], function(err) {
                if (err) reject(err); else resolve(this);
            });
        });
        res.redirect('/');
    } catch (err) {
        res.status(500).send("Erro ao processar reserva: " + err.message);
    }
});

// ROTA PARA CONCLUIR RESERVA
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