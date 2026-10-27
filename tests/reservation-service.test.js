process.env.TZ = "America/Sao_Paulo";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  validarConflitoReserva,
  calcularDisponiveisComBloqueios,
  calcularDisponiveisNoPeriodo,
  calcularPicoDeUso,
  calcularPicoBloqueado,
  simularAtendimentoFila,
  toTimestamp,
} = require("../services/reservation-service");

// --- FACTORIES AUXILIARES ---

function criarCarrinho(overrides = {}) {
  return {
    id: 1,
    nome: "Carrinho 01",
    capacidade: 20,
    indisponiveis: 0,
    ativo: 1,
    ...overrides,
  };
}

function criarReserva(overrides = {}) {
  return {
    id: 101,
    carrinho_id: 1,
    quantidade: 5,
    data_retirada: "2026-11-02T10:00:00.000Z",
    data_devolucao: "2026-11-02T12:00:00.000Z",
    status: "Ativa",
    ...overrides,
  };
}

function criarBloqueio(overrides = {}) {
  return {
    id: 201,
    carrinho_id: 1,
    quantidade: 5,
    data_inicio: "2026-11-02T10:00:00.000Z",
    data_fim: "2026-11-02T12:00:00.000Z",
    motivo: "Manutenção preventiva",
    ...overrides,
  };
}

// Data base fixa de referência para os testes (2026-11-01 às 08:00 UTC)
const AGORA = new Date("2026-11-01T08:00:00.000Z");

describe("Serviço de Reservas - Validação Pura de Conflito e Capacidade", () => {
  // Cenário 1: Sem reservas existentes: válida
  it("Cenário 1: Sem reservas existentes deve aceitar a solicitação", () => {
    const carrinho = criarCarrinho({ capacidade: 20 });
    const resultado = validarConflitoReserva({
      carrinho,
      quantidade: 10,
      inicio: "2026-11-03T10:00:00.000Z", // +48h
      fim: "2026-11-03T12:00:00.000Z",
      reservasExistentes: [],
      bloqueios: [],
      usuarioRole: "professor",
      agora: AGORA,
    });

    assert.equal(resultado.valida, true);
    assert.equal(resultado.disponiveisNoPeriodo, 20);
    assert.equal(resultado.picoOcupado, 0);
  });

  // Cenário 2: Pedido igual à capacidade disponível (limite exato): válida
  it("Cenário 2: Pedido igual à capacidade disponível exata deve ser válido", () => {
    const carrinho = criarCarrinho({ capacidade: 15 });
    const resultado = validarConflitoReserva({
      carrinho,
      quantidade: 15,
      inicio: "2026-11-03T10:00:00.000Z",
      fim: "2026-11-03T12:00:00.000Z",
      reservasExistentes: [],
      bloqueios: [],
      agora: AGORA,
    });

    assert.equal(resultado.valida, true);
    assert.equal(resultado.disponiveisNoPeriodo, 15);
  });

  // Cenário 3: Pedido excede em 1 aparelho: inválida
  it("Cenário 3: Pedido que excede em 1 aparelho a capacidade disponível deve ser inválido", () => {
    const carrinho = criarCarrinho({ capacidade: 15 });
    const resultado = validarConflitoReserva({
      carrinho,
      quantidade: 16,
      inicio: "2026-11-03T10:00:00.000Z",
      fim: "2026-11-03T12:00:00.000Z",
      reservasExistentes: [],
      bloqueios: [],
      agora: AGORA,
    });

    assert.equal(resultado.valida, false);
    assert.match(resultado.motivo, /so ha 15 disponiveis/i);
    assert.equal(resultado.disponiveisNoPeriodo, 15);
  });

  // Cenário 4: Sobreposição total, capacidade esgotada: inválida
  it("Cenário 4: Sobreposição total de horário com capacidade esgotada deve ser inválida", () => {
    const carrinho = criarCarrinho({ capacidade: 10 });
    const reservasExistentes = [
      criarReserva({
        quantidade: 10,
        data_retirada: "2026-11-03T09:00:00.000Z",
        data_devolucao: "2026-11-03T13:00:00.000Z",
        status: "Ativa",
      }),
    ];

    const resultado = validarConflitoReserva({
      carrinho,
      quantidade: 1,
      inicio: "2026-11-03T10:00:00.000Z",
      fim: "2026-11-03T12:00:00.000Z",
      reservasExistentes,
      bloqueios: [],
      agora: AGORA,
    });

    assert.equal(resultado.valida, false);
    assert.equal(resultado.disponiveisNoPeriodo, 0);
    assert.equal(resultado.picoOcupado, 10);
  });

  // Cenário 5: Sobreposição parcial de horário com capacidade insuficiente no trecho sobreposto: inválida
  it("Cenário 5: Sobreposição parcial onde a soma excede a capacidade deve ser inválida", () => {
    // Carrinho de 15 aparelhos. Reserva existente de 10 das 10h às 12h.
    // Nova reserva pede 8 das 11h às 13h. No intervalo 11h-12h precisa de 18 (18 > 15).
    const carrinho = criarCarrinho({ capacidade: 15 });
    const reservasExistentes = [
      criarReserva({
        quantidade: 10,
        data_retirada: "2026-11-03T10:00:00.000Z",
        data_devolucao: "2026-11-03T12:00:00.000Z",
      }),
    ];

    const resultado = validarConflitoReserva({
      carrinho,
      quantidade: 8,
      inicio: "2026-11-03T11:00:00.000Z",
      fim: "2026-11-03T13:00:00.000Z",
      reservasExistentes,
      bloqueios: [],
      agora: AGORA,
    });

    assert.equal(resultado.valida, false);
    assert.equal(resultado.disponiveisNoPeriodo, 5); // 15 - 10 = 5 disponíveis no pico
  });

  // Cenário 6: Sobreposição parcial, mas com capacidade suficiente: válida
  it("Cenário 6: Sobreposição parcial com saldo suficiente deve ser válida", () => {
    // Carrinho de 20 aparelhos. Reserva de 10 das 10h às 12h.
    // Nova reserva pede 8 das 11h às 13h. 10 + 8 = 18 <= 20.
    const carrinho = criarCarrinho({ capacidade: 20 });
    const reservasExistentes = [
      criarReserva({
        quantidade: 10,
        data_retirada: "2026-11-03T10:00:00.000Z",
        data_devolucao: "2026-11-03T12:00:00.000Z",
      }),
    ];

    const resultado = validarConflitoReserva({
      carrinho,
      quantidade: 8,
      inicio: "2026-11-03T11:00:00.000Z",
      fim: "2026-11-03T13:00:00.000Z",
      reservasExistentes,
      bloqueios: [],
      agora: AGORA,
    });

    assert.equal(resultado.valida, true);
    assert.equal(resultado.disponiveisNoPeriodo, 10); // 20 - 10 = 10 disponíveis no período
  });

  // Cenário 7: Reservas adjacentes (fim == início): sem conflito
  it("Cenário 7: Intervalos adjacentes (saída de um no exato momento da entrada do outro) não conflitam", () => {
    // Carrinho tem capacidade 10.
    // Reserva A usa todos os 10 dispositivos das 08:00 às 10:00.
    // Nova reserva pede todos os 10 dispositivos das 10:00 às 12:00.
    // Sweep-line DEVE processar a saída de A (-10) antes da entrada da nova (+10) no timestamp 10:00.
    const carrinho = criarCarrinho({ capacidade: 10 });
    const reservasExistentes = [
      criarReserva({
        quantidade: 10,
        data_retirada: "2026-11-03T08:00:00.000Z",
        data_devolucao: "2026-11-03T10:00:00.000Z",
      }),
    ];

    const resultado = validarConflitoReserva({
      carrinho,
      quantidade: 10,
      inicio: "2026-11-03T10:00:00.000Z",
      fim: "2026-11-03T12:00:00.000Z",
      reservasExistentes,
      bloqueios: [],
      agora: AGORA,
    });

    assert.equal(resultado.valida, true);
    assert.equal(resultado.disponiveisNoPeriodo, 10);
    assert.equal(resultado.picoOcupado, 0); // dentro da janela 10:00-12:00 o pico anterior já foi encerrado
  });

  // Cenário 8: Duas reservas pequenas que somadas estouram a capacidade só num trecho do intervalo (sweep-line)
  it("Cenário 8: Duas reservas que só estouram a capacidade na intersecção mútua devem invalidar nova reserva", () => {
    // Carrinho tem 15.
    // Reserva 1: 8 unidades das 09:00 às 11:30.
    // Reserva 2: 8 unidades das 10:30 às 13:00.
    // Entre 10:30 e 11:30 o uso acumulado é 8 + 8 = 16 > 15.
    // Nova reserva de 2 unidades das 09:00 às 13:00 deve ser rejeitada porque a disponibilidade no pico é 0.
    const carrinho = criarCarrinho({ capacidade: 15 });
    const reservasExistentes = [
      criarReserva({
        quantidade: 8,
        data_retirada: "2026-11-03T09:00:00.000Z",
        data_devolucao: "2026-11-03T11:30:00.000Z",
      }),
      criarReserva({
        quantidade: 8,
        data_retirada: "2026-11-03T10:30:00.000Z",
        data_devolucao: "2026-11-03T13:00:00.000Z",
      }),
    ];

    const resultado = validarConflitoReserva({
      carrinho,
      quantidade: 2,
      inicio: "2026-11-03T09:00:00.000Z",
      fim: "2026-11-03T13:00:00.000Z",
      reservasExistentes,
      bloqueios: [],
      agora: AGORA,
    });

    assert.equal(resultado.valida, false);
    assert.equal(resultado.picoOcupado, 16);
    assert.equal(resultado.disponiveisNoPeriodo, 0); // Math.max(15 - 16, 0) = 0
  });

  // Cenário 9: Mesmo horário em carrinhos diferentes: sem conflito
  it("Cenário 9: Reservas existentes em carrinhos diferentes não devem consumir vaga do carrinho atual", () => {
    const carrinho1 = criarCarrinho({ id: 1, capacidade: 15 });
    const reservasExistentes = [
      criarReserva({
        carrinho_id: 2, // Outro carrinho!
        quantidade: 15,
        data_retirada: "2026-11-03T10:00:00.000Z",
        data_devolucao: "2026-11-03T12:00:00.000Z",
      }),
    ];

    const resultado = validarConflitoReserva({
      carrinho: carrinho1,
      quantidade: 15,
      inicio: "2026-11-03T10:00:00.000Z",
      fim: "2026-11-03T12:00:00.000Z",
      reservasExistentes,
      bloqueios: [],
      agora: AGORA,
    });

    assert.equal(resultado.valida, true);
    assert.equal(resultado.disponiveisNoPeriodo, 15);
    assert.equal(resultado.picoOcupado, 0);
  });

  // Cenário 10: Dias diferentes: sem conflito
  it("Cenário 10: Reservas em dias diferentes não devem conflitar", () => {
    const carrinho = criarCarrinho({ capacidade: 10 });
    const reservasExistentes = [
      criarReserva({
        quantidade: 10,
        data_retirada: "2026-11-03T10:00:00.000Z",
        data_devolucao: "2026-11-03T12:00:00.000Z",
      }),
    ];

    const resultado = validarConflitoReserva({
      carrinho,
      quantidade: 10,
      inicio: "2026-11-04T10:00:00.000Z", // Dia seguinte
      fim: "2026-11-04T12:00:00.000Z",
      reservasExistentes,
      bloqueios: [],
      agora: AGORA,
    });

    assert.equal(resultado.valida, true);
    assert.equal(resultado.disponiveisNoPeriodo, 10);
  });

  // Cenário 11: Aparelhos indisponíveis reduzem a capacidade
  it("Cenário 11: Aparelhos indisponíveis no carrinho reduzem a capacidade base", () => {
    // Capacidade 20, indisponiveis 4 -> base disponível é 16
    const carrinho = criarCarrinho({ capacidade: 20, indisponiveis: 4 });
    const resultado = validarConflitoReserva({
      carrinho,
      quantidade: 17, // 17 > 16
      inicio: "2026-11-03T10:00:00.000Z",
      fim: "2026-11-03T12:00:00.000Z",
      reservasExistentes: [],
      bloqueios: [],
      agora: AGORA,
    });

    assert.equal(resultado.valida, false);
    assert.equal(resultado.disponiveisNoPeriodo, 16);
    assert.match(resultado.motivo, /so ha 16 disponiveis/i);
  });

  // Cenário 12: Bloqueio de manutenção parcial reduz a capacidade só no período do bloqueio
  it("Cenário 12: Bloqueio programado reduz a capacidade estritamente no período sobreposto", () => {
    // Carrinho 20. Bloqueio de 8 das 10h às 12h.
    // Reserva das 10h às 12h pede 15. Sobram 20 - 8 = 12. 15 > 12 -> inválida.
    const carrinho = criarCarrinho({ capacidade: 20 });
    const bloqueios = [
      criarBloqueio({
        quantidade: 8,
        data_inicio: "2026-11-03T10:00:00.000Z",
        data_fim: "2026-11-03T12:00:00.000Z",
      }),
    ];

    const resultadoSobreposto = validarConflitoReserva({
      carrinho,
      quantidade: 15,
      inicio: "2026-11-03T10:00:00.000Z",
      fim: "2026-11-03T12:00:00.000Z",
      reservasExistentes: [],
      bloqueios,
      agora: AGORA,
    });

    assert.equal(resultadoSobreposto.valida, false);
    assert.equal(resultadoSobreposto.disponiveisNoPeriodo, 12);
    assert.equal(resultadoSobreposto.picoBloqueado, 8);

    // Mesma quantidade das 14h às 16h (fora do bloqueio) -> válida com 20 livres
    const resultadoFora = validarConflitoReserva({
      carrinho,
      quantidade: 15,
      inicio: "2026-11-03T14:00:00.000Z",
      fim: "2026-11-03T16:00:00.000Z",
      reservasExistentes: [],
      bloqueios,
      agora: AGORA,
    });

    assert.equal(resultadoFora.valida, true);
    assert.equal(resultadoFora.disponiveisNoPeriodo, 20);
    assert.equal(resultadoFora.picoBloqueado, 0);
  });

  // Cenário 13: Bloqueio cobrindo o carrinho inteiro: qualquer reserva inválida
  it("Cenário 13: Bloqueio cobrindo 100% da capacidade inviabiliza qualquer reserva no período", () => {
    const carrinho = criarCarrinho({ capacidade: 15 });
    const bloqueios = [
      criarBloqueio({
        quantidade: 15,
        data_inicio: "2026-11-03T08:00:00.000Z",
        data_fim: "2026-11-03T18:00:00.000Z",
      }),
    ];

    const resultado = validarConflitoReserva({
      carrinho,
      quantidade: 1,
      inicio: "2026-11-03T10:00:00.000Z",
      fim: "2026-11-03T11:00:00.000Z",
      reservasExistentes: [],
      bloqueios,
      agora: AGORA,
    });

    assert.equal(resultado.valida, false);
    assert.equal(resultado.disponiveisNoPeriodo, 0);
  });

  // Cenário 14: Reserva com status 'Retirada' ainda ocupa capacidade
  it("Cenário 14: Reserva com status 'Retirada' continua ocupando capacidade e bloqueia novas reservas", () => {
    // Carrinho 15. Reserva de 15 foi marcada como 'Retirada'.
    const carrinho = criarCarrinho({ capacidade: 15 });
    const reservasExistentes = [
      criarReserva({
        quantidade: 15,
        status: "Retirada",
        data_retirada: "2026-11-03T10:00:00.000Z",
        data_devolucao: "2026-11-03T12:00:00.000Z",
      }),
    ];

    const resultado = validarConflitoReserva({
      carrinho,
      quantidade: 1,
      inicio: "2026-11-03T10:00:00.000Z",
      fim: "2026-11-03T12:00:00.000Z",
      reservasExistentes,
      bloqueios: [],
      agora: AGORA,
    });

    assert.equal(resultado.valida, false);
    assert.equal(resultado.disponiveisNoPeriodo, 0);
    assert.equal(resultado.picoOcupado, 15);
  });

  // Cenário 15: Reservas 'Cancelada' e 'Concluida' não ocupam capacidade
  it("Cenário 15: Reservas com status 'Cancelada' e 'Concluida' não devem consumir capacidade", () => {
    const carrinho = criarCarrinho({ capacidade: 15 });
    const reservasExistentes = [
      criarReserva({
        quantidade: 15,
        status: "Cancelada",
        data_retirada: "2026-11-03T10:00:00.000Z",
        data_devolucao: "2026-11-03T12:00:00.000Z",
      }),
      criarReserva({
        quantidade: 15,
        status: "Concluida",
        data_retirada: "2026-11-03T10:00:00.000Z",
        data_devolucao: "2026-11-03T12:00:00.000Z",
      }),
    ];

    const resultado = validarConflitoReserva({
      carrinho,
      quantidade: 15,
      inicio: "2026-11-03T10:00:00.000Z",
      fim: "2026-11-03T12:00:00.000Z",
      reservasExistentes,
      bloqueios: [],
      agora: AGORA,
    });

    assert.equal(resultado.valida, true);
    assert.equal(resultado.disponiveisNoPeriodo, 15);
    assert.equal(resultado.picoOcupado, 0);
  });

  // Cenário 16: Regras de antecedência
  describe("Cenário 16: Regras de Antecedência e Limites de Prazo", () => {
    const carrinho = criarCarrinho({ capacidade: 10 });

    it("Professor com menos de 24 horas de antecedência deve ser rejeitado", () => {
      // Agora é 2026-11-01T08:00:00.000Z.
      // Tentativa para 23 horas e 59 minutos à frente: 2026-11-02T07:59:00.000Z
      const resultado = validarConflitoReserva({
        carrinho,
        quantidade: 2,
        inicio: "2026-11-02T07:59:00.000Z",
        fim: "2026-11-02T09:00:00.000Z",
        usuarioRole: "professor",
        agora: AGORA,
      });

      assert.equal(resultado.valida, false);
      assert.match(resultado.motivo, /pelo menos 24 horas de antecedencia/i);
    });

    it("Professor com exatamente 24 horas de antecedência deve ser aceito (limite inferior)", () => {
      // Exatamente 24 horas à frente: 2026-11-02T08:00:00.000Z
      const resultado = validarConflitoReserva({
        carrinho,
        quantidade: 2,
        inicio: "2026-11-02T08:00:00.000Z",
        fim: "2026-11-02T10:00:00.000Z",
        usuarioRole: "professor",
        agora: AGORA,
      });

      assert.equal(resultado.valida, true);
    });

    it("Professor com exatamente 30 dias de antecedência deve ser aceito (limite superior)", () => {
      // Exatamente 30 dias à frente: 2026-12-01T08:00:00.000Z
      const data30dias = new Date(AGORA.getTime() + 30 * 24 * 60 * 60 * 1000);
      const inicio29d = new Date(AGORA.getTime() + 29 * 24 * 60 * 60 * 1000);

      const resultadoExato = validarConflitoReserva({
        carrinho,
        quantidade: 2,
        inicio: inicio29d,
        fim: data30dias,
        usuarioRole: "professor",
        agora: AGORA,
      });

      assert.equal(resultadoExato.valida, true);
    });

    it("Professor com mais de 30 dias de antecedência deve ser rejeitado", () => {
      // 30 dias e 1 minuto à frente
      const dataAlem30d = new Date(AGORA.getTime() + 30 * 24 * 60 * 60 * 1000 + 60 * 1000);
      const resultado = validarConflitoReserva({
        carrinho,
        quantidade: 2,
        inicio: dataAlem30d,
        fim: new Date(dataAlem30d.getTime() + 3600000),
        usuarioRole: "professor",
        agora: AGORA,
      });

      assert.equal(resultado.valida, false);
      assert.match(resultado.motivo, /Maximo de 30 dias de antecedencia/i);
    });

    it("Admin com menos de 24 horas de antecedência (ex: daqui a 2h) deve ser aceito", () => {
      // 2 horas à frente: 2026-11-01T10:00:00.000Z
      const resultado = validarConflitoReserva({
        carrinho,
        quantidade: 2,
        inicio: "2026-11-01T10:00:00.000Z",
        fim: "2026-11-01T12:00:00.000Z",
        usuarioRole: "admin",
        agora: AGORA,
      });

      assert.equal(resultado.valida, true);
    });

    it("Admin tentando reservar no passado deve ser rejeitado (regra preservada para todos)", () => {
      // Data anterior a AGORA
      const resultado = validarConflitoReserva({
        carrinho,
        quantidade: 2,
        inicio: "2026-11-01T07:00:00.000Z",
        fim: "2026-11-01T07:50:00.000Z",
        usuarioRole: "admin",
        agora: AGORA,
      });

      assert.equal(resultado.valida, false);
      assert.match(resultado.motivo, /nao pode estar no passado/i);
    });
  });

  // Equivalência entre string MySQL e Date local
  it("Deve garantir que '2026-11-03 10:00:00' e new Date(2026, 10, 3, 10, 0, 0) produzem o mesmo timestamp", () => {
    const timestampString = toTimestamp("2026-11-03 10:00:00");
    const timestampDate = toTimestamp(new Date(2026, 10, 3, 10, 0, 0));

    assert.equal(typeof timestampString, "number");
    assert.equal(typeof timestampDate, "number");
    assert.equal(timestampString, timestampDate);
  });

  // Ajuste 3A: Apenas strings no formato MySQL ('YYYY-MM-DD HH:mm:ss')
  it("Ajuste 3A: Deve processar corretamente quando todos os dados estão no formato de string do MySQL ('YYYY-MM-DD HH:mm:ss')", () => {
    const carrinho = criarCarrinho({ capacidade: 10 });

    const reservasExistentes = [
      criarReserva({
        quantidade: 4,
        data_retirada: "2026-11-03 10:00:00",
        data_devolucao: "2026-11-03 12:00:00",
      }),
      criarReserva({
        id: 102,
        quantidade: 3,
        data_retirada: "2026-11-03 11:00:00",
        data_devolucao: "2026-11-03 13:00:00",
      }),
    ];

    const resultado = validarConflitoReserva({
      carrinho,
      quantidade: 3,
      inicio: "2026-11-03 11:30:00",
      fim: "2026-11-03 12:30:00",
      reservasExistentes,
      bloqueios: [],
      agora: "2026-11-01 08:00:00",
    });

    // No trecho 11:30-12:00, ocupação é 4 + 3 = 7. Restam 10 - 7 = 3. Pedido é 3 <= 3 -> Válido!
    assert.equal(resultado.valida, true);
    assert.equal(resultado.picoOcupado, 7);
    assert.equal(resultado.disponiveisNoPeriodo, 3);
  });

  // Ajuste Flatpickr: Solicitação com formato exato do Flatpickr ("YYYY-MM-DD HH:mm", sem segundos) misturado com reservas/bloqueios do MySQL ("YYYY-MM-DD HH:mm:ss")
  it("Deve validar solicitação no formato exato do Flatpickr ('YYYY-MM-DD HH:mm') com reservas e bloqueios do MySQL ('YYYY-MM-DD HH:mm:ss')", () => {
    const carrinho = criarCarrinho({ capacidade: 15 });

    const reservasExistentes = [
      criarReserva({
        quantidade: 5,
        data_retirada: "2026-11-03 10:00:00",
        data_devolucao: "2026-11-03 12:00:00",
      }),
    ];

    const bloqueios = [
      criarBloqueio({
        quantidade: 3,
        data_inicio: "2026-11-03 11:00:00",
        data_fim: "2026-11-03 13:00:00",
      }),
    ];

    // Solicitação vem do Flatpickr sem segundos: "YYYY-MM-DD HH:mm"
    const resultado = validarConflitoReserva({
      carrinho,
      quantidade: 7,
      inicio: "2026-11-03 11:30",
      fim: "2026-11-03 12:30",
      reservasExistentes,
      bloqueios,
      agora: "2026-11-01 08:00",
      usuarioRole: "professor",
    });

    // No trecho 11:30-12:00: reservas = 5, bloqueios = 3 -> pico total ocupado = 8.
    // Disponíveis = 15 - 8 = 7. Pedido de 7 <= 7 -> Válido!
    assert.equal(resultado.valida, true);
    assert.equal(resultado.picoOcupado, 5);
    assert.equal(resultado.picoBloqueado, 3);
    assert.equal(resultado.disponiveisNoPeriodo, 7);

    // Se pedir 8 (1 acima da capacidade disponível no trecho de pico), deve invalidar:
    const resultadoEstouro = validarConflitoReserva({
      carrinho,
      quantidade: 8,
      inicio: "2026-11-03 11:30",
      fim: "2026-11-03 12:30",
      reservasExistentes,
      bloqueios,
      agora: "2026-11-01 08:00",
      usuarioRole: "professor",
    });
    assert.equal(resultadoEstouro.valida, false);
    assert.equal(resultadoEstouro.disponiveisNoPeriodo, 7);
  });

  // Ajuste 3B: Apenas objetos Date nativos
  it("Ajuste 3B: Deve processar corretamente quando todos os dados são objetos Date nativos locais", () => {
    const carrinho = criarCarrinho({ capacidade: 10 });

    const reservasExistentes = [
      criarReserva({
        quantidade: 4,
        data_retirada: new Date(2026, 10, 3, 10, 0, 0),
        data_devolucao: new Date(2026, 10, 3, 12, 0, 0),
      }),
      criarReserva({
        id: 102,
        quantidade: 3,
        data_retirada: new Date(2026, 10, 3, 11, 0, 0),
        data_devolucao: new Date(2026, 10, 3, 13, 0, 0),
      }),
    ];

    const resultado = validarConflitoReserva({
      carrinho,
      quantidade: 3,
      inicio: new Date(2026, 10, 3, 11, 30, 0),
      fim: new Date(2026, 10, 3, 12, 30, 0),
      reservasExistentes,
      bloqueios: [],
      agora: new Date(2026, 10, 1, 8, 0, 0),
    });

    assert.equal(resultado.valida, true);
    assert.equal(resultado.picoOcupado, 7);
    assert.equal(resultado.disponiveisNoPeriodo, 3);
  });

  // Ajuste 5: Confirmação de que bloqueios também são filtrados por carrinho_id
  it("Ajuste 5: Bloqueios pertencentes a outros carrinhos não devem afetar o carrinho atual", () => {
    const carrinho1 = criarCarrinho({ id: 1, capacidade: 10 });
    const bloqueios = [
      criarBloqueio({
        carrinho_id: 2, // Bloqueio do Carrinho 02!
        quantidade: 10,
        data_inicio: "2026-11-03T10:00:00.000Z",
        data_fim: "2026-11-03T12:00:00.000Z",
      }),
    ];

    const resultado = validarConflitoReserva({
      carrinho: carrinho1,
      quantidade: 10,
      inicio: "2026-11-03T10:00:00.000Z",
      fim: "2026-11-03T12:00:00.000Z",
      reservasExistentes: [],
      bloqueios,
      agora: AGORA,
    });

    assert.equal(resultado.valida, true);
    assert.equal(resultado.picoBloqueado, 0);
    assert.equal(resultado.disponiveisNoPeriodo, 10);
  });

  // Ajuste 6: Garantir que aparelhos indisponíveis são subtraídos apenas uma vez
  it("Ajuste 6: Aparelhos indisponíveis não devem ser subtraídos em dobro se carrinho já possuir campo disponiveis", () => {
    // Carrinho com capacidade 20 e 5 indisponiveis.
    // normalizarCarrinho já define disponiveis: 15.
    const carrinhoNormalizado = {
      id: 1,
      nome: "Carrinho 01",
      capacidade: 20,
      indisponiveis: 5,
      disponiveis: 15,
      ativo: 1,
    };

    const resultado = validarConflitoReserva({
      carrinho: carrinhoNormalizado,
      quantidade: 15,
      inicio: "2026-11-03T10:00:00.000Z",
      fim: "2026-11-03T12:00:00.000Z",
      reservasExistentes: [],
      bloqueios: [],
      agora: AGORA,
    });

    // Se subtraísse duas vezes, restaria 15 - 5 = 10 e falharia.
    assert.equal(resultado.valida, true);
    assert.equal(resultado.disponiveisNoPeriodo, 15);
  });

  // Teste de integridade de carrinho desativado
  it("Deve rejeitar reservas em carrinhos desativados", () => {
    const carrinhoInativo = criarCarrinho({ ativo: 0 });
    const resultado = validarConflitoReserva({
      carrinho: carrinhoInativo,
      quantidade: 5,
      inicio: "2026-11-03T10:00:00.000Z",
      fim: "2026-11-03T12:00:00.000Z",
      reservasExistentes: [],
      bloqueios: [],
      agora: AGORA,
    });

    assert.equal(resultado.valida, false);
    assert.match(resultado.motivo, /desativado para reservas/i);
  });

  // Ajuste do controller: SELECTs retornam linhas sem status nem carrinho_id
  it("Deve contabilizar reservas e bloqueios no formato exato dos SELECTs do controller (sem campos status e sem carrinho_id)", () => {
    const carrinho = {
      capacidade: 20,
      indisponiveis: 2,
      nome: "Carrinho Teste",
      ativo: 1,
      disponiveis: 18,
    };

    // SELECT quantidade, data_retirada, data_devolucao FROM reservas ...
    const reservasDoSelect = [
      {
        quantidade: 6,
        data_retirada: "2026-11-03 10:00:00",
        data_devolucao: "2026-11-03 12:00:00",
      },
    ];

    // SELECT quantidade, data_inicio, data_fim FROM carrinho_bloqueios ...
    const bloqueiosDoSelect = [
      {
        quantidade: 4,
        data_inicio: "2026-11-03 10:30:00",
        data_fim: "2026-11-03 11:30:00",
      },
    ];

    // Total base: 18.
    // Pico reservas: 6.
    // Pico bloqueios: 4.
    // Disponíveis no período: 18 - 6 - 4 = 8.
    const resultadoSucesso = validarConflitoReserva({
      carrinho,
      quantidade: 8,
      inicio: "2026-11-03 10:00",
      fim: "2026-11-03 12:00",
      reservasExistentes: reservasDoSelect,
      bloqueios: bloqueiosDoSelect,
      usuarioRole: "professor",
      agora: new Date("2026-11-01 10:00:00"),
    });

    assert.equal(resultadoSucesso.valida, true);
    assert.equal(resultadoSucesso.disponiveisNoPeriodo, 8);
    assert.equal(resultadoSucesso.picoOcupado, 6);
    assert.equal(resultadoSucesso.picoBloqueado, 4);

    const resultadoExcesso = validarConflitoReserva({
      carrinho,
      quantidade: 9,
      inicio: "2026-11-03 10:00",
      fim: "2026-11-03 12:00",
      reservasExistentes: reservasDoSelect,
      bloqueios: bloqueiosDoSelect,
      usuarioRole: "professor",
      agora: new Date("2026-11-01 10:00:00"),
    });

    assert.equal(resultadoExcesso.valida, false);
    assert.equal(resultadoExcesso.disponiveisNoPeriodo, 8);
    assert.match(resultadoExcesso.motivo, /so ha 8 disponiveis/i);
  });

  it("Não deve rejeitar carrinho quando campo ativo for ausente (undefined)", () => {
    const carrinhoSemAtivo = {
      capacidade: 15,
      indisponiveis: 0,
      nome: "Carrinho Sem Campo Ativo",
      // ativo ausente (undefined)
    };

    const resultado = validarConflitoReserva({
      carrinho: carrinhoSemAtivo,
      quantidade: 5,
      inicio: "2026-11-03 10:00",
      fim: "2026-11-03 12:00",
      reservasExistentes: [],
      bloqueios: [],
      usuarioRole: "professor",
      agora: new Date("2026-11-01 10:00:00"),
    });

    assert.equal(resultado.valida, true);
    assert.equal(resultado.disponiveisNoPeriodo, 15);
  });
});

describe("Serviço de Reservas - Simulação Pura de Atendimento da Fila de Espera", () => {
  const AGORA_TESTE = new Date("2026-11-01T10:00:00.000Z");

  it("Cenário 1: Cabe exato - item com quantidade igual aos disponíveis deve ser atendido", () => {
    const carrinho = { id: 1, capacidade: 10, indisponiveis: 0, ativo: 1, nome: "Carrinho 1" };
    const fila = [
      { id: 101, carrinho_id: 1, quantidade: 10, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00" },
    ];

    const atendidos = simularAtendimentoFila({
      carrinho,
      fila,
      reservasExistentes: [],
      bloqueiosExistentes: [],
      agora: AGORA_TESTE,
    });

    assert.equal(atendidos.length, 1);
    assert.equal(atendidos[0].id, 101);
  });

  it("Cenário 2: Não cabe - item com quantidade maior que disponíveis não deve ser atendido", () => {
    const carrinho = { id: 1, capacidade: 10, indisponiveis: 0, ativo: 1, nome: "Carrinho 1" };
    const fila = [
      { id: 102, carrinho_id: 1, quantidade: 11, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00" },
    ];

    const atendidos = simularAtendimentoFila({
      carrinho,
      fila,
      reservasExistentes: [],
      bloqueiosExistentes: [],
      agora: AGORA_TESTE,
    });

    assert.equal(atendidos.length, 0);
  });

  it("Cenário 3: O primeiro não cabe e o seguinte cabe - pula o primeiro e atende o segundo", () => {
    const carrinho = { id: 1, capacidade: 10, indisponiveis: 0, ativo: 1, nome: "Carrinho 1" };
    const fila = [
      { id: 103, carrinho_id: 1, quantidade: 15, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00" },
      { id: 104, carrinho_id: 1, quantidade: 5, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00" },
    ];

    const atendidos = simularAtendimentoFila({
      carrinho,
      fila,
      reservasExistentes: [],
      bloqueiosExistentes: [],
      agora: AGORA_TESTE,
    });

    assert.equal(atendidos.length, 1);
    assert.equal(atendidos[0].id, 104);
  });

  it("Cenário 4: Dois itens disputando a última vaga - o primeiro é atendido e o segundo não cabe", () => {
    const carrinho = { id: 1, capacidade: 10, indisponiveis: 0, ativo: 1, nome: "Carrinho 1" };
    const reservasExistentes = [
      { quantidade: 8, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00", status: "Ativa" },
    ];
    const fila = [
      { id: 105, carrinho_id: 1, quantidade: 2, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00" },
      { id: 106, carrinho_id: 1, quantidade: 2, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00" },
    ];

    const atendidos = simularAtendimentoFila({
      carrinho,
      fila,
      reservasExistentes,
      bloqueiosExistentes: [],
      agora: AGORA_TESTE,
    });

    assert.equal(atendidos.length, 1);
    assert.equal(atendidos[0].id, 105);
  });

  it("Cenário 5: Bloqueio parcial - reduz a capacidade disponível no período", () => {
    const carrinho = { id: 1, capacidade: 10, indisponiveis: 0, ativo: 1, nome: "Carrinho 1" };
    const bloqueiosExistentes = [
      { quantidade: 4, data_inicio: "2026-11-03 10:00:00", data_fim: "2026-11-03 12:00:00" },
    ];
    const fila = [
      { id: 107, carrinho_id: 1, quantidade: 7, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00" },
      { id: 108, carrinho_id: 1, quantidade: 6, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00" },
    ];

    const atendidos = simularAtendimentoFila({
      carrinho,
      fila,
      reservasExistentes: [],
      bloqueiosExistentes,
      agora: AGORA_TESTE,
    });

    assert.equal(atendidos.length, 1);
    assert.equal(atendidos[0].id, 108);
  });

  it("Cenário 6: Janelas de datas diferentes - atende ambos os pedidos em horários que não colidem", () => {
    const carrinho = { id: 1, capacidade: 10, indisponiveis: 0, ativo: 1, nome: "Carrinho 1" };
    const fila = [
      { id: 109, carrinho_id: 1, quantidade: 10, data_retirada: "2026-11-03 08:00:00", data_devolucao: "2026-11-03 10:00:00" },
      { id: 110, carrinho_id: 1, quantidade: 10, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00" },
    ];

    const atendidos = simularAtendimentoFila({
      carrinho,
      fila,
      reservasExistentes: [],
      bloqueiosExistentes: [],
      agora: AGORA_TESTE,
    });

    assert.equal(atendidos.length, 2);
    assert.equal(atendidos[0].id, 109);
    assert.equal(atendidos[1].id, 110);
  });

  it("Cenário 7: Fila vazia - deve retornar array vazio", () => {
    const carrinho = { id: 1, capacidade: 10, indisponiveis: 0, ativo: 1, nome: "Carrinho 1" };
    const atendidos = simularAtendimentoFila({
      carrinho,
      fila: [],
      agora: AGORA_TESTE,
    });

    assert.deepEqual(atendidos, []);
  });

  it("Cenário 8: Carrinho inativo (ativo = 0) - nenhum item deve ser atendido", () => {
    const carrinhoInativo = { id: 1, capacidade: 20, indisponiveis: 0, ativo: 0, nome: "Inativo" };
    const fila = [
      { id: 111, carrinho_id: 1, quantidade: 2, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00" },
    ];

    const atendidos = simularAtendimentoFila({
      carrinho: carrinhoInativo,
      fila,
      agora: AGORA_TESTE,
    });

    assert.deepEqual(atendidos, []);
  });

  it("Cenário 9: Item vencido (data_retirada no passado) - deve ser ignorado e não atendido", () => {
    const carrinho = { id: 1, capacidade: 10, indisponiveis: 0, ativo: 1, nome: "Carrinho 1" };
    const fila = [
      // Vencido em relação a AGORA_TESTE (2026-11-01)
      { id: 112, carrinho_id: 1, quantidade: 5, data_retirada: "2026-10-30 10:00:00", data_devolucao: "2026-10-30 12:00:00" },
      // Futuro válido
      { id: 113, carrinho_id: 1, quantidade: 5, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00" },
    ];

    const atendidos = simularAtendimentoFila({
      carrinho,
      fila,
      agora: AGORA_TESTE,
    });

    assert.equal(atendidos.length, 1);
    assert.equal(atendidos[0].id, 113);
  });

  it("Cenário 10: Aparelhos indisponíveis reduzem a capacidade do carrinho", () => {
    const carrinho = { id: 1, capacidade: 10, indisponiveis: 4, ativo: 1, nome: "Carrinho 1" }; // base disponível = 6
    const fila = [
      { id: 114, carrinho_id: 1, quantidade: 7, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00" },
      { id: 115, carrinho_id: 1, quantidade: 6, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00" },
    ];

    const atendidos = simularAtendimentoFila({
      carrinho,
      fila,
      agora: AGORA_TESTE,
    });

    assert.equal(atendidos.length, 1);
    assert.equal(atendidos[0].id, 115);
  });

  it("Cenário 11: Fim <= Início ou datas inválidas - item deve ser ignorado", () => {
    const carrinho = { id: 1, capacidade: 10, indisponiveis: 0, ativo: 1, nome: "Carrinho 1" };
    const fila = [
      { id: 116, carrinho_id: 1, quantidade: 5, data_retirada: "2026-11-03 12:00:00", data_devolucao: "2026-11-03 10:00:00" }, // fim antes do início
      { id: 117, carrinho_id: 1, quantidade: 5, data_retirada: "invalid-date", data_devolucao: "2026-11-03 12:00:00" },
      { id: 118, carrinho_id: 1, quantidade: 5, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00" }, // válido
    ];

    const atendidos = simularAtendimentoFila({
      carrinho,
      fila,
      agora: AGORA_TESTE,
    });

    assert.equal(atendidos.length, 1);
    assert.equal(atendidos[0].id, 118);
  });

  it("Cenário 12: Reserva com status 'Retirada' ocupa capacidade e impede atendimento excedente", () => {
    const carrinho = { id: 1, capacidade: 10, indisponiveis: 0, ativo: 1, nome: "Carrinho 1" };
    const reservasExistentes = [
      { quantidade: 8, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00", status: "Retirada" },
      { quantidade: 10, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00", status: "Cancelada" },
    ];
    const fila = [
      { id: 119, carrinho_id: 1, quantidade: 3, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00" },
      { id: 120, carrinho_id: 1, quantidade: 2, data_retirada: "2026-11-03 10:00:00", data_devolucao: "2026-11-03 12:00:00" },
    ];

    const atendidos = simularAtendimentoFila({
      carrinho,
      fila,
      reservasExistentes,
      agora: AGORA_TESTE,
    });

    assert.equal(atendidos.length, 1);
    assert.equal(atendidos[0].id, 120);
  });
});



