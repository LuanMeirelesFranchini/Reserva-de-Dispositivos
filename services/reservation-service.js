/**
 * Converte um valor de data para timestamp (milissegundos).
 * Aceita Date, string ISO ('YYYY-MM-DDTHH:mm:ss.sssZ') ou string MySQL ('YYYY-MM-DD HH:mm:ss').
 *
 * @param {string|Date} value - O valor da data a ser convertida.
 * @returns {number} O timestamp correspondente.
 */
function toTimestamp(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    // Se for formato MySQL com espaço 'YYYY-MM-DD HH:mm:ss', normaliza para T
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      return new Date(trimmed.replace(" ", "T")).getTime();
    }
    return new Date(trimmed).getTime();
  }
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

  // Desempate de Sweep-line: no mesmo timestamp, eventos de saída (delta < 0)
  // são processados antes dos de entrada (delta > 0).
  // Isso garante que reservas adjacentes (fim == início) não conflitem.
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
  const disponiveisBase = carrinho.disponiveis !== undefined
    ? Number(carrinho.disponiveis)
    : Math.max((Number(carrinho.capacidade) || 0) - (Number(carrinho.indisponiveis) || 0), 0);
  return Math.max(disponiveisBase - picoDeUso, 0);
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
  const eventos = (bloqueiosAtivos || []).map((bloqueio) => ({
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
  const picoReservado = calcularPicoDeUso(reservasAtivas || [], inicio, fim);
  const picoBloqueado = calcularPicoBloqueado(bloqueiosAtivos || [], inicio, fim);
  const disponiveisBase = carrinho.disponiveis !== undefined
    ? Number(carrinho.disponiveis)
    : Math.max((Number(carrinho.capacidade) || 0) - (Number(carrinho.indisponiveis) || 0), 0);
  return Math.max(disponiveisBase - picoBloqueado - picoReservado, 0);
}

/**
 * Valida se uma solicitação de reserva é permitida segundo as regras de negócio
 * e calcula a capacidade remanescente disponível no período solicitado.
 *
 * Função pura: não realiza chamadas de banco nem de rede.
 *
 * @param {Object} params
 * @param {Object} params.carrinho - Objeto do carrinho { id, capacidade, indisponiveis, ativo, disponiveis? }
 * @param {number} params.quantidade - Quantidade de Chromebooks solicitada
 * @param {Date|string} params.inicio - Data e hora de início/retirada
 * @param {Date|string} params.fim - Data e hora de término/devolução
 * @param {Array<Object>} [params.reservasExistentes] - Lista de reservas existentes
 * @param {Array<Object>} [params.bloqueios] - Lista de bloqueios de manutenção programados
 * @param {string} [params.usuarioRole='professor'] - Perfil do usuário ('professor', 'admin', 'operacional')
 * @param {Date|string} [params.agora=new Date()] - Momento de referência para testes/tempo atual
 * @returns {{ valida: boolean, motivo?: string, capacidadeTotal: number, disponiveisNoPeriodo: number, picoOcupado: number, picoBloqueado: number }}
 */
function validarConflitoReserva({
  carrinho,
  quantidade,
  inicio,
  fim,
  reservasExistentes = [],
  bloqueios = [],
  usuarioRole = "professor",
  agora = new Date(),
}) {
  if (!carrinho) {
    return {
      valida: false,
      motivo: "Carrinho nao encontrado.",
      capacidadeTotal: 0,
      disponiveisNoPeriodo: 0,
      picoOcupado: 0,
      picoBloqueado: 0,
    };
  }

  const capacidade = Number.isInteger(carrinho.capacidade)
    ? carrinho.capacidade
    : parseInt(carrinho.capacidade, 10) || 0;
  const indisponiveis = Number.isInteger(carrinho.indisponiveis)
    ? carrinho.indisponiveis
    : parseInt(carrinho.indisponiveis, 10) || 0;

  // Garante que 'indisponiveis' não seja subtraído duas vezes caso carrinho.disponiveis já venha calculado
  const capacidadeDisponivelBase = carrinho.disponiveis !== undefined && carrinho.disponiveis !== null
    ? Number(carrinho.disponiveis)
    : Math.max(capacidade - indisponiveis, 0);

  // 1. Carrinho desativado
  if (carrinho.ativo === 0 || carrinho.ativo === false || carrinho.ativo === "0") {
    return {
      valida: false,
      motivo: "Este carrinho esta desativado para reservas.",
      capacidadeTotal: capacidade,
      disponiveisNoPeriodo: 0,
      picoOcupado: 0,
      picoBloqueado: 0,
    };
  }

  const inicioTs = toTimestamp(inicio);
  const fimTs = toTimestamp(fim);
  const agoraTs = toTimestamp(agora);

  // 2. Datas inválidas ou período inconsistente (fim <= inicio)
  if (isNaN(inicioTs) || isNaN(fimTs) || fimTs <= inicioTs) {
    return {
      valida: false,
      motivo: "Periodo invalido.",
      capacidadeTotal: capacidade,
      disponiveisNoPeriodo: 0,
      picoOcupado: 0,
      picoBloqueado: 0,
    };
  }

  // 3. Reserva no passado (aplica-se a todos, inclusive admin)
  if (inicioTs < agoraTs) {
    return {
      valida: false,
      motivo: "A data de retirada nao pode estar no passado.",
      capacidadeTotal: capacidade,
      disponiveisNoPeriodo: 0,
      picoOcupado: 0,
      picoBloqueado: 0,
    };
  }

  // 4. Regras de antecedência para perfis que não são admin
  if (usuarioRole !== "admin") {
    const minimoTs = agoraTs + 24 * 60 * 60 * 1000;
    const maximoTs = agoraTs + 30 * 24 * 60 * 60 * 1000;

    if (inicioTs < minimoTs) {
      return {
        valida: false,
        motivo: "As reservas devem ser feitas com pelo menos 24 horas de antecedencia.",
        capacidadeTotal: capacidade,
        disponiveisNoPeriodo: 0,
        picoOcupado: 0,
        picoBloqueado: 0,
      };
    }
    if (inicioTs > maximoTs || fimTs > maximoTs) {
      return {
        valida: false,
        motivo: "Maximo de 30 dias de antecedencia.",
        capacidadeTotal: capacidade,
        disponiveisNoPeriodo: 0,
        picoOcupado: 0,
        picoBloqueado: 0,
      };
    }
  }

  // 5. Filtragem de reservas pertencentes a este carrinho e com status que ocupa capacidade ('Ativa', 'Retirada')
  const carrinhoId = carrinho.id;
  const reservasValidas = (reservasExistentes || []).filter((r) => {
    // Se o item tiver carrinho_id e for diferente do carrinho atual, ignora
    if (carrinhoId !== undefined && r.carrinho_id !== undefined && Number(r.carrinho_id) !== Number(carrinhoId)) {
      return false;
    }
    // Apenas reservas 'Ativa' ou 'Retirada' ocupam capacidade ('Cancelada' e 'Concluida' não ocupam)
    if (r.status !== undefined && r.status !== null) {
      return r.status === "Ativa" || r.status === "Retirada";
    }
    return true;
  });

  // 6. Filtragem de bloqueios pertencentes a este carrinho
  const bloqueiosValidos = (bloqueios || []).filter((b) => {
    if (carrinhoId !== undefined && b.carrinho_id !== undefined && Number(b.carrinho_id) !== Number(carrinhoId)) {
      return false;
    }
    return true;
  });

  // 7. Cálculo de ocupação no trecho solicitado via Sweep-Line
  const picoOcupado = calcularPicoDeUso(reservasValidas, inicioTs, fimTs);
  const picoBloqueado = calcularPicoBloqueado(bloqueiosValidos, inicioTs, fimTs);
  const disponiveisNoPeriodo = Math.max(
    capacidadeDisponivelBase - picoBloqueado - picoOcupado,
    0,
  );

  const qtdPedida = Number(quantidade) || 0;
  if (!Number.isInteger(qtdPedida) || qtdPedida <= 0) {
    return {
      valida: false,
      motivo: "Quantidade invalida.",
      capacidadeTotal: capacidade,
      disponiveisNoPeriodo,
      picoOcupado,
      picoBloqueado,
    };
  }

  if (qtdPedida > disponiveisNoPeriodo) {
    return {
      valida: false,
      motivo: `Erro: so ha ${disponiveisNoPeriodo} disponiveis para esse periodo.`,
      capacidadeTotal: capacidade,
      disponiveisNoPeriodo,
      picoOcupado,
      picoBloqueado,
    };
  }

  return {
    valida: true,
    capacidadeTotal: capacidade,
    disponiveisNoPeriodo,
    picoOcupado,
    picoBloqueado,
  };
}

/**
 * Simula o atendimento de uma fila de espera de forma pura e determinística.
 * Para cada item da fila (na ordem recebida):
 * 1. Se carrinho estiver inativo (ativo === 0 ou false), nenhum item é atendido (retorna vazio imediatamente).
 * 2. Se o item estiver vencido (data_retirada <= agora), é ignorado/não atendido (continua para o próximo).
 * 3. Se as datas do item forem inválidas ou fim <= início, é ignorado/não atendido.
 * 4. Calcula a capacidade disponível no período considerando reservas existentes ('Ativa' e 'Retirada'),
 *    bloqueios existentes, e as novas reservas simuladas já confirmadas neste loop.
 * 5. Se item.quantidade <= disponiveisNoPeriodo:
 *    - O item é incluído na lista de atendidos.
 *    - Uma nova reserva simulada é somada ao conjunto de reservas ativas para o cálculo dos próximos itens.
 * 6. Se não couber: o item é pulado (não bloqueia os itens seguintes da fila).
 *
 * @param {Object} params
 * @param {Object} params.carrinho - { id, capacidade, indisponiveis, ativo, nome }
 * @param {Array<Object>} params.fila - Itens da fila ordenados por criado_em ASC, id ASC
 * @param {Array<Object>} [params.reservasExistentes=[]] - Reservas com status 'Ativa' ou 'Retirada'
 * @param {Array<Object>} [params.bloqueiosExistentes=[]] - Bloqueios do carrinho
 * @param {Date|string} [params.agora=new Date()] - Referência temporal para identificar itens vencidos
 * @returns {Array<Object>} Lista de itens da fila atendidos
 */
function simularAtendimentoFila({
  carrinho,
  fila = [],
  reservasExistentes = [],
  bloqueiosExistentes = [],
  agora = new Date(),
}) {
  if (!carrinho) return [];
  if (carrinho.ativo === 0 || carrinho.ativo === false) return [];
  if (!Array.isArray(fila) || fila.length === 0) return [];

  const capacidade = Number(carrinho.capacidade) || 0;
  const indisponiveis = Number(carrinho.indisponiveis) || 0;
  const baseDisponiveis = Math.max(capacidade - indisponiveis, 0);

  // Considera apenas reservas válidas com status 'Ativa' ou 'Retirada' (ou sem status especificado, default ativo)
  const reservasValidas = (reservasExistentes || []).filter((r) => {
    if (!r) return false;
    if (r.status) {
      return r.status === "Ativa" || r.status === "Retirada";
    }
    return true;
  });

  const bloqueiosValidos = (bloqueiosExistentes || []).filter(Boolean);
  const reservasSimuladas = [...reservasValidas];
  const atendidos = [];

  const refAgoraTs = toTimestamp(agora);

  for (const item of fila) {
    if (!item) continue;

    const inicioTs = toTimestamp(item.data_retirada);
    const fimTs = toTimestamp(item.data_devolucao);

    // Validação de datas: inválidas ou fim <= início
    if (isNaN(inicioTs) || isNaN(fimTs) || fimTs <= inicioTs) {
      continue;
    }

    // Item vencido (data_retirada <= agora)
    if (inicioTs <= refAgoraTs) {
      continue;
    }

    const quantidade = Number(item.quantidade) || 0;
    if (quantidade <= 0) continue;

    // Recalcula pico de uso incluindo reservas existentes e as já atendidas nesta simulação
    const picoDeUso = calcularPicoDeUso(
      reservasSimuladas,
      item.data_retirada,
      item.data_devolucao,
    );
    const picoBloqueado = calcularPicoBloqueado(
      bloqueiosValidos,
      item.data_retirada,
      item.data_devolucao,
    );
    const disponiveisNoPeriodo = Math.max(
      baseDisponiveis - picoBloqueado - picoDeUso,
      0,
    );

    if (quantidade <= disponiveisNoPeriodo) {
      atendidos.push(item);
      reservasSimuladas.push({
        quantidade,
        data_retirada: item.data_retirada,
        data_devolucao: item.data_devolucao,
        status: "Ativa",
      });
    }
  }

  return atendidos;
}

module.exports = {
  calcularDisponiveisNoPeriodo,
  calcularDisponiveisComBloqueios,
  calcularPicoBloqueado,
  calcularPicoDeUso,
  validarConflitoReserva,
  simularAtendimentoFila,
  toTimestamp,
};
