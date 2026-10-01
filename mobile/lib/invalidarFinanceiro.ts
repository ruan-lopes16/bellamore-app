import type { QueryClient } from '@tanstack/react-query';

/**
 * Chaves de query (prefixos) que alimentam números financeiros e alertas
 * ligados a dinheiro no app. Qualquer ação que mexa em receita, despesa,
 * taxa, comissão ou no estado de fechamento de uma comanda deve invalidar todas:
 * assim Dashboard, Financeiro e Relatórios mostram o mesmo número.
 *
 * `fin-retiradas` fica de fora de propósito: só muda por ações da própria
 * tela de retiradas, que já a invalida.
 */
export const CHAVES_FINANCEIRO = [
  'fin-resumo',
  'fin-despesas',
  'fin-despesas-historico',
  'fin-taxas-reserva',
  'fin-taxas-cancelamento',
  'dash-financeiro',
  'agendamentos-hoje',
  'rel-dados',
  'rel-sumidos',
  'comissoes-pendentes',
  'comissoes-gestor',
  'comandas-nao-fechadas',
] as const;

/** Invalida (refaz a busca de) todas as consultas que alimentam números financeiros. */
export function invalidarFinanceiro(qc: QueryClient): void {
  for (const chave of CHAVES_FINANCEIRO) {
    qc.invalidateQueries({ queryKey: [chave] });
  }
}
