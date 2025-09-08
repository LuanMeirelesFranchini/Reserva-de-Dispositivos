require('dotenv').config();

const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const db = new sqlite3.Database('./reservas.db', (err) => {
    if (err) return console.error("ERRO FATAL: Não foi possível conectar ao banco.", err.message);
    console.log('Conectado ao banco de dados SQLite.');
});

const saltRounds = 10;

const closeDb = () => {
    db.close((err) => {
        if (err) return console.error("Erro ao fechar o banco:", err.message);
        console.log('Conexão com o banco de dados fechada com sucesso.');
    });
};

db.serialize(() => {
    // Criação de tabelas (usuários, carrinhos, reservas)
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE, senha_hash TEXT, role TEXT NOT NULL DEFAULT 'professor')`);
    db.run(`CREATE TABLE IF NOT EXISTS carrinhos (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, localizacao TEXT NOT NULL, capacidade INTEGER NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS reservas (id INTEGER PRIMARY KEY, quantidade INTEGER NOT NULL, data_retirada TEXT NOT NULL, data_devolucao TEXT NOT NULL, sala TEXT NOT NULL, status TEXT NOT NULL, carrinho_id INTEGER NOT NULL, usuario_id INTEGER NOT NULL, FOREIGN KEY (carrinho_id) REFERENCES carrinhos(id), FOREIGN KEY (usuario_id) REFERENCES usuarios(id))`);

    // --- NOVA TABELA PARA AS REGRAS DE RESERVAS RECORRENTES ---
    db.run(`
        CREATE TABLE IF NOT EXISTS reservas_recorrentes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            carrinho_id INTEGER NOT NULL,
            quantidade INTEGER NOT NULL,
            sala TEXT NOT NULL,
            dia_semana INTEGER NOT NULL, -- 0: Domingo, 1: Segunda, ..., 6: Sábado
            hora_inicio TEXT NOT NULL,   -- Formato "HH:MM"
            hora_fim TEXT NOT NULL,      -- Formato "HH:MM"
            data_inicio_recorrencia TEXT NOT NULL, -- Formato "YYYY-MM-DD"
            data_fim_recorrencia TEXT NOT NULL,   -- Formato "YYYY-MM-DD"
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
            FOREIGN KEY (carrinho_id) REFERENCES carrinhos(id)
        )
    `);

    // Inserir dados dos carrinhos
    const carrinhos = [
        { nome: 'Carrinho 1', localizacao: 'Bloco A - 1º Andar', capacidade: 35 },
        { nome: 'Carrinho 2', localizacao: 'Bloco A - 2º Andar', capacidade: 35 },
        { nome: 'Carrinho 3', localizacao: 'Bloco A - 3º Andar', capacidade: 34 },
        { nome: 'Carrinho 4', localizacao: 'Corredor Bloco C', capacidade: 35 },
        { nome: 'Carrinho 5', localizacao: 'Sala Maker Bloco E', capacidade: 35 }
    ];
    const stmt = db.prepare("INSERT OR IGNORE INTO carrinhos (nome, localizacao, capacidade) VALUES (?, ?, ?)");
    carrinhos.forEach(c => stmt.run(c.nome, c.localizacao, c.capacidade));
    stmt.finalize();
    console.log("Tabelas e carrinhos criados/verificados.");

    // Garantir que o utilizador admin exista e tenha o papel correto
    const adminEmail = process.env.INITIAL_ADMIN_EMAIL;
    if (!adminEmail) {
        console.error("ERRO: A variável INITIAL_ADMIN_EMAIL não foi definida no ficheiro .env!");
        return closeDb();
    }

    db.get("SELECT * FROM usuarios WHERE email = ?", [adminEmail], (err, user) => {
        if (err) {
            console.error("Erro ao procurar utilizador admin:", err.message);
            return closeDb();
        }
        if (user) {
            db.run("UPDATE usuarios SET role = 'admin' WHERE email = ?", [adminEmail], (err) => {
                if (err) console.error("Erro ao ATUALIZAR utilizador para admin:", err.message);
                else console.log(`Utilizador ${adminEmail} verificado e definido como admin.`);
                closeDb();
            });
        } else {
            const adminSenha = "admin123";
            bcrypt.hash(adminSenha, saltRounds, (err, hash) => {
                if (err) {
                    console.error("Erro ao gerar hash:", err.message);
                    return closeDb();
                }
                db.run(`INSERT INTO usuarios (nome, email, senha_hash, role) VALUES (?, ?, ?, ?)`, 
                    ['Administrador Padrão', adminEmail, hash, 'admin'], (err) => {
                    if (err) console.error("Erro ao INSERIR utilizador admin:", err.message);
                    else console.log(`Utilizador admin padrão (${adminEmail}) criado com sucesso.`);
                    closeDb();
                });
            });
        }
    });
});
