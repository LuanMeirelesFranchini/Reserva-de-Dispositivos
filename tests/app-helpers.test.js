process.env.TZ = "America/Sao_Paulo";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { toMySQLDateTime, estaEmAtraso } = require("../helpers/app-helpers");

describe("Helpers - toMySQLDateTime", () => {
  it("Deve formatar objeto Date local para 'YYYY-MM-DD HH:mm:ss'", () => {
    // 2026-10-20 17:41:09 local
    const data = new Date(2026, 9, 20, 17, 41, 9);
    const resultado = toMySQLDateTime(data);
    assert.equal(resultado, "2026-10-20 17:41:09");
  });

  it("Deve formatar Date no limite da virada de ano/mês com zero à esquerda", () => {
    // 2026-01-05 08:04:02 local
    const data = new Date(2026, 0, 5, 8, 4, 2);
    const resultado = toMySQLDateTime(data);
    assert.equal(resultado, "2026-01-05 08:04:02");
  });

  it("Deve converter string ISO com 'Z' (UTC) para o fuso local 'America/Sao_Paulo'", () => {
    // 17:41:09 UTC no fuso America/Sao_Paulo (UTC-3) corresponde a 14:41:09
    const isoUtc = "2026-10-20T17:41:09.000Z";
    const resultado = toMySQLDateTime(isoUtc);
    assert.equal(resultado, "2026-10-20 14:41:09");
  });


  it("Deve processar string no formato Flatpickr ('YYYY-MM-DD HH:mm')", () => {
    const flatpickr = "2026-10-20 17:41";
    const resultado = toMySQLDateTime(flatpickr);
    assert.equal(resultado, "2026-10-20 17:41");
  });

  it("Deve processar string que já está em formato MySQL ('YYYY-MM-DD HH:mm:ss')", () => {
    const mysqlStr = "2026-10-20 17:41:09";
    const resultado = toMySQLDateTime(mysqlStr);
    assert.equal(resultado, "2026-10-20 17:41:09");
  });

  it("Deve retornar null para valores nulos, vazios ou Date inválido", () => {
    assert.equal(toMySQLDateTime(null), null);
    assert.equal(toMySQLDateTime(undefined), null);
    assert.equal(toMySQLDateTime(""), null);
    assert.equal(toMySQLDateTime(new Date("data-invalida")), null);
  });
});

describe("Helpers - estaEmAtraso", () => {
  const agora = new Date(2026, 9, 21, 15, 0, 0); // 2026-10-21 15:00:00

  it("Deve retornar true se status for 'Ativa' e data_devolucao estritamente anterior a agora", () => {
    const reserva = { status: "Ativa", data_devolucao: "2026-10-21 14:59:59" };
    assert.equal(estaEmAtraso(reserva, agora), true);
  });

  it("Deve retornar true se status for 'Retirada' e data_devolucao estritamente anterior a agora", () => {
    const reserva = { status: "Retirada", data_devolucao: new Date(2026, 9, 21, 14, 0, 0) };
    assert.equal(estaEmAtraso(reserva, agora), true);
  });

  it("LIMITE EXATO: Deve retornar false se data_devolucao for exatamente igual a agora (não é atraso)", () => {
    // Com string no formato MySQL
    const reservaStr = { status: "Ativa", data_devolucao: "2026-10-21 15:00:00" };
    assert.equal(estaEmAtraso(reservaStr, agora), false);

    // Com objeto Date
    const reservaDate = { status: "Ativa", data_devolucao: new Date(2026, 9, 21, 15, 0, 0) };
    assert.equal(estaEmAtraso(reservaDate, agora), false);

    // Com status Retirada no limite exato
    const retiradaDate = { status: "Retirada", data_devolucao: new Date(2026, 9, 21, 15, 0, 0) };
    assert.equal(estaEmAtraso(retiradaDate, agora), false);
  });

  it("Deve retornar false se data_devolucao for posterior a agora (futura/em dia)", () => {
    const reserva = { status: "Ativa", data_devolucao: "2026-10-21 15:00:01" };
    assert.equal(estaEmAtraso(reserva, agora), false);

    const reservaFutura = { status: "Ativa", data_devolucao: new Date(2026, 9, 21, 16, 0, 0) };
    assert.equal(estaEmAtraso(reservaFutura, agora), false);
  });

  it("Deve retornar false se status for 'Concluida' ou 'Cancelada' mesmo com data no passado", () => {
    const concluida = { status: "Concluida", data_devolucao: "2026-10-20 10:00:00" };
    assert.equal(estaEmAtraso(concluida, agora), false);

    const cancelada = { status: "Cancelada", data_devolucao: "2026-10-20 10:00:00" };
    assert.equal(estaEmAtraso(cancelada, agora), false);
  });

  it("Deve retornar false para entradas nulas, vazias ou inválidas", () => {
    assert.equal(estaEmAtraso(null, agora), false);
    assert.equal(estaEmAtraso({}, agora), false);
    assert.equal(estaEmAtraso({ status: "Ativa" }, agora), false);
    assert.equal(estaEmAtraso({ data_devolucao: "2026-10-20" }, agora), false);
    assert.equal(estaEmAtraso({ status: "Ativa", data_devolucao: "data-invalida" }, agora), false);
  });
});
