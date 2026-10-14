import { describe, expect, it } from 'vitest';
import {
  rotuloContrato, normalizarComissao, normalizarTipoContrato, emailValido, montarPatchVinculo,
  vinculoParaGravar, estatisticasDoMes,
} from '@shared/equipe';

describe('normalizações', () => {
  it('comissão: undefined não veio; número/texto 0–100; fora disso inválida', () => {
    expect(normalizarComissao(undefined)).toBeUndefined();
    expect(normalizarComissao(45)).toBe(45);
    expect(normalizarComissao('45,5')).toBe(45.5);
    expect(normalizarComissao('')).toBe(0);
    expect(normalizarComissao(null)).toBeUndefined();
    expect(normalizarComissao('  ')).toBe(0);
    expect(normalizarComissao('45.5')).toBe(45.5);
    expect(normalizarComissao('1e1')).toBeNull();
    expect(normalizarComissao(NaN)).toBeNull();
    expect(normalizarComissao(101)).toBeNull();
    expect(normalizarComissao(-1)).toBeNull();
    expect(normalizarComissao('abc')).toBeNull();
  });
  it('tipo de contrato: pj/clt; null ou vazio = sem contrato; outro = inválido', () => {
    expect(normalizarTipoContrato(undefined)).toBeUndefined();
    expect(normalizarTipoContrato('pj')).toBe('pj');
    expect(normalizarTipoContrato('clt')).toBe('clt');
    expect(normalizarTipoContrato(null)).toBeNull();
    expect(normalizarTipoContrato('')).toBeNull();
    expect(normalizarTipoContrato('mei')).toBe('invalido');
  });
  it('rótulo e e-mail', () => {
    expect(rotuloContrato('pj')).toBe('PJ / Comissionada');
    expect(rotuloContrato('clt')).toBe('CLT');
    expect(rotuloContrato(null)).toBe('');
    expect(emailValido(' ana@x.com ')).toBe(true);
    expect(emailValido('ana@x')).toBe(false);
  });
});

describe('montarPatchVinculo', () => {
  it('só o que veio', () => {
    expect(montarPatchVinculo({})).toEqual({ patch: {} });
    expect(montarPatchVinculo({ percentual_comissao: 50 })).toEqual({ patch: { percentual_comissao: 50 } });
    expect(montarPatchVinculo({ tipo_contrato: null })).toEqual({ patch: { tipo_contrato: null } });
  });
  it('erros', () => {
    expect(montarPatchVinculo({ percentual_comissao: 150 })).toEqual({ erro: 'A comissão deve ficar entre 0 e 100%.' });
    expect(montarPatchVinculo({ tipo_contrato: 'x' })).toEqual({ erro: 'Tipo de contrato inválido.' });
  });
});

describe('vinculoParaGravar', () => {
  it('vínculo novo: comissão e contrato que vieram, senão 0 e sem contrato', () => {
    expect(vinculoParaGravar(null, { percentual_comissao: 40, tipo_contrato: 'clt' }))
      .toEqual({ valores: { percentual_comissao: 40, tipo_contrato: 'clt' } });
    expect(vinculoParaGravar(null, {})).toEqual({ valores: { percentual_comissao: 0, tipo_contrato: null } });
  });
  it('vínculo existente: nunca zera o que não veio (bug do convite)', () => {
    const existente = { percentual_comissao: 70, tipo_contrato: 'pj' as const };
    expect(vinculoParaGravar(existente, {})).toEqual({ valores: { percentual_comissao: 70, tipo_contrato: 'pj' } });
    expect(vinculoParaGravar(existente, { percentual_comissao: 55 })).toEqual({ valores: { percentual_comissao: 55, tipo_contrato: 'pj' } });
    expect(vinculoParaGravar(existente, { tipo_contrato: null })).toEqual({ valores: { percentual_comissao: 70, tipo_contrato: null } });
  });
  it('erro de validação', () => {
    expect(vinculoParaGravar(null, { percentual_comissao: 'x' })).toEqual({ erro: 'A comissão deve ficar entre 0 e 100%.' });
  });
});

describe('estatisticasDoMes (decisão 1)', () => {
  it('valor não numérico conta 0, nunca NaN', () => {
    expect(estatisticasDoMes([{ profissional_id: 'a', valor: 'x', pacote_cliente_id: null }, { profissional_id: 'a', valor: 5, pacote_cliente_id: null }], {}))
      .toEqual({ a: { total: 5, atendimentos: 2 } });
  });
  it('faturado sem sessões de pacote + extras; atendimentos contam todos', () => {
    const r = estatisticasDoMes([
      { profissional_id: 'a', valor: 100, pacote_cliente_id: null },
      { profissional_id: 'a', valor: '50.5', pacote_cliente_id: null },
      { profissional_id: 'a', valor: 0, pacote_cliente_id: 'pc1' },
      { profissional_id: 'b', valor: 80, pacote_cliente_id: 'pc2' },
      { profissional_id: null, valor: 10, pacote_cliente_id: null },
    ], { a: 20, c: 30 });
    expect(r).toEqual({
      a: { total: 170.5, atendimentos: 3 },
      b: { total: 0, atendimentos: 1 },
      c: { total: 30, atendimentos: 0 },
    });
  });
});
