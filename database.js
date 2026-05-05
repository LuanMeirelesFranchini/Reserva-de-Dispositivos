const mysql = require('mysql2/promise');

function buildConfig() {
    return {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306', 10),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
        queueLimit: 0,
        dateStrings: true,
        charset: 'utf8mb4'
    };
}

function validateConfig(config) {
    const missing = [];
    if (!config.user) missing.push('DB_USER');
    if (!config.database) missing.push('DB_NAME');

    if (missing.length > 0) {
        throw new Error(`Variaveis de ambiente do MySQL ausentes: ${missing.join(', ')}`);
    }
}

function normalizeError(err) {
    if (!err) return err;

    if (err.code === 'ER_DUP_FIELDNAME') {
        err.message = `duplicate column name: ${err.message}`;
    }

    if (err.code === 'ER_NO_SUCH_TABLE') {
        err.message = `no such table: ${err.message}`;
    }

    return err;
}

class MySQLStatement {
    constructor(database, sql) {
        this.database = database;
        this.sql = sql;
        this.pending = [];
    }

    run(...args) {
        const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const promise = this.database.run(this.sql, params, callback);
        this.pending.push(promise);
        return this;
    }

    finalize(callback) {
        Promise.allSettled(this.pending)
            .then((results) => {
                const rejected = results.find((result) => result.status === 'rejected');
                if (callback) callback(rejected ? rejected.reason : null);
            });
    }
}

class MySQLDatabase {
    constructor(callback) {
        const config = buildConfig();
        validateConfig(config);

        this.pool = mysql.createPool(config);
        this.ready = this.pool.query('SELECT 1')
            .then(() => {
                if (callback) callback(null);
            })
            .catch((err) => {
                if (callback) callback(err);
                if (callback) return;
                throw err;
            });
    }

    serialize(callback) {
        callback();
    }

    async execute(sql, params = []) {
        await this.ready;
        try {
            return await this.pool.execute(sql, params);
        } catch (err) {
            if (err.code === 'ER_DUP_KEYNAME' && /^\s*CREATE\s+(UNIQUE\s+)?INDEX/i.test(sql)) {
                return [{ affectedRows: 0, insertId: 0 }, undefined];
            }

            throw err;
        }
    }

    run(sql, params = [], callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }

        const promise = this.execute(sql, params)
            .then(([result]) => {
                const context = {
                    lastID: result.insertId,
                    changes: result.affectedRows
                };
                if (callback) callback.call(context, null);
                return context;
            })
            .catch((err) => {
                const normalized = normalizeError(err);
                if (callback) {
                    callback.call({}, normalized);
                    return {};
                }
                throw normalized;
            });

        return promise;
    }

    get(sql, params = [], callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }

        const promise = this.execute(sql, params)
            .then(([rows]) => {
                const row = rows[0] || null;
                if (callback) callback(null, row);
                return row;
            })
            .catch((err) => {
                const normalized = normalizeError(err);
                if (callback) {
                    callback(normalized);
                    return null;
                }
                throw normalized;
            });

        return promise;
    }

    all(sql, params = [], callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }

        const promise = this.execute(sql, params)
            .then(([rows]) => {
                if (callback) callback(null, rows);
                return rows;
            })
            .catch((err) => {
                const normalized = normalizeError(err);
                if (callback) {
                    callback(normalized);
                    return [];
                }
                throw normalized;
            });

        return promise;
    }

    prepare(sql, callback) {
        const statement = new MySQLStatement(this, sql);
        if (callback) process.nextTick(() => callback(null));
        return statement;
    }

    close(callback) {
        this.pool.end()
            .then(() => callback && callback(null))
            .catch((err) => callback && callback(err));
    }
}

module.exports = {
    MySQLDatabase
};
