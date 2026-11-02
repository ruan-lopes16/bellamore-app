import { describe, expect, it } from 'vitest';
import { fakeDb, opsDe, type Op } from './fixtures/fake-db';
import {
  carregarAvisos, carregarDadosAlertas, contarAvisosNaoLidos, marcarLidas, marcarTodasLidas,
  TAMANHO_PAGINA_AVISOS,
} from '@shared/notificacoes-consultas';
import type { Acesso } from '@shared/permissoes';

const E = 'emp-1';
const U = 'user-1';
const aviso = (n: number, lida = false) => ({ id: `n${n}`, tipo: 'agendamento', titulo: `T${n}`, mensagem: null, lida, created_at: '2026-10-28T12:00:00Z' });
const tem = (ops: Op[], m: string, ...args: unknown[]) => ops.some(([x, a]) => x === m && JSON.stringify(a) === JSON.stringify(args));

describe('carregarAvisos', () => {
  it('filtra por empresa e pessoa, mais recentes primeiro, página de 50 (+1 para saber se há mais)', async () => {
    const { db, chamadas } = fakeDb({ linhas: { notificacoes: Array.from({ length: 51 }, (_, i) => aviso(i)) } });
    const r = await carregarAvisos(db, E, U);
    expect(TAMANHO_PAGINA_AVISOS).toBe(50);
    expect(r.avisos).toHaveLength(50);
    expect(r.temMais).toBe(true);
    const [ops] = opsDe(chamadas, 'notificacoes');
    expect(tem(ops, 'eq', 'empresa_id', E)).toBe(true);
    expect(tem(ops, 'eq', 'user_id', U)).toBe(true);
    expect(tem(ops, 'eq', 'lida', false)).toBe(false);
    expect(tem(ops, 'order', 'created_at', { ascending: false })).toBe(true);
    expect(tem(ops, 'range', 0, 50)).toBe(true);
  });

  it('"Não lidas" e página seguinte', async () => {
    const { db, chamadas } = fakeDb({ linhas: { notificacoes: [aviso(1)] } });
    const r = await carregarAvisos(db, E, U, { soNaoLidas: true, pagina: 2 });
    expect(r).toEqual({ avisos: [], temMais: false });
    const [ops] = opsDe(chamadas, 'notificacoes');
    expect(tem(ops, 'eq', 'lida', false)).toBe(true);
    expect(tem(ops, 'range', 100, 150)).toBe(true);
  });

  it('lida nula vira false; erro lança', async () => {
    const { db } = fakeDb({ linhas: { notificacoes: [{ ...aviso(1), lida: null }] } });
    expect((await carregarAvisos(db, E, U)).avisos[0].lida).toBe(false);
    const falha = fakeDb({ erroTabelasCodigo: { notificacoes: { code: '57014', message: 'timeout' } } });
    await expect(carregarAvisos(falha.db, E, U)).rejects.toThrow('O banco demorou demais');
  });
});

describe('contarAvisosNaoLidos', () => {
  function stub(resp: { count: number | null; error: { code?: string; message: string } | null }) {
    const ops: Op[] = [];
    const b: Record<string, unknown> = new Proxy({}, {
      get(_a, prop) {
        if (prop === 'then') return (ok: (v: unknown) => unknown) => ok(resp);
        return (...args: unknown[]) => { ops.push([String(prop), args]); return b; };
      },
    });
    return { db: { from: (t: string) => { ops.push(['from', [t]]); return b; } }, ops };
  }
  it('conta só as não lidas da pessoa na empresa', async () => {
    const { db, ops } = stub({ count: 7, error: null });
    expect(await contarAvisosNaoLidos(db, E, U)).toBe(7);
    expect(tem(ops, 'select', 'id', { count: 'exact', head: true })).toBe(true);
    expect(tem(ops, 'eq', 'empresa_id', E) && tem(ops, 'eq', 'user_id', U) && tem(ops, 'eq', 'lida', false)).toBe(true);
  });
  it('erro lança', async () => {
    await expect(contarAvisosNaoLidos(stub({ count: null, error: { message: 'falhou' } }).db, E, U)).rejects.toThrow();
  });
});

describe('marcarLidas', () => {
  it('update lida=true com .select(\'id\') e devolve o que o banco confirmou', async () => {
    const { db, chamadas } = fakeDb({ respostaUpdate: (_t, ids) => ({ data: ids.filter(i => i !== 'b').map(id => ({ id })), error: null }) });
    expect(await marcarLidas(db, ['a', 'b', 'a', 'c'])).toEqual({ confirmados: ['a', 'c'], naoConfirmados: ['b'] });
    const [ops] = opsDe(chamadas, 'notificacoes');
    expect(ops).toEqual([['update', [{ lida: true }]], ['in', ['id', ['a', 'b', 'c']]], ['select', ['id']]]);
  });

  it('lotes de 100; lista vazia não consulta', async () => {
    const { db, chamadas } = fakeDb();
    await marcarLidas(db, Array.from({ length: 230 }, (_, i) => `x${i}`));
    expect(opsDe(chamadas, 'notificacoes')).toHaveLength(3);
    const vazio = fakeDb();
    expect(await marcarLidas(vazio.db, [])).toEqual({ confirmados: [], naoConfirmados: [] });
    expect(vazio.chamadas).toEqual([]);
  });

  it('erro do banco (trigger da 097) lança em português', async () => {
    const { db } = fakeDb({ respostaUpdate: () => ({ data: null, error: { code: '42501', message: 'Você só pode marcar a notificação como lida.' } }) });
    await expect(marcarLidas(db, ['a'])).rejects.toThrow('Você só pode marcar a notificação como lida.');
  });
});

describe('marcarTodasLidas', () => {
  it('todas as não lidas da pessoa na empresa, com .select(\'id\')', async () => {
    const { db, chamadas } = fakeDb({ respostaUpdate: () => ({ data: [{ id: 'a' }, { id: 'b' }], error: null }) });
    expect(await marcarTodasLidas(db, E, U)).toBe(2);
    expect(opsDe(chamadas, 'notificacoes')[0]).toEqual([
      ['update', [{ lida: true }]], ['eq', ['empresa_id', E]], ['eq', ['user_id', U]], ['eq', ['lida', false]], ['select', ['id']],
    ]);
  });
});

describe('carregarDadosAlertas', () => {
  const AGORA = new Date('2026-10-28T23:30:00Z'); // 20:30 em Brasília, ainda dia 28
  const todas = (): boolean => true;
  const nenhuma = (a: Acesso): boolean => !['agenda.ver_equipe', 'comissoes.ver_todas', 'agenda.gerenciar_outras', 'estoque.acessar', 'financeiro.ver', 'comanda.fechar'].includes(a);

  it('com todas as permissões busca tudo da empresa, com o dia de Brasília', async () => {
    const { db, chamadas } = fakeDb({ linhas: {
      v_produtos_estoque_baixo: [{ id: 'p1', nome: 'Óleo', estoque_atual: '0', estoque_minimo: '2', unidade: 'un' }],
      comissoes: [{ id: 'c1', valor_comissao: '12.5', profissional_id: 'x', profissional: { nome: 'Ana' } }],
    } });
    const d = await carregarDadosAlertas(db, E, { userId: U, pode: todas }, AGORA);
    expect(d.hoje).toBe('2026-10-28');
    expect(d.estoqueBaixo).toEqual([{ id: 'p1', nome: 'Óleo', estoque_atual: 0, estoque_minimo: 2, unidade: 'un' }]);
    expect(d.comissoesPendentes[0].valor_comissao).toBe(12.5);
    expect(d.despesasVencendo).toEqual([]);
    expect(d.comandasNaoFechadas).toEqual([]);
    expect(d.soPropriaAgenda).toBe(false);
    expect(d.soPropriasComissoes).toBe(false);

    const [agHoje, comandas] = opsDe(chamadas, 'agendamentos');
    expect(tem(agHoje, 'lte', 'data_hora_inicio', '2026-10-29T02:59:59.999Z')).toBe(true);
    expect(tem(agHoje, 'gte', 'data_hora_fim', AGORA.toISOString())).toBe(true);
    expect(agHoje.some(([m, a]) => m === 'eq' && a[0] === 'profissional_id')).toBe(false);
    expect(tem(comandas, 'is', 'comanda_id', null)).toBe(true);
    expect(comandas.some(([m, a]) => m === 'eq' && a[0] === 'profissional_id')).toBe(false);
    const [desp] = opsDe(chamadas, 'despesas');
    expect(tem(desp, 'gte', 'data_vencimento', '2026-10-28') && tem(desp, 'lte', 'data_vencimento', '2026-11-04')).toBe(true);
    expect(opsDe(chamadas, 'comissoes')[0].some(([m, a]) => m === 'eq' && a[0] === 'profissional_id')).toBe(false);
    expect(opsDe(chamadas, 'clientes')).toHaveLength(1);
  });

  it('sem as permissões: não consulta estoque, despesas e comandas; agenda e comissões só as próprias', async () => {
    const { db, chamadas } = fakeDb();
    const d = await carregarDadosAlertas(db, E, { userId: U, pode: nenhuma }, AGORA);
    expect(d.estoqueBaixo).toBeNull();
    expect(d.despesasVencendo).toBeNull();
    expect(d.comandasNaoFechadas).toBeNull();
    expect(d.soPropriaAgenda && d.soPropriasComissoes).toBe(true);
    expect(opsDe(chamadas, 'v_produtos_estoque_baixo')).toHaveLength(0);
    expect(opsDe(chamadas, 'despesas')).toHaveLength(0);
    const ags = opsDe(chamadas, 'agendamentos');
    expect(ags).toHaveLength(1);
    expect(tem(ags[0], 'eq', 'profissional_id', U)).toBe(true);
    expect(tem(opsDe(chamadas, 'comissoes')[0], 'eq', 'profissional_id', U)).toBe(true);
  });

  it('fecha comanda só das próprias sem agenda.gerenciar_outras', async () => {
    const { db, chamadas } = fakeDb();
    const pode = (a: Acesso) => a === 'comanda.fechar';
    const d = await carregarDadosAlertas(db, E, { userId: U, pode }, AGORA);
    expect(d.comandasNaoFechadas).toEqual([]);
    const comandas = opsDe(chamadas, 'agendamentos')[1];
    expect(tem(comandas, 'eq', 'profissional_id', U)).toBe(true);
  });

  it('qualquer consulta com erro: lança (nunca alertas pela metade)', async () => {
    const { db } = fakeDb({ erroEm: 'comissoes' });
    await expect(carregarDadosAlertas(db, E, { userId: U, pode: todas }, AGORA)).rejects.toThrow('falha em comissoes');
  });
});
