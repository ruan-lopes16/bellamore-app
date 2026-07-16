import { describe, expect, it } from 'vitest';
import {
  getFechamentoForMonth,
  resolveFinanceiroKpis,
} from '../../lib/financeiro/fechamentos-mensais';

describe('fechamentos financeiros mensais', () => {
  it('usa exatamente os quatro valores do fechamento historico', () => {
    const fechamento = getFechamentoForMonth([
      {
        mes: '2026-01-01',
        receita_bruta: 6491.08,
        comissao_paga: 2920.99,
      },
    ], '2026-01');

    expect(resolveFinanceiroKpis({
      receita: 999,
      comissoes: 888,
      gastos: 2448.19,
      taxasCartao: 666,
    }, fechamento)).toEqual({
      receita: 6491.08,
      comissoes: 2920.99,
      gastos: 2448.19,
      taxasCartao: 0,
      lucroReal: 1121.90,
    });
  });

  it('mantem o calculo normal quando o mes nao tem fechamento historico', () => {
    const kpis = resolveFinanceiroKpis({
      receita: 1000,
      comissoes: 200,
      gastos: 300,
      taxasCartao: 50,
    }, null);

    expect(kpis).toEqual({
      receita: 1000,
      comissoes: 200,
      gastos: 300,
      taxasCartao: 50,
      lucroReal: 450,
    });
  });
});
