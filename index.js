require("dotenv").config();

const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const passport = require("passport");
const { initializeSalasTable } = require("./salas-data");
const { MySQLDatabase } = require("./database");
const MySQLSessionStore = require("./config/mysql-session-store");
const configurePassport = require("./config/passport");
const authMiddlewares = require("./middlewares/auth");
const createAppHelpers = require("./helpers/app-helpers");

const requiredEnvVars = [
  "SESSION_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "DB_HOST",
  "DB_USER",
  "DB_NAME",
];

const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error(
    `ERRO FATAL: Variaveis de ambiente obrigatorias ausentes: ${missingEnvVars.join(", ")}`,
  );
  process.exit(1);
}

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.set("view engine", "ejs");
app.set("trust proxy", 1);

const db = new MySQLDatabase((err) => {
  if (err) {
    console.error(
      "ERRO FATAL: Nao foi possivel conectar ao banco de dados.",
      err.message,
    );
    process.exit(1);
  }

  console.log("Conectado ao banco de dados MySQL com sucesso.");
});

const sessionStore = new MySQLSessionStore(db);
setInterval(
  () => sessionStore.cleanupExpiredSessions(),
  60 * 60 * 1000,
).unref();

initializeSalasTable(db)
  .then(() => console.log("Tabela 'salas' pronta para uso."))
  .catch((err) =>
    console.error("Erro ao inicializar tabela 'salas':", err.message),
  );

configurePassport(passport, db);

app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  }),
);
app.use(passport.initialize());
app.use(passport.session());

const helpers = createAppHelpers(db);

app.get("/login", (req, res) =>
  res.render("login", { erro: req.query.error || "" }),
);

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: [
      "profile",
      "email",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    accessType: "offline",
  }),
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    successRedirect: "/",
    failureRedirect: "/login?error=true",
  }),
);

app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect("/login");
  });
});

app.use("/admin", require("./routes/admin")(db, authMiddlewares, helpers));
app.use("/", require("./routes/reservas")(db, authMiddlewares, helpers));

app.use((err, req, res, next) => {
  console.error("Erro nao tratado:", err.message || err);

  if (res.headersSent) {
    return next(err);
  }

  // Intercepta erros de expiração/falha de código do Google OAuth
  if (err.name === "TokenError" || err.code === "invalid_grant") {
    return res.redirect("/login?error=true");
  }

  if (req.originalUrl.startsWith("/api/")) {
    return res.status(500).json({ error: "Erro interno no servidor." });
  }

  res.status(500).send("Erro interno no servidor.");
});

if (require.main === module) {
  app.listen(PORT, () =>
    console.log(`Servidor rodando em http://localhost:${PORT}`),
  );
}

module.exports = app;
