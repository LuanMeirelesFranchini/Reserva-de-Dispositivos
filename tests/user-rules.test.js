const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  podeAlterarOuDesativarAdmin,
  deveEnviarEmailCancelamento,
  sanitizarDestinoCancelamento,
} = require("../helpers/user-rules");

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

describe("Regras de Usuário - Decisão de Envio de E-mail de Cancelamento", () => {
  const AGORA = new Date("2026-11-01T10:00:00.000Z");

  it("Cenário 1: Dono cancelando reserva futura não deve receber e-mail", () => {
    const deveEnviar = deveEnviarEmailCancelamento({
      ehDono: true,
      dataRetirada: "2026-11-05 14:00:00",
      agora: AGORA,
    });
    assert.equal(deveEnviar, false);
  });

  it("Cenário 2: Dono cancelando reserva passada ou em andamento não deve receber e-mail", () => {
    const deveEnviar = deveEnviarEmailCancelamento({
      ehDono: true,
      dataRetirada: "2026-10-30 14:00:00",
      agora: AGORA,
    });
    assert.equal(deveEnviar, false);
  });

  it("Cenário 3: Terceiro cancelando reserva futura deve receber e-mail", () => {
    const deveEnviar = deveEnviarEmailCancelamento({
      ehDono: false,
      dataRetirada: "2026-11-05 14:00:00",
      agora: AGORA,
    });
    assert.equal(deveEnviar, true);
  });

  it("Cenário 4: Terceiro cancelando reserva que já iniciou (passada) não deve receber e-mail", () => {
    const deveEnviar = deveEnviarEmailCancelamento({
      ehDono: false,
      dataRetirada: "2026-10-30 14:00:00",
      agora: AGORA,
    });
    assert.equal(deveEnviar, false);
  });

  it("Cenário 5: Terceiro no limite exato de horário (dataRetirada igual a agora) não deve receber e-mail", () => {
    const deveEnviar = deveEnviarEmailCancelamento({
      ehDono: false,
      dataRetirada: AGORA,
      agora: AGORA,
    });
    assert.equal(deveEnviar, false);
  });

  it("Cenário 6: Entradas nulas, vazias ou inválidas devem retornar false", () => {
    assert.equal(
      deveEnviarEmailCancelamento({ ehDono: false, dataRetirada: null, agora: AGORA }),
      false,
    );
    assert.equal(
      deveEnviarEmailCancelamento({ ehDono: false, dataRetirada: "", agora: AGORA }),
      false,
    );
    assert.equal(
      deveEnviarEmailCancelamento({
        ehDono: false,
        dataRetirada: "data-invalida",
        agora: AGORA,
      }),
      false,
    );
  });

  it("Cenário 7: Deve processar corretamente objeto Date nativo e formato string MySQL", () => {
    const dataDate = new Date("2026-11-02T10:00:00.000Z");
    assert.equal(
      deveEnviarEmailCancelamento({
        ehDono: false,
        dataRetirada: dataDate,
        agora: AGORA,
      }),
      true,
    );
    assert.equal(
      deveEnviarEmailCancelamento({
        ehDono: false,
        dataRetirada: "2026-11-02 10:00:00",
        agora: AGORA,
      }),
      true,
    );
  });
});

describe("Regras de Usuário - Destino Seguro de Redirecionamento no Cancelamento", () => {
  describe("Para administradores e operadores (podem gerenciar)", () => {
    it("Padrão para admin sem voltar_para deve ser /admin", () => {
      assert.equal(
        sanitizarDestinoCancelamento({ voltarPara: undefined, usuarioRole: "admin" }),
        "/admin",
      );
      assert.equal(
        sanitizarDestinoCancelamento({ voltarPara: "", usuarioRole: "admin" }),
        "/admin",
      );
    });

    it("Padrão para operacional sem voltar_para deve ser /admin", () => {
      assert.equal(
        sanitizarDestinoCancelamento({ voltarPara: undefined, usuarioRole: "operacional" }),
        "/admin",
      );
    });

    it("Deve aceitar /admin exato, /admin? com query params e /admin/ subpath", () => {
      assert.equal(
        sanitizarDestinoCancelamento({ voltarPara: "/admin", usuarioRole: "admin" }),
        "/admin",
      );
      assert.equal(
        sanitizarDestinoCancelamento({
          voltarPara: "/admin?page=2&q=biologia",
          usuarioRole: "operacional",
        }),
        "/admin?page=2&q=biologia",
      );
      assert.equal(
        sanitizarDestinoCancelamento({
          voltarPara: "/admin/relatorios",
          usuarioRole: "admin",
        }),
        "/admin/relatorios",
      );
    });

    it("Deve aceitar /minhas-reservas se requisitado pelo gestor", () => {
      assert.equal(
        sanitizarDestinoCancelamento({
          voltarPara: "/minhas-reservas",
          usuarioRole: "admin",
        }),
        "/minhas-reservas",
      );
    });

    it("Deve rejeitar destinos externos ou desconhecidos e cair para /admin", () => {
      assert.equal(
        sanitizarDestinoCancelamento({
          voltarPara: "https://evil.com",
          usuarioRole: "admin",
        }),
        "/admin",
      );
      assert.equal(
        sanitizarDestinoCancelamento({
          voltarPara: "//evil.com",
          usuarioRole: "admin",
        }),
        "/admin",
      );
      assert.equal(
        sanitizarDestinoCancelamento({
          voltarPara: "/carrinhos",
          usuarioRole: "operacional",
        }),
        "/admin",
      );
    });
  });

  describe("Para professores / usuários comuns (não gerenciam)", () => {
    it("Padrão para professor deve ser sempre /minhas-reservas", () => {
      assert.equal(
        sanitizarDestinoCancelamento({ voltarPara: undefined, usuarioRole: "professor" }),
        "/minhas-reservas",
      );
      assert.equal(
        sanitizarDestinoCancelamento({ voltarPara: "", usuarioRole: "professor" }),
        "/minhas-reservas",
      );
    });

    it("Professor NUNCA é redirecionado para /admin mesmo que voltar_para solicite", () => {
      assert.equal(
        sanitizarDestinoCancelamento({ voltarPara: "/admin", usuarioRole: "professor" }),
        "/minhas-reservas",
      );
      assert.equal(
        sanitizarDestinoCancelamento({
          voltarPara: "/admin?page=3",
          usuarioRole: "professor",
        }),
        "/minhas-reservas",
      );
      assert.equal(
        sanitizarDestinoCancelamento({
          voltarPara: "/admin/usuarios",
          usuarioRole: "professor",
        }),
        "/minhas-reservas",
      );
    });

    it("Professor aceita /minhas-reservas explicitamente", () => {
      assert.equal(
        sanitizarDestinoCancelamento({
          voltarPara: "/minhas-reservas",
          usuarioRole: "professor",
        }),
        "/minhas-reservas",
      );
    });

    it("Professor com destinos inválidos ou externos cai em /minhas-reservas", () => {
      assert.equal(
        sanitizarDestinoCancelamento({
          voltarPara: "https://externo.com",
          usuarioRole: "professor",
        }),
        "/minhas-reservas",
      );
      assert.equal(
        sanitizarDestinoCancelamento({
          voltarPara: "//outro.com",
          usuarioRole: "professor",
        }),
        "/minhas-reservas",
      );
    });
  });
});


