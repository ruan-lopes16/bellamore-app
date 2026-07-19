export type FinanceiroAjusteMensalRow = {
  mes: string;
  receita_bruta: number | null;
  comissao_paga: number | null;
};

export type FinanceiroAjusteMensal = {
  receitaBruta: number;
  comissaoPaga: number;
};

export type FinanceiroKpis = {
  receita: number;
  comissoes: number;
  gastos: number;
  taxasCartao: number;
};

export function getFinanceiroAjusteForMonth(
  rows: FinanceiroAjusteMensalRow[],
  monthKey: string,
): FinanceiroAjusteMensal {
  return rows
    .filter(row => row.mes.slice(0, 7) === monthKey)
    .reduce<FinanceiroAjusteMensal>((acc, row) => ({
      receitaBruta: roundMoney(acc.receitaBruta + Number(row.receita_bruta ?? 0)),
      comissaoPaga: roundMoney(acc.comissaoPaga + Number(row.comissao_paga ?? 0)),
    }), { receitaBruta: 0, comissaoPaga: 0 });
}

export function applyFinanceiroAjuste(
  kpis: FinanceiroKpis,
  ajuste: FinanceiroAjusteMensal,
): FinanceiroKpis {
  return {
    receita: roundMoney(kpis.receita + ajuste.receitaBruta),
    comissoes: roundMoney(kpis.comissoes + ajuste.comissaoPaga),
    gastos: kpis.gastos,
    taxasCartao: kpis.taxasCartao,
  };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
