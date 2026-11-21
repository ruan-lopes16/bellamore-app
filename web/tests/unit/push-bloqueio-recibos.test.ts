/**
 * Push dos avisos de bloqueio (C14) e recibos da Expo (B14), com db e fetch falsos (spec 2026-11-20).
 */
import { describe, expect, it, vi } from 'vitest';
import { executarCronNotificacoes } from '@/lib/push/cron-notificacoes';
import { enviarPushExpo, lerRecibosExpo, URL_EXPO_RECIBOS, LOTE_RECIBOS } from '@/lib/push/expo';

type Op = [string, unknown[]];
type Consulta = { tabela: string; ops: Op[] };
type Resp = { data: unknown; error: { code?: string; message: string } | null };

function dbFalso(responder: (q: Consulta) => Resp | undefined) {
  const consultas: Consulta[] = [];
  const db = {
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
const op = (q: Consulta, m: string) => q.ops.find(([n]) => n === m)?.[1];
const eqDe = (q: Consulta, col: string) => q.ops.find(([n, a]) => n === 'eq' && a[0] === col)?.[1][1];
const ehDelete = (q: Consulta) => q.ops.some(([n]) => n === 'delete');
const ehUpdate = (q: Consulta) => q.ops.some(([n]) => n === 'update');
const ehUpsert = (q: Consulta) => q.ops.some(([n]) => n === 'upsert');
const ehLeitura = (q: Consulta) => !ehDelete(q) && !ehUpdate(q) && !ehUpsert(q);

const AGORA = new Date('2026-11-20T15:00:00.000Z');
const tok = (n: number | string) => `ExponentPushToken[${n}]`;
const AVISO = { id: 'n-1', user_id: 'gest', empresa_id: 'emp-1', titulo: 'Bloqueio pendente', mensagem: 'Ana pediu bloqueio' };

function fetchExpo(ticketDe: (to: string, i: number) => unknown = (_t, i) => ({ status: 'ok', id: `tk-${i}` })) {
  const chamadas: { url: string; corpo: { to: string }[] }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const corpo = JSON.parse(String(init.body));
    chamadas.push({ url, corpo });
    return new Response(JSON.stringify({ data: corpo.map((m: { to: string }, i: number) => ticketDe(m.to, i)) }), { status: 200 });
  });
  return { fn: fn as unknown as typeof fetch, chamadas };
}

function cenario(o: { avisos?: unknown[]; claim?: Resp; falha?: (q: Consulta) => Resp | undefined } = {}) {
  return dbFalso(q => {
    const f = o.falha?.(q);
    if (f) return f;
    if (q.tabela === 'notificacoes' && ehUpdate(q)) return o.claim ?? { data: [{ id: 'n-1' }], error: null };
    if (q.tabela === 'notificacoes') return { data: o.avisos ?? [AVISO], error: null };
    if (q.tabela === 'web_push_subscriptions') return { data: [{ user_id: 'gest', endpoint: 'https://w/g', p256dh: 'p', auth: 'a' }], error: null };
    if (q.tabela === 'push_dispositivos' && ehLeitura(q)) return { data: [{ user_id: 'gest', token: tok('g') }], error: null };
    return undefined;
  });
}

describe('executarCronNotificacoes — push de bloqueio (C14)', () => {
  it('consulta só os 3 tipos, sem push enviado e das últimas 24 h', async () => {
    const { db, consultas } = cenario();
    await executarCronNotificacoes({ db, agora: AGORA, enviarWeb: vi.fn(async () => ({})), fetchFn: fetchExpo().fn });
    const q = consultas.find(c => c.tabela === 'notificacoes' && ehLeitura(c))!;
    expect(tem(q, 'in', 'tipo', ['bloqueio_pendente', 'bloqueio_aprovado', 'bloqueio_recusado'])).toBe(true);
    expect(tem(q, 'is', 'push_enviado_em', null)).toBe(true);
    expect(tem(q, 'gte', 'created_at', '2026-11-19T15:00:00.000Z')).toBe(true);
  });

  it('marca ANTES de enviar (só se ainda nulo) e manda web + app com título e mensagem do aviso', async () => {
    const { db, consultas } = cenario();
    const ordem: string[] = [];
    const enviarWeb = vi.fn(async (_s: unknown, payload: string) => { ordem.push(`web:${payload}`); return {}; });
    const { fn, chamadas } = fetchExpo();
    const r = await executarCronNotificacoes({ db, agora: AGORA, enviarWeb, fetchFn: fn });

    const up = consultas.find(c => c.tabela === 'notificacoes' && ehUpdate(c))!;
    expect(tem(up, 'update', { push_enviado_em: AGORA.toISOString() })).toBe(true);
    expect(tem(up, 'eq', 'id', 'n-1')).toBe(true);
    expect(tem(up, 'is', 'push_enviado_em', null)).toBe(true);
    expect(op(up, 'select')).toEqual(['id']);
    expect(ordem).toEqual([`web:${JSON.stringify({ title: 'Bloqueio pendente', body: 'Ana pediu bloqueio', url: '/agenda' })}`]);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].corpo.map(m => m.to)).toEqual([tok('g')]);
    expect(r.enviados).toBe(2);
    // a marcação aconteceu antes do envio ao app e à web
    expect(consultas.indexOf(up)).toBeLessThan(consultas.findIndex(c => c.tabela === 'push_recibos'));
  });

  it('aparelhos e inscrições só da empresa do aviso', async () => {
    const { db, consultas } = cenario();
    await executarCronNotificacoes({ db, agora: AGORA, enviarWeb: vi.fn(async () => ({})), fetchFn: fetchExpo().fn });
    const disp = consultas.find(c => c.tabela === 'push_dispositivos' && ehLeitura(c))!;
    expect(eqDe(disp, 'empresa_id')).toBe('emp-1');
    const web = consultas.find(c => c.tabela === 'web_push_subscriptions')!;
    expect(eqDe(web, 'empresa_id')).toBe('emp-1');
    expect(eqDe(web, 'user_id')).toBe('gest');
  });

  it('outro cron já marcou (0 linhas) ou a marcação falhou: não envia nada (nunca repete)', async () => {
    for (const claim of [{ data: [], error: null }, { data: null, error: { message: 'falhou' } }]) {
      const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { db } = cenario({ claim });
      const enviarWeb = vi.fn(async () => ({}));
      const { fn, chamadas } = fetchExpo();
      const r = await executarCronNotificacoes({ db, agora: AGORA, enviarWeb, fetchFn: fn });
      expect(enviarWeb).not.toHaveBeenCalled();
      expect(chamadas).toEqual([]);
      expect(r.enviados).toBe(0);
      erro.mockRestore();
    }
  });

  it('falha ao ler aparelhos ou inscrições: não marca nem envia', async () => {
    const erroDb: Resp = { data: null, error: { message: 'timeout' } };
    for (const tabela of ['push_dispositivos', 'web_push_subscriptions']) {
      const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { db, consultas } = cenario({ falha: q => (q.tabela === tabela && ehLeitura(q) ? erroDb : undefined) });
      const enviarWeb = vi.fn(async () => ({}));
      await executarCronNotificacoes({ db, agora: AGORA, enviarWeb, fetchFn: fetchExpo().fn });
      expect(enviarWeb).not.toHaveBeenCalled();
      expect(consultas.some(c => c.tabela === 'notificacoes' && ehUpdate(c))).toBe(false);
      erro.mockRestore();
    }
  });

  it('aviso sem empresa fica só no sino', async () => {
    const { db, consultas } = cenario({ avisos: [{ ...AVISO, empresa_id: null }] });
    const r = await executarCronNotificacoes({ db, agora: AGORA, enviarWeb: vi.fn(async () => ({})), fetchFn: fetchExpo().fn });
    expect(r.enviados).toBe(0);
    expect(consultas.some(c => c.tabela === 'notificacoes' && ehUpdate(c))).toBe(false);
  });

  it('sem a 102 (coluna inexistente) pula em silêncio, sem log de erro e sem lançar', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = cenario({ falha: q => (q.tabela === 'notificacoes'
      ? { data: null, error: { code: '42703', message: 'column notificacoes.push_enviado_em does not exist' } } : undefined) });
    const r = await executarCronNotificacoes({ db, agora: AGORA, enviarWeb: vi.fn(async () => ({})), fetchFn: fetchExpo().fn });
    expect(r).toEqual({ enviados: 0, recibos: 0 });
    expect(erro).not.toHaveBeenCalled();
    erro.mockRestore();
  });

  it('web push falhando não impede o app', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = cenario();
    const enviarWeb = vi.fn(async () => { throw Object.assign(new Error('x'), { statusCode: 500 }); });
    const { fn, chamadas } = fetchExpo();
    const r = await executarCronNotificacoes({ db, agora: AGORA, enviarWeb, fetchFn: fn });
    expect(chamadas).toHaveLength(1);
    expect(r.enviados).toBe(1);
    erro.mockRestore();
  });
});

describe('recibos da Expo (B14)', () => {
  it('o envio grava (ticket, token) de cada ticket ok; erro ao gravar não derruba o envio', async () => {
    const { db, consultas } = dbFalso(() => undefined);
    const { fn } = fetchExpo((to, i) => (to === tok('b') ? { status: 'error', message: 'x' } : { status: 'ok', id: `tk-${i}` }));
    const disp = { legado: false, porUsuario: new Map([['u1', [tok('a'), tok('b'), tok('c')]]]) };
    const n = await enviarPushExpo(db, disp, [{ userId: 'u1', titulo: 'T', corpo: 'B' }], { fetchFn: fn });
    expect(n).toBe(2);
    const up = consultas.find(c => c.tabela === 'push_recibos' && ehUpsert(c))!;
    expect(op(up, 'upsert')![0]).toEqual([{ ticket_id: 'tk-0', token: tok('a') }, { ticket_id: 'tk-2', token: tok('c') }]);

    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const b = dbFalso(q => (q.tabela === 'push_recibos' ? { data: null, error: { message: 'quebrou' } } : undefined));
    const n2 = await enviarPushExpo(b.db, { legado: false, porUsuario: new Map([['u1', [tok('a')]]]) },
      [{ userId: 'u1', titulo: 'T', corpo: 'B' }], { fetchFn: fetchExpo().fn });
    expect(n2).toBe(1);
    erro.mockRestore();
  });

  it('sem a 102 (tabela inexistente) a gravação é pulada em silêncio; legado não grava', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = dbFalso(q => (q.tabela === 'push_recibos'
      ? { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.push_recibos'" } } : undefined));
    expect(await enviarPushExpo(a.db, { legado: false, porUsuario: new Map([['u1', [tok('a')]]]) },
      [{ userId: 'u1', titulo: 'T', corpo: 'B' }], { fetchFn: fetchExpo().fn })).toBe(1);
    expect(erro).not.toHaveBeenCalled();
    const b = dbFalso(() => undefined);
    await enviarPushExpo(b.db, { legado: true, porUsuario: new Map([['u1', [tok('a')]]]) },
      [{ userId: 'u1', titulo: 'T', corpo: 'B' }], { fetchFn: fetchExpo().fn });
    expect(b.consultas).toEqual([]);
    erro.mockRestore();
  });

  function cenarioRecibos(recibos: { ticket_id: string; token: string }[], mapa: Record<string, unknown>, status = 200) {
    const { db, consultas } = dbFalso(q => (q.tabela === 'push_recibos' && ehLeitura(q) ? { data: recibos, error: null } : undefined));
    const chamadas: { url: string; ids: string[]; auth?: string }[] = [];
    const fn = vi.fn(async (url: string, init: RequestInit) => {
      chamadas.push({ url, ids: JSON.parse(String(init.body)).ids, auth: (init.headers as Record<string, string>).Authorization });
      return new Response(JSON.stringify({ data: mapa }), { status });
    }) as unknown as typeof fetch;
    return { db, consultas, chamadas, fn };
  }

  it('lê só recibos com mais de 15 min; DeviceNotRegistered apaga o aparelho; lidos e velhos saem da tabela', async () => {
    const { db, consultas, chamadas, fn } = cenarioRecibos(
      [{ ticket_id: 't1', token: tok('a') }, { ticket_id: 't2', token: tok('b') }, { ticket_id: 't3', token: tok('c') }],
      { t1: { status: 'ok' }, t2: { status: 'error', details: { error: 'DeviceNotRegistered' } } }, // t3 ainda sem recibo
    );
    const r = await lerRecibosExpo(db, { agora: AGORA, fetchFn: fn, accessToken: 'segredo' });
    const sel = consultas.find(c => c.tabela === 'push_recibos' && ehLeitura(c))!;
    expect(tem(sel, 'lte', 'criado_em', '2026-11-20T14:45:00.000Z')).toBe(true);
    expect(chamadas).toEqual([{ url: URL_EXPO_RECIBOS, ids: ['t1', 't2', 't3'], auth: 'Bearer segredo' }]);
    expect(URL_EXPO_RECIBOS).toBe('https://exp.host/--/api/v2/push/getReceipts');

    const delDisp = consultas.find(c => c.tabela === 'push_dispositivos' && ehDelete(c))!;
    expect(tem(delDisp, 'in', 'token', [tok('b')])).toBe(true);
    const dels = consultas.filter(c => c.tabela === 'push_recibos' && ehDelete(c));
    expect(dels.some(d => tem(d, 'in', 'ticket_id', ['t1', 't2']))).toBe(true); // t3 fica para depois
    expect(dels.some(d => tem(d, 'lt', 'criado_em', '2026-11-19T15:00:00.000Z'))).toBe(true); // > 24 h
    expect(r).toEqual({ lidos: 2, apagados: 1 });
  });

  it('consulta em lotes de até 300', async () => {
    const recibos = Array.from({ length: 650 }, (_, i) => ({ ticket_id: `t${i}`, token: tok(i) }));
    const { db, chamadas, fn } = cenarioRecibos(recibos, {});
    await lerRecibosExpo(db, { agora: AGORA, fetchFn: fn });
    expect(LOTE_RECIBOS).toBe(300);
    expect(chamadas.map(c => c.ids.length)).toEqual([300, 300, 50]);
  });

  it('HTTP de erro ou rede caindo: nada é apagado e não lança; token nunca vai para o log', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = cenarioRecibos([{ ticket_id: 't1', token: tok('a') }], {}, 500);
    await lerRecibosExpo(a.db, { agora: AGORA, fetchFn: a.fn });
    expect(a.consultas.some(c => c.tabela === 'push_dispositivos')).toBe(false);
    expect(a.consultas.filter(c => ehDelete(c) && tem(c, 'in', 'ticket_id', ['t1']))).toEqual([]);

    const b = cenarioRecibos([{ ticket_id: 't1', token: tok('a') }], {});
    const quebra = vi.fn(async () => { throw new Error('rede'); }) as unknown as typeof fetch;
    await expect(lerRecibosExpo(b.db, { agora: AGORA, fetchFn: quebra, accessToken: 'segredo' })).resolves.toBeDefined();
    const logado = JSON.stringify(erro.mock.calls);
    expect(logado).not.toContain('ExponentPushToken');
    expect(logado).not.toContain('segredo');
    erro.mockRestore();
  });

  it('sem a 102 (tabela inexistente): não faz nada e não loga erro', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = dbFalso(() => ({ data: null, error: { code: '42P01', message: 'relation "push_recibos" does not exist' } }));
    const fn = vi.fn() as unknown as typeof fetch;
    expect(await lerRecibosExpo(db, { agora: AGORA, fetchFn: fn })).toEqual({ lidos: 0, apagados: 0 });
    expect(fn).not.toHaveBeenCalled();
    expect(erro).not.toHaveBeenCalled();
    erro.mockRestore();
  });
});
