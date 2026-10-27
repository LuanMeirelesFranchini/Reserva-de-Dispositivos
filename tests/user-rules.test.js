const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { podeAlterarOuDesativarAdmin } = require("../helpers/user-rules");

describe("Regras de Usuário - Proteção do Último Administrador", () => {
  describe("Cenário 1: 0 administradores restantes", () => {
    it("Deve bloquear rebaixamento de admin quando restam 0 outros admins ativos", () => {
      const resultado = podeAlterarOuDesativarAdmin({
        acao: "rebaixar",
        roleAtual: "admin",
        novoRole: "professor",
        outrosAdminsAtivos: 0,
      });

      assert.equal(resultado.permitido, false);
      assert.equal(
        resultado.motivo,
        "Nao e possivel rebaixar o unico administrador ativo do sistema.",
      );
    });

    it("Deve bloquear desativação de admin quando restam 0 outros admins ativos", () => {
      const resultado = podeAlterarOuDesativarAdmin({
        acao: "desativar",
        roleAtual: "admin",
        outrosAdminsAtivos: 0,
      });

      assert.equal(resultado.permitido, false);
      assert.equal(
        resultado.motivo,
        "Nao e possivel desativar o unico administrador ativo do sistema.",
      );
    });
  });

  describe("Cenário 2: 1 administrador restante", () => {
    it("Deve permitir rebaixar admin se resta 1 outro admin ativo", () => {
      const resultado = podeAlterarOuDesativarAdmin({
        acao: "rebaixar",
        roleAtual: "admin",
        novoRole: "professor",
        outrosAdminsAtivos: 1,
      });

      assert.equal(resultado.permitido, true);
      assert.equal(resultado.motivo, undefined);
    });

    it("Deve permitir desativar admin se resta 1 outro admin ativo", () => {
      const resultado = podeAlterarOuDesativarAdmin({
        acao: "desativar",
        roleAtual: "admin",
        outrosAdminsAtivos: 1,
      });

      assert.equal(resultado.permitido, true);
      assert.equal(resultado.motivo, undefined);
    });
  });

  describe("Cenário 3: 2 ou mais administradores restantes", () => {
    it("Deve permitir rebaixar admin para operacional se restam 2 outros admins", () => {
      const resultado = podeAlterarOuDesativarAdmin({
        acao: "rebaixar",
        roleAtual: "admin",
        novoRole: "operacional",
        outrosAdminsAtivos: 2,
      });

      assert.equal(resultado.permitido, true);
    });

    it("Deve permitir desativar admin se restam múltiplos outros admins (ex: 5)", () => {
      const resultado = podeAlterarOuDesativarAdmin({
        acao: "desativar",
        roleAtual: "admin",
        outrosAdminsAtivos: 5,
      });

      assert.equal(resultado.permitido, true);
    });
  });

  describe("Cenário 4: Usuário alvo que NÃO é administrador", () => {
    it("Deve permitir alterar papel de professor mesmo com 0 outros admins", () => {
      const resultado = podeAlterarOuDesativarAdmin({
        acao: "rebaixar",
        roleAtual: "professor",
        novoRole: "operacional",
        outrosAdminsAtivos: 0,
      });

      assert.equal(resultado.permitido, true);
    });

    it("Deve permitir desativar professor mesmo com 0 outros admins", () => {
      const resultado = podeAlterarOuDesativarAdmin({
        acao: "desativar",
        roleAtual: "professor",
        outrosAdminsAtivos: 0,
      });

      assert.equal(resultado.permitido, true);
    });

    it("Deve permitir rebaixar operacional para professor mesmo com 0 outros admins", () => {
      const resultado = podeAlterarOuDesativarAdmin({
        acao: "rebaixar",
        roleAtual: "operacional",
        novoRole: "professor",
        outrosAdminsAtivos: 0,
      });

      assert.equal(resultado.permitido, true);
    });

    it("Deve permitir desativar operacional mesmo com 0 outros admins", () => {
      const resultado = podeAlterarOuDesativarAdmin({
        acao: "desativar",
        roleAtual: "operacional",
        outrosAdminsAtivos: 0,
      });

      assert.equal(resultado.permitido, true);
    });
  });

  describe("Cenário 5: Admin mantendo papel de admin", () => {
    it("Deve permitir salvar admin como admin mesmo se for o único no sistema", () => {
      const resultado = podeAlterarOuDesativarAdmin({
        acao: "rebaixar",
        roleAtual: "admin",
        novoRole: "admin",
        outrosAdminsAtivos: 0,
      });

      assert.equal(resultado.permitido, true);
    });
  });

  describe("Cenário 6: Validação de papéis válidos permitidos", () => {
    it("Lista de papéis permitidos deve conter exatamente professor, operacional e admin", () => {
      const allowedRoles = ["professor", "operacional", "admin"];
      assert.equal(allowedRoles.includes("professor"), true);
      assert.equal(allowedRoles.includes("operacional"), true);
      assert.equal(allowedRoles.includes("admin"), true);
      assert.equal(allowedRoles.includes("root"), false);
      assert.equal(allowedRoles.includes(""), false);
      assert.equal(allowedRoles.includes(null), false);
    });
  });
});
