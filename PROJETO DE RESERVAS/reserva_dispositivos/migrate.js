const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'reservas.db');
const db = new sqlite3.Database(dbPath);

console.log("🛠️  Iniciando atualização da estrutura do banco de dados...");

db.serialize(() => {
    db.run(`ALTER TABLE reservas ADD COLUMN concluido_por TEXT`, (err) => {
        if (err) {
            if (err.message.includes("duplicate column name")) {
                console.log("ℹ️  A coluna 'concluido_por' já existe. Nenhuma alteração necessária.");
            } else {
                console.error("❌ Erro ao adicionar coluna:", err.message);
            }
        } else {
            console.log("✅ Coluna 'concluido_por' adicionada com sucesso!");
        }
    });

    db.run(`ALTER TABLE carrinhos ADD COLUMN indisponiveis INTEGER NOT NULL DEFAULT 0`, (err) => {
        if (err) {
            if (err.message.includes("duplicate column name")) {
                console.log("ℹ️  A coluna 'indisponiveis' já existe. Nenhuma alteração necessária.");
            } else {
                console.error("❌ Erro ao adicionar coluna em carrinhos:", err.message);
            }
        } else {
            console.log("✅ Coluna 'indisponiveis' adicionada com sucesso!");
        }
    });
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
            console.error("Erro ao criar tabela audit_logs:", err.message);
        } else {
            console.log("Tabela 'audit_logs' pronta para uso!");
        }
    });
});

db.close();
