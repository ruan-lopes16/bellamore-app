// web/tests/unit/shared-dashboard-consultas.test.ts
import { describe, expect, it } from 'vitest';
import {
  carregarUltimasVisitas, aplicarFiltroComandasNaoFechadas, carregarComandasNaoFechadas,
  aplicarFiltroDespesasVencendo, carregarDespesasVencendo, carregarAniversariantes,
} from '@shared/dashboard-consultas';
import { fakeDb, opsDe, gravador } from './fixtures/fake-db';

describe('últimas visitas (reconquista e sumidas)', () => {
  it('paginado, mais recente primeiro, 1ª linha de cada cliente', async () => {
    const linhas = [
      { cliente_id: 'a', data_hora_inicio: '2026-09-10T12:00:00Z', cliente: { nome: 'Ana' } },
      { cliente_id: null, data_hora_inicio: '2026-09-09T12:00:00Z', cliente: null },
      { cliente_id: 'a', data_hora_inicio: '2026-08-10T12:00:00Z', cliente: { nome: 'Ana' } },
      { cliente_id: 'b', data_hora_inicio: '2026-07-10T12:00:00Z', cliente: null },
    ];
    const { db, chamadas } = fakeDb({ linhas: { agendamentos: linhas } });
    const m = await carregarUltimasVisitas(db, 'emp', '2026-10-01T02:59:59.999Z');
    expect([...m.entries()]).toEqual([
      ['a', { nome: 'Ana', ultimaVisita: '2026-09-10T12:00:00Z' }],
      ['b', { nome: 'Cliente', ultimaVisita: '2026-07-10T12:00:00Z' }],
    ]);
    const [ops] = opsDe(chamadas, 'agendamentos');
    expect(ops).toContainEqual(['eq', ['status', 'concluido']]);
    expect(ops).toContainEqual(['lte', ['data_hora_inicio', '2026-10-01T02:59:59.999Z']]);
    expect(ops).toContainEqual(['order', ['data_hora_inicio', { ascending: false }]]);
    expect(ops).toContainEqual(['order', ['id']]);
  });
  it('clientes arquivadas ficam fora', async () => {
    const linhas = [
      { cliente_id: 'a', data_hora_inicio: '2026-08-01T12:00:00Z', cliente: { nome: 'Ana', ativo: true } },
      { cliente_id: 'x', data_hora_inicio: '2026-08-02T12:00:00Z', cliente: { nome: 'Arq', ativo: false } },
    ];
    const { db } = fakeDb({ linhas: { agendamentos: linhas } });
    const m = await carregarUltimasVisitas(db, 'emp');
    expect([...m.keys()]).toEqual(['a']);
  });
  it('sem limite final e com erro', async () => {
    const { db, chamadas } = fakeDb();
    await carregarUltimasVisitas(db, 'emp');
    expect(opsDe(chamadas, 'agendamentos')[0].some(([m]) => m === 'lte')).toBe(false);
    await expect(carregarUltimasVisitas(fakeDb({ erroEm: 'agendamentos' }).db, 'emp')).rejects.toThrow();
  });
});

describe('filtros únicos (Dashboard e badges do Sidebar)', () => {
  it('comandas não fechadas', () => {
    const { b, ops } = gravador();
    aplicarFiltroComandasNaoFechadas(b, 'emp', '2026-09-30T15:00:00.000Z');
    expect(ops).toEqual([
      ['eq', ['empresa_id', 'emp']], ['is', ['comanda_id', null]],
      ['not', ['status', 'in', '("cancelado","faltou")']], ['lt', ['data_hora_fim', '2026-09-30T15:00:00.000Z']],
    ]);
  });
  it('despesas vencendo em 7 dias', () => {
    const { b, ops } = gravador();
    aplicarFiltroDespesasVencendo(b, 'emp', '2026-09-30');
    expect(ops).toEqual([
      ['eq', ['empresa_id', 'emp']], ['eq', ['status', 'pendente']],
      ['gte', ['data_vencimento', '2026-09-30']], ['lte', ['data_vencimento', '2026-10-07']],
    ]);
  });
  it('consultas paginadas com ordem estável', async () => {
    const { db, chamadas } = fakeDb();
    await carregarComandasNaoFechadas(db, 'emp', 'agora');
    await carregarDespesasVencendo(db, 'emp', '2026-09-30');
    await carregarAniversariantes(db, 'emp');
    expect(opsDe(chamadas, 'agendamentos')[0]).toContainEqual(['order', ['data_hora_inicio', { ascending: true }]]);
    expect(opsDe(chamadas, 'despesas')[0]).toContainEqual(['order', ['data_vencimento']]);
    const cli = opsDe(chamadas, 'clientes')[0];
    expect(cli).toContainEqual(['eq', ['ativo', true]]);
    expect(cli).toContainEqual(['not', ['data_nascimento', 'is', null]]);
    for (const t of ['agendamentos', 'despesas', 'clientes']) expect(opsDe(chamadas, t)[0]).toContainEqual(['order', ['id']]);
  });
});
