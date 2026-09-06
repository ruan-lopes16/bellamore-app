/**
 * Helpers puros da Comanda (frente de caixa).
 *
 * Hoje cobre a persistencia do valor editado dos procedimentos: quando o
 * usuario troca, na comanda, o valor de um servico que veio de um
 * agendamento, esse valor precisa voltar para o proprio agendamento
 * (`agendamentos.valor` e, no caso multi-servico, cada
 * `agendamento_servicos.valor`) — senao some ao reabrir a comanda e a
 * comissao continua calculada sobre o preco antigo. Ver migration 075.
 */

/** Item da comanda, na forma minima necessaria para calcular a persistencia. */
export type ItemComandaValor = {
  tipo: string;
  agendamento_id?: string | null;
  /** id da linha em `agendamento_servicos` (so em agendamento multi-servico). */
  ag_servico_id?: string | null;
  valor: number;
  quantidade: number;
};

/** O que gravar de volta em um agendamento apos editar valores na comanda. */
export type PersistenciaValorAgendamento = {
  agendamentoId: string;
  /** Novo `agendamentos.valor` = soma das linhas daquele agendamento na comanda. */
  novoValorTotal: number;
  /** Linhas de `agendamento_servicos` cujo `valor` deve ser regravado. */
  linhasServico: { agServicoId: string; valor: number }[];
};

/**
 * Agrupa os itens de agendamento de uma comanda por `agendamento_id` e
 * calcula, para cada um, o novo valor total (soma das linhas presentes) e a
 * lista de linhas de `agendamento_servicos` a atualizar.
 *
 * - Itens extras (servico / produto / pacote avulsos) sao ignorados: eles
 *   vivem em `comanda_itens`, nao no agendamento.
 * - Agendamento legado de servico unico (sem `agendamento_servicos`) entra
 *   no resultado com `linhasServico` vazio — so o total do agendamento e
 *   regravado.
 * - Uma linha removida da comanda simplesmente nao entra na soma; o
 *   `agendamento_servicos` orfao mantem o valor antigo, mas o total do
 *   agendamento (e a comissao) refletem o que foi cobrado.
 */
export function agruparValoresPorAgendamento(
  itens: ItemComandaValor[],
): PersistenciaValorAgendamento[] {
  const porAgendamento = new Map<string, PersistenciaValorAgendamento>();

  for (const item of itens) {
    if (item.tipo !== 'agendamento') continue;
    if (!item.agendamento_id) continue;

    const quantidade = item.quantidade > 0 ? item.quantidade : 1;

    let grupo = porAgendamento.get(item.agendamento_id);
    if (!grupo) {
      grupo = {
        agendamentoId: item.agendamento_id,
        novoValorTotal: 0,
        linhasServico: [],
      };
      porAgendamento.set(item.agendamento_id, grupo);
    }

    grupo.novoValorTotal += item.valor * quantidade;
    if (item.ag_servico_id) {
      grupo.linhasServico.push({ agServicoId: item.ag_servico_id, valor: item.valor });
    }
  }

  for (const grupo of porAgendamento.values()) {
    grupo.novoValorTotal = Math.round(grupo.novoValorTotal * 100) / 100;
  }

  return [...porAgendamento.values()];
}
