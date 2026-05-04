// Carrega as variáveis de ambiente do ficheiro .env - DEVE SER A PRIMEIRA LINHA!
require('dotenv').config();

// --- Importações das Ferramentas ---
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const { formatarLocal, initializeSalasTable, montarSalasParaView } = require('./salas-data');

// --- Configurações Iniciais ---
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
app.set('view engine', 'ejs');
app.set('trust proxy', 1);
const requiredEnvVars = ['SESSION_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length > 0) {
    console.error(`ERRO FATAL: Variáveis de ambiente obrigatórias ausentes: ${missingEnvVars.join(', ')}`);
    process.exit(1);
}
const dbPath = path.join(__dirname, 'data', 'reservas.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("ERRO FATAL: Não foi possível conectar ao banco de dados.", err.message);
        process.exit(1);
    }
    console.log("Conectado ao banco de dados SQLite com sucesso.");
});

class SQLiteSessionStore extends session.Store {
    constructor(database) {
        super();
        this.db = database;
        this.ready = this.initialize();
    }

    initialize() {
        return new Promise((resolve, reject) => {
            this.db.run(`
                CREATE TABLE IF NOT EXISTS sessions (
                    sid TEXT PRIMARY KEY,
                    sess TEXT NOT NULL,
                    expires_at INTEGER NOT NULL
                )
            `, (err) => {
                if (err) return reject(err);

                this.db.run(
                    `CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at)`,
                    (indexErr) => indexErr ? reject(indexErr) : resolve()
                );
            });
        });
    }

    get(sid, callback) {
        this.ready
            .then(() => {
                this.db.get(
                    `SELECT sess, expires_at FROM sessions WHERE sid = ?`,
                    [sid],
                    (err, row) => {
                        if (err) return callback(err);
                        if (!row) return callback(null, null);

                        if (row.expires_at <= Date.now()) {
                            return this.destroy(sid, () => callback(null, null));
                        }

                        try {
                            callback(null, JSON.parse(row.sess));
                        } catch (parseErr) {
                            callback(parseErr);
                        }
                    }
                );
            })
            .catch((err) => callback(err));
    }

    set(sid, sess, callback) {
        this.ready
            .then(() => {
                const expiresAt = this.getExpiry(sess);
                const payload = JSON.stringify(sess);

                this.db.run(
                    `INSERT INTO sessions (sid, sess, expires_at)
                     VALUES (?, ?, ?)
                     ON CONFLICT(sid) DO UPDATE SET
                        sess = excluded.sess,
                        expires_at = excluded.expires_at`,
                    [sid, payload, expiresAt],
                    (err) => callback && callback(err)
                );
            })
            .catch((err) => callback && callback(err));
    }

    destroy(sid, callback) {
        this.ready
            .then(() => {
                this.db.run(`DELETE FROM sessions WHERE sid = ?`, [sid], (err) => {
                    if (callback) callback(err);
                });
            })
            .catch((err) => callback && callback(err));
    }

    touch(sid, sess, callback) {
        this.ready
            .then(() => {
                this.db.run(
                    `UPDATE sessions SET expires_at = ? WHERE sid = ?`,
                    [this.getExpiry(sess), sid],
                    (err) => callback && callback(err)
                );
            })
            .catch((err) => callback && callback(err));
    }

    getExpiry(sess) {
        const cookieExpiry = sess && sess.cookie && sess.cookie.expires
            ? new Date(sess.cookie.expires).getTime()
            : NaN;

        if (Number.isFinite(cookieExpiry)) {
            return cookieExpiry;
        }

        const maxAge = sess && sess.cookie && typeof sess.cookie.maxAge === 'number'
            ? sess.cookie.maxAge
            : 24 * 60 * 60 * 1000;

        return Date.now() + maxAge;
    }

    cleanupExpiredSessions() {
        this.ready
            .then(() => {
                this.db.run(`DELETE FROM sessions WHERE expires_at <= ?`, [Date.now()], (err) => {
                    if (err) {
                        console.error('Erro ao limpar sessões expiradas:', err.message);
                    }
                });
            })
            .catch((err) => console.error('Erro ao inicializar limpeza de sessões:', err.message));
    }
}

const sessionStore = new SQLiteSessionStore(db);
setInterval(() => sessionStore.cleanupExpiredSessions(), 60 * 60 * 1000).unref();

initializeSalasTable(db)
    .then(() => console.log("Tabela 'salas' pronta para uso."))
    .catch((err) => console.error("Erro ao inicializar tabela 'salas':", err.message));

db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER,
        usuario_nome TEXT,
        usuario_role TEXT,
        acao TEXT NOT NULL,
        entidade TEXT,
        entidade_id INTEGER,
        detalhes_json TEXT,
        ip TEXT,
        user_agent TEXT,
        criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )
`, (err) => {
    if (err) {
        console.error("Erro ao garantir tabela 'audit_logs':", err.message);
        return;
    }

    console.log("Tabela 'audit_logs' pronta para uso.");
});

db.run(`ALTER TABLE reservas ADD COLUMN concluido_por TEXT`, (err) => {
    if (!err) {
        console.log("Coluna 'concluido_por' adicionada na tabela reservas.");
        return;
    }

    if (err.message.includes('duplicate column name')) {
        return;
    }

    if (err.message.includes('no such table')) {
        console.warn("Tabela 'reservas' ainda nao existe para adicionar 'concluido_por'.");
        return;
    }

    console.error("Erro ao garantir coluna 'concluido_por':", err.message);
});

db.run(`ALTER TABLE carrinhos ADD COLUMN indisponiveis INTEGER NOT NULL DEFAULT 0`, (err) => {
    if (!err) {
        console.log("Coluna 'indisponiveis' adicionada na tabela carrinhos.");
        return;
    }

    if (err.message.includes('duplicate column name')) {
        return;
    }

    if (err.message.includes('no such table')) {
        console.warn("Tabela 'carrinhos' ainda nao existe para adicionar 'indisponiveis'.");
        return;
    }

    console.error("Erro ao garantir coluna 'indisponiveis':", err.message);
});

// --- Middlewares Essenciais ---
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
    } // Sessao valida por 24 horas
}));

// --- Configuração Completa do Passport.js ---
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
    db.get("SELECT * FROM usuarios WHERE id = ?", [id], (err, user) => done(err, user));
});

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
  },
  function(accessToken, refreshToken, profile, done) {
    const email = profile.emails[0].value;
    const nome = profile.displayName;
    db.get("SELECT * FROM usuarios WHERE email = ?", [email], (err, user) => {
        if (err) return done(err);
        if (user) {
            db.run("UPDATE usuarios SET google_access_token = ?, google_refresh_token = ? WHERE id = ?", 
                   [accessToken, refreshToken || user.google_refresh_token, user.id], (updateErr) => {
                if (updateErr) return done(updateErr);
                user.google_access_token = accessToken;
                user.google_refresh_token = refreshToken || user.google_refresh_token;
                return done(null, user);
            });
        } else {
            if (!email.endsWith('@lasalle.org.br') && !email.endsWith('@prof.soulasalle.com.br')) {
                return done(null, false, { message: 'Apenas e-mails institucionais são permitidos.' });
            }
            db.run("INSERT INTO usuarios (nome, email, role, google_access_token, google_refresh_token) VALUES (?, ?, ?, ?, ?)", 
                   [nome, email, 'professor', accessToken, refreshToken], function(insertErr) {
                if (insertErr) return done(insertErr);
                const newUser = { id: this.lastID, nome, email, role: 'professor', google_access_token: accessToken, google_refresh_token: refreshToken };
                return done(null, newUser);
            });
        }
    });
  }
));

// --- Configuração do Nodemailer ---
const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASS;

const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: (process.env.SMTP_SECURE === 'true'),
  auth: { user: smtpUser, pass: smtpPass }
});

mailTransporter.verify()
  .then(() => console.log('SMTP conectado — pronto para enviar e-mails.'))
  .catch(err => console.error('Falha ao conectar SMTP:', err.message || err));

async function sendReservationEmail({ to, subject, text, html, attachments=[] }) {
  try {
    const info = await mailTransporter.sendMail({
      from: process.env.EMAIL_FROM || smtpUser,
      to,
      subject,
      text,
      html,
      attachments
    });
    console.log('Email enviado:', info.messageId || info);
    return info;
  } catch (err) {
    console.error('Erro ao enviar email:', err && err.message ? err.message : err);
    throw err;
  }
}

function appendFlashMessage(urlBase, field, message) {
    const separator = urlBase.includes('?') ? '&' : '?';
    return `${urlBase}${separator}${field}=${encodeURIComponent(message)}`;
}

// --- Funções de Calendário ---
function gerarLinkGoogleCalendar(titulo, descricao, local, inicio, fim) {
    const formatarData = (date) => date.toISOString().replace(/-|:|\.\d+/g,'');
    const start = formatarData(new Date(inicio));
    const end = formatarData(new Date(fim));
    return `https://calendar.google.com/calendar/r/eventedit?` +
           `text=${encodeURIComponent(titulo)}` +
           `&dates=${start}/${end}` +
           `&details=${encodeURIComponent(descricao)}` +
           `&location=${encodeURIComponent(local)}`;
}

function gerarICS(titulo, descricao, local, inicio, fim) {
    const formatarDataICS = (date) => date.toISOString().replace(/-|:|\.\d+/g,'');
    return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//SeuProjeto//Reserva de Chromebooks//PT
BEGIN:VEVENT
UID:${Date.now()}@seudominio.com
DTSTAMP:${formatarDataICS(new Date())}
DTSTART:${formatarDataICS(new Date(inicio))}
DTEND:${formatarDataICS(new Date(fim))}
SUMMARY:${titulo}
DESCRIPTION:${descricao}
LOCATION:${local}
END:VEVENT
END:VCALENDAR`;
}

// --- Middlewares de Proteção ---
function isAuthenticated(req, res, next) { if (req.isAuthenticated()) return next(); res.redirect('/login'); }
function isAdmin(req, res, next) { if (req.isAuthenticated() && req.user.role === 'admin') return next(); res.status(403).send("<h1>Acesso Negado</h1>"); }
function canManageReservations(req, res, next) { if (req.isAuthenticated() && (req.user.role === 'admin' || req.user.role === 'operacional')) return next(); res.status(403).send("<h1>Acesso Negado</h1>"); }
function ensureAuthenticatedApi(req, res, next) { if (req.isAuthenticated()) return next(); res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' }); }

function normalizarCarrinho(carrinho) {
    const capacidade = Number.isInteger(carrinho.capacidade) ? carrinho.capacidade : parseInt(carrinho.capacidade, 10) || 0;
    const indisponiveis = Number.isInteger(carrinho.indisponiveis) ? carrinho.indisponiveis : parseInt(carrinho.indisponiveis, 10) || 0;

    return {
        ...carrinho,
        capacidade,
        indisponiveis,
        disponiveis: Math.max(capacidade - indisponiveis, 0)
    };
}

async function registrarAuditoria(req, { acao, entidade = null, entidadeId = null, detalhes = null }) {
    const usuario = req.user || {};
    const detalhesJson = detalhes ? JSON.stringify(detalhes) : null;
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
    const userAgent = req.get('user-agent') || null;

    try {
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO audit_logs (
                    usuario_id, usuario_nome, usuario_role, acao, entidade, entidade_id, detalhes_json, ip, user_agent
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    usuario.id || null,
                    usuario.nome || null,
                    usuario.role || null,
                    acao,
                    entidade,
                    entidadeId,
                    detalhesJson,
                    ip,
                    userAgent
                ],
                (err) => err ? reject(err) : resolve()
            );
        });
    } catch (err) {
        console.error("Erro ao registrar auditoria:", err.message);
    }
}


// --- ROTAS ---
app.get('/login', (req, res) => res.render('login', { erro: req.query.error || '' }));
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.events'], accessType: 'offline' }));
app.get('/auth/google/callback', passport.authenticate('google', { successRedirect: '/', failureRedirect: '/login?error=true' }));
app.get('/logout', (req, res, next) => { req.logout(err => { if (err) return next(err); res.redirect('/login'); }); });

app.get('/', isAuthenticated, async (req, res) => {
    try {
        const carrinhosDb = await new Promise((r,j)=>db.all("SELECT * FROM carrinhos",[],(e,rows)=>e?j(e):r(rows)));
        const carrinhos = carrinhosDb.map(normalizarCarrinho);
        const salas = await new Promise((r, j) => db.all("SELECT bloco, nome FROM salas", [], (e, rows) => e ? j(e) : r(rows)));
        const blocosSalas = montarSalasParaView(salas);

        res.render('index', { carrinhos, blocosSalas, user: req.user, erro: req.query.erro || '', sucesso: req.query.sucesso || '' });
    } catch (err) {
        res.status(500).send("Erro ao carregar a página: " + err.message);
    }
});

// Painel "Minhas Reservas"
app.get('/minhas-reservas', isAuthenticated, async (req, res) => {
    try {
        const sql = `SELECT r.*, c.nome as nome_carrinho 
                     FROM reservas r 
                     JOIN carrinhos c ON r.carrinho_id = c.id 
                     WHERE r.usuario_id = ? AND r.status = 'Ativa'
                     ORDER BY r.data_retirada ASC`;
        const reservas = await new Promise((r, j) => db.all(sql, [req.user.id], (e, rows) => e ? j(e) : r(rows)));
        res.render('minhas-reservas', {
            reservas,
            user: req.user,
            erro: req.query.erro || '',
            sucesso: req.query.sucesso || ''
        });
    } catch (err) {
        res.status(500).send("Erro ao carregar suas reservas.");
    }
});

// Rota de Cancelamento pelo Professor
app.post('/reservas/cancelar/:id', isAuthenticated, async (req, res) => {
    const reservaId = req.params.id;
    try {
        // Verifica se a reserva pertence ao usuário (ou se ele é admin)
        const reserva = await new Promise((r, j) => db.get(
            `SELECT r.*, c.nome as nome_carrinho
             FROM reservas r
             LEFT JOIN carrinhos c ON r.carrinho_id = c.id
             WHERE r.id = ?`,
            [reservaId],
            (e, row) => e ? j(e) : r(row)
        ));
        
        if (!reserva || (reserva.usuario_id !== req.user.id && req.user.role !== 'admin')) {
            return res.status(403).send("Você não tem permissão para cancelar esta reserva.");
        }

        await new Promise((r, j) => db.run("UPDATE reservas SET status = 'Cancelada' WHERE id = ?", [reservaId], e => e ? j(e) : r()));
        await registrarAuditoria(req, {
            acao: 'RESERVA_CANCELADA',
            entidade: 'reserva',
            entidadeId: reservaId,
            detalhes: {
                carrinho_id: reserva.carrinho_id,
                carrinho: reserva.nome_carrinho,
                quantidade: reserva.quantidade,
                data_retirada: reserva.data_retirada,
                data_devolucao: reserva.data_devolucao,
                sala: reserva.sala,
                usuario_reserva_id: reserva.usuario_id
            }
        });
        res.redirect('/minhas-reservas?sucesso=Reserva cancelada com sucesso.');
    } catch (err) {
        res.status(500).send("Erro ao cancelar reserva.");
    }
});


app.get('/admin', canManageReservations, async (req, res) => {
    try {
        const dataFiltro = req.query.data;
        let sql = `SELECT r.*, c.nome as nome_carrinho, u.nome as nome_professor FROM reservas r 
                     JOIN carrinhos c ON r.carrinho_id = c.id 
                     JOIN usuarios u ON r.usuario_id = u.id 
                     WHERE r.status = 'Ativa'`;

                     let params = [];

                     //Verifica se há filtro de data
                     if (dataFiltro) {
                        sql += ` AND date(r.data_retirada) = date(?)`;
                        params.push(dataFiltro);
                     }
                     // Ordena por data de retirada
                        sql += ` ORDER BY r.data_retirada ASC`;
        const reservas = await new Promise((r,j)=>db.all(sql, params, (e,rows)=>e?j(e):r(rows)));

        res.render('admin', { reservas, user: req.user, dataFiltro: dataFiltro || '' });
    } catch (err) {
        res.status(500).send("Erro ao carregar a página de admin: " + err.message);
    }
});

app.get('/admin/users', isAdmin, async (req, res) => {
    try {
        const usuarios = await new Promise((r,j)=>db.all("SELECT id, nome, email, role FROM usuarios",[],(e,rows)=>e?j(e):r(rows)));
        res.render('admin-users', { usuarios, user: req.user });
    } catch (err) {
        res.status(500).send("Erro ao carregar utilizadores: " + err.message);
    }
});

app.get('/admin/history', canManageReservations, async (req, res) => {
    try {
        const sql = `SELECT r.*, c.nome as nome_carrinho, u.nome as nome_professor FROM reservas r 
                     JOIN carrinhos c ON r.carrinho_id = c.id 
                     JOIN usuarios u ON r.usuario_id = u.id 
                     WHERE r.status = 'Concluída' ORDER BY r.data_devolucao DESC`;
        const reservas = await new Promise((r,j)=>db.all(sql,[],(e,rows)=>e?j(e):r(rows)));
        res.render('admin-history', { reservas, user: req.user });
    } catch (err) {
        res.status(500).send("Erro ao carregar histórico: " + err.message);
    }
});

app.get('/admin/audit', isAdmin, async (req, res) => {
    try {
        const acaoFiltro = (req.query.acao || '').trim();
        const params = [];
        let sql = `SELECT * FROM audit_logs`;

        if (acaoFiltro) {
            sql += ` WHERE acao = ?`;
            params.push(acaoFiltro);
        }

        sql += ` ORDER BY criado_em DESC, id DESC LIMIT 300`;

        const logs = await new Promise((r,j)=>db.all(sql, params, (e,rows)=>e?j(e):r(rows)));
        const acoes = await new Promise((r,j)=>db.all(
            `SELECT DISTINCT acao FROM audit_logs ORDER BY acao ASC`,
            [],
            (e,rows)=>e?j(e):r(rows.map(row => row.acao))
        ));

        res.render('admin-audit', { logs, acoes, acaoFiltro, user: req.user });
    } catch (err) {
        res.status(500).send("Erro ao carregar auditoria: " + err.message);
    }
});
// Rota para abrir a página de inventário
app.get('/admin/inventario', isAdmin, (req, res) => {
    db.all('SELECT * FROM carrinhos', [], (err, rows) => {
        if (err) return res.status(500).send("Erro ao carregar inventário.");
        
        res.render('admin-inventario', { 
            user: req.user, 
            carrinhos: rows.map(normalizarCarrinho)
        });
    });
});

// Rota para salvar a alteração de quantidade
app.post('/admin/inventario/update', isAdmin, async (req, res) => {
    const id = parseInt(req.body.id, 10);
    const capacidade = parseInt(req.body.capacidade, 10);
    const indisponiveis = parseInt(req.body.indisponiveis, 10);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Carrinho inválido." });
    }

    if (!Number.isInteger(capacidade) || capacidade < 0) {
        return res.status(400).json({ message: "Capacidade inválida." });
    }

    if (!Number.isInteger(indisponiveis) || indisponiveis < 0) {
        return res.status(400).json({ message: "Quantidade em manutenção inválida." });
    }

    if (indisponiveis > capacidade) {
        return res.status(400).json({ message: "Indisponíveis não pode ser maior que a capacidade total." });
    }

    try {
        const carrinhoAnterior = await new Promise((r, j) => db.get(
            "SELECT id, nome, capacidade, indisponiveis FROM carrinhos WHERE id = ?",
            [id],
            (e, row) => e ? j(e) : r(row)
        ));

        if (!carrinhoAnterior) {
            return res.status(404).json({ message: "Carrinho não encontrado." });
        }

        const sql = `UPDATE carrinhos SET capacidade = ?, indisponiveis = ? WHERE id = ?`;
        await new Promise((r, j) => db.run(sql, [capacidade, indisponiveis, id], function(err) {
            if (err) return j(err);
            r(this);
        }));

        await registrarAuditoria(req, {
            acao: 'INVENTARIO_ATUALIZADO',
            entidade: 'carrinho',
            entidadeId: id,
            detalhes: {
                carrinho: carrinhoAnterior.nome,
                antes: {
                    capacidade: carrinhoAnterior.capacidade,
                    indisponiveis: carrinhoAnterior.indisponiveis
                },
                depois: {
                    capacidade,
                    indisponiveis
                }
            }
        });

        res.json({ message: "Sucesso!", disponiveis: Math.max(capacidade - indisponiveis, 0) });
    } catch (err) {
        res.status(500).json({ message: "Erro ao atualizar banco." });
    }
});

// --- Rota para o Dashboard de Reservas ---
app.get('/admin/dashboard', canManageReservations, async (req, res) => {
    try {
        // 1. Total de Reservas por Status (Ativas vs Concluídas)
        const statsStatus = await new Promise((r, j) => 
            db.all("SELECT status, COUNT(*) as qtd FROM reservas GROUP BY status", [], (e, rows) => e ? j(e) : r(rows))
        );

        // 2. Uso por Carrinho (Os 5 carrinhos mais reservados)
        const statsCarrinhos = await new Promise((r, j) => 
            db.all(`SELECT c.nome, COUNT(r.id) as total 
                    FROM reservas r 
                    JOIN carrinhos c ON r.carrinho_id = c.id 
                    GROUP BY c.id ORDER BY total DESC LIMIT 5`, [], (e, rows) => e ? j(e) : r(rows))
        );

        // 3. Top 5 Professores que mais utilizam o sistema
        const statsProfessores = await new Promise((r, j) => 
            db.all(`SELECT u.nome, COUNT(r.id) as total 
                    FROM reservas r 
                    JOIN usuarios u ON r.usuario_id = u.id 
                    GROUP BY u.id ORDER BY total DESC LIMIT 5`, [], (e, rows) => e ? j(e) : r(rows))
        );

        // 4. Volume de reservas nos últimos 7 dias (Para o gráfico de tendência)
        const statsDias = await new Promise((r, j) => 
            db.all(`SELECT date(data_retirada) as data, COUNT(*) as qtd 
                    FROM reservas 
                    WHERE data_retirada >= date('now', '-7 days')
                    GROUP BY date(data_retirada)
                    ORDER BY data ASC`, [], (e, rows) => e ? j(e) : r(rows))
        );
        const statsSalas = await new Promise((r, j) =>
            db.all(`SELECT sala, COUNT(*) as total
                    FROM reservas
                    WHERE sala IS NOT NULL AND trim(sala) <> ''
                    GROUP BY sala
                    ORDER BY total DESC
                    LIMIT 5`, [], (e, rows) => e ? j(e) : r(rows))
        );

        const statsHorarios = await new Promise((r, j) =>
            db.all(`SELECT strftime('%H:00', data_retirada) as hora, COUNT(*) as total
                    FROM reservas
                    GROUP BY strftime('%H', data_retirada)
                    ORDER BY total DESC, hora ASC
                    LIMIT 6`, [], (e, rows) => e ? j(e) : r(rows))
        );

        const statsResumo = await new Promise((r, j) =>
            db.get(`SELECT
                        COUNT(*) as totalReservas,
                        COALESCE(SUM(quantidade), 0) as totalChromebooks,
                        ROUND(AVG((julianday(data_devolucao) - julianday(data_retirada)) * 24), 1) as mediaHoras
                    FROM reservas`, [], (e, row) => e ? j(e) : r(row))
        );

        const statusMap = statsStatus.reduce((acc, item) => {
            acc[item.status] = item.qtd;
            return acc;
        }, {});

        const totalCanceladas = statusMap.Cancelada || 0;
        const taxaCancelamento = statsResumo.totalReservas
            ? Number(((totalCanceladas / statsResumo.totalReservas) * 100).toFixed(1))
            : 0;

        res.render('admin-dashboard', { 
            user: req.user, 
            statsStatus, 
            statsCarrinhos, 
            statsProfessores, 
            statsDias,
            statsSalas,
            statsHorarios,
            resumo: {
                totalReservas: statsResumo.totalReservas || 0,
                totalChromebooks: statsResumo.totalChromebooks || 0,
                mediaHoras: statsResumo.mediaHoras || 0,
                totalAtivas: statusMap.Ativa || 0,
                totalConcluidas: statusMap['Concluída'] || 0,
                totalCanceladas,
                taxaCancelamento
            }
        });
    } catch (err) {
        console.error("Erro no Dashboard:", err);
        res.status(500).send("Erro ao carregar o dashboard: " + err.message);
    }
});
// --- Rotas de atualização de usuários ---
app.post('/admin/set-role/:id', isAdmin, async (req, res) => {
    const { role } = req.body;
    const userId = req.params.id;
    if (req.user.id == userId) return res.status(400).send("Você não pode alterar seu próprio papel.");
    const allowedRoles = ['professor', 'operacional', 'admin'];
    if (!allowedRoles.includes(role)) return res.status(400).send("Papel inválido.");

    try {
        const usuarioAlterado = await new Promise((r, j) => db.get(
            "SELECT id, nome, email, role FROM usuarios WHERE id = ?",
            [userId],
            (e, row) => e ? j(e) : r(row)
        ));

        if (!usuarioAlterado) return res.status(404).send("Utilizador não encontrado.");

        await new Promise((r, j) => db.run(`UPDATE usuarios SET role = ? WHERE id = ?`, [role, userId], (err) => err ? j(err) : r()));
        await registrarAuditoria(req, {
            acao: 'USUARIO_PERFIL_ALTERADO',
            entidade: 'usuario',
            entidadeId: userId,
            detalhes: {
                usuario: usuarioAlterado.nome,
                email: usuarioAlterado.email,
                role_anterior: usuarioAlterado.role,
                role_novo: role
            }
        });
        res.redirect('/admin/users');
    } catch (err) {
        res.status(500).send("Erro ao atualizar papel do utilizador.");
    }
});

app.post('/admin/delete/:id', isAdmin, async (req, res) => {
    if (req.user.id == req.params.id) return res.status(400).send("Você não pode excluir a si mesmo.");

    try {
        const usuarioExcluido = await new Promise((r, j) => db.get(
            "SELECT id, nome, email, role FROM usuarios WHERE id = ?",
            [req.params.id],
            (e, row) => e ? j(e) : r(row)
        ));

        if (!usuarioExcluido) return res.status(404).send("Utilizador não encontrado.");

        await new Promise((r, j) => db.run(`DELETE FROM usuarios WHERE id = ?`, [req.params.id], (err) => err ? j(err) : r()));
        await registrarAuditoria(req, {
            acao: 'USUARIO_EXCLUIDO',
            entidade: 'usuario',
            entidadeId: req.params.id,
            detalhes: {
                usuario: usuarioExcluido.nome,
                email: usuarioExcluido.email,
                role: usuarioExcluido.role
            }
        });
        res.redirect('/admin/users');
    } catch (err) {
        res.status(500).send("Erro ao excluir utilizador.");
    }
});

// --- Rota de reservas individuais ---
app.post('/reservar', isAuthenticated, async (req, res) => {
    const { carrinho_id, quantidade, data_retirada, data_devolucao, bloco, sala, addToCalendar } = req.body;
    const quantidadeNum = parseInt(quantidade, 10);
    const usuario_id = req.user.id;
    const blocoSelecionado = (bloco || '').trim();
    const salaSelecionada = (sala || '').trim();

    try {
        if (!Number.isInteger(quantidadeNum) || quantidadeNum <= 0) {
            return res.redirect('/?erro=' + encodeURIComponent('Quantidade invalida.'));
        }

        if (!blocoSelecionado || !salaSelecionada) {
            return res.redirect('/?erro=' + encodeURIComponent('Selecione o bloco e a sala da reserva.'));
        }

        const inicioSolicitado = new Date(data_retirada);
        const fimSolicitado = new Date(data_devolucao);
        if (isNaN(inicioSolicitado.getTime()) || isNaN(fimSolicitado.getTime()) || fimSolicitado <= inicioSolicitado) {
            return res.redirect('/?erro=' + encodeURIComponent('Periodo invalido para reserva.'));
        }

        const agora = new Date();
        if (inicioSolicitado < agora) {
            return res.redirect('/?erro=' + encodeURIComponent('A data de retirada nao pode estar no passado.'));
        }

        if (req.user.role !== 'admin') {
            const minimoPermitido = new Date(agora.getTime() + 24 * 60 * 60 * 1000);
            const maximoPermitido = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);

            if (inicioSolicitado < minimoPermitido) {
                return res.redirect('/?erro=' + encodeURIComponent('As reservas devem ser feitas com pelo menos 24 horas de antecedencia.'));
            }

            if (inicioSolicitado > maximoPermitido || fimSolicitado > maximoPermitido) {
                return res.redirect('/?erro=' + encodeURIComponent('As reservas devem ser feitas com no maximo 30 dias de antecedencia.'));
            }
        }

        const carrinhoDb = await new Promise((r,j)=>db.get("SELECT capacidade, indisponiveis, nome FROM carrinhos WHERE id = ?",[carrinho_id],(e,row)=>e?j(e):r(row)));
        const carrinho = carrinhoDb ? normalizarCarrinho(carrinhoDb) : null;
        if (!carrinho) return res.redirect('/?erro=' + encodeURIComponent('Carrinho não encontrado.'));

        const salaValida = await new Promise((r, j) => db.get(
            "SELECT bloco, nome FROM salas WHERE bloco = ? AND nome = ?",
            [blocoSelecionado, salaSelecionada],
            (e, row) => e ? j(e) : r(row)
        ));

        if (!salaValida) {
            return res.redirect('/?erro=' + encodeURIComponent('A sala selecionada nao pertence ao bloco informado.'));
        }

        const salaFormatada = `${formatarLocal(salaValida.bloco)} - ${formatarLocal(salaValida.nome)}`;

        const reservasAtivas = await new Promise((r,j)=>db.all("SELECT quantidade, data_retirada, data_devolucao FROM reservas WHERE carrinho_id = ? AND status = 'Ativa'",[carrinho_id],(e,rows)=>e?j(e):r(rows)));
        
        let picoDeUso = 0;
        const inicioNovaReserva = new Date(data_retirada);
        const fimNovaReserva = new Date(data_devolucao);
        for(let t=inicioNovaReserva.getTime(); t<fimNovaReserva.getTime(); t+=60000){
            let u = 0;
            for(const R of reservasAtivas){
                const i = new Date(R.data_retirada).getTime();
                const f = new Date(R.data_devolucao).getTime();
                if(t >= i && t < f) u += R.quantidade;
            }
            if(u > picoDeUso) picoDeUso = u;
        }
        if(quantidadeNum > (carrinho.disponiveis - picoDeUso)){
            return res.redirect('/?erro=' + encodeURIComponent(`Erro: só há ${Math.max(carrinho.disponiveis - picoDeUso, 0)} disponíveis.`));
        }

        // Inserção
        const sqlInsert = `INSERT INTO reservas (carrinho_id, quantidade, usuario_id, data_retirada, data_devolucao, sala, status) VALUES (?, ?, ?, ?, ?, ?, ?)`; 
        const { lastID } = await new Promise((r,j)=>db.run(sqlInsert,[carrinho_id,quantidadeNum,usuario_id,data_retirada,data_devolucao,salaFormatada,"Ativa"], function(e){ e?j(e):r(this) }));
        await registrarAuditoria(req, {
            acao: 'RESERVA_CRIADA',
            entidade: 'reserva',
            entidadeId: lastID,
            detalhes: {
                carrinho_id,
                carrinho: carrinho.nome,
                quantidade: quantidadeNum,
                data_retirada,
                data_devolucao,
                sala: salaFormatada,
                reserva_admin_sem_bloqueio_prazo: req.user.role === 'admin'
            }
        });

        // Dados do evento
        const tituloEvento = `Reserva de ${quantidadeNum} Chromebooks (${carrinho.nome})`;
        const descricaoEvento = `Reserva realizada por ${req.user.nome}. ID da Reserva: ${lastID}`;
        const localEvento = `${salaFormatada}, Colégio La Salle`;

        // Link e ICS
        const linkGoogleCalendar = gerarLinkGoogleCalendar(tituloEvento, descricaoEvento, localEvento, data_retirada, data_devolucao);
        const arquivoICS = gerarICS(tituloEvento, descricaoEvento, localEvento, data_retirada, data_devolucao);

        const avisos = [];

        try {
            await sendReservationEmail({
                to: req.user.email,
                subject: "Confirmação da sua reserva",
                text: `Olá ${req.user.nome}, sua reserva foi feita com sucesso. Adicione à sua agenda: ${linkGoogleCalendar}`,
                html: `<p>Olá <b>${req.user.nome}</b>, sua reserva foi feita com sucesso!</p>
                   <p><b>Detalhes:</b><br>
                   <strong>Carrinho:</strong> ${carrinho.nome}<br>
                   <strong>Quantidade:</strong> ${quantidadeNum}<br>
                  <strong> Data de Retirada:</strong> ${data_retirada}<br>
                  <strong> Data de Devolução:</strong> ${data_devolucao}<br>
                  <strong> Sala:</strong> ${salaFormatada}</p>
                   <p>Adicione à sua agenda:</strong> <a href="${linkGoogleCalendar}">Google Calendar</a></p>
                   <p>Ou abra o anexo .ics para Outlook/Apple Calendar.</p>
                   <p><strong>Equipe de Tecnologia - Colégio La Salle</p>
                           <p>(11) 2793.1444</p>
                           <p>https://www.lasalle.edu.br/saopaulo</strong></p>`,
                attachments: [
                    { filename: 'reserva.ics', content: arquivoICS }
                ]
            });
        } catch (emailErr) {
            console.error('Falha ao enviar e-mail de confirmação:', emailErr.message || emailErr);
            avisos.push('Reserva criada, mas o e-mail de confirmação não pôde ser enviado.');
        }

        // Criar evento Google Calendar automático
        if (addToCalendar === 'true' && req.user.google_refresh_token) {
            try {
                const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, "/auth/google/callback");
                oauth2Client.setCredentials({ refresh_token: req.user.google_refresh_token });
                const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
                await calendar.events.insert({
                    calendarId: 'primary',
                    resource: {
                        summary: tituloEvento,
                        location: localEvento,
                        description: descricaoEvento,
                        start: { dateTime: new Date(data_retirada).toISOString(), timeZone: 'America/Sao_Paulo' },
                        end: { dateTime: new Date(data_devolucao).toISOString(), timeZone: 'America/Sao_Paulo' },
                        attendees: [{ email: req.user.email }, { email: process.env.MANAGER_EMAIL }],
                        reminders: { useDefault: true }
                    }
                });
                console.log('Evento criado no Google Calendar com sucesso!');
            } catch (calendarErr) {
                console.error("ERRO ao criar evento no Google Calendar:", calendarErr);
                avisos.push('Reserva criada, mas houve falha ao adicionar o evento no Google Calendar.');
            }
        }

        let redirectUrl = '/?sucesso=' + encodeURIComponent('Sua reserva foi feita com sucesso!');
        if (avisos.length > 0) {
            redirectUrl = appendFlashMessage(redirectUrl, 'erro', avisos.join(' '));
        }

        res.redirect(redirectUrl);
    } catch (err) {
        console.error(err);
        res.status(500).send("Erro ao processar reserva: " + err.message);
    }
});

// --- Rota de reservas recorrentes ---
app.post('/reservar-recorrente', isAuthenticated, async (req, res) => {
    return res.redirect('/?erro=' + encodeURIComponent('Reservas recorrentes ainda nao estao ativas no sistema.'));
});
app.post('/reservas/concluir/:id', canManageReservations, async (req, res) => {
    const reservaId = req.params.id;
    
    // Captura o nome do Administrador ou Operacional que está logado na sessão
    const nomeQuemConcluiu = req.user.nome; 

    try {
        const reserva = await new Promise((resolve, reject) => {
            db.get(
                `SELECT r.*, c.nome as nome_carrinho, u.nome as nome_professor
                 FROM reservas r
                 LEFT JOIN carrinhos c ON r.carrinho_id = c.id
                 LEFT JOIN usuarios u ON r.usuario_id = u.id
                 WHERE r.id = ?`,
                [reservaId],
                (err, row) => err ? reject(err) : resolve(row)
            );
        });

        if (!reserva) {
            return res.status(404).send("Reserva não encontrada.");
        }

        // Atualiza o status da reserva E grava o nome do responsável
        await new Promise((resolve, reject) => {
            const sql = "UPDATE reservas SET status = 'Concluída', concluido_por = ? WHERE id = ?";
            db.run(sql, [nomeQuemConcluiu, reservaId], function(err) {
                if (err) return reject(err);
                resolve();
            });
        });
        await registrarAuditoria(req, {
            acao: 'RESERVA_CONCLUIDA',
            entidade: 'reserva',
            entidadeId: reservaId,
            detalhes: {
                carrinho_id: reserva.carrinho_id,
                carrinho: reserva.nome_carrinho,
                professor: reserva.nome_professor,
                quantidade: reserva.quantidade,
                data_retirada: reserva.data_retirada,
                data_devolucao: reserva.data_devolucao,
                sala: reserva.sala,
                concluido_por: nomeQuemConcluiu
            }
        });

        // Redireciona de volta para o painel de gestão
        res.redirect('/admin'); 
    } catch (err) {
        console.error("Erro ao concluir reserva:", err);
        res.status(500).send("Erro ao concluir reserva: " + err.message);
    }
});

// --- Histórico de reservas (todas concluídas) ---
app.get('/api/availability', ensureAuthenticatedApi, async (req, res) => {
    const { carrinho_id, data_retirada, data_devolucao } = req.query;
    if (!carrinho_id || !data_retirada || !data_devolucao) {
        return res.status(400).json({ error: 'Parâmetros faltando.' });
    }

    const inicioNovaReserva = new Date(data_retirada);
    const fimNovaReserva = new Date(data_devolucao);

    if (isNaN(inicioNovaReserva) || isNaN(fimNovaReserva) || fimNovaReserva <= inicioNovaReserva) {
        return res.status(400).json({ error: 'Datas inválidas.' });
    }

    try {
        const carrinhoDb = await new Promise((resolve, reject) => {
            db.get("SELECT capacidade, indisponiveis FROM carrinhos WHERE id = ?", [carrinho_id], (err, row) => {
                if (err) reject(err); else resolve(row);
            });
        });
        const carrinho = carrinhoDb ? normalizarCarrinho(carrinhoDb) : null;

        if (!carrinho) return res.status(404).json({ error: 'Carrinho não encontrado.' });

        // Combina reservas pontuais e recorrentes para a verificação
        const reservasAtivas = await new Promise((resolve, reject) => {
            db.all("SELECT * FROM reservas WHERE carrinho_id = ? AND status = 'Ativa'", [carrinho_id], (err, rows) => {
                if (err) reject(err); else resolve(rows);
            });
        });

        let picoDeUso = 0;
        for (let t = inicioNovaReserva.getTime(); t < fimNovaReserva.getTime(); t += 60000) {
            let emUsoNesteMinuto = 0;
            // Verifica conflito com reservas pontuais
            for (const r of reservasAtivas) {
                if (t >= new Date(r.data_retirada).getTime() && t < new Date(r.data_devolucao).getTime()) {
                    emUsoNesteMinuto += r.quantidade;
                }
            }
            if (emUsoNesteMinuto > picoDeUso) picoDeUso = emUsoNesteMinuto;
        }

        const disponiveisNoHorario = carrinho.disponiveis - picoDeUso;
        res.json({ disponiveis: disponiveisNoHorario < 0 ? 0 : disponiveisNoHorario });

    } catch (err) {
        console.error("Erro na API /api/availability:", err);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});


app.use((err, req, res, next) => {
    console.error('Erro não tratado:', err);

    if (res.headersSent) {
        return next(err);
    }

    if (req.originalUrl.startsWith('/api/')) {
        return res.status(500).json({ error: 'Erro interno no servidor.' });
    }

    res.status(500).send('Erro interno no servidor.');
});

// --- Inicia servidor ---
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));

