import { describe, expect, it } from 'vitest';
import {
  buildDespesaPagamentoUpdate,
  formatValorMonetarioInput,
  parseValorMonetario,
  recorrenciaAindaAtiva,
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

  it('considera recorrencia sem data de termino sempre ativa', () => {
    expect(recorrenciaAindaAtiva(null, '2026-08-01')).toBe(true);
    expect(recorrenciaAindaAtiva(undefined, '2026-08-01')).toBe(true);
  });

  it('considera ativa quando o termino cai no mes visualizado ou depois', () => {
    expect(recorrenciaAindaAtiva('2026-08-01', '2026-08-01')).toBe(true);
    expect(recorrenciaAindaAtiva('2026-08-15', '2026-08-01')).toBe(true);
    expect(recorrenciaAindaAtiva('2026-12-01', '2026-08-01')).toBe(true);
  });

  it('considera encerrada quando o termino ja passou antes do mes visualizado', () => {
    expect(recorrenciaAindaAtiva('2026-07-31', '2026-08-01')).toBe(false);
    expect(recorrenciaAindaAtiva('2026-01-01', '2026-08-01')).toBe(false);
  });
});
