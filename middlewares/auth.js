function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect("/login");
}

function isAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.role === "admin") return next();
  res.status(403).send("<h1>Acesso Negado</h1>");
}

function canManageReservations(req, res, next) {
  if (
    req.isAuthenticated() &&
    (req.user.role === "admin" || req.user.role === "operacional")
  ) {
    return next();
  }

  res.status(403).send("<h1>Acesso Negado</h1>");
}

function ensureAuthenticatedApi(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: "Sessao expirada. Faca login novamente." });
}

module.exports = {
  isAuthenticated,
  isAdmin,
  canManageReservations,
  ensureAuthenticatedApi,
};
