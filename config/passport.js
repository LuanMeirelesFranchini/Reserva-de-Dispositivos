const GoogleStrategy = require("passport-google-oauth20").Strategy;

function configurePassport(passport, db) {
  passport.serializeUser((user, done) => done(null, user.id));

  passport.deserializeUser((id, done) => {
    db.get("SELECT * FROM usuarios WHERE id = ?", [id], (err, user) =>
      done(err, user),
    );
  });

  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "/auth/google/callback",
      },
      (accessToken, refreshToken, profile, done) => {
        const email = profile.emails[0].value;
        const nome = profile.displayName;

        db.get(
          "SELECT * FROM usuarios WHERE email = ?",
          [email],
          (err, user) => {
            if (err) return done(err);

            if (user) {
              return db.run(
                "UPDATE usuarios SET google_access_token = ?, google_refresh_token = ? WHERE id = ?",
                [accessToken, refreshToken || user.google_refresh_token, user.id],
                (updateErr) => {
                  if (updateErr) return done(updateErr);

                  user.google_access_token = accessToken;
                  user.google_refresh_token =
                    refreshToken || user.google_refresh_token;
                  return done(null, user);
                },
              );
            }

            const allowedDomains = (
              process.env.ALLOWED_DOMAINS ||
              "lasalle.org.br,prof.soulasalle.com.br"
            )
              .split(",")
              .map((domain) => domain.trim())
              .filter(Boolean);

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
              [nome, email, "professor", accessToken, refreshToken],
              function (insertErr) {
                if (insertErr) return done(insertErr);

                return done(null, {
                  id: this.lastID,
                  nome,
                  email,
                  role: "professor",
                  google_access_token: accessToken,
                  google_refresh_token: refreshToken,
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
