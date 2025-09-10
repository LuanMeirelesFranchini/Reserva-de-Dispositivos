// Carrega as variáveis de ambiente do ficheiro .env - DEVE SER A PRIMEIRA LINHA!
require('dotenv').config();

// --- Importações das Ferramentas ---
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

// --- Configurações Iniciais ---
const app = express();
const PORT = 3000;
app.set('view engine', 'ejs');
const db = new sqlite3.Database('./reservas.db', (err) => {
    if (err) return console.error("ERRO FATAL: Não foi possível conectar ao banco de dados.", err.message);
    console.log("Conectado ao banco de dados SQLite com sucesso.");
});

// --- Middlewares Essenciais ---
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // Sessão válida por 24 horas
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
        if (user) return done(null, user);

        // --- MUDANÇA PRINCIPAL: Verifica os dois domínios ---
        if (!email.endsWith('@lasalle.org.br') && !email.endsWith('@prof.soulasalle.com.br')) {
            return done(null, false, { message: 'Apenas e-mails institucionais são permitidos.' });
        }

        db.run("INSERT INTO usuarios (nome, email, role) VALUES (?, ?, ?)", [nome, email, 'professor'], function(err) {
            if (err) return done(err);
            const newUser = { id: this.lastID, nome, email, role: 'professor' };
            return done(null, newUser);
        });
    });
  }
));

// --- Middlewares de Proteção de Rotas (Nossos "Guardas") ---
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect('/login');
}

function canManageReservations(req, res, next) {
    if (req.isAuthenticated() && (req.user.role === 'admin' || req.user.role === 'operacional')) {
        return next();
    }
    res.status(403).send("<h1>Acesso Negado</h1><p>Você não tem permissão para ver esta página.</p>");
}

function isAdmin(req, res, next) {
    if (req.isAuthenticated() && req.user.role === 'admin') return next();
    res.status(403).send("<h1>Acesso Negado</h1>");
}

// ==================================================================
// --- ROTAS DA APLICAÇÃO ---
// ==================================================================

// --- Rotas de Autenticação ---
app.get('/login', (req, res) => res.render('login', { erro: req.query.error || '' }));
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { successRedirect: '/', failureRedirect: '/login?error=true' }));
app.get('/logout', (req, res, next) => {
    req.logout(err => {
        if (err) return next(err);
        res.redirect('/login');
    });
});

// --- Rota Principal ---
app.get('/', isAuthenticated, async (req, res) => {
    try {
        const carrinhos = await new Promise((r,j)=>db.all("SELECT * FROM carrinhos",[],(e,rows)=>e?j(e):r(rows)));
        res.render('index', { 
            carrinhos, 
            user: req.user,
            erro: req.query.erro || '',
            sucesso: req.query.sucesso || ''
        });
    } catch (err) {
        res.status(500).send("Erro ao carregar a página: " + err.message);
    }
});

// --- Rotas de Gestão e Administração ---
app.get('/admin', canManageReservations, async (req, res) => {
  try {
    const sql = `SELECT r.*, c.nome as nome_carrinho, u.nome as nome_professor FROM reservas r JOIN carrinhos c ON r.carrinho_id = c.id JOIN usuarios u ON r.usuario_id = u.id WHERE r.status = 'Ativa' ORDER BY r.data_retirada ASC`;
    const reservas = await new Promise((r,j)=>db.all(sql,[],(e,rows)=>e?j(e):r(rows)));
    res.render('admin', { reservas, user: req.user });
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

app.post('/admin/set-role/:id', isAdmin, (req, res) => {
    const { role } = req.body;
    const userId = req.params.id;
    if (req.user.id == userId) {
        return res.status(400).send("Você não pode alterar seu próprio papel.");
    }
    const allowedRoles = ['professor', 'operacional', 'admin'];
    if (!allowedRoles.includes(role)) {
        return res.status(400).send("Papel inválido.");
    }
    db.run(`UPDATE usuarios SET role = ? WHERE id = ?`, [role, userId], (err) => {
        if (err) return res.status(500).send("Erro ao atualizar papel do utilizador.");
        res.redirect('/admin/users');
    });
});

app.post('/admin/delete/:id', isAdmin, (req, res) => {
    if (req.user.id == req.params.id) {
        return res.status(400).send("Você não pode excluir a si mesmo.");
    }
    db.run(`DELETE FROM usuarios WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).send("Erro ao excluir utilizador.");
        res.redirect('/admin/users');
    });
});

// --- ROTAS DE AÇÕES E API ---
app.post('/reservar', isAuthenticated, async (req, res) => {
    const { carrinho_id, quantidade, data_retirada, data_devolucao, sala } = req.body;
    const quantidadeNum = parseInt(quantidade, 10);
    const usuario_id = req.user.id;
    try {
        const carrinho = await new Promise((r,j)=>db.get("SELECT capacidade FROM carrinhos WHERE id = ?",[carrinho_id],(e,row)=>e?j(e):r(row)));
        const capacidadeTotal = carrinho.capacidade;
        const reservasAtivas = await new Promise((r,j)=>db.all("SELECT quantidade, data_retirada, data_devolucao FROM reservas WHERE carrinho_id = ? AND status = 'Ativa'",[carrinho_id],(e,rows)=>e?j(e):r(rows)));
        let picoDeUso = 0;
        const inicioNovaReserva = new Date(data_retirada);
        const fimNovaReserva = new Date(data_devolucao);
        for(let t=inicioNovaReserva.getTime(); t<fimNovaReserva.getTime(); t+=60000){
            let u=0;
            for(const R of reservasAtivas){
                let i=new Date(R.data_retirada).getTime(),f=new Date(R.data_devolucao).getTime();
                if(t>=i&&t<f) u+=R.quantidade;
            }
            if(u>picoDeUso) picoDeUso=u;
        }
        const disponiveisNoHorario = capacidadeTotal - picoDeUso;
        if(quantidadeNum > disponiveisNoHorario){
            const msg=`Erro: Você tentou reservar ${quantidadeNum}, mas só há ${disponiveisNoHorario} disponíveis.`;
            return res.redirect('/?erro='+encodeURIComponent(msg));
        }
        const sqlInsert = `INSERT INTO reservas (carrinho_id, quantidade, usuario_id, data_retirada, data_devolucao, sala, status) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        await new Promise((r,j)=>db.run(sqlInsert,[carrinho_id,quantidadeNum,usuario_id,data_retirada,data_devolucao,sala,"Ativa"],function(e){if(e)j(e);else r(this)}));
        res.redirect('/?sucesso=' + encodeURIComponent('Sua reserva foi feita com sucesso!'));
    } catch (err) {
        res.status(500).send("Erro ao processar reserva: " + err.message);
    }
});

app.post('/reservas/concluir/:id', canManageReservations, (req, res) => {
    const idParaConcluir = req.params.id;
    const sql = `UPDATE reservas SET status = 'Concluída' WHERE id = ?`;
    db.run(sql, [idParaConcluir], (err) => {
        if (err) return res.status(500).send("Erro ao concluir a reserva.");
        res.redirect('/admin');
    });
});

app.get('/api/availability', isAuthenticated, async (req, res) => {
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
        const carrinho = await new Promise((r,j)=>db.get("SELECT capacidade FROM carrinhos WHERE id = ?",[carrinho_id],(e,row)=>e?j(e):r(row)));
        if (!carrinho) return res.status(404).json({error:'Carrinho não encontrado.'});
        const capacidadeTotal = carrinho.capacidade;
        const reservasAtivas = await new Promise((r,j)=>db.all("SELECT quantidade, data_retirada, data_devolucao FROM reservas WHERE carrinho_id = ? AND status = 'Ativa'",[carrinho_id],(e,rows)=>e?j(e):r(rows)));
        let picoDeUso = 0;
        for(let t=inicioNovaReserva.getTime(); t<fimNovaReserva.getTime(); t+=60000){
            let u=0;
            for(const R of reservasAtivas){
                let i=new Date(R.data_retirada).getTime(),f=new Date(R.data_devolucao).getTime();
                if(t>=i&&t<f) u+=R.quantidade;
            }
            if(u>picoDeUso) picoDeUso=u;
        }
        const disponiveisNoHorario = capacidadeTotal - picoDeUso;
        res.json({disponiveis:disponiveisNoHorario});
    } catch (err) {
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

app.listen(PORT, () => console.log(`Servidor a rodar na porta ${PORT}.`));

