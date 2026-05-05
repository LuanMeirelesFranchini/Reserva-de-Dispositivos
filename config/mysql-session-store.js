const session = require("express-session");

class MySQLSessionStore extends session.Store {
  constructor(database) {
    super();
    this.db = database;
    this.ready = this.initialize();
  }

  initialize() {
    return new Promise((resolve, reject) => {
      this.db.run(
        `
          CREATE TABLE IF NOT EXISTS sessions (
            sid VARCHAR(128) PRIMARY KEY,
            sess TEXT NOT NULL,
            expires_at BIGINT NOT NULL
          )
        `,
        (err) => {
          if (err) return reject(err);

          this.db.run(
            "CREATE INDEX idx_sessions_expires_at ON sessions (expires_at)",
            (indexErr) => (indexErr ? reject(indexErr) : resolve()),
          );
        },
      );
    });
  }

  get(sid, callback) {
    this.ready
      .then(() => {
        this.db.get(
          "SELECT sess, expires_at FROM sessions WHERE sid = ?",
          [sid],
          (err, row) => {
            if (err) return callback(err);
            if (!row) return callback(null, null);

            if (row.expires_at <= Date.now()) {
              return this.destroy(sid, () => callback(null, null));
            }

            try {
              callback(null, JSON.parse(row.sess));
            } catch (parseErr) {
              callback(parseErr);
            }
          },
        );
      })
      .catch((err) => callback(err));
  }

  set(sid, sess, callback) {
    this.ready
      .then(() => {
        this.db.run(
          `INSERT INTO sessions (sid, sess, expires_at)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE
             sess = VALUES(sess),
             expires_at = VALUES(expires_at)`,
          [sid, JSON.stringify(sess), this.getExpiry(sess)],
          (err) => callback && callback(err),
        );
      })
      .catch((err) => callback && callback(err));
  }

  destroy(sid, callback) {
    this.ready
      .then(() => {
        this.db.run("DELETE FROM sessions WHERE sid = ?", [sid], (err) => {
          if (callback) callback(err);
        });
      })
      .catch((err) => callback && callback(err));
  }

  touch(sid, sess, callback) {
    this.ready
      .then(() => {
        this.db.run(
          "UPDATE sessions SET expires_at = ? WHERE sid = ?",
          [this.getExpiry(sess), sid],
          (err) => callback && callback(err),
        );
      })
      .catch((err) => callback && callback(err));
  }

  getExpiry(sess) {
    const cookieExpiry =
      sess && sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : NaN;

    if (Number.isFinite(cookieExpiry)) {
      return cookieExpiry;
    }

    const maxAge =
      sess && sess.cookie && typeof sess.cookie.maxAge === "number"
        ? sess.cookie.maxAge
        : 24 * 60 * 60 * 1000;

    return Date.now() + maxAge;
  }

  cleanupExpiredSessions() {
    this.ready
      .then(() => {
        this.db.run(
          "DELETE FROM sessions WHERE expires_at <= ?",
          [Date.now()],
          (err) => {
            if (err) {
              console.error("Erro ao limpar sessoes expiradas:", err.message);
            }
          },
        );
      })
      .catch((err) =>
        console.error("Erro ao inicializar limpeza de sessoes:", err.message),
      );
  }
}

module.exports = MySQLSessionStore;
