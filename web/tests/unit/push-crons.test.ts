/**
 * Push nos crons (Task 3 da Paridade Configurações, Notificações e Papéis; spec, seção "Push"):
 * envio pela Expo em lotes de até 100, apagando aparelhos `DeviceNotRegistered`, só para os
 * dispositivos da MESMA empresa, com fallback só-leitura em `users.push_token` sem a 097; lembrete
 * de 30 min único mesmo com um canal falhando; resumo diário com despesas/estoque por permissão.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  carregarDispositivosExpo, enviarExpo, enviarPushExpo, URL_EXPO_PUSH, LOTE_EXPO,
} from '@/lib/push/expo';
import { executarCronLembretes } from '@/lib/push/cron-lembretes';
import { executarCronResumo } from '@/lib/push/cron-resumo';
import { corpoResumoDoMembro } from '@shared/lembretes';

// ── db falso: cada consulta é gravada e respondida por `responder` ────────────────

type Op = [string, unknown[]];
type Consulta = { tabela: string; ops: Op[] };
type Resp = { data: unknown; error: { code?: string; message: string } | null };

function dbFalso(responder: (q: Consulta) => Resp | undefined) {
  const consultas: Consulta[] = [];
  const db = {
    rpc: () => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'x' } }),
    from(tabela: string) {
      const q: Consulta = { tabela, ops: [] };
      consultas.push(q);
      const b: Record<string, unknown> = new Proxy({}, {
        get(_a, prop) {
          if (prop === 'then') {
            return (ok: (v: Resp) => unknown, ko: (e: unknown) => unknown) => {
              try { return ok(responder(q) ?? { data: [], error: null }); } catch (e) { return ko(e); }
            };
          }
          return (...args: unknown[]) => { q.ops.push([String(prop), args]); return b; };
        },
      });
      return b;
    },
  };
  return { db, consultas };
}
const tem = (q: Consulta, m: string, ...args: unknown[]) =>
  q.ops.some(([n, a]) => n === m && args.every((v, i) => JSON.stringify(a[i]) === JSON.stringify(v)));
const eqDe = (q: Consulta, col: string) => q.ops.find(([n, a]) => n === 'eq' && a[0] === col)?.[1][1];
const ehDelete = (q: Consulta) => q.ops.some(([n]) => n === 'delete');
const ehUpdate = (q: Consulta) => q.ops.some(([n]) => n === 'update');
const ehInsert = (q: Consulta) => q.ops.some(([n]) => n === 'insert');

const SEM_097 = { code: 'PGRST205', message: "Could not find the table 'public.push_dispositivos' in the schema cache" };

// ── fetch falso da Expo ──────────────────────────────────────────────────────

type Ticket = { status: 'ok'; id: string } | { status: 'error'; message: string; details?: { error?: string } };
function fetchExpo(ticketDe: (to: string) => Ticket = () => ({ status: 'ok', id: 'r' })) {
  const chamadas: { url: string; init: RequestInit; corpo: { to: string; title: string; body: string; data?: unknown }[] }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const corpo = JSON.parse(String(init.body));
    chamadas.push({ url, init, corpo });
    return new Response(JSON.stringify({ data: corpo.map((m: { to: string }) => ticketDe(m.to)) }), { status: 200 });
  });
  return { fn: fn as unknown as typeof fetch, chamadas };
}
const tok = (n: number | string) => `ExponentPushToken[${n}]`;

// ═════════════════════════════════════════════════════════════════════════════

describe('enviarExpo (fetch, lotes de 100)', () => {
  it('manda em lotes de até 100 para a URL da Expo', async () => {
    const { fn, chamadas } = fetchExpo();
    const msgs = Array.from({ length: 230 }, (_, i) => ({ to: tok(i), title: 'T', body: 'B' }));
    const r = await enviarExpo(msgs, { fetchFn: fn });
    expect(LOTE_EXPO).toBe(100);
    expect(chamadas.map(c => c.corpo.length)).toEqual([100, 100, 30]);
    expect(chamadas.every(c => c.url === URL_EXPO_PUSH)).toBe(true);
    expect(URL_EXPO_PUSH).toBe('https://exp.host/--/api/v2/push/send');
    expect(r).toEqual({ enviados: 230, falhas: 0, invalidos: [] });
  });

  it('Authorization só quando há access token', async () => {
    const a = fetchExpo();
    await enviarExpo([{ to: tok(1), title: 'T', body: 'B' }], { fetchFn: a.fn });
    expect((a.chamadas[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
    const b = fetchExpo();
    await enviarExpo([{ to: tok(1), title: 'T', body: 'B' }], { fetchFn: b.fn, accessToken: 'segredo' });
    expect((b.chamadas[0].init.headers as Record<string, string>).Authorization).toBe('Bearer segredo');
  });

  it('DeviceNotRegistered vira inválido; outros erros só contam como falha', async () => {
    const { fn } = fetchExpo(to => to === tok(2)
      ? { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } }
      : to === tok(3) ? { status: 'error', message: 'y', details: { error: 'MessageRateExceeded' } }
      : { status: 'ok', id: 'r' });
    const r = await enviarExpo([1, 2, 3].map(i => ({ to: tok(i), title: 'T', body: 'B' })), { fetchFn: fn });
    expect(r).toEqual({ enviados: 1, falhas: 2, invalidos: [tok(2)] });
  });

  it('rede caindo ou HTTP de erro em um lote não derruba os outros nem lança', async () => {
    let n = 0;
    const fn = vi.fn(async (_u: string, init: RequestInit) => {
      n++;
      if (n === 1) throw new Error('rede');
      if (n === 2) return new Response('erro', { status: 500 });
      const corpo = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ data: corpo.map(() => ({ status: 'ok', id: 'r' })) }), { status: 200 });
    }) as unknown as typeof fetch;
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const msgs = Array.from({ length: 250 }, (_, i) => ({ to: tok(i), title: 'T', body: 'B' }));
    const r = await enviarExpo(msgs, { fetchFn: fn, accessToken: 'segredo' });
    expect(r).toEqual({ enviados: 50, falhas: 200, invalidos: [] });
    // nunca registra token (nem o de acesso nem o do aparelho) em log
    const logado = JSON.stringify(erro.mock.calls);
    expect(logado).not.toContain('segredo');
    expect(logado).not.toContain('ExponentPushToken');
    erro.mockRestore();
  });
});

describe('carregarDispositivosExpo', () => {
  it('097: só os aparelhos expo DESTA empresa, dos usuários pedidos, com token válido', async () => {
    const { db, consultas } = dbFalso(q => q.tabela === 'push_dispositivos'
      ? { data: [
          { user_id: 'u1', token: tok('a') },
          { user_id: 'u1', token: tok('b') },
          { user_id: 'u9', token: tok('z') },   // não pedido
          { user_id: 'u2', token: 'lixo' },     // token inválido
        ], error: null }
      : undefined);
    const d = await carregarDispositivosExpo(db, 'emp-1', ['u1', 'u2'], { legado: true });
    const q = consultas.find(c => c.tabela === 'push_dispositivos')!;
    expect(eqDe(q, 'empresa_id')).toBe('emp-1');
    expect(eqDe(q, 'plataforma')).toBe('expo');
    expect(d.legado).toBe(false);
    expect(Object.fromEntries(d.porUsuario)).toEqual({ u1: [tok('a'), tok('b')] });
    expect(consultas.some(c => c.tabela === 'users')).toBe(false);
  });

  it('sem a 097: lê users.push_token (só leitura) e pula quem tem vínculo em outra empresa', async () => {
    const { db, consultas } = dbFalso(q => {
      if (q.tabela === 'push_dispositivos') return { data: null, error: SEM_097 };
      if (q.tabela === 'users') return { data: [
        { id: 'u1', push_token: tok('a') }, { id: 'u2', push_token: tok('b') }, { id: 'u3', push_token: null },
      ], error: null };
      if (q.tabela === 'empresa_membros') return { data: [
        { user_id: 'u1', empresa_id: 'emp-1' },
        { user_id: 'u2', empresa_id: 'emp-1' }, { user_id: 'u2', empresa_id: 'emp-2' },
        { user_id: 'u3', empresa_id: 'emp-1' },
      ], error: null };
      return undefined;
    });
    const d = await carregarDispositivosExpo(db, 'emp-1', ['u1', 'u2', 'u3'], { legado: true });
    expect(d.legado).toBe(true);
    expect(Object.fromEntries(d.porUsuario)).toEqual({ u1: [tok('a')] });
    expect(consultas.some(c => ehUpdate(c) || ehDelete(c) || ehInsert(c))).toBe(false);
  });

  it('sem a 097 e sem legado: nenhum aparelho', async () => {
    const { db, consultas } = dbFalso(q => q.tabela === 'push_dispositivos' ? { data: null, error: SEM_097 } : undefined);
    const d = await carregarDispositivosExpo(db, 'emp-1', ['u1'], { legado: false });
    expect(d.porUsuario.size).toBe(0);
    expect(consultas.some(c => c.tabela === 'users')).toBe(false);
  });

  it('outro erro do banco: nenhum aparelho (não cai no legado, não lança)', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, consultas } = dbFalso(q => q.tabela === 'push_dispositivos' ? { data: null, error: { code: '57014', message: 'timeout' } } : undefined);
    const d = await carregarDispositivosExpo(db, 'emp-1', ['u1'], { legado: true });
    expect(d.porUsuario.size).toBe(0);
    expect(consultas.some(c => c.tabela === 'users')).toBe(false);
    erro.mockRestore();
  });
});

describe('enviarPushExpo', () => {
  it('apaga da 097 os aparelhos DeviceNotRegistered e tira do mapa', async () => {
    const { db, consultas } = dbFalso(() => undefined);
    const { fn } = fetchExpo(to => to === tok('b') ? { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'r' });
    const disp = { legado: false, porUsuario: new Map([['u1', [tok('a'), tok('b')]]]) };
    const n = await enviarPushExpo(db, disp, [{ userId: 'u1', titulo: 'T', corpo: 'B', dados: { url: '/agenda' } }], { fetchFn: fn });
    expect(n).toBe(1);
    const del = consultas.filter(ehDelete);
    expect(del).toHaveLength(1);
    expect(del[0].tabela).toBe('push_dispositivos');
    expect(tem(del[0], 'in', 'token', [tok('b')])).toBe(true);
    expect(disp.porUsuario.get('u1')).toEqual([tok('a')]);
  });

  it('legado (users.push_token): nunca apaga nem altera nada', async () => {
    const { db, consultas } = dbFalso(() => undefined);
    const { fn } = fetchExpo(() => ({ status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } }));
    const disp = { legado: true, porUsuario: new Map([['u1', [tok('a')]]]) };
    await enviarPushExpo(db, disp, [{ userId: 'u1', titulo: 'T', corpo: 'B' }], { fetchFn: fn });
    expect(consultas).toEqual([]);
  });

  it('sem aparelho: nem chama a Expo', async () => {
    const { db } = dbFalso(() => undefined);
    const { fn, chamadas } = fetchExpo();
    expect(await enviarPushExpo(db, { legado: false, porUsuario: new Map() }, [{ userId: 'u1', titulo: 'T', corpo: 'B' }], { fetchFn: fn })).toBe(0);
    expect(chamadas).toEqual([]);
  });
});

// ── Cron de lembretes ────────────────────────────────────────────────────────

const AGORA = new Date('2026-10-28T13:00:00.000Z'); // 10:00 em Brasília
const AG = {
  id: 'ag-1', profissional_id: 'prof', data_hora_inicio: '2026-10-28T10:30:00-03:00', lembrete_30min_em: null,
  cliente: { nome: 'Lazara' }, servico: { nome: 'Design' }, agendamento_servicos: [], pacote_cliente: null,
};

function cenarioLembrete(o: {
  dispositivos?: { user_id: string; token: string; empresa_id?: string }[] | 'sem097';
  claim?: Resp;
  membros?: unknown[];
  usuarios?: unknown[];
  vinculos?: unknown[];
  falha?: (q: Consulta) => Resp | undefined;
} = {}) {
  return dbFalso(q => {
    const f = o.falha?.(q);
    if (f) return f;
    if (q.tabela === 'empresas') return { data: [{ id: 'emp-1', owner_id: 'dona' }], error: null };
    if (q.tabela === 'empresa_membros' && eqDe(q, 'empresa_id')) return { data: o.membros ?? [
      { user_id: 'prof', role: 'profissional', usuario: { notif_lembrete_atendimento: true } },
      { user_id: 'dona', role: 'owner', usuario: { notif_lembrete_atendimento: true } },
      { user_id: 'gest', role: 'gestor', usuario: { notif_lembrete_atendimento: false } },
    ], error: null };
    if (q.tabela === 'empresa_membros') return { data: o.vinculos ?? [], error: null };
    if (q.tabela === 'users') return { data: o.usuarios ?? [], error: null };
    if (q.tabela === 'web_push_subscriptions' && !ehDelete(q)) return { data: [
      { user_id: 'prof', endpoint: 'https://w/prof', p256dh: 'p', auth: 'a' },
    ], error: null };
    if (q.tabela === 'agendamentos' && ehUpdate(q)) return o.claim ?? { data: [{ id: 'ag-1' }], error: null };
    if (q.tabela === 'agendamentos') return { data: [AG], error: null };
    if (q.tabela === 'push_dispositivos' && !ehDelete(q)) {
      if (o.dispositivos === 'sem097') return { data: null, error: SEM_097 };
      return { data: (o.dispositivos ?? [{ user_id: 'prof', token: tok('prof') }, { user_id: 'dona', token: tok('dona') }, { user_id: 'gest', token: tok('gest') }]), error: null };
    }
    return undefined;
  });
}

describe('executarCronLembretes', () => {
  it('manda web push e Expo para profissional e dona; respeita notif_lembrete_atendimento', async () => {
    const { db, consultas } = cenarioLembrete();
    const enviarWeb = vi.fn(async () => ({}));
    const { fn, chamadas } = fetchExpo();
    const r = await executarCronLembretes({ db, agora: AGORA, enviarWeb, fetchFn: fn });
    expect(enviarWeb).toHaveBeenCalledTimes(1);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].corpo.map(m => m.to).sort()).toEqual([tok('dona'), tok('prof')]);
    expect(chamadas[0].corpo[0]).toMatchObject({ title: 'Atendimento em 30 minutos', body: 'Lazara · Design · 10:30' });
    expect(r.enviados).toBe(3);
    // dispositivos lidos só da empresa do lembrete
    const qd = consultas.find(c => c.tabela === 'push_dispositivos')!;
    expect(eqDe(qd, 'empresa_id')).toBe('emp-1');
  });

  it('marca lembrete_30min_em ANTES de enviar, só se ainda estiver vazio (nunca repete)', async () => {
    const { db, consultas } = cenarioLembrete();
    const ordem: string[] = [];
    const enviarWeb = vi.fn(async () => { ordem.push('web'); return {}; });
    await executarCronLembretes({ db, agora: AGORA, enviarWeb, fetchFn: fetchExpo().fn });
    const up = consultas.find(c => c.tabela === 'agendamentos' && ehUpdate(c))!;
    expect(tem(up, 'update', { lembrete_30min_em: AGORA.toISOString() })).toBe(true);
    expect(tem(up, 'eq', 'id', 'ag-1')).toBe(true);
    expect(tem(up, 'is', 'lembrete_30min_em', null)).toBe(true);
    expect(consultas.indexOf(up)).toBeLessThan(consultas.findIndex(c => c.tabela === 'notificacoes'));
    expect(ordem).toEqual(['web']);
  });

  it('outro cron já marcou (0 linhas) ou a marcação falhou: não envia nada', async () => {
    for (const claim of [{ data: [], error: null }, { data: null, error: { message: 'falhou' } }]) {
      const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { db, consultas } = cenarioLembrete({ claim });
      const enviarWeb = vi.fn(async () => ({}));
      const { fn, chamadas } = fetchExpo();
      const r = await executarCronLembretes({ db, agora: AGORA, enviarWeb, fetchFn: fn });
      expect(enviarWeb).not.toHaveBeenCalled();
      expect(chamadas).toEqual([]);
      expect(consultas.some(c => c.tabela === 'notificacoes')).toBe(false);
      expect(r.enviados).toBe(0);
      erro.mockRestore();
    }
  });

  it('web push falhando não impede a Expo nem a notificação; Expo falhando não impede o resto', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, consultas } = cenarioLembrete();
    const enviarWeb = vi.fn(async () => { throw Object.assign(new Error('x'), { statusCode: 500 }); });
    const { fn, chamadas } = fetchExpo();
    await executarCronLembretes({ db, agora: AGORA, enviarWeb, fetchFn: fn });
    expect(chamadas).toHaveLength(1);
    expect(consultas.some(c => c.tabela === 'notificacoes' && ehInsert(c))).toBe(true);
    // erro 500 não apaga a inscrição web (só 404/410)
    expect(consultas.some(c => c.tabela === 'web_push_subscriptions' && ehDelete(c))).toBe(false);

    const b = cenarioLembrete();
    const enviarWeb2 = vi.fn(async () => ({}));
    const quebra = vi.fn(async () => { throw new Error('rede'); }) as unknown as typeof fetch;
    const r = await executarCronLembretes({ db: b.db, agora: AGORA, enviarWeb: enviarWeb2, fetchFn: quebra });
    expect(enviarWeb2).toHaveBeenCalledTimes(1);
    expect(b.consultas.some(c => c.tabela === 'notificacoes' && ehInsert(c))).toBe(true);
    expect(r.enviados).toBe(1);
    erro.mockRestore();
  });

  it('inscrição web 410 é apagada', async () => {
    const { db, consultas } = cenarioLembrete();
    const enviarWeb = vi.fn(async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); });
    await executarCronLembretes({ db, agora: AGORA, enviarWeb, fetchFn: fetchExpo().fn });
    const del = consultas.find(c => c.tabela === 'web_push_subscriptions' && ehDelete(c))!;
    expect(tem(del, 'eq', 'endpoint', 'https://w/prof')).toBe(true);
  });

  it('falha ao ler membros, inscrições web ou aparelhos: não marca nem envia (tenta de novo no próximo cron)', async () => {
    const erroDb: Resp = { data: null, error: { message: 'timeout' } };
    const falhas: ((q: Consulta) => Resp | undefined)[] = [
      q => (q.tabela === 'empresa_membros' && eqDe(q, 'empresa_id') ? erroDb : undefined),
      q => (q.tabela === 'web_push_subscriptions' && !ehDelete(q) ? erroDb : undefined),
      q => (q.tabela === 'push_dispositivos' && !ehDelete(q) ? erroDb : undefined),
    ];
    for (const falha of falhas) {
      const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { db, consultas } = cenarioLembrete({ falha });
      const enviarWeb = vi.fn(async () => ({}));
      const { fn, chamadas } = fetchExpo();
      const r = await executarCronLembretes({ db, agora: AGORA, enviarWeb, fetchFn: fn });
      expect(consultas.some(c => c.tabela === 'agendamentos' && ehUpdate(c))).toBe(false);
      expect(enviarWeb).not.toHaveBeenCalled();
      expect(chamadas).toEqual([]);
      expect(consultas.some(c => c.tabela === 'notificacoes')).toBe(false);
      expect(r.enviados).toBe(0);
      erro.mockRestore();
    }
  });

  it('sem a 097 continua marcando e mandando o web push (tabela ausente não é falha de leitura)', async () => {
    const { db, consultas } = cenarioLembrete({ dispositivos: 'sem097' });
    const enviarWeb = vi.fn(async () => ({}));
    await executarCronLembretes({ db, agora: AGORA, enviarWeb, fetchFn: fetchExpo().fn });
    expect(consultas.some(c => c.tabela === 'agendamentos' && ehUpdate(c))).toBe(true);
    expect(enviarWeb).toHaveBeenCalledTimes(1);
  });

  it('sem a 097: o lembrete NÃO usa users.push_token (o app antigo já agenda o lembrete local)', async () => {
    const { db, consultas } = cenarioLembrete({ dispositivos: 'sem097', usuarios: [{ id: 'prof', push_token: tok('p') }], vinculos: [{ user_id: 'prof', empresa_id: 'emp-1' }] });
    const { fn, chamadas } = fetchExpo();
    await executarCronLembretes({ db, agora: AGORA, enviarWeb: vi.fn(async () => ({})), fetchFn: fn });
    expect(chamadas).toEqual([]);
    expect(consultas.some(c => c.tabela === 'users')).toBe(false);
  });
});

// ── Cron do resumo diário ───────────────────────────────────────────────────

describe('corpoResumoDoMembro', () => {
  const base = { agendamentosEmpresa: 4, atendimentosDela: 2, comissaoDela: 50, despesasVencendo: 1, estoqueBaixo: 3 };
  it('visão da empresa: despesas e estoque só com a permissão', () => {
    expect(corpoResumoDoMembro({ ...base, visao: 'empresa', podeFinanceiro: true, podeEstoque: true }))
      .toBe('📅 4 atendimentos hoje\n💰 1 despesa vencendo hoje\n📦 3 produtos com estoque baixo');
    expect(corpoResumoDoMembro({ ...base, visao: 'empresa', podeFinanceiro: false, podeEstoque: false }))
      .toBe('📅 4 atendimentos hoje');
    expect(corpoResumoDoMembro({ ...base, visao: 'empresa', podeFinanceiro: false, podeEstoque: true }))
      .toBe('📅 4 atendimentos hoje\n📦 3 produtos com estoque baixo');
  });
  it('visão pessoal: atendimentos e comissão dela, mais despesas/estoque se tiver a permissão', () => {
    expect(corpoResumoDoMembro({ ...base, visao: 'pessoal', podeFinanceiro: false, podeEstoque: false }))
      .toBe('📅 2 atendimentos hoje\n💰 R$ 50,00 em comissão hoje');
    expect(corpoResumoDoMembro({ ...base, visao: 'pessoal', podeFinanceiro: true, podeEstoque: false }))
      .toBe('📅 2 atendimentos hoje\n💰 R$ 50,00 em comissão hoje\n💰 1 despesa vencendo hoje');
    expect(corpoResumoDoMembro({ ...base, atendimentosDela: 0, visao: 'pessoal', podeFinanceiro: false, podeEstoque: true }))
      .toBe('📦 3 produtos com estoque baixo');
    expect(corpoResumoDoMembro({ ...base, atendimentosDela: 0, visao: 'pessoal', podeFinanceiro: false, podeEstoque: false })).toBe('');
  });
});

function cenarioResumo(o: {
  permPapel?: Resp; permMembro?: Resp;
  dispositivos?: unknown[] | 'sem097';
  usuarios?: unknown[]; vinculos?: unknown[]; webSubs?: unknown[];
} = {}) {
  return dbFalso(q => {
    if (q.tabela === 'empresas') return { data: [{ id: 'emp-1', owner_id: 'dona' }], error: null };
    if (q.tabela === 'agendamentos') return { data: [
      { id: 'a1', profissional_id: 'prof', status: 'agendado' },
      { id: 'a2', profissional_id: 'prof', status: 'confirmado' },
    ], error: null };
    if (q.tabela === 'comissoes') return { data: [{ valor_comissao: 30, profissional_id: 'prof' }], error: null };
    if (q.tabela === 'despesas') return { data: [{ id: 'd1' }], error: null };
    if (q.tabela === 'v_produtos_estoque_baixo') return { data: [{ id: 'p1' }, { id: 'p2' }], error: null };
    if (q.tabela === 'empresa_membros' && eqDe(q, 'empresa_id')) return { data: [
      { user_id: 'dona', role: 'owner', usuario: { notif_resumo_diario: true } },
      { user_id: 'gest', role: 'gestor', usuario: { notif_resumo_diario: true } },
      { user_id: 'prof', role: 'profissional', usuario: { notif_resumo_diario: true } },
      { user_id: 'mudo', role: 'gestor', usuario: { notif_resumo_diario: false } },
    ], error: null };
    if (q.tabela === 'empresa_membros') return { data: o.vinculos ?? [], error: null };
    if (q.tabela === 'users') return { data: o.usuarios ?? [], error: null };
    if (q.tabela === 'permissoes_papel') return o.permPapel ?? { data: [], error: null };
    if (q.tabela === 'permissoes_membro') return o.permMembro ?? { data: [], error: null };
    if (q.tabela === 'web_push_subscriptions') return { data: o.webSubs ?? [], error: null };
    if (q.tabela === 'push_dispositivos' && !ehDelete(q)) {
      if (o.dispositivos === 'sem097') return { data: null, error: SEM_097 };
      return { data: o.dispositivos ?? ['dona', 'gest', 'prof', 'mudo'].map(u => ({ user_id: u, token: tok(u) })), error: null };
    }
    return undefined;
  });
}
const corpoPara = (chamadas: ReturnType<typeof fetchExpo>['chamadas'], u: string) =>
  chamadas.flatMap(c => c.corpo).find(m => m.to === tok(u))?.body;

describe('executarCronResumo', () => {
  it('gestora sem financeiro.ver/estoque.acessar não recebe despesas e estoque; dona recebe tudo', async () => {
    const { db } = cenarioResumo({
      permPapel: { data: [{ papel: 'gestor', chave: 'financeiro.ver', permitido: false }], error: null },
      permMembro: { data: [{ user_id: 'gest', chave: 'estoque.acessar', permitido: false }], error: null },
    });
    const { fn, chamadas } = fetchExpo();
    await executarCronResumo({ db, hoje: '2026-10-28', enviarWeb: vi.fn(async () => ({})), fetchFn: fn });
    expect(corpoPara(chamadas, 'dona')).toBe('📅 2 atendimentos hoje\n💰 1 despesa vencendo hoje\n📦 2 produtos com estoque baixo');
    expect(corpoPara(chamadas, 'gest')).toBe('📅 2 atendimentos hoje');
    expect(corpoPara(chamadas, 'prof')).toBe('📅 2 atendimentos hoje\n💰 R$ 30,00 em comissão hoje');
    expect(corpoPara(chamadas, 'mudo')).toBeUndefined(); // notif_resumo_diario = false
  });

  it('com os padrões, a gestora recebe despesas e estoque (comportamento de antes)', async () => {
    const { db, consultas } = cenarioResumo();
    const { fn, chamadas } = fetchExpo();
    await executarCronResumo({ db, hoje: '2026-10-28', enviarWeb: vi.fn(async () => ({})), fetchFn: fn });
    expect(corpoPara(chamadas, 'gest')).toBe('📅 2 atendimentos hoje\n💰 1 despesa vencendo hoje\n📦 2 produtos com estoque baixo');
    // permissões lidas só da empresa do resumo
    expect(eqDe(consultas.find(c => c.tabela === 'permissoes_papel')!, 'empresa_id')).toBe('emp-1');
    expect(eqDe(consultas.find(c => c.tabela === 'permissoes_membro')!, 'empresa_id')).toBe('emp-1');
  });

  it('erro ao ler as permissões: despesas e estoque ficam de fora para quem não é dona', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = cenarioResumo({ permMembro: { data: null, error: { code: '57014', message: 'timeout' } } });
    const { fn, chamadas } = fetchExpo();
    await executarCronResumo({ db, hoje: '2026-10-28', enviarWeb: vi.fn(async () => ({})), fetchFn: fn });
    expect(corpoPara(chamadas, 'gest')).toBe('📅 2 atendimentos hoje');
    expect(corpoPara(chamadas, 'dona')).toContain('despesa');
    erro.mockRestore();
  });

  it('grava a notificação com o mesmo texto do push e só da empresa', async () => {
    const { db, consultas } = cenarioResumo({
      permPapel: { data: [{ papel: 'gestor', chave: 'financeiro.ver', permitido: false }, { papel: 'gestor', chave: 'estoque.acessar', permitido: false }], error: null },
    });
    await executarCronResumo({ db, hoje: '2026-10-28', enviarWeb: vi.fn(async () => ({})), fetchFn: fetchExpo().fn });
    const ins = consultas.find(c => c.tabela === 'notificacoes' && ehInsert(c))!;
    const linhas = ins.ops.find(([n]) => n === 'insert')![1][0] as { user_id: string; empresa_id: string; mensagem: string }[];
    expect(linhas.map(l => l.user_id).sort()).toEqual(['dona', 'gest', 'prof']);
    expect(linhas.every(l => l.empresa_id === 'emp-1')).toBe(true);
    expect(linhas.find(l => l.user_id === 'gest')!.mensagem).toBe('📅 2 atendimentos hoje');
  });

  it('sem a 097: usa users.push_token só de quem é exclusivo desta empresa, sem escrever em users', async () => {
    const { db, consultas } = cenarioResumo({
      dispositivos: 'sem097',
      usuarios: [{ id: 'dona', push_token: tok('dona') }, { id: 'prof', push_token: tok('prof') }],
      vinculos: [{ user_id: 'dona', empresa_id: 'emp-1' }, { user_id: 'prof', empresa_id: 'emp-1' }, { user_id: 'prof', empresa_id: 'emp-2' }],
    });
    const { fn, chamadas } = fetchExpo(() => ({ status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } }));
    await executarCronResumo({ db, hoje: '2026-10-28', enviarWeb: vi.fn(async () => ({})), fetchFn: fn });
    expect(chamadas.flatMap(c => c.corpo).map(m => m.to)).toEqual([tok('dona')]);
    expect(consultas.some(c => (c.tabela === 'users' || c.tabela === 'push_dispositivos') && (ehUpdate(c) || ehDelete(c)))).toBe(false);
  });

  it('Expo falhando não impede web push nem a notificação', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, consultas } = cenarioResumo({ webSubs: [{ user_id: 'dona', endpoint: 'https://w/d', p256dh: 'p', auth: 'a' }] });
    const enviarWeb = vi.fn(async () => ({}));
    const quebra = vi.fn(async () => { throw new Error('rede'); }) as unknown as typeof fetch;
    const r = await executarCronResumo({ db, hoje: '2026-10-28', enviarWeb, fetchFn: quebra });
    expect(enviarWeb).toHaveBeenCalledTimes(1);
    expect(consultas.some(c => c.tabela === 'notificacoes' && ehInsert(c))).toBe(true);
    expect(r.enviados).toBe(1);
    erro.mockRestore();
  });
});

describe('rotas dos crons', () => {
  const raiz = path.resolve(__dirname, '../../app/api/cron');
  it('as duas rotas usam os módulos testados e passam EXPO_ACCESS_TOKEN', () => {
    for (const [arq, fn] of [['lembretes/route.ts', 'executarCronLembretes'], ['resumo-diario/route.ts', 'executarCronResumo']]) {
      const src = fs.readFileSync(path.join(raiz, arq), 'utf8');
      expect(src).toContain(fn);
      expect(src).toContain('process.env.EXPO_ACCESS_TOKEN');
      expect(src).toContain('CRON_SECRET');
    }
  });
});
