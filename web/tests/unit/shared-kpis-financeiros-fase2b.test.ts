import { describe, expect, it } from 'vitest';
import { limitesMes } from '@shared/periodos';
import {
  calcularKpisFinanceiros, recortarDados, resumoMetodosPagamento, arredondar, DADOS_VAZIOS,
} from '@shared/kpis-financeiros';
import { fixtureSetembro } from './fixtures/kpis-setembro-2026';

const SET = limitesMes('2026-09');

describe('lucro e líquido = conta das partes exibidas (consistência de 1 centavo)', () => {
  it('meio centavo não some no lucro', () => {
    const k = calcularKpisFinanceiros({
      ...DADOS_VAZIOS,
      vendas: [{ id: 'v', valor_final: 0.006, created_at: '2026-09-10T12:00:00Z' }],
      pagamentos: [{ id: 'g', metodo: 'credito', valor: 0.006, valor_liquido: 0.002, created_at: '2026-09-10T12:00:00Z' }],
      despesas: [{ id: 'd', valor: 0.004, categoria: null, status: 'pago', data_pagamento: '2026-09-10' }],
    }, SET);
    expect([k.bruto, k.taxasCartao, k.despesas]).toEqual([0.01, 0, 0]);
    expect(k.liquidoAposTaxas).toBe(0.01);
    expect(k.lucro).toBe(0.01);
  });
  it('invariante na fixture', () => {
    const k = calcularKpisFinanceiros(fixtureSetembro(), SET);
    expect(k.lucro).toBe(arredondar(k.bruto - k.taxasCartao - k.comissoes - k.despesas));
    expect(k.liquidoAposTaxas).toBe(arredondar(k.bruto - k.taxasCartao));
  });
});

describe('casos que a 2A deixou sem teste', () => {
  it('mês fechado: comissões do fechamento, pendentes continuam ao vivo', () => {
    const k = calcularKpisFinanceiros(
      { ...fixtureSetembro(), fechamentos: [{ mes: '2026-09-01', receita_bruta: 9000, comissao_paga: 999 }] }, SET);
    expect(k.comissoes).toBe(999);
    expect(k.comissoesPendentes).toBe(80);
    expect(k.taxasCartao).toBe(0);
    expect(k.mesesComFechamento).toEqual(['2026-09']);
  });
  it('valor_liquido em string conta na taxa de cartão', () => {
    const k = calcularKpisFinanceiros({ ...DADOS_VAZIOS, pagamentos: [
      { id: 'g', metodo: 'credito', valor: '200.00', valor_liquido: '194.00', created_at: '2026-09-10T13:30:00Z' },
    ] }, SET);
    expect(k.taxasCartao).toBe(6);
  });
  it('pagamento de 01/10 00:00 BRT fica fora de setembro (cartão e formas de pagamento)', () => {
    const dados = { ...DADOS_VAZIOS, pagamentos: [
      { id: 'g1', metodo: 'credito', valor: 100, valor_liquido: 97, created_at: '2026-09-15T12:00:00Z' },
      { id: 'g2', metodo: 'debito', valor: 50, valor_liquido: 49, created_at: '2026-10-01T03:00:00Z' },
    ] };
    expect(calcularKpisFinanceiros(dados, SET).taxasCartao).toBe(3);
    expect(resumoMetodosPagamento(recortarDados(dados, SET).pagamentos).map(m => m.metodo)).toEqual(['credito']);
  });
});
