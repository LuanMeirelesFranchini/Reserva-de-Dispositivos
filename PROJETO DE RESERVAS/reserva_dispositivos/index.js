// Carrega as variáveis de ambiente do ficheiro .env - DEVE SER A PRIMEIRA LINHA!
require('dotenv').config();

// --- Importações das Ferramentas ---
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');

// --- Configurações Iniciais ---
const app = express();
const PORT = 3000;
app.set('view engine', 'ejs');
const db = new sqlite3.Database('./data/reservas.db', (err) => {
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

// ==================================================================
// --- ROTAS ---
// ==================================================================
app.get('/login', (req, res) => res.render('login', { erro: req.query.error || '' }));
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.events'], accessType: 'offline' }));
app.get('/auth/google/callback', passport.authenticate('google', { successRedirect: '/', failureRedirect: '/login?error=true' }));
app.get('/logout', (req, res, next) => { req.logout(err => { if (err) return next(err); res.redirect('/login'); }); });

app.get('/', isAuthenticated, async (req, res) => {
    try {
        const carrinhos = await new Promise((r,j)=>db.all("SELECT * FROM carrinhos",[],(e,rows)=>e?j(e):r(rows)));
        res.render('index', { carrinhos, user: req.user, erro: req.query.erro || '', sucesso: req.query.sucesso || '' });
    } catch (err) {
        res.status(500).send("Erro ao carregar a página: " + err.message);
    }
});

// NOVO: Painel "Minhas Reservas"
app.get('/minhas-reservas', isAuthenticated, async (req, res) => {
    try {
        const sql = `SELECT r.*, c.nome as nome_carrinho 
                     FROM reservas r 
                     JOIN carrinhos c ON r.carrinho_id = c.id 
                     WHERE r.usuario_id = ? AND r.status = 'Ativa'
                     ORDER BY r.data_retirada ASC`;
        const reservas = await new Promise((r, j) => db.all(sql, [req.user.id], (e, rows) => e ? j(e) : r(rows)));
        res.render('minhas-reservas', { reservas, user: req.user });
    } catch (err) {
        res.status(500).send("Erro ao carregar suas reservas.");
    }
});

// NOVO: Rota de Cancelamento pelo Professor
app.post('/reservas/cancelar/:id', isAuthenticated, async (req, res) => {
    const reservaId = req.params.id;
    try {
        // Verifica se a reserva pertence ao usuário (ou se ele é admin)
        const reserva = await new Promise((r, j) => db.get("SELECT usuario_id FROM reservas WHERE id = ?", [reservaId], (e, row) => e ? j(e) : r(row)));
        
        if (!reserva || (reserva.usuario_id !== req.user.id && req.user.role !== 'admin')) {
            return res.status(403).send("Você não tem permissão para cancelar esta reserva.");
        }

        await new Promise((r, j) => db.run("UPDATE reservas SET status = 'Cancelada' WHERE id = ?", [reservaId], e => e ? j(e) : r()));
        res.redirect('/minhas-reservas?sucesso=Reserva cancelada com sucesso.');
    } catch (err) {
        res.status(500).send("Erro ao cancelar reserva.");
    }
});


app.get('/admin', canManageReservations, async (req, res) => {
    try {
        const sql = `SELECT r.*, c.nome as nome_carrinho, u.nome as nome_professor FROM reservas r 
                     JOIN carrinhos c ON r.carrinho_id = c.id 
                     JOIN usuarios u ON r.usuario_id = u.id 
                     WHERE r.status = 'Ativa' ORDER BY r.data_retirada ASC`;
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

// --- Rotas de atualização de usuários ---
app.post('/admin/set-role/:id', isAdmin, (req, res) => {
    const { role } = req.body;
    const userId = req.params.id;
    if (req.user.id == userId) return res.status(400).send("Você não pode alterar seu próprio papel.");
    const allowedRoles = ['professor', 'operacional', 'admin'];
    if (!allowedRoles.includes(role)) return res.status(400).send("Papel inválido.");
    db.run(`UPDATE usuarios SET role = ? WHERE id = ?`, [role, userId], (err) => {
        if (err) return res.status(500).send("Erro ao atualizar papel do utilizador.");
        res.redirect('/admin/users');
    });
});

app.post('/admin/delete/:id', isAdmin, (req, res) => {
    if (req.user.id == req.params.id) return res.status(400).send("Você não pode excluir a si mesmo.");
    db.run(`DELETE FROM usuarios WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).send("Erro ao excluir utilizador.");
        res.redirect('/admin/users');
    });
});

// --- Rota de reservas individuais ---
app.post('/reservar', isAuthenticated, async (req, res) => {
    const { carrinho_id, quantidade, data_retirada, data_devolucao, sala, addToCalendar } = req.body;
    const quantidadeNum = parseInt(quantidade, 10);
    const usuario_id = req.user.id;

    try {
        // Validação
        const carrinho = await new Promise((r,j)=>db.get("SELECT capacidade, nome FROM carrinhos WHERE id = ?",[carrinho_id],(e,row)=>e?j(e):r(row)));
        if (!carrinho) return res.redirect('/?erro=' + encodeURIComponent('Carrinho não encontrado.'));

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
        if(quantidadeNum > (carrinho.capacidade - picoDeUso)){
            return res.redirect('/?erro=' + encodeURIComponent(`Erro: só há ${carrinho.capacidade - picoDeUso} disponíveis.`));
        }

        // Inserção
        const sqlInsert = `INSERT INTO reservas (carrinho_id, quantidade, usuario_id, data_retirada, data_devolucao, sala, status) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        const { lastID } = await new Promise((r,j)=>db.run(sqlInsert,[carrinho_id,quantidadeNum,usuario_id,data_retirada,data_devolucao,sala,"Ativa"], function(e){ e?j(e):r(this) }));

        // Dados do evento
        const tituloEvento = `Reserva de ${quantidadeNum} Chromebooks (${carrinho.nome})`;
        const descricaoEvento = `Reserva realizada por ${req.user.nome}. ID da Reserva: ${lastID}`;
        const localEvento = `Sala ${sala}, Colégio La Salle`;

        // Link e ICS
        const linkGoogleCalendar = gerarLinkGoogleCalendar(tituloEvento, descricaoEvento, localEvento, data_retirada, data_devolucao);
        const arquivoICS = gerarICS(tituloEvento, descricaoEvento, localEvento, data_retirada, data_devolucao);

        // Enviar e-mail
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
                  <strong> Sala:</strong> ${sala}</p>
                   <p>Adicione à sua agenda:</strong> <a href="${linkGoogleCalendar}">Google Calendar</a></p>
                   <p>Ou abra o anexo .ics para Outlook/Apple Calendar.</p>
                   <p><strong>Equipe de Tecnologia - Colégio La Salle</p>
                           <p>(11) 2793.1444</p>
                           <p>https://www.lasalle.edu.br/saopaulo</strong></p>`,
            attachments: [
                { filename: 'reserva.ics', content: arquivoICS }
            ]
        });

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
            }
        }

        res.redirect('/?sucesso=' + encodeURIComponent('Sua reserva foi feita com sucesso!'));
    } catch (err) {
        console.error(err);
        res.status(500).send("Erro ao processar reserva: " + err.message);
    }
});

// --- Rota de reservas recorrentes ---
app.post('/reservar-recorrente', isAuthenticated, async (req, res) => {
    const { carrinho_id, quantidade, dia_semana, hora_inicio, hora_fim, data_final, sala, addToCalendar } = req.body;
    const quantidadeNum = parseInt(quantidade, 10);
    const usuario_id = req.user.id;
    const recurrence_id = uuidv4();

    try {
        // Validação de campos obrigatórios
        if (!carrinho_id || !quantidadeNum || !dia_semana || !hora_inicio || !hora_fim || !data_final || !sala) {
            return res.redirect('/?erro=' + encodeURIComponent('Preencha todos os campos obrigatórios.'));
        }

        const dataFinalISO = new Date(data_final);
        if (isNaN(dataFinalISO.getTime())) {
            return res.redirect('/?erro=' + encodeURIComponent('Data final inválida.'));
        }

        // Salva regra recorrente no banco
        const sql = `
            INSERT INTO reservas_recorrentes 
            (recurrence_id, usuario_id, carrinho_id, quantidade, dia_semana, hora_inicio, hora_fim, data_final, sala) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await new Promise((resolve, reject) => 
            db.run(sql, [recurrence_id, usuario_id, carrinho_id, quantidadeNum, dia_semana, hora_inicio, hora_fim, dataFinalISO.toISOString(), sala], err => err ? reject(err) : resolve())
        );

        // Recupera informações do carrinho
        const carrinho = await new Promise((resolve, reject) => 
            db.get("SELECT nome, capacidade FROM carrinhos WHERE id = ?", [carrinho_id], (err, row) => err ? reject(err) : resolve(row))
        );
        if (!carrinho) return res.redirect('/?erro=' + encodeURIComponent('Carrinho não encontrado.'));

        // Cria reservas futuras
        let current = new Date();
        current.setHours(0,0,0,0);

        while(current <= dataFinalISO){
            if(current.getDay() === parseInt(dia_semana,10)){
                const inicioReserva = new Date(current);
                const [hInicio, mInicio] = hora_inicio.split(':');
                inicioReserva.setHours(hInicio, mInicio, 0, 0);

                const fimReserva = new Date(current);
                const [hFim, mFim] = hora_fim.split(':');
                fimReserva.setHours(hFim, mFim, 0, 0);

                // Inserir reserva no banco
                const sqlInsert = `
                    INSERT INTO reservas 
                    (carrinho_id, quantidade, usuario_id, data_retirada, data_devolucao, sala, status, recurrence_id) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `;
                const { lastID } = await new Promise((resolve, reject) => 
                    db.run(sqlInsert, [carrinho_id, quantidadeNum, usuario_id, inicioReserva.toISOString(), fimReserva.toISOString(), sala, "Ativa", recurrence_id], function(err){
                        err ? reject(err) : resolve(this);
                    })
                );

                // Preparar dados do evento
                const tituloEvento = `Reserva Recorrente de ${quantidadeNum} Chromebooks (${carrinho.nome})`;
                const descricaoEvento = `Reserva recorrente realizada por ${req.user.nome}. ID da Reserva: ${lastID}`;
                const localEvento = `Sala ${sala}, Colégio La Salle`;

                const linkGoogleCalendar = gerarLinkGoogleCalendar(tituloEvento, descricaoEvento, localEvento, inicioReserva.toISOString(), fimReserva.toISOString());
                const arquivoICS = gerarICS(tituloEvento, descricaoEvento, localEvento, inicioReserva.toISOString(), fimReserva.toISOString());

                // Enviar e-mail
                await sendReservationEmail({
                    to: req.user.email,
                    subject: "Confirmação da sua reserva recorrente",
                    text: `Olá ${req.user.nome}, sua reserva recorrente foi feita com sucesso. Adicione à sua agenda: ${linkGoogleCalendar}`,
                    html: `<p>Olá <b>${req.user.nome}</b>, sua reserva recorrente foi feita com sucesso!</p>
                           <p><b>Detalhes:</b><br>
                           <strong>Carrinho:</strong> ${carrinho.nome}<br>
                           <strong>Quantidade:</strong> ${quantidadeNum}<br>
                           <strong>Data de Retirada:</strong> ${inicioReserva.toISOString()}<br>
                           <strong>Data de Devolução:</strong> ${fimReserva.toISOString()}<br>
                           <strong>Sala:</strong> ${sala}</p>
                           <p>Adicione à sua Agenda Google: <a href="${linkGoogleCalendar}">Google Calendar</a></p>
                           <p>Ou abra o anexo .ics para Outlook/Apple Calendar.</p>
                           <p>Equipe de Tecnologia - Colégio La Salle</p>
                           <p>(11) 2793.1444</p>
                           <p>https://www.lasalle.edu.br/saopaulo</p>`,
                    attachments: [
                        { filename: `reserva_${lastID}.ics`, content: arquivoICS }
                    ]
                });

                // Criar evento Google Calendar
                if(addToCalendar === 'true' && req.user.google_refresh_token){
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
                                start: { dateTime: inicioReserva.toISOString(), timeZone: 'America/Sao_Paulo' },
                                end: { dateTime: fimReserva.toISOString(), timeZone: 'America/Sao_Paulo' },
                                attendees: [{ email: req.user.email }, { email: process.env.MANAGER_EMAIL }],
                                reminders: { useDefault: true }
                            }
                        });
                    } catch(err) {
                        console.error('Erro ao criar evento recorrente no Google Calendar:', err);
                    }
                }
            }
            current.setDate(current.getDate() + 1);
        }

        res.redirect('/?sucesso=' + encodeURIComponent('Reserva recorrente criada com sucesso!'));
    } catch(err) {
        console.error(err);
        res.status(500).send("Erro ao criar reserva recorrente: " + err.message);
    }
});
// --- Concluir reserva ---
app.post('/reservas/concluir/:id', canManageReservations, async (req, res) => {
    const reservaId = req.params.id;
    try {
        // Atualiza status da reserva para Concluída
        await new Promise((resolve, reject) => {
            db.run("UPDATE reservas SET status = 'Concluída' WHERE id = ?", [reservaId], function(err) {
                if (err) return reject(err);
                resolve();
            });
        });
        res.redirect('/admin'); // volta para a página de admin
    } catch (err) {
        console.error("Erro ao concluir reserva:", err);
        res.status(500).send("Erro ao concluir reserva: " + err.message);
    }
});

// --- Histórico de reservas (todas concluídas) ---
app.get('/admin/history', canManageReservations, async (req, res) => {
    try {
        const sql = `
            SELECT r.*, c.nome as nome_carrinho, u.nome as nome_professor 
            FROM reservas r
            JOIN carrinhos c ON r.carrinho_id = c.id
            JOIN usuarios u ON r.usuario_id = u.id
            WHERE r.status = 'Concluída'
            ORDER BY r.data_devolucao DESC
        `;
        const reservas = await new Promise((resolve, reject) => {
            db.all(sql, [], (err, rows) => err ? reject(err) : resolve(rows));
        });
        res.render('admin-history', { reservas, user: req.user });
    } catch (err) {
        console.error("Erro ao carregar histórico:", err);
        res.status(500).send("Erro ao carregar histórico: " + err.message);
    }
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
        const carrinho = await new Promise((resolve, reject) => {
            db.get("SELECT capacidade FROM carrinhos WHERE id = ?", [carrinho_id], (err, row) => {
                if (err) reject(err); else resolve(row);
            });
        });

        if (!carrinho) return res.status(404).json({ error: 'Carrinho não encontrado.' });
        
        const capacidadeTotal = carrinho.capacidade;

        // Combina reservas pontuais e recorrentes para a verificação
        const reservasAtivas = await new Promise((resolve, reject) => {
            db.all("SELECT * FROM reservas WHERE carrinho_id = ? AND status = 'Ativa'", [carrinho_id], (err, rows) => {
                if (err) reject(err); else resolve(rows);
            });
        });

        const regrasRecorrentes = await new Promise((resolve, reject) => {
            db.all("SELECT * FROM reservas_recorrentes WHERE carrinho_id = ?", [carrinho_id], (err, rows) => {
                if (err) reject(err); else resolve(rows);
            });
        });

        let picoDeUso = 0;
        for (let t = inicioNovaReserva.getTime(); t < fimNovaReserva.getTime(); t += 60000) {
            let emUsoNesteMinuto = 0;
            const tempoAtual = new Date(t);

            // Verifica conflito com reservas pontuais
            for (const r of reservasAtivas) {
                if (t >= new Date(r.data_retirada).getTime() && t < new Date(r.data_devolucao).getTime()) {
                    emUsoNesteMinuto += r.quantidade;
                }
            }

            // Verifica conflito com reservas recorrentes
            for (const regra of regrasRecorrentes) {
                const diaDaSemanaAtual = tempoAtual.getDay();
                if (diaDaSemanaAtual === parseInt(regra.dia_semana, 10)) {
                    const dataFinalRegra = new Date(regra.data_final);
                    if (tempoAtual <= dataFinalRegra) {
                        const [hInicio, mInicio] = regra.hora_inicio.split(':');
                        const [hFim, mFim] = regra.hora_fim.split(':');
                        
                        const inicioRegraNoDia = new Date(tempoAtual);
                        inicioRegraNoDia.setHours(hInicio, mInicio, 0, 0);

                        const fimRegraNoDia = new Date(tempoAtual);
                        fimRegraNoDia.setHours(hFim, mFim, 0, 0);

                        if (t >= inicioRegraNoDia.getTime() && t < fimRegraNoDia.getTime()) {
                            emUsoNesteMinuto += regra.quantidade;
                        }
                    }
                }
            }
            if (emUsoNesteMinuto > picoDeUso) picoDeUso = emUsoNesteMinuto;
        }

        const disponiveisNoHorario = capacidadeTotal - picoDeUso;
        res.json({ disponiveis: disponiveisNoHorario < 0 ? 0 : disponiveisNoHorario });

    } catch (err) {
        console.error("Erro na API /api/availability:", err);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});


// --- Inicia servidor ---
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
