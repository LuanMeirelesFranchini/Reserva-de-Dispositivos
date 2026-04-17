/**
 * BOT DE GERAÇÃO DE DADOS (SEEDER)
 * Este script popula o seu banco de dados com dados fictícios para testar o Dashboard.
 * Uso: node scripts/test-seeder.js
 */

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/reservas.db');

// Dados para sorteio
const usuarios = [1, 2]; // IDs de usuários existentes
const carrinhos = [1, 2, 3, 4]; // IDs de carrinhos existentes
const salas = ['BLOCO A - Sala 1', 'BLOCO C - Tecnologia', 'BLOCO E - Sala 10', 'ESPAÇOS - Pátio'];
const status = ['Ativa', 'Concluída', 'Cancelada'];

function getRandomDate(daysAgo) {
    const date = new Date();
    date.setDate(date.getDate() - Math.floor(Math.random() * daysAgo));
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

db.serialize(() => {
    console.log("🤖 Bot: Iniciando geração de dados de teste...");

    const stmt = db.prepare(`
        INSERT INTO reservas (carrinho_id, quantidade, usuario_id, data_retirada, data_devolucao, sala, status) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // Criar 50 reservas aleatórias
    for (let i = 0; i < 50; i++) {
        const dataRetirada = getRandomDate(10); // Reservas dos últimos 10 dias
        const dataDevolucao = new Date(new Date(dataRetirada).getTime() + 3600000).toISOString(); // 1 hora depois
        
        stmt.run(
            carrinhos[Math.floor(Math.random() * carrinhos.length)],
            Math.floor(Math.random() * 10) + 1,
            usuarios[Math.floor(Math.random() * usuarios.length)],
            dataRetirada,
            dataDevolucao,
            salas[Math.floor(Math.random() * salas.length)],
            status[Math.floor(Math.random() * status.length)]
        );
    }

    stmt.finalize();
    console.log("✅ Bot: 50 reservas de teste criadas com sucesso!");
});

db.close();