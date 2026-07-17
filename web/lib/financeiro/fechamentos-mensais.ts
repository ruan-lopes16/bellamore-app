export type FinanceiroFechamentoRow = {
  mes: string;
  receita_bruta: number | null;
  comissao_paga: number | null;
};

export type FinanceiroFechamento = {
  receitaBruta: number;
  comissao: number;
};

export type FinanceiroKpisBase = {
  receita: number;
  comissoes: number;
  gastos: number;
  taxasCartao: number;
};

export type FinanceiroKpisResolvidos = FinanceiroKpisBase & {
  lucroReal: number;
};

export function getFechamentoForMonth(
  rows: FinanceiroFechamentoRow[],
  monthKey: string,
): FinanceiroFechamento | null {
  const row = rows.find(item => item.mes.slice(0, 7) === monthKey);
  if (!row) return null;

  return {
    receitaBruta: roundMoney(Number(row.receita_bruta ?? 0)),
    comissao: roundMoney(Number(row.comissao_paga ?? 0)),
  };
}

export function resolveFinanceiroKpis(
  calculated: FinanceiroKpisBase,
  fechamento: FinanceiroFechamento | null,
): FinanceiroKpisResolvidos {
  const receita = fechamento?.receitaBruta ?? calculated.receita;
  const comissoes = fechamento?.comissao ?? calculated.comissoes;
  const gastos = roundMoney(calculated.gastos);
  const taxasCartao = fechamento ? 0 : calculated.taxasCartao;

  return {
    receita,
    comissoes,
    gastos,
    taxasCartao,
    lucroReal: roundMoney(receita - taxasCartao - comissoes - gastos),
  };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
