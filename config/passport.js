const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { decryptToken, encryptToken } = require("../helpers/token-crypto");

function getAllowedDomains() {
  return (process.env.ALLOWED_DOMAINS || "lasalle.org.br,prof.soulasalle.com.br")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

function configurePassport(passport, db) {
  passport.serializeUser((user, done) => done(null, user.id));

  passport.deserializeUser((id, done) => {
    db.get(
      `SELECT id, nome, email, role, ativo
       FROM usuarios
       WHERE id = ? AND ativo = 1`,
      [id],
      (err, user) => {
        if (err) return done(err);
        if (!user) return done(null, false);

        return done(null, user);
      },
    );
  });

  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "/auth/google/callback",
        state: true,
      },
      (accessToken, refreshToken, profile, done) => {
        const email = profile.emails?.[0]?.value?.toLowerCase();
        const nome = profile.displayName;

        if (!email || !accessToken) {
          return done(null, false, {
            message: "Nao foi possivel obter os dados da conta Google.",
          });
        }

        db.get(
          "SELECT * FROM usuarios WHERE email = ?",
          [email],
          (err, user) => {
            if (err) return done(err);

            if (user && Number(user.ativo) === 0) {
              return done(null, false, {
                message: "Usuario inativo.",
              });
            }

            if (user) {
              const currentRefreshToken = decryptToken(user.google_refresh_token);
              const nextRefreshToken = refreshToken || currentRefreshToken || null;

              return db.run(
                "UPDATE usuarios SET google_access_token = NULL, google_refresh_token = ? WHERE id = ?",
                [
                  encryptToken(nextRefreshToken),
                  user.id,
                ],
                (updateErr) => {
                  if (updateErr) return done(updateErr);

                  user.google_access_token = null;
                  user.google_refresh_token = nextRefreshToken;
                  return done(null, user);
                },
              );
            }

            const allowedDomains = getAllowedDomains();

            const isAllowed = allowedDomains.some((domain) =>
              email.endsWith(`@${domain}`),
            );

            if (!isAllowed) {
              return done(null, false, {
                message: "Apenas e-mails institucionais permitidos.",
              });
            }

            return db.run(
                "INSERT INTO usuarios (nome, email, role, google_access_token, google_refresh_token) VALUES (?, ?, ?, ?, ?)",
                [
                  nome,
                  email,
                  "professor",
                  null,
                  encryptToken(refreshToken),
                ],
              function (insertErr) {
                if (insertErr) return done(insertErr);

                return done(null, {
                  id: this.lastID,
                  nome,
                  email,
                  role: "professor",
                  google_refresh_token: refreshToken || null,
                  ativo: 1,
                });
              },
            );
          },
        );
      },
    ),
  );
}

module.exports = configurePassport;
