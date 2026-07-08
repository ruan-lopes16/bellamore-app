import { describe, expect, it } from 'vitest';
import {
  buildDespesaPagamentoUpdate,
  formatValorMonetarioInput,
  parseValorMonetario,
} from '@shared/despesas';

describe('despesas helpers', () => {
  it('converte valores monetarios com virgula, ponto e prefixo de moeda', () => {
    expect(parseValorMonetario('125,90')).toBe(125.9);
    expect(parseValorMonetario('125.90')).toBe(125.9);
    expect(parseValorMonetario('1.250')).toBe(1250);
    expect(parseValorMonetario('R$ 1.250,90')).toBe(1250.9);
  });

  it('rejeita valores vazios, zerados ou invalidos', () => {
    expect(parseValorMonetario('')).toBeNull();
    expect(parseValorMonetario('0')).toBeNull();
    expect(parseValorMonetario('abc')).toBeNull();
  });

  it('monta payload de pagamento com valor editado apenas para o lancamento mensal', () => {
    expect(buildDespesaPagamentoUpdate('2026-07-08', '980,50')).toEqual({
      status: 'pago',
      data_pagamento: '2026-07-08',
      valor: 980.5,
    });
  });

  it('formata valor numerico para input monetario editavel', () => {
    expect(formatValorMonetarioInput(980.5)).toBe('980,50');
  });
});
