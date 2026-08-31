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

export type ValoresPorMes = {
  receita: Record<string, number>;      // chave 'yyyy-MM' -> receita ao vivo (servicos + vendas + taxas)
  comissoes: Record<string, number>;    // chave 'yyyy-MM' -> comissoes geradas ao vivo
  taxasCartao: Record<string, number>;  // chave 'yyyy-MM' -> taxa de cartao (valor - valor_liquido)
};

/**
 * Soma faturamento bruto, comissoes e taxa de cartao de um periodo que pode
 * abranger varios meses, aplicando os fechamentos historicos importados
 * (financeiro_ajustes_mensais) mes a mes — mesma regra de resolveFinanceiroKpis
 * ja usada no Financeiro. Para cada mes de `mesesChave`: se existe um fechamento
 * importado, ele substitui por inteiro receita + comissoes daquele mes (e zera a
 * taxa de cartao, que nao faz parte do numero importado); senao, usa os valores
 * ao vivo em `porMes`.
 *
 * Sem isso, Relatorios e Dashboard mostram receita zerada em meses cobertos so
 * por importacao (sem agendamento/venda por tras), enquanto as despesas desses
 * meses continuam contando — distorcendo o "Lucro real".
 */
export function somarPeriodoComFechamentos(
  porMes: ValoresPorMes,
  fechamentos: FinanceiroFechamentoRow[],
  mesesChave: string[],
): { bruto: number; comTot: number; taxasCartao: number } {
  let bruto = 0;
  let comTot = 0;
  let taxasCartao = 0;

  for (const chave of mesesChave) {
    const kpis = resolveFinanceiroKpis(
      {
        receita: porMes.receita[chave] ?? 0,
        comissoes: porMes.comissoes[chave] ?? 0,
        gastos: 0,
        taxasCartao: porMes.taxasCartao[chave] ?? 0,
      },
      getFechamentoForMonth(fechamentos, chave),
    );
    bruto += kpis.receita;
    comTot += kpis.comissoes;
    taxasCartao += kpis.taxasCartao;
  }

  return {
    bruto: roundMoney(bruto),
    comTot: roundMoney(comTot),
    taxasCartao: roundMoney(taxasCartao),
  };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
