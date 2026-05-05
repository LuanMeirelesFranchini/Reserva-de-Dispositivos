require('dotenv').config();

const { MySQLDatabase } = require('./database');
const { initializeSalasTable } = require('./salas-data');

const db = new MySQLDatabase((err) => {
    if (err) {
        console.error("ERRO FATAL: Nao foi possivel conectar ao banco MySQL.", err.message);
        process.exit(1);
    }
});

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

async function runIgnoringDuplicateColumn(sql, label) {
    try {
        await run(sql);
        console.log(`Coluna '${label}' adicionada com sucesso.`);
    } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('duplicate column name')) {
            console.log(`A coluna '${label}' ja existe. Nenhuma alteracao necessaria.`);
            return;
        }

        if (err.code === 'ER_NO_SUCH_TABLE' || err.message.includes('no such table')) {
            console.warn(`Tabela ainda nao existe para adicionar '${label}'. Rode node setup.js primeiro.`);
            return;
        }

        throw err;
    }
}

async function main() {
    console.log("Iniciando atualizacao da estrutura do banco MySQL...");

    await runIgnoringDuplicateColumn(
        `ALTER TABLE reservas ADD COLUMN concluido_por VARCHAR(255)`,
        'concluido_por'
    );

    await runIgnoringDuplicateColumn(
        `ALTER TABLE carrinhos ADD COLUMN indisponiveis INT NOT NULL DEFAULT 0`,
        'indisponiveis'
    );

    await runIgnoringDuplicateColumn(
        `ALTER TABLE usuarios ADD COLUMN ativo TINYINT(1) NOT NULL DEFAULT 1`,
        'ativo'
    );

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
    console.log("Tabela 'audit_logs' pronta para uso.");

    await initializeSalasTable(db);
    console.log("Tabela 'salas' pronta para uso.");
}

main()
    .then(() => {
        console.log("Migracao concluida com sucesso.");
        db.close();
    })
    .catch((err) => {
        console.error("Erro na migracao:", err.message);
        db.close(() => process.exit(1));
    });
