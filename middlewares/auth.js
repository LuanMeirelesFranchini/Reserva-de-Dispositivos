function hasActiveUser(req) {
  return (
    req.isAuthenticated() &&
    req.user &&
    req.user.ativo !== 0 &&
    req.user.ativo !== "0"
  );
}

function isAuthenticated(req, res, next) {
  if (hasActiveUser(req)) return next();
  res.redirect("/login");
}

function isAdmin(req, res, next) {
  if (hasActiveUser(req) && req.user.role === "admin") return next();
  res.status(403).send("<h1>Acesso Negado</h1>");
}

function canManageReservations(req, res, next) {
  if (
    hasActiveUser(req) &&
    (req.user.role === "admin" || req.user.role === "operacional")
  ) {
    return next();
  }

  res.status(403).send("<h1>Acesso Negado</h1>");
}

function ensureAuthenticatedApi(req, res, next) {
  if (hasActiveUser(req)) return next();
  res.status(401).json({ error: "Sessao expirada. Faca login novamente." });
}

module.exports = {
  hasActiveUser,
  isAuthenticated,
  isAdmin,
  canManageReservations,
  ensureAuthenticatedApi,
};
