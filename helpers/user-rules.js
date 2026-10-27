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

module.exports = {
  podeAlterarOuDesativarAdmin,
};
