require('dotenv').config();

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { MySQLDatabase } = require('../database');

const sqlitePath = process.env.SQLITE_DB_PATH
    ? path.resolve(process.env.SQLITE_DB_PATH)
    : path.join(__dirname, '..', 'data', 'reservas.db');

const tables = [
    'usuarios',
    'carrinhos',
    'salas',
    'reservas',
    'reservas_recorrentes',
    'audit_logs'
];

const truncateBeforeImport = process.env.MIGRATION_TRUNCATE === 'true';

const tableOptions = {
    salas: {
        ignoreDuplicates: true,
        skipColumns: ['id']
    }
};

const sqliteDb = new sqlite3.Database(sqlitePath);
const mysqlDb = new MySQLDatabase();

function sqliteAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        sqliteDb.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });
}

function sqliteClose() {
    return new Promise((resolve, reject) => {
        sqliteDb.close((err) => err ? reject(err) : resolve());
    });
}

function mysqlRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        mysqlDb.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function mysqlAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        mysqlDb.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });
}

function quoteIdentifier(identifier) {
    return `\`${identifier.replace(/`/g, '``')}\``;
}

async function tableExistsInSQLite(table) {
    const rows = await sqliteAll(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table]
    );
    return rows.length > 0;
}

async function getSQLiteColumns(table) {
    const rows = await sqliteAll(`PRAGMA table_info(${quoteIdentifier(table)})`);
    return rows.map((row) => row.name);
}

async function getMySQLColumns(table) {
    const rows = await mysqlAll(`SHOW COLUMNS FROM ${quoteIdentifier(table)}`);
    return rows.map((row) => row.Field);
}

async function clearMySQLTables() {
    console.log('Limpando tabelas MySQL antes da importacao...');
    const connection = await mysqlDb.pool.getConnection();

    try {
        await connection.execute('SET FOREIGN_KEY_CHECKS = 0');

        for (const table of [...tables].reverse()) {
            await connection.execute(`DELETE FROM ${quoteIdentifier(table)}`);
            await connection.execute(`ALTER TABLE ${quoteIdentifier(table)} AUTO_INCREMENT = 1`);
        }

        await connection.execute('SET FOREIGN_KEY_CHECKS = 1');
    } finally {
        connection.release();
    }
}

async function getMissingReservationReferences() {
    const sqliteUserIds = new Set((await sqliteAll('SELECT id FROM usuarios')).map((row) => Number(row.id)));
    const sqliteCartIds = new Set((await sqliteAll('SELECT id FROM carrinhos')).map((row) => Number(row.id)));
    const reservationRefs = await sqliteAll(`
        SELECT DISTINCT usuario_id, carrinho_id
        FROM reservas
    `);

    const missingUserIds = [...new Set(
        reservationRefs
            .map((row) => Number(row.usuario_id))
            .filter((id) => !sqliteUserIds.has(id))
    )];

    const missingCartIds = [...new Set(
        reservationRefs
            .map((row) => Number(row.carrinho_id))
            .filter((id) => !sqliteCartIds.has(id))
    )];

    return { missingUserIds, missingCartIds };
}

async function createPlaceholderUsers(userIds) {
    for (const userId of userIds) {
        await mysqlRun(
            `INSERT INTO usuarios (id, nome, email, role)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                nome = VALUES(nome),
                email = VALUES(email),
                role = VALUES(role)`,
            [
                userId,
                `Usuario antigo removido #${userId}`,
                `usuario-removido-${userId}@migracao.local`,
                'professor'
            ]
        );
    }
}

async function validateAndRepairReservationsReferences() {
    const { missingUserIds, missingCartIds } = await getMissingReservationReferences();

    if (missingCartIds.length > 0) {
        throw new Error(
            `SQLite possui reservas com referencias ausentes. ` +
            `carrinho_id faltando: ${missingCartIds.join(', ') || 'nenhum'}.`
        );
    }

    if (missingUserIds.length > 0) {
        console.warn(
            `SQLite possui reservas de usuario(s) removido(s): ${missingUserIds.join(', ')}. ` +
            `Criando usuario(s) placeholder para preservar o historico.`
        );
        await createPlaceholderUsers(missingUserIds);
    }
}

async function migrateTable(table) {
    if (!(await tableExistsInSQLite(table))) {
        console.log(`Tabela '${table}' nao existe no SQLite. Pulando.`);
        return;
    }

    const sqliteColumns = await getSQLiteColumns(table);
    const mysqlColumns = await getMySQLColumns(table);
    const mysqlColumnSet = new Set(mysqlColumns);
    const options = tableOptions[table] || {};
    const skipColumns = new Set(options.skipColumns || []);
    const columns = sqliteColumns.filter((column) => mysqlColumnSet.has(column) && !skipColumns.has(column));

    if (columns.length === 0) {
        console.log(`Tabela '${table}' nao possui colunas compativeis. Pulando.`);
        return;
    }

    const rows = await sqliteAll(`SELECT ${columns.map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(table)}`);
    if (rows.length === 0) {
        console.log(`Tabela '${table}' sem registros. Pulando.`);
        return;
    }

    const placeholders = columns.map(() => '?').join(', ');
    const updates = columns
        .filter((column) => column !== 'id')
        .map((column) => `${quoteIdentifier(column)} = VALUES(${quoteIdentifier(column)})`);

    const updateSql = updates.length > 0
        ? updates.join(', ')
        : `${quoteIdentifier(columns[0])} = ${quoteIdentifier(columns[0])}`;

    const sql = options.ignoreDuplicates
        ? `
            INSERT IGNORE INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')})
            VALUES (${placeholders})
        `
        : `
            INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')})
            VALUES (${placeholders})
            ON DUPLICATE KEY UPDATE ${updateSql}
        `;

    for (const row of rows) {
        const params = columns.map((column) => row[column]);
        await mysqlRun(sql, params);
    }

    console.log(`Tabela '${table}': ${rows.length} registro(s) importado(s).`);
}

async function main() {
    console.log(`Migrando dados de SQLite para MySQL: ${sqlitePath}`);

    if (truncateBeforeImport) {
        await clearMySQLTables();
    } else {
        console.warn(
            "Aviso: importando sem limpar o MySQL antes. " +
            "Se ja existirem usuarios/carrinhos/salas, os IDs antigos podem nao ser preservados. " +
            "Para uma migracao completa, rode com MIGRATION_TRUNCATE=true."
        );
    }

    for (const table of tables) {
        await migrateTable(table);

        if (table === 'usuarios') {
            await validateAndRepairReservationsReferences();
        }
    }

    console.log('Migracao concluida.');
}

main()
    .catch((err) => {
        console.error('Erro na migracao SQLite -> MySQL:', err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await sqliteClose().catch(() => {});
        mysqlDb.close();
    });
