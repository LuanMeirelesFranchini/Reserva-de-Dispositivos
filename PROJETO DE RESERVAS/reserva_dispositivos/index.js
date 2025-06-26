const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const PORT = 3000;

const SENHA_ADMIN = "lasalle123"; // Defina uma senha simples aqui

app.set('view engine', 'ejs');
const db = new sqlite3.Database('./reservas.db');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// ROTA PRINCIPAL (GET /) - Agora mais simples!
app.get('/', async (req, res) => {
  try {
    const erroMsg = req.query.erro || '';
    const carrinhos = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM carrinhos", [], (err, rows) => {
        if (err) reject(err); else resolve(rows);
      });
    });
    // Não precisamos mais buscar as reservas aqui, a página ficou mais leve!
    res.render('index', { carrinhos, erro: erroMsg });
  } catch (err) {
    res.status(500).send("Erro ao carregar a página: " + err.message);
  }
});

// NOVA ROTA DE ADMIN (GET /admin)
app.get('/admin', async (req, res) => {
  // PASSO DE SEGURANÇA SIMPLES: Verifica se a senha na URL está correta
  if (req.query.senha !== SENHA_ADMIN) {
    return res.status(403).send("<h1>Acesso Negado</h1><p>Você não tem permissão para ver esta página.</p>");
  }

  try {
    const sql = `SELECT r.*, c.nome as nome_carrinho 
                 FROM reservas r JOIN carrinhos c ON r.carrinho_id = c.id 
                 WHERE r.status = 'Ativa' ORDER BY r.data_retirada ASC`;
    const reservas = await new Promise((resolve, reject) => {
      db.all(sql, [], (err, rows) => {
        if (err) reject(err); else resolve(rows);
      });
    });
    // Renderiza a nova página 'admin.ejs' com os dados das reservas
    res.render('admin', { reservas });
  } catch (err) {
    res.status(500).send("Erro ao carregar página de admin: " + err.message);
  }
});

// ROTA PARA CONCLUIR RESERVA - Pequena mudança no redirect
app.post('/reservas/concluir/:id', (req, res) => {
  const idParaConcluir = req.params.id;
  const sql = `UPDATE reservas SET status = 'Concluída' WHERE id = ?`;
  db.run(sql, [idParaConcluir], (err) => {
    if (err) return res.status(500).send("Erro ao concluir a reserva.");
    // Redireciona de volta para a página de admin, mantendo a senha na URL
    res.redirect('/admin?senha=' + SENHA_ADMIN);
  });
});

// A rota da API e a de criar reserva continuam as mesmas...
app.get('/api/availability', async (req, res) => { /* ...código existente sem alteração... */ });
app.post('/reservar', async (req, res) => { /* ...código existente sem alteração... */ });

// --- Para manter o código limpo, vou colar as duas rotas que não mudam aqui embaixo ---
app.get('/api/availability', async (req, res) => {const { carrinho_id, data_retirada, data_devolucao } = req.query; if (!carrinho_id || !data_retirada || !data_devolucao) {return res.status(400).json({ error: 'Parâmetros faltando.' });} const inicioNovaReserva = new Date(data_retirada); const fimNovaReserva = new Date(data_devolucao); if (isNaN(inicioNovaReserva) || isNaN(fimNovaReserva) || fimNovaReserva <= inicioNovaReserva) {return res.status(400).json({ error: 'Datas inválidas.' });} try {const carrinho = await new Promise((resolve, reject) => {db.get("SELECT capacidade FROM carrinhos WHERE id = ?", [carrinho_id], (err, row) => {if (err) reject(err); else resolve(row);});}); if (!carrinho) {return res.status(404).json({ error: 'Carrinho não encontrado.'});} const capacidadeTotal = carrinho.capacidade; const reservasAtivas = await new Promise((resolve, reject) => {const sql = "SELECT quantidade, data_retirada, data_devolucao FROM reservas WHERE carrinho_id = ? AND status = 'Ativa'"; db.all(sql, [carrinho_id], (err, rows) => {if (err) reject(err); else resolve(rows);});}); let picoDeUso = 0; for (let tempoAtual = inicioNovaReserva.getTime(); tempoAtual < fimNovaReserva.getTime(); tempoAtual += 60000) {let chromesUsadosNesteMinuto = 0; for (const reserva of reservasAtivas) {const inicioReservaExistente = new Date(reserva.data_retirada).getTime(); const fimReservaExistente = new Date(reserva.data_devolucao).getTime(); if (tempoAtual >= inicioReservaExistente && tempoAtual < fimReservaExistente) {chromesUsadosNesteMinuto += reserva.quantidade;}} if (chromesUsadosNesteMinuto > picoDeUso) {picoDeUso = chromesUsadosNesteMinuto;}} const disponiveisNoHorario = capacidadeTotal - picoDeUso; res.json({ disponiveis: disponiveisNoHorario });} catch (err) {res.status(500).json({ error: "Erro no servidor: " + err.message });}});
app.post('/reservar', async (req, res) => {const { carrinho_id, quantidade, nome_professor, data_retirada, data_devolucao, sala } = req.body; const quantidadeNum = parseInt(quantidade, 10); const inicioNovaReserva = new Date(data_retirada); const fimNovaReserva = new Date(data_devolucao); try {const carrinho = await new Promise((resolve, reject) => {db.get("SELECT capacidade FROM carrinhos WHERE id = ?", [carrinho_id], (err, row) => {if (err) reject(err); else resolve(row);});}); const capacidadeTotal = carrinho.capacidade; const reservasAtivas = await new Promise((resolve, reject) => {const sql = "SELECT quantidade, data_retirada, data_devolucao FROM reservas WHERE carrinho_id = ? AND status = 'Ativa'"; db.all(sql, [carrinho_id], (err, rows) => {if (err) reject(err); else resolve(rows);});}); let picoDeUso = 0; for (let tempoAtual = inicioNovaReserva.getTime(); tempoAtual < fimNovaReserva.getTime(); tempoAtual += 60000) {let chromesUsadosNesteMinuto = 0; for (const reserva of reservasAtivas) {const inicioReservaExistente = new Date(reserva.data_retirada).getTime(); const fimReservaExistente = new Date(reserva.data_devolucao).getTime(); if (tempoAtual >= inicioReservaExistente && tempoAtual < fimReservaExistente) {chromesUsadosNesteMinuto += reserva.quantidade;}} if (chromesUsadosNesteMinuto > picoDeUso) {picoDeUso = chromesUsadosNesteMinuto;}} const disponiveisNoHorario = capacidadeTotal - picoDeUso; if (quantidadeNum > disponiveisNoHorario) {const msg = `Erro: Você tentou reservar ${quantidadeNum}, mas só há ${disponiveisNoHorario} disponíveis nesse carrinho para o horário solicitado.`; return res.redirect('/?erro=' + encodeURIComponent(msg));} const status = "Ativa"; const sqlInsert = `INSERT INTO reservas (carrinho_id, quantidade, nome_professor, data_retirada, data_devolucao, sala, status) VALUES (?, ?, ?, ?, ?, ?, ?)`; await new Promise((resolve, reject) => {db.run(sqlInsert, [carrinho_id, quantidadeNum, nome_professor, data_retirada, data_devolucao, sala, status], function(err) {if (err) reject(err); else resolve(this);});}); res.redirect('/');} catch (err) {res.status(500).send("Erro ao processar reserva: " + err.message);}});


// Inicia o Servidor
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));