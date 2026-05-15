/**
 * Converte um valor de data para timestamp (milissegundos).
 *
 * @param {string|Date} value - O valor da data a ser convertida.
 * @returns {number} O timestamp correspondente.
 */
function toTimestamp(value) {
  return new Date(value).getTime();
}

/**
 * Calcula o pico máximo de uso de dispositivos durante um determinado período
 * utilizando o algoritmo de Sweep-line (Eventos).
 *
 * @param {Array<Object>} reservasAtivas - Lista de reservas ativas.
 * @param {Date|string} inicioReserva - Data de início do período.
 * @param {Date|string} fimReserva - Data final do período.
 * @returns {number} O pico de uso calculado.
 */
function calcularPicoDeUso(reservasAtivas, inicioReserva, fimReserva) {
  const inicio = toTimestamp(inicioReserva);
  const fim = toTimestamp(fimReserva);
  const eventos = [];

  for (const reserva of reservasAtivas) {
    const inicioSobreposto = Math.max(
      toTimestamp(reserva.data_retirada),
      inicio,
    );
    const fimSobreposto = Math.min(toTimestamp(reserva.data_devolucao), fim);

    if (inicioSobreposto >= fimSobreposto) {
      continue;
    }

    const quantidade = Number(reserva.quantidade) || 0;
    eventos.push({ tempo: inicioSobreposto, delta: quantidade });
    eventos.push({ tempo: fimSobreposto, delta: -quantidade });
  }

  eventos.sort((a, b) =>
    a.tempo !== b.tempo ? a.tempo - b.tempo : a.delta - b.delta,
  );

  let usoAtual = 0;
  let picoDeUso = 0;

  for (const evento of eventos) {
    usoAtual += evento.delta;
    if (usoAtual > picoDeUso) {
      picoDeUso = usoAtual;
    }
  }

  return picoDeUso;
}

/**
 * Calcula a quantidade de dispositivos disponíveis em um carrinho.
 *
 * @param {Object} carrinho - Objeto do carrinho contendo a propriedade `disponiveis`.
 * @param {Array<Object>} reservasAtivas - Lista de reservas ativas.
 * @param {Date|string} inicio - Data e hora de retirada.
 * @param {Date|string} fim - Data e hora de devolução.
 * @returns {number} Quantidade disponível (mínimo 0).
 */
function calcularDisponiveisNoPeriodo(carrinho, reservasAtivas, inicio, fim) {
  const picoDeUso = calcularPicoDeUso(reservasAtivas, inicio, fim);
  return Math.max(carrinho.disponiveis - picoDeUso, 0);
}

/**
 * Calcula o pico de indisponibilidade programada durante um periodo.
 *
 * @param {Array<Object>} bloqueiosAtivos - Lista de bloqueios programados.
 * @param {Date|string} inicioPeriodo - Inicio do periodo.
 * @param {Date|string} fimPeriodo - Fim do periodo.
 * @returns {number} Quantidade maxima bloqueada no periodo.
 */
function calcularPicoBloqueado(bloqueiosAtivos, inicioPeriodo, fimPeriodo) {
  const eventos = bloqueiosAtivos.map((bloqueio) => ({
    quantidade: Number(bloqueio.quantidade) || 0,
    data_retirada: bloqueio.data_inicio,
    data_devolucao: bloqueio.data_fim,
  }));

  return calcularPicoDeUso(eventos, inicioPeriodo, fimPeriodo);
}

/**
 * Calcula a disponibilidade considerando indisponibilidades permanentes e agendadas.
 *
 * @param {Object} carrinho - Carrinho normalizado.
 * @param {Array<Object>} reservasAtivas - Reservas sobrepostas ao periodo.
 * @param {Array<Object>} bloqueiosAtivos - Bloqueios programados sobrepostos ao periodo.
 * @param {Date|string} inicio - Inicio do periodo.
 * @param {Date|string} fim - Fim do periodo.
 * @returns {number} Quantidade disponivel no periodo.
 */
function calcularDisponiveisComBloqueios(
  carrinho,
  reservasAtivas,
  bloqueiosAtivos,
  inicio,
  fim,
) {
  const picoReservado = calcularPicoDeUso(reservasAtivas, inicio, fim);
  const picoBloqueado = calcularPicoBloqueado(bloqueiosAtivos, inicio, fim);
  return Math.max(carrinho.disponiveis - picoBloqueado - picoReservado, 0);
}

module.exports = {
  calcularDisponiveisNoPeriodo,
  calcularDisponiveisComBloqueios,
  calcularPicoBloqueado,
  calcularPicoDeUso,
};
