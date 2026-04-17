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
});

db.close();
