require("dotenv").config();

const crypto = require("crypto");
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
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const googleScopes = ["profile", "email"];

if (process.env.GOOGLE_CALENDAR_ENABLED === "true") {
  googleScopes.push("https://www.googleapis.com/auth/calendar.events");
}

function safeJson(value) {
  const replacements = {
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029",
  };

  const json = JSON.stringify(value);
  return (json === undefined ? "null" : json).replace(
    /[<>&\u2028\u2029]/g,
    (char) => replacements[char],
  );
}

function secureCompare(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function csrfProtection(req, res, next) {
  if (!req.session) return next();

  if (!req.session.csrfToken && SAFE_METHODS.has(req.method)) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }

  res.locals.csrfToken = req.session.csrfToken || "";

  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const submittedToken =
    req.body?._csrf ||
    req.get("x-csrf-token") ||
    req.get("x-xsrf-token") ||
    "";

  if (!req.session.csrfToken || !secureCompare(req.session.csrfToken, submittedToken)) {
    if (req.originalUrl.startsWith("/api/") || req.is("application/json")) {
      return res.status(403).json({ error: "Token CSRF invalido." });
    }

    return res.status(403).send("Token CSRF invalido.");
  }

  return next();
}

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://npmcdn.com",
      "connect-src 'self'",
      "form-action 'self'",
    ].join("; "),
  );

  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }

  next();
}

app.set("view engine", "ejs");
app.set("trust proxy", 1);
app.locals.safeJson = safeJson;

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

app.use(securityHeaders);
app.use(express.static("public"));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
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
app.use(csrfProtection);

const helpers = createAppHelpers(db);

app.get("/login", (req, res) =>
  res.render("login", { erro: req.query.error || "" }),
);

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: googleScopes,
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
