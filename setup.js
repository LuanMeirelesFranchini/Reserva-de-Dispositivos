require('dotenv').config();

const bcrypt = require('bcrypt');
const { MySQLDatabase } = require('./database');
const { initializeSalasTable } = require('./salas-data');

const db = new MySQLDatabase((err) => {
    if (err) {
        console.error("ERRO FATAL: Nao foi possivel conectar ao banco MySQL.", err.message);
        process.exit(1);
    }
    console.log('Conectado ao banco de dados MySQL.');
});

const saltRounds = 10;

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });
}

async function main() {
    await run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            senha_hash VARCHAR(255),
            role VARCHAR(50) NOT NULL DEFAULT 'professor',
            ativo TINYINT(1) NOT NULL DEFAULT 1,
            google_access_token TEXT,
            google_refresh_token TEXT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Tabela 'usuarios' pronta.");

    await run(`
        CREATE TABLE IF NOT EXISTS carrinhos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(100) NOT NULL UNIQUE,
            localizacao VARCHAR(255) NOT NULL,
            capacidade INT NOT NULL,
            indisponiveis INT NOT NULL DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Tabela 'carrinhos' pronta.");

    const carrinhos = [
        { nome: 'Carrinho 1', localizacao: 'Bloco A - 1° Andar', capacidade: 29 },
        { nome: 'Carrinho 2', localizacao: 'Bloco A - 2° Andar (Touch)', capacidade: 38 },
        { nome: 'Carrinho 3', localizacao: 'Bloco A - 3° Andar', capacidade: 32 },
        { nome: 'Carrinho 4', localizacao: 'Bloco A - Terreo', capacidade: 15 },
        { nome: 'Carrinho 5', localizacao: 'Corredor Bloco C', capacidade: 35 },
        { nome: 'Carrinho 6', localizacao: 'Corredor Bloco C (Touch)', capacidade: 15 }
    ];

    for (const carrinho of carrinhos) {
        await run(
            `INSERT IGNORE INTO carrinhos (nome, localizacao, capacidade) VALUES (?, ?, ?)`,
            [carrinho.nome, carrinho.localizacao, carrinho.capacidade]
        );
    }
    console.log("Carrinhos iniciais prontos.");

    await run(`
        CREATE TABLE IF NOT EXISTS reservas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            quantidade INT NOT NULL,
            data_retirada DATETIME NOT NULL,
            data_devolucao DATETIME NOT NULL,
            data_reserva DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            sala VARCHAR(255) NOT NULL,
            concluido_por VARCHAR(255),
            status VARCHAR(50) NOT NULL,
            carrinho_id INT NOT NULL,
            usuario_id INT NOT NULL,
            recurrence_id VARCHAR(100),
            FOREIGN KEY (carrinho_id) REFERENCES carrinhos(id),
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Tabela 'reservas' pronta.");

    await run(`
        CREATE TABLE IF NOT EXISTS reservas_recorrentes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            recurrence_id VARCHAR(100) NOT NULL,
            usuario_id INT NOT NULL,
            carrinho_id INT NOT NULL,
            quantidade INT NOT NULL,
            dia_semana INT NOT NULL,
            hora_inicio TIME NOT NULL,
            hora_fim TIME NOT NULL,
            data_final DATE NOT NULL,
            sala VARCHAR(255) NOT NULL,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
            FOREIGN KEY (carrinho_id) REFERENCES carrinhos(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Tabela 'reservas_recorrentes' pronta.");

    await run(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            usuario_id INT,
            usuario_nome VARCHAR(255),
            usuario_role VARCHAR(50),
            acao VARCHAR(100) NOT NULL,
            entidade VARCHAR(100),
            entidade_id INT,
            detalhes_json TEXT,
            ip VARCHAR(100),
            user_agent TEXT,
            criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Tabela 'audit_logs' pronta.");

    await initializeSalasTable(db);
    console.log("Tabela 'salas' pronta.");

    const adminEmail = process.env.INITIAL_ADMIN_EMAIL;
    const adminSenha = process.env.INITIAL_ADMIN_PASSWORD;
    if (!adminEmail) {
        throw new Error("INITIAL_ADMIN_EMAIL nao definido no .env");
    }
    if (!adminSenha || adminSenha.length < 12) {
        throw new Error("INITIAL_ADMIN_PASSWORD precisa ter pelo menos 12 caracteres.");
    }

    const admin = await get("SELECT * FROM usuarios WHERE email = ?", [adminEmail]);
    const hash = await bcrypt.hash(adminSenha, saltRounds);

    if (admin) {
        await run("UPDATE usuarios SET role = 'admin' WHERE email = ?", [adminEmail]);
        console.log(`Usuario ${adminEmail} atualizado para admin.`);
    } else {
        await run(
            "INSERT INTO usuarios (nome, email, senha_hash, role) VALUES (?, ?, ?, ?)",
            ['Administrador', adminEmail, hash, 'admin']
        );
        console.log(`Usuario admin ${adminEmail} criado.`);
    }
}

main()
    .then(() => {
        console.log("Setup concluido com sucesso.");
        db.close();
    })
    .catch((err) => {
        console.error("Erro no setup:", err.message);
        db.close(() => process.exit(1));
    });
