import { describe, expect, it } from 'vitest';
import { getFechamentoForMonth } from '@shared/fechamentos-mensais';

describe('getFechamentoForMonth', () => {
  it('lê receita e comissão do mês pedido', () => {
    expect(getFechamentoForMonth([{ mes: '2026-01-01', receita_bruta: 6491.08, comissao_paga: 2920.99 }], '2026-01'))
      .toEqual({ receitaBruta: 6491.08, comissao: 2920.99 });
  });
  it('null vira zero', () => {
    expect(getFechamentoForMonth([{ mes: '2026-05-01', receita_bruta: null, comissao_paga: null }], '2026-05'))
      .toEqual({ receitaBruta: 0, comissao: 0 });
  });
  it('mês sem fechamento → null', () => {
    expect(getFechamentoForMonth([{ mes: '2026-05-01', receita_bruta: 1, comissao_paga: 1 }], '2026-06')).toBeNull();
  });
});
