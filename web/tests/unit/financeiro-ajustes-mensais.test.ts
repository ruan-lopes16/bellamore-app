import { describe, expect, it } from 'vitest';
import {
  applyFinanceiroAjuste,
  getFinanceiroAjusteForMonth,
} from '@/lib/financeiro/ajustes-mensais';

describe('ajustes financeiros mensais', () => {
  it('soma receita e comissao historicas sem alterar gastos nem taxas', () => {
    const ajuste = getFinanceiroAjusteForMonth([
      { mes: '2026-01-01', receita_bruta: 6491.08, comissao_paga: 2920.99 },
      { mes: '2026-02-01', receita_bruta: 7353.04, comissao_paga: 3308.87 },
    ], '2026-01');

    expect(ajuste).toEqual({ receitaBruta: 6491.08, comissaoPaga: 2920.99 });
    expect(applyFinanceiroAjuste({
      receita: 0,
      comissoes: 0,
      gastos: 2448.19,
      taxasCartao: 0,
    }, ajuste)).toEqual({
      receita: 6491.08,
      comissoes: 2920.99,
      gastos: 2448.19,
      taxasCartao: 0,
    });
  });

  it('combina ajuste historico com valores reais existentes no mes', () => {
    const ajuste = getFinanceiroAjusteForMonth([
      { mes: '2026-03-01', receita_bruta: 9402.1, comissao_paga: 4230.95 },
      { mes: '2026-03-15', receita_bruta: 10, comissao_paga: 5 },
    ], '2026-03');

    expect(ajuste).toEqual({ receitaBruta: 9412.1, comissaoPaga: 4235.95 });
    expect(applyFinanceiroAjuste({
      receita: 100,
      comissoes: 45,
      gastos: 1708.24,
      taxasCartao: 0,
    }, ajuste)).toEqual({
      receita: 9512.1,
      comissoes: 4280.95,
      gastos: 1708.24,
      taxasCartao: 0,
    });
  });
});
