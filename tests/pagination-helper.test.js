const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { escaparLike, calcularPaginacao } = require("../helpers/pagination-helper");

describe("Helper de Paginação e Busca", () => {
  describe("escaparLike", () => {
    it("Deve escapar %, _ e \\ com barra invertida", () => {
      assert.equal(escaparLike("100%"), "100\\%");
      assert.equal(escaparLike("prof_ana"), "prof\\_ana");
      assert.equal(escaparLike("c:\\path"), "c:\\\\path");
      assert.equal(escaparLike("normal"), "normal");
    });

    it("Deve retornar string vazia para tipos inválidos", () => {
      assert.equal(escaparLike(null), "");
      assert.equal(escaparLike(undefined), "");
      assert.equal(escaparLike(123), "");
    });
  });

  describe("calcularPaginacao", () => {
    it("Deve calcular corretamente quando há 0 registros", () => {
      const p = calcularPaginacao({ totalItems: 0, currentPage: 1, pageSize: 20 });
      assert.equal(p.totalItems, 0);
      assert.equal(p.totalPages, 1);
      assert.equal(p.currentPage, 1);
      assert.equal(p.offset, 0);
      assert.equal(p.startIndex, 0);
      assert.equal(p.endIndex, 0);
      assert.equal(p.hasPrev, false);
      assert.equal(p.hasNext, false);
      assert.deepEqual(p.pages, [1]);
    });

    it("Deve calcular corretamente para limite padrão de 20 registros por página", () => {
      const p = calcularPaginacao({ totalItems: 45, currentPage: 1, pageSize: 20 });
      assert.equal(p.totalItems, 45);
      assert.equal(p.totalPages, 3);
      assert.equal(p.currentPage, 1);
      assert.equal(p.offset, 0);
      assert.equal(p.startIndex, 1);
      assert.equal(p.endIndex, 20);
      assert.equal(p.hasPrev, false);
      assert.equal(p.hasNext, true);
      assert.deepEqual(p.pages, [1, 2, 3]);
    });

    it("Deve ajustar página fora do intervalo inferior (página <= 0 vira 1)", () => {
      const p = calcularPaginacao({ totalItems: 60, currentPage: -5, pageSize: 20 });
      assert.equal(p.currentPage, 1);
      assert.equal(p.offset, 0);
    });

    it("Deve ajustar página fora do intervalo superior (página > totalPages vira totalPages)", () => {
      const p = calcularPaginacao({ totalItems: 60, currentPage: 99, pageSize: 20 });
      assert.equal(p.currentPage, 3);
      assert.equal(p.offset, 40);
    });

    it("Deve validar tamanhos de página permitidos (20, 50, 100) e usar 20 como fallback", () => {
      const p50 = calcularPaginacao({ totalItems: 120, currentPage: 1, pageSize: 50 });
      assert.equal(p50.pageSize, 50);
      assert.equal(p50.totalPages, 3);

      const p100 = calcularPaginacao({ totalItems: 250, currentPage: 1, pageSize: 100 });
      assert.equal(p100.pageSize, 100);
      assert.equal(p100.totalPages, 3);

      const pInvalido = calcularPaginacao({ totalItems: 100, currentPage: 1, pageSize: 15 });
      assert.equal(pInvalido.pageSize, 20); // fallback para 20
    });

    it("Deve gerar reticências no final quando estiver no início de muitas páginas", () => {
      const p = calcularPaginacao({ totalItems: 200, currentPage: 1, pageSize: 20 });
      // 10 páginas no total. Na página 1: [1, 2, 3, '...', 10]
      assert.equal(p.totalPages, 10);
      assert.deepEqual(p.pages, [1, 2, 3, "...", 10]);
    });

    it("Deve gerar reticências no início e no final quando estiver no meio", () => {
      const p = calcularPaginacao({ totalItems: 400, currentPage: 10, pageSize: 20 });
      // 20 páginas. Na página 10: [1, '...', 8, 9, 10, 11, 12, '...', 20]
      assert.equal(p.totalPages, 20);
      assert.deepEqual(p.pages, [1, "...", 8, 9, 10, 11, 12, "...", 20]);
    });

    it("Deve gerar reticências no início quando estiver nas últimas páginas", () => {
      const p = calcularPaginacao({ totalItems: 200, currentPage: 10, pageSize: 20 });
      // 10 páginas. Na página 10: [1, '...', 8, 9, 10]
      assert.equal(p.totalPages, 10);
      assert.deepEqual(p.pages, [1, "...", 8, 9, 10]);
    });
  });
});
