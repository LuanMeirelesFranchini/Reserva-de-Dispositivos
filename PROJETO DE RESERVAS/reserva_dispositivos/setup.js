const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
require('dotenv').config(); // Carrega as variáveis do .env

const db = new sqlite3.Database('./reservas.db', (err) => {
    if (err) return console.error("ERRO FATAL: Não foi possível conectar ao banco.", err.message);
    console.log('Conectado ao banco de dados SQLite.');
});

const saltRounds = 10;

db.serialize(() => {
    // Passo 1: Criar tabela de usuários com os novos campos para o Google Calendar
    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            senha_hash TEXT,
            role TEXT NOT NULL DEFAULT 'professor',
            google_access_token TEXT, -- NOVO CAMPO
            google_refresh_token TEXT  -- NOVO CAMPO
        )
    `, (err) => {
        if (err) return console.error("Erro ao criar tabela usuarios:", err.message);
        console.log("Tabela 'usuarios' atualizada com campos para o Calendário.");

        // Passo 2: Criar tabela de carrinhos
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

            // Passo 3: Inserir dados dos carrinhos
            const carrinhos = [
                { nome: 'Carrinho 1', localizacao: 'Bloco A - 1º Andar', capacidade: 35 },
                { nome: 'Carrinho 2', localizacao: 'Bloco A - 2º Andar', capacidade: 35 },
                { nome: 'Carrinho 3', localizacao: 'Bloco A - 3º Andar', capacidade: 34 },
                { nome: 'Carrinho 4', localizacao: 'Corredor Bloco C', capacidade: 35 },
                { nome: 'Carrinho 5', localizacao: 'Sala Maker Bloco E', capacidade: 35 }
            ];
            const stmt = db.prepare("INSERT INTO carrinhos (nome, localizacao, capacidade) VALUES (?, ?, ?)");
            carrinhos.forEach(c => stmt.run(c.nome, c.localizacao, c.capacidade));
            stmt.finalize((err) => {
                if (err) return console.error("Erro ao inserir carrinhos:", err.message);
                console.log("Carrinhos inseridos com sucesso.");

                // Passo 4: Criar a tabela de reservas
                db.run(`
                    CREATE TABLE IF NOT EXISTS reservas (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        quantidade INTEGER NOT NULL,
                        data_retirada TEXT NOT NULL,
                        data_devolucao TEXT NOT NULL,
                        sala TEXT NOT NULL,
                        status TEXT NOT NULL,
                        carrinho_id INTEGER NOT NULL,
                        usuario_id INTEGER NOT NULL,
                        FOREIGN KEY (carrinho_id) REFERENCES carrinhos (id),
                        FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
                    )
                `, (err) => {
                    if (err) return console.error("Erro ao criar tabela reservas:", err.message);
                    console.log("Tabela 'reservas' criada com sucesso.");
                    
                    // Passo 5: Criar/Atualizar o usuário admin padrão
                    const adminEmail = process.env.INITIAL_ADMIN_EMAIL;
                    const adminSenha = "admin123"; // Senha temporária, não será usada para login
                    if (!adminEmail) {
                        console.error("ERRO: A variável INITIAL_ADMIN_EMAIL não está definida no ficheiro .env");
                        return db.close();
                    }

                    db.get("SELECT * FROM usuarios WHERE email = ?", [adminEmail], (err, row) => {
                        if (err) return console.error(err.message);
                        bcrypt.hash(adminSenha, saltRounds, (err, hash) => {
                            if (err) return console.error("Erro ao gerar hash:", err);
                            if (row) {
                                db.run("UPDATE usuarios SET role = 'admin' WHERE email = ?", [adminEmail], (err) => {
                                    if (err) return console.error(err.message);
                                    console.log(`Utilizador ${adminEmail} atualizado para admin.`);
                                    db.close();
                                });
                            } else {
                                db.run("INSERT INTO usuarios (nome, email, senha_hash, role) VALUES (?, ?, ?, ?)", ['Administrador', adminEmail, hash, 'admin'], (err) => {
                                    if (err) return console.error(err.message);
                                    console.log(`Utilizador admin ${adminEmail} criado.`);
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
