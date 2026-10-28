/**
 * Valida se um usuário pode ser rebaixado de papel ou desativado sem violar
 * a regra de existência de pelo menos um administrador ativo no sistema.
 *
 * Função pura: não realiza chamadas de banco nem de rede.
 *
 * @param {Object} params
 * @param {'rebaixar'|'desativar'} params.acao - Ação a ser executada ('rebaixar' ou 'desativar')
 * @param {string} params.roleAtual - Papel atual do usuário alvo ('admin', 'operacional', 'professor')
 * @param {string} [params.novoRole] - Novo papel em caso de alteração de papel ('rebaixar')
 * @param {number} params.outrosAdminsAtivos - Quantidade de outros administradores ativos no sistema (excluindo o usuário alvo)
 * @returns {{ permitido: boolean, motivo?: string }}
 */
function podeAlterarOuDesativarAdmin({
  acao,
  roleAtual,
  novoRole,
  outrosAdminsAtivos = 0,
}) {
  // Se o usuário não é admin, a operação não reduz o total de administradores
  if (roleAtual !== "admin") {
    return { permitido: true };
  }

  // Se a ação for rebaixar, mas o novo papel continuar sendo admin, não há redução
  if (acao === "rebaixar" && novoRole === "admin") {
    return { permitido: true };
  }

  // Se for rebaixar ou desativar admin, verifica se restam outros admins ativos
  const restantes = Number(outrosAdminsAtivos) || 0;
  if (restantes <= 0) {
    const verbo = acao === "rebaixar" ? "rebaixar" : "desativar";
    return {
      permitido: false,
      motivo: `Nao e possivel ${verbo} o unico administrador ativo do sistema.`,
    };
  }

  return { permitido: true };
}

/**
 * Regras:
 * 1. Se quem cancelou é o próprio dono da reserva (ehDono === true), NÃO envia e-mail (retorna false).
 * 2. Se for cancelada por terceiro (ehDono === false):
 *    - Se a reserva for estritamente futura (dataRetirada > agora), ENVIA e-mail (retorna true).
 *    - Se a reserva já iniciou ou é passada (dataRetirada <= agora), NÃO envia e-mail (retorna false).
 * 3. Se dataRetirada for inválida ou nula, retorna false.
 *
 * @param {Object} params
 * @param {boolean} params.ehDono - Se o usuário logado é o dono da reserva
 * @param {Date|string} params.dataRetirada - Data de retirada prevista da reserva
 * @param {Date|string} [params.agora=new Date()] - Referência temporal
 * @returns {boolean}
 */
function deveEnviarEmailCancelamento({
  ehDono,
  dataRetirada,
  agora = new Date(),
}) {
  if (ehDono) return false;
  if (!dataRetirada) return false;

  let retirada = dataRetirada;
  if (typeof retirada === "string") {
    retirada = new Date(retirada.trim().replace(" ", "T"));
  } else if (!(retirada instanceof Date)) {
    retirada = new Date(retirada);
  }

  let refAgora = agora;
  if (typeof refAgora === "string") {
    refAgora = new Date(refAgora.trim().replace(" ", "T"));
  } else if (!(refAgora instanceof Date)) {
    refAgora = new Date(refAgora);
  }

  if (isNaN(retirada.getTime()) || isNaN(refAgora.getTime())) return false;

  return retirada.getTime() > refAgora.getTime();
}

/**
 * Determina com segurança o destino de redirecionamento após o cancelamento de uma reserva.
 *
 * Regras:
 * - Se o usuário gerencia reservas (admin ou operacional):
 *   - Padrão é "/admin".
 *   - Aceita voltarPara se for exatamente "/admin", iniciar com "/admin?" ou "/admin/", ou for "/minhas-reservas".
 *   - Qualquer outro destino cai no padrão "/admin".
 * - Se o usuário NÃO gerencia reservas (ex: professor):
 *   - Padrão é "/minhas-reservas".
 *   - Nunca é redirecionado para "/admin..." nem destinos externos.
 *
 * @param {Object} params
 * @param {string} [params.voltarPara] - URL ou caminho solicitado para retorno
 * @param {string} params.usuarioRole - Papel do usuário logado ('admin', 'operacional', 'professor')
 * @returns {string} URL segura para redirecionamento
 */
function sanitizarDestinoCancelamento({ voltarPara, usuarioRole }) {
  const podeGerenciar = usuarioRole === "admin" || usuarioRole === "operacional";
  const solicitado = typeof voltarPara === "string" ? voltarPara.trim() : "";

  if (podeGerenciar) {
    if (
      solicitado === "/admin" ||
      solicitado.startsWith("/admin?") ||
      solicitado.startsWith("/admin/")
    ) {
      return solicitado;
    }
    if (solicitado === "/minhas-reservas") {
      return "/minhas-reservas";
    }
    return "/admin";
  }

  // Usuário comum (ex: professor) nunca acessa /admin
  if (solicitado === "/minhas-reservas") {
    return "/minhas-reservas";
  }
  return "/minhas-reservas";
}

module.exports = {
  podeAlterarOuDesativarAdmin,
  deveEnviarEmailCancelamento,
  sanitizarDestinoCancelamento,
};

