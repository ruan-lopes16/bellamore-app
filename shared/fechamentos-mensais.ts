/**
 * @file fechamentos-mensais.ts
 * Leitura do fechamento mensal importado (financeiro_ajustes_mensais). A regra
 * de aplicação (substitui receita e comissão do mês INTEIRO e zera a taxa de
 * cartão) mora só em calcularKpisFinanceiros (@shared/kpis-financeiros).
 */
export type FinanceiroFechamentoRow = { mes: string; receita_bruta: number | null; comissao_paga: number | null };
export type FinanceiroFechamento = { receitaBruta: number; comissao: number };

export function getFechamentoForMonth(rows: FinanceiroFechamentoRow[], monthKey: string): FinanceiroFechamento | null {
  const row = rows.find(item => item.mes.slice(0, 7) === monthKey);
  if (!row) return null;
  return { receitaBruta: roundMoney(Number(row.receita_bruta ?? 0)), comissao: roundMoney(Number(row.comissao_paga ?? 0)) };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
