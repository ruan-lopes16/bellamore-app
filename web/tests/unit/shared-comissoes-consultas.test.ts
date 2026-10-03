import { describe, expect, it } from 'vitest';
import { limitesMes } from '@shared/periodos';
import { carregarComissoesDoPeriodo, pagarComissoes, COLUNAS_COMISSAO_DETALHE } from '@shared/comissoes-consultas';
import { carregarComissoesPendentes } from '@shared/kpis-financeiros-consultas';
import { fakeDb, opsDe } from './fixtures/fake-db';

const SET = limitesMes('2026-09');

describe('carregarComissoesDoPeriodo', () => {
  it('created_at em Brasília, ordem estável, colunas únicas', async () => {
    const { db, chamadas } = fakeDb();
    await carregarComissoesDoPeriodo(db, 'emp', SET);
    const [ops] = opsDe(chamadas, 'comissoes');
    expect(ops).toContainEqual(['select', [COLUNAS_COMISSAO_DETALHE]]);
    expect(ops).toContainEqual(['eq', ['empresa_id', 'emp']]);
    expect(ops).toContainEqual(['gte', ['created_at', SET.startIso]]);
    expect(ops).toContainEqual(['lte', ['created_at', SET.endIso]]);
    expect(ops).toContainEqual(['order', ['id']]);
    expect(ops.some(([m, a]) => m === 'eq' && a[0] === 'profissional_id')).toBe(false);
  });
  it('profissional: filtra pelo próprio id', async () => {
    const { db, chamadas } = fakeDb();
    await carregarComissoesDoPeriodo(db, 'emp', SET, { profissionalId: 'p1' });
    expect(opsDe(chamadas, 'comissoes')[0]).toContainEqual(['eq', ['profissional_id', 'p1']]);
  });
  it('pagina e lança erro', async () => {
    const { db } = fakeDb({ linhas: { comissoes: Array.from({ length: 1500 }, (_, i) => ({ id: `k${i}` })) } });
    expect(await carregarComissoesDoPeriodo(db, 'emp', SET)).toHaveLength(1500);
    await expect(carregarComissoesDoPeriodo(fakeDb({ erroEm: 'comissoes' }).db, 'emp', SET)).rejects.toThrow('falha em comissoes');
  });
});

describe('pagarComissoes — só pendentes, da empresa, conferindo as linhas', () => {
  it('filtros e .select(id)', async () => {
    const { db, chamadas } = fakeDb();
    const r = await pagarComissoes(db, 'emp', ['a', 'a', 'b']);
    const [ops] = opsDe(chamadas, 'comissoes');
    expect(ops).toContainEqual(['update', [{ status: 'pago' }]]);
    expect(ops).toContainEqual(['in', ['id', ['a', 'b']]]);
    expect(ops).toContainEqual(['eq', ['empresa_id', 'emp']]);
    expect(ops).toContainEqual(['eq', ['status', 'pendente']]);
    expect(ops).toContainEqual(['select', ['id']]);
    expect(r).toEqual({ confirmados: ['a', 'b'], naoConfirmados: [], erro: null });
  });
  it('lotes de 150 ids', async () => {
    const { db, chamadas } = fakeDb();
    await pagarComissoes(db, 'emp', Array.from({ length: 320 }, (_, i) => `k${i}`));
    expect(opsDe(chamadas, 'comissoes').map(ops => (ops.find(([m]) => m === 'in')![1][1] as string[]).length)).toEqual([150, 150, 20]);
  });
  it('RLS devolve menos linhas → naoConfirmados', async () => {
    const { db } = fakeDb({ respostaUpdate: (_t, ids) => ({ data: ids.slice(1).map(id => ({ id })), error: null }) });
    expect(await pagarComissoes(db, 'emp', ['a', 'b'])).toEqual({ confirmados: ['b'], naoConfirmados: ['a'], erro: null });
  });
  it('erro no 2º lote: para, devolve o que confirmou e a mensagem', async () => {
    const { db } = fakeDb({ respostaUpdate: (_t, ids, lote) => lote === 1
      ? { data: null, error: { message: 'falhou' } } : { data: ids.map(id => ({ id })), error: null } });
    const r = await pagarComissoes(db, 'emp', Array.from({ length: 200 }, (_, i) => `k${i}`));
    expect(r.confirmados).toHaveLength(150);
    expect(r.naoConfirmados).toHaveLength(50);
    expect(r.erro).toBe('falhou');
  });
  it('sem ids, não consulta', async () => {
    const { db, chamadas } = fakeDb();
    expect(await pagarComissoes(db, 'emp', [])).toEqual({ confirmados: [], naoConfirmados: [], erro: null });
    expect(chamadas).toHaveLength(0);
  });
});

describe('carregarComissoesPendentes traz profissional e data (Equipe)', () => {
  it('colunas', async () => {
    const { db, chamadas } = fakeDb();
    await carregarComissoesPendentes(db, 'emp');
    expect(opsDe(chamadas, 'comissoes')[0]).toContainEqual(['select', ['id, profissional_id, valor_comissao, created_at']]);
  });
});
