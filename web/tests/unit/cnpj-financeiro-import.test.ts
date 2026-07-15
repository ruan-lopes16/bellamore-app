import { describe, expect, it } from 'vitest';
import {
  buildCnpjDespesaDuplicateKey,
  parseCnpjFinanceiroRowsBySheet,
} from '@/lib/import/cnpj-financeiro';

describe('importacao CNPJ ANA para Financeiro', () => {
  it('importa despesas operacionais e pro-labore de Jan-Mai como despesas pagas', () => {
    const preview = parseCnpjFinanceiroRowsBySheet({
      '01-Jan': [
        ['CNPJ - RUAN', null, null, null, null, null, null, null, null, 'CNPJ - ANA'],
        ['RECEITAS', null, null, null, null, 'DESPESAS OPERACIONAIS', null, null, null, 'RECEITAS', null, null, null, null, 'DESPESAS OPERACIONAIS'],
        ['TIPO', 'DESCRICAO', 'VALOR (R$)', 'STATUS', null, 'CATEGORIA', 'DESCRICAO', 'VALOR (R$)', null, 'TIPO', 'DESCRICAO', 'VALOR (R$)', 'STATUS', null, 'CATEGORIA', 'DESCRICAO', 'VALOR (R$)'],
        [null, null, null, null, null, 'DAS/Imposto', 'MEI Ruan ignorado', 10, null, 'Faturamento Semanal', 'Lamooni', 945.72, 'PAGO', null, 'DAS/Imposto', 'MEI', 80.9],
        [null, null, null, null, null, null, null, null, null, 'Faturamento Semanal', 'Semana', 1000, 'PAGO', null, 'Marketing', 'Maria', 1000],
        ['TOTAL RECEITAS', null, 0, null, null, 'TOTAL DESPESAS OP.', null, 10, null, 'TOTAL RECEITAS', null, 1945.72, null, null, 'TOTAL DESPESAS OP.', null, 1080.9],
        ['PRO-LABORE  (45% do faturamento bruto)', null, null, null, null, null, null, 0, null, 'PRO-LABORE  (45% do faturamento bruto)', null, null, null, null, null, null, 875.574],
      ],
      '02-Fev': [
        ['CNPJ - ANA'],
        ['RECEITAS', null, null, null, null, 'DESPESAS OPERACIONAIS'],
        ['TIPO', 'DESCRICAO', 'VALOR (R$)', 'STATUS', null, 'CATEGORIA', 'DESCRICAO', 'VALOR (R$)', null, 'TIPO', 'DESCRICAO', 'VALOR (R$)', 'STATUS', null, 'CATEGORIA', 'DESCRICAO', 'VALOR (R$)'],
        [null, null, null, null, null, null, null, null, null, 'Faturamento Semanal', 'Semana', 500, 'PAGO', null, 'Aluguel', null, 969.56],
        ['PRO-LABORE', null, null, null, null, null, null, null, null, 'PRO-LABORE  (45% do faturamento bruto)', null, null, null, null, null, null, 225],
      ],
      '06-Jun': [
        ['CNPJ - ANA'],
        ['RECEITAS', null, null, null, null, 'DESPESAS OPERACIONAIS'],
        ['TIPO', 'DESCRICAO', 'VALOR (R$)', 'STATUS', null, 'CATEGORIA', 'DESCRICAO', 'VALOR (R$)', null, 'TIPO', 'DESCRICAO', 'VALOR (R$)', 'STATUS', null, 'CATEGORIA', 'DESCRICAO', 'VALOR (R$)'],
        [null, null, null, null, null, null, null, null, null, 'Faturamento Semanal', 'Semana', 500, 'PAGO', null, 'Energia', 'Junho ignorado', 123],
      ],
    });

    expect(preview.items).toEqual([
      expect.objectContaining({
        sheetName: '01-Jan',
        descricao: 'MEI',
        categoria: 'DAS/Imposto',
        valor: 80.9,
        data_pagamento: '2026-01-01',
        data_vencimento: '2026-01-01',
        status: 'pago',
        recorrente: false,
      }),
      expect.objectContaining({
        sheetName: '01-Jan',
        descricao: 'Maria',
        categoria: 'Marketing',
        valor: 1000,
      }),
      expect.objectContaining({
        sheetName: '01-Jan',
        descricao: 'Comissao - Janeiro/2026',
        categoria: 'Comissao',
        valor: 875.57,
      }),
      expect.objectContaining({
        sheetName: '02-Fev',
        descricao: 'Aluguel',
        categoria: 'Aluguel',
        valor: 969.56,
        data_pagamento: '2026-02-01',
      }),
      expect.objectContaining({
        sheetName: '02-Fev',
        descricao: 'Comissao - Fevereiro/2026',
        categoria: 'Comissao',
        valor: 225,
      }),
    ]);
    expect(preview.items).toHaveLength(5);
    expect(preview.summary.total).toBe(3151.03);
    expect(preview.summary.byCategory.Comissao.total).toBe(1100.57);
    expect(preview.summary.byMonth['2026-01'].count).toBe(3);
    expect(preview.summary.byMonth['2026-02'].total).toBe(1194.56);
  });

  it('gera chave de duplicidade com campos que serao gravados', () => {
    const preview = parseCnpjFinanceiroRowsBySheet({
      '05-Mai': [
        ['CNPJ - ANA'],
        ['RECEITAS', null, null, null, null, 'DESPESAS OPERACIONAIS'],
        ['TIPO', 'DESCRICAO', 'VALOR (R$)', 'STATUS', null, 'CATEGORIA', 'DESCRICAO', 'VALOR (R$)', null, 'TIPO', 'DESCRICAO', 'VALOR (R$)', 'STATUS', null, 'CATEGORIA', 'DESCRICAO', 'VALOR (R$)'],
        [null, null, null, null, null, null, null, null, null, 'Faturamento Semanal', 'Semana', 500, 'PAGO', null, 'Outros', 'app agenda cartao credito', 10.9],
      ],
    });

    expect(buildCnpjDespesaDuplicateKey(preview.items[0])).toBe(
      'app agenda cartao credito|Outros|10.90|2026-05-01|pago',
    );
  });
});
