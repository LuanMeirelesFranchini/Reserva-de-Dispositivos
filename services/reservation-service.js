function toTimestamp(value) {
  return new Date(value).getTime();
}

function calcularPicoDeUso(reservasAtivas, inicioReserva, fimReserva) {
  const inicio = toTimestamp(inicioReserva);
  const fim = toTimestamp(fimReserva);
  const eventos = [];

  for (const reserva of reservasAtivas) {
    const inicioSobreposto = Math.max(toTimestamp(reserva.data_retirada), inicio);
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

function calcularDisponiveisNoPeriodo(carrinho, reservasAtivas, inicio, fim) {
  const picoDeUso = calcularPicoDeUso(reservasAtivas, inicio, fim);
  return Math.max(carrinho.disponiveis - picoDeUso, 0);
}

module.exports = {
  calcularDisponiveisNoPeriodo,
  calcularPicoDeUso,
};
