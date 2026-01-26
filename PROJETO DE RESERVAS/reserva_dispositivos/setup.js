const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
require('dotenv').config(); // Carrega variáveis do .env

const db = new sqlite3.Database('./data/reservas.db', (err) => {
    if (err) return console.error("ERRO FATAL: Não foi possível conectar ao banco.", err.message);
    console.log('Conectado ao banco de dados SQLite.');
});

const saltRounds = 10;

db.serialize(() => {
    // --- 1. Usuários ---
    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            senha_hash TEXT,
            role TEXT NOT NULL DEFAULT 'professor',
            google_access_token TEXT,
            google_refresh_token TEXT
        )
    `, (err) => {
        if (err) return console.error("Erro ao criar tabela usuarios:", err.message);
        console.log("Tabela 'usuarios' atualizada.");

        // --- 2. Carrinhos ---
        db.run(`
            CREATE TABLE IF NOT EXISTS carrinhos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL,
                localizacao TEXT NOT NULL,
                capacidade INTEGER NOT NULL
            )
        `, (err) => {
            if (err) return console.error("Erro ao criar tabela carrinhos:", err.message);
            console.log("Tabela 'carrinhos' criada.");

            // --- 3. Inserir carrinhos ---
            const carrinhos = [
                { nome: 'Carrinho 1', localizacao: 'Bloco A - 1º Andar', capacidade: 28 },
                { nome: 'Carrinho 2', localizacao: 'Bloco A - 2º Andar', capacidade: 31 },
                { nome: 'Carrinho 3', localizacao: 'Bloco A - 3º Andar', capacidade: 27 },
                { nome: 'Carrinho 4', localizacao: 'Sala Maker Bloco A', capacidade: 17 },
                { nome: 'Carrinho 5', localizacao: 'Corredor Bloco C', capacidade: 22 },
                { nome: 'Carrinho 6', localizacao: 'Sala Maker Bloco E', capacidade: 11 }
            ];
            const stmt = db.prepare("INSERT OR IGNORE INTO carrinhos (nome, localizacao, capacidade) VALUES (?, ?, ?)");
            carrinhos.forEach(c => stmt.run(c.nome, c.localizacao, c.capacidade));
            stmt.finalize((err) => {
                if (err) return console.error("Erro ao inserir carrinhos:", err.message);
                console.log("Carrinhos inseridos.");

                // --- 4. Tabela de reservas ---
                db.run(`
                    CREATE TABLE IF NOT EXISTS reservas (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        quantidade INTEGER NOT NULL,
                        data_retirada TEXT NOT NULL,
                        data_devolucao TEXT NOT NULL,
                        data_reserva TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                        sala TEXT NOT NULL,
                        status TEXT NOT NULL,
                        carrinho_id INTEGER NOT NULL,
                        usuario_id INTEGER NOT NULL,
                        recurrence_id TEXT,
                        FOREIGN KEY (carrinho_id) REFERENCES carrinhos(id),
                        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
                    )
                `, (err) => {
                    if (err) return console.error("Erro ao criar tabela reservas:", err.message);
                    console.log("Tabela 'reservas' criada.");

                    // --- 5. Tabela de reservas recorrentes ---
                    db.run(`
                        CREATE TABLE IF NOT EXISTS reservas_recorrentes (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            recurrence_id TEXT NOT NULL,
                            usuario_id INTEGER NOT NULL,
                            carrinho_id INTEGER NOT NULL,
                            quantidade INTEGER NOT NULL,
                            dia_semana INTEGER NOT NULL,
                            hora_inicio TEXT NOT NULL,
                            hora_fim TEXT NOT NULL,
                            data_final TEXT NOT NULL,
                            sala TEXT NOT NULL,
                            FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
                            FOREIGN KEY (carrinho_id) REFERENCES carrinhos(id)
                        )
                    `, (err) => {
                        if (err) return console.error("Erro ao criar tabela reservas_recorrentes:", err.message);
                        console.log("Tabela 'reservas_recorrentes' criada.");

                        // --- 6. Admin padrão ---
                        const adminEmail = process.env.INITIAL_ADMIN_EMAIL;
                        const adminSenha = "admin123";
                        if (!adminEmail) {
                            console.error("ERRO: INITIAL_ADMIN_EMAIL não definido no .env");
                            return db.close();
                        }

                        db.get("SELECT * FROM usuarios WHERE email = ?", [adminEmail], (err, row) => {
                            if (err) return console.error(err.message);
                            bcrypt.hash(adminSenha, saltRounds, (err, hash) => {
                                if (err) return console.error("Erro ao gerar hash:", err);
                                if (row) {
                                    db.run("UPDATE usuarios SET role = 'admin' WHERE email = ?", [adminEmail], (err) => {
                                        if (err) return console.error(err.message);
                                        console.log(`Usuário ${adminEmail} atualizado para admin.`);
                                        db.close();
                                    });
                                } else {
                                    db.run("INSERT INTO usuarios (nome, email, senha_hash, role) VALUES (?, ?, ?, ?)", ['Administrador', adminEmail, hash, 'admin'], (err) => {
                                        if (err) return console.error(err.message);
                                        console.log(`Usuário admin ${adminEmail} criado.`);
                                        db.close();
                                    });
                                }
                            });
                        });
                    });
                });
            });
        });
    });
});
