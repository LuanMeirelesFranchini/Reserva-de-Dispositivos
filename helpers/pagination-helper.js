/**
 * Helper para tratamento de busca e cálculo de paginação do lado do servidor.
 */

/**
 * Escapa caracteres especiais do operador LIKE no SQL (%, _, \)
 * para evitar injeção de curingas indesejados.
 *
 * @param {string} str - O termo de busca bruto.
 * @returns {string} O termo com caracteres especiais escapados por barra invertida.
 */
function escaparLike(str) {
  if (typeof str !== "string") return "";
  return str.replace(/([%_\\])/g, "\\$1");
}

/**
 * Calcula os parâmetros de paginação e gera a lista de páginas com reticências.
 *
 * @param {Object} options
 * @param {number} options.totalItems - Quantidade total de registros filtrados.
 * @param {number|string} [options.currentPage=1] - Página solicitada.
 * @param {number|string} [options.pageSize=20] - Itens por página (20, 50, 100).
 * @param {number} [options.delta=2] - Quantidade de páginas vizinhas exibidas ao redor da página atual.
 * @returns {Object} Dados completos de navegação e limites.
 */
function calcularPaginacao({ totalItems, currentPage, pageSize, delta = 2 }) {
  const total = Number.isInteger(Number(totalItems)) && Number(totalItems) >= 0 ? Number(totalItems) : 0;

  // Limites permitidos para pageSize
  let limit = parseInt(pageSize, 10);
  if (![20, 50, 100].includes(limit)) {
    limit = 20;
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  let page = parseInt(currentPage, 10);
  if (!Number.isInteger(page) || page < 1) {
    page = 1;
  } else if (page > totalPages) {
    page = totalPages;
  }

  const offset = (page - 1) * limit;
  const startIndex = total === 0 ? 0 : offset + 1;
  const endIndex = Math.min(offset + limit, total);

  // Geração de números de página com reticências (ex: [1, '...', 4, 5, 6, '...', 20])
  const pages = [];
  const rangeLeft = Math.max(2, page - delta);
  const rangeRight = Math.min(totalPages - 1, page + delta);

  pages.push(1);

  if (rangeLeft > 2) {
    pages.push("...");
  }

  for (let i = rangeLeft; i <= rangeRight; i++) {
    pages.push(i);
  }

  if (rangeRight < totalPages - 1) {
    pages.push("...");
  }

  if (totalPages > 1) {
    pages.push(totalPages);
  }

  return {
    totalItems: total,
    totalPages,
    currentPage: page,
    pageSize: limit,
    offset,
    startIndex,
    endIndex,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    prevPage: page > 1 ? page - 1 : null,
    nextPage: page < totalPages ? page + 1 : null,
    pages,
  };
}

module.exports = {
  escaparLike,
  calcularPaginacao,
};
