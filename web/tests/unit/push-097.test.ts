// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { carregarDispositivosExpo, enviarPushExpo } from '@/lib/push/expo';
import { limiteVistoEm } from '@shared/push-dispositivos';

/**
 * Migration 097 (spec docs/superpowers/specs/2026-10-28-paridade-configuracoes-notificacoes-design.md,
 * "Push"): tabela push_dispositivos com RLS, função de registro, backfill de users.push_token e a
 * policy + trigger de "marcar como lida" em notificacoes. Lida como texto e exercitada num Postgres
 * em memória (PGlite, nada de banco real) sobre fixtures/schema-push-097.sql.
 */
const raiz = join(process.cwd(), '..');
const ARQ = '097_push_dispositivos_e_notificacoes.sql';
const bruto = readFileSync(join(raiz, 'supabase', 'migrations', ARQ), 'utf8');
const fixture = readFileSync(join(process.cwd(), 'tests', 'unit', 'fixtures', 'schema-push-097.sql'), 'utf8');
const sql = bruto.toLowerCase().replace(/\r\n/g, '\n');
const corpo = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

function policy(nome: string, tabela: string): string {
  const drop = corpo.indexOf(`drop policy if exists "${nome}" on public.${tabela};`);
  const ini = corpo.indexOf(`create policy "${nome}"`);
  expect(drop, `drop da policy ${nome}`).toBeGreaterThanOrEqual(0);
  expect(ini, `policy ${nome}`).toBeGreaterThan(drop);
  return corpo.slice(ini, corpo.indexOf(';', ini));
}
function funcao(nome: string): string {
  const ini = corpo.indexOf(`create or replace function public.${nome}(`);
  expect(ini, `função ${nome}`).toBeGreaterThanOrEqual(0);
  const fim = corpo.indexOf('$$;', corpo.indexOf('as $$', ini) + 5);
  return corpo.slice(ini, fim + 3);
}

describe('migration 097 — texto', () => {
  it('tabela push_dispositivos com as colunas da spec, token único e plataforma conferida', () => {
    expect(corpo).toContain('create table if not exists public.push_dispositivos (');
    const ini = corpo.indexOf('create table if not exists public.push_dispositivos (');
    const t = corpo.slice(ini, corpo.indexOf(');', ini));
    for (const c of ['id ', 'user_id ', 'empresa_id ', 'plataforma ', 'token ', 'criado_em ', 'visto_em ']) expect(t).toContain(c);
    expect(t).toContain('references public.users(id) on delete cascade');
    expect(t).toContain('references public.empresas(id) on delete cascade');
    expect(t).toMatch(/token\s+text not null unique/);
    expect(t).toContain("check (plataforma in ('expo', 'web'))");
    expect(corpo).toContain('alter table public.push_dispositivos enable row level security;');
  });

  it('RLS: só os próprios registros; inserir só de empresa com vínculo ativo; ver e apagar sem vínculo', () => {
    const ver = policy('push_dispositivos: ver proprios', 'push_dispositivos');
    expect(ver).toContain('for select');
    expect(ver).toContain('user_id = auth.uid()');
    // O DELETE com WHERE/RETURNING passa pela policy de SELECT: exigir vínculo travaria quem saiu.
    expect(ver).not.toContain('minha_empresas()');
    const ins = policy('push_dispositivos: inserir proprios', 'push_dispositivos');
    expect(ins).toContain('for insert');
    expect(ins).toContain('user_id = auth.uid()');
    expect(ins).toContain('minha_empresas()');
    const del = policy('push_dispositivos: apagar proprios', 'push_dispositivos');
    expect(del).toContain('for delete');
    expect(del).toContain('user_id = auth.uid()');
    expect(corpo).not.toMatch(/create policy "[^"]*" on public\.push_dispositivos\s+for (update|all)/);
  });

  it('registrar_push_dispositivo: security definer, search_path fixo, sem returning, revoke/grant', () => {
    const f = funcao('registrar_push_dispositivo');
    expect(f).toContain('returns void');
    expect(f).toContain('security definer');
    expect(f).toContain('set search_path = public');
    expect(f).toContain('auth.uid()');
    expect(f).toContain('minha_empresas()');
    expect(f).toContain('on conflict (token) do update');
    expect(f).not.toContain('returning');
    expect(corpo).toContain('revoke all on function public.registrar_push_dispositivo(uuid, text, text) from public, anon;');
    expect(corpo).toContain('grant execute on function public.registrar_push_dispositivo(uuid, text, text) to authenticated;');
  });

  it('backfill de users.push_token, sem apagar a coluna antiga', () => {
    expect(corpo).toContain('insert into public.push_dispositivos');
    expect(corpo).toContain('from public.users u');
    expect(corpo).toContain('on conflict (token) do nothing');
    expect(corpo).not.toMatch(/drop column[^;]*push_token/);
    expect(corpo).not.toContain('web_push_subscriptions');
  });

  it('notificacoes: policy nova de UPDATE (com drop antes) e trigger que só deixa mudar lida', () => {
    const p = policy('notificacoes: marcar propria como lida', 'notificacoes');
    expect(p).toContain('for update');
    expect(p).toMatch(/using \(user_id = auth\.uid\(\)\)/);
    expect(p).toMatch(/with check \(user_id = auth\.uid\(\)\)/);
    const f = funcao('fn_notificacoes_so_lida');
    expect(f).not.toContain('security definer');
    expect(f).toContain("(to_jsonb(new) - 'lida') is distinct from (to_jsonb(old) - 'lida')");
    expect(corpo).toContain('drop trigger if exists trg_notificacoes_so_lida on public.notificacoes;');
    expect(corpo).toMatch(/create trigger trg_notificacoes_so_lida\s+before update on public\.notificacoes/);
    expect(bruto).toContain('Você só pode marcar a notificação como lida.');
  });

  it('cabeçalho com rollback e fim com notify', () => {
    expect(sql).toContain('rollback');
    expect(corpo.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});

// ── PGlite ─────────────────────────────────────────────────────

const id = (pfx: string, n: number) => `00000000-0000-0000-0000-${pfx}${String(n).padStart(12 - pfx.length, '0')}`;
const E1 = id('e', 1);
const E2 = id('e', 2);
const E3 = id('e', 3);
const DONA = id('d', 1);
const P1 = id('a', 1);  // membro de E2 (mais antiga) e E1
const P2 = id('a', 2);  // membro de E1 só
const P3 = id('a', 3);  // vínculo desativado em E1, sem outra empresa
const P4 = id('a', 4);  // sem token
const N1 = id('f', 1);
const N2 = id('f', 2);

let db: PGlite;

async function como(user: string) {
  await db.exec(`reset role; select set_config('app.uid', '${user}', false); set role authenticated;`);
}
async function admin<T = Record<string, unknown>>(q: string, p: unknown[] = []): Promise<T[]> {
  await db.exec('reset role');
  return (await db.query<T>(q, p)).rows;
}
async function q<T = Record<string, unknown>>(s: string, p: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(s, p)).rows;
}
async function erro(fn: () => Promise<unknown>): Promise<{ msg: string; code: string }> {
  try { await fn(); } catch (e) { return { msg: (e as Error).message, code: (e as { code?: string }).code ?? '' }; }
  return { msg: '(sem erro)', code: '' };
}
const dispositivos = () => admin<{ user_id: string; empresa_id: string; plataforma: string; token: string }>(
  `select user_id, empresa_id, plataforma, token from push_dispositivos order by token`);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(fixture);
  await db.exec(`
    insert into users (id, nome, push_token) values
      ('${DONA}', 'Dona', 'ExponentPushToken[dona]'),
      ('${P1}', 'P1', '  ExponentPushToken[p1]  '),
      ('${P2}', 'P2', 'ExponentPushToken[p2]'),
      ('${P3}', 'P3', 'ExponentPushToken[p3]'),
      ('${P4}', 'P4', '   ');
    insert into empresas (id, owner_id, created_at) values
      ('${E1}', '${DONA}', '2026-01-01'), ('${E2}', null, '2025-01-01'), ('${E3}', null, '2026-05-01');
    insert into empresa_membros (empresa_id, user_id, role, ativo, created_at) values
      ('${E1}', '${P1}', 'profissional', true,  '2026-03-01'),
      ('${E2}', '${P1}', 'profissional', true,  '2025-06-01'),
      ('${E1}', '${P2}', 'profissional', true,  '2026-03-01'),
      ('${E1}', '${P3}', 'profissional', false, '2026-03-01'),
      ('${E1}', '${P4}', 'profissional', true,  '2026-03-01');
    insert into notificacoes (id, user_id, empresa_id, tipo, titulo, mensagem) values
      ('${N1}', '${P1}', '${E1}', 'agendamento', 'Lembrete', 'Cliente às 10h'),
      ('${N2}', '${P2}', '${E1}', 'agendamento', 'Lembrete', 'Cliente às 11h');
  `);
  await db.exec(bruto);
}, 60_000);

describe('097 em PGlite — backfill', () => {
  it('copia os tokens de users para a empresa mais antiga do vínculo ativo (dona pela owner_id)', async () => {
    expect(await dispositivos()).toEqual([
      { user_id: DONA, empresa_id: E1, plataforma: 'expo', token: 'ExponentPushToken[dona]' },
      { user_id: P1, empresa_id: E2, plataforma: 'expo', token: 'ExponentPushToken[p1]' },
      { user_id: P2, empresa_id: E1, plataforma: 'expo', token: 'ExponentPushToken[p2]' },
    ]);
  });

  it('é idempotente: rodar de novo não duplica nem quebra', async () => {
    await db.exec(bruto);
    expect(await dispositivos()).toHaveLength(3);
  });

  it('users.push_token continua como estava', async () => {
    expect(await admin(`select push_token from users where id = $1`, [P2])).toEqual([{ push_token: 'ExponentPushToken[p2]' }]);
  });
});

describe('097 em PGlite — RLS de push_dispositivos', () => {
  it('cada pessoa vê só os próprios registros', async () => {
    await como(P2);
    expect(await q(`select token from push_dispositivos`)).toEqual([{ token: 'ExponentPushToken[p2]' }]);
    await como(DONA);
    expect(await q(`select token from push_dispositivos`)).toEqual([{ token: 'ExponentPushToken[dona]' }]);
  });

  it('insere o próprio registro em empresa com vínculo ativo', async () => {
    await como(P2);
    await q(`insert into push_dispositivos (user_id, empresa_id, plataforma, token) values ($1, $2, 'expo', 'tok-p2-b')`, [P2, E1]);
    expect(await admin(`select count(*)::int n from push_dispositivos where token = 'tok-p2-b'`)).toEqual([{ n: 1 }]);
  });

  it('recusa inserir para outra pessoa, em empresa sem vínculo ou com vínculo desativado', async () => {
    await como(P2);
    expect((await erro(() => q(`insert into push_dispositivos (user_id, empresa_id, plataforma, token) values ($1, $2, 'expo', 'x1')`, [P1, E1]))).msg)
      .toMatch(/row-level security/);
    expect((await erro(() => q(`insert into push_dispositivos (user_id, empresa_id, plataforma, token) values ($1, $2, 'expo', 'x2')`, [P2, E3]))).msg)
      .toMatch(/row-level security/);
    await como(P3);
    expect((await erro(() => q(`insert into push_dispositivos (user_id, empresa_id, plataforma, token) values ($1, $2, 'expo', 'x3')`, [P3, E1]))).msg)
      .toMatch(/row-level security/);
  });

  it('plataforma fora de expo/web é recusada', async () => {
    await como(P2);
    expect((await erro(() => q(`insert into push_dispositivos (user_id, empresa_id, plataforma, token) values ($1, $2, 'sms', 'x4')`, [P2, E1]))).code)
      .toBe('23514');
  });

  it('sem UPDATE pela API (a policy não existe)', async () => {
    await como(P2);
    expect(await q(`update push_dispositivos set empresa_id = $1 where token = 'tok-p2-b' returning id`, [E3])).toEqual([]);
    expect(await admin(`select empresa_id from push_dispositivos where token = 'tok-p2-b'`)).toEqual([{ empresa_id: E1 }]);
  });

  it('apaga só os próprios registros', async () => {
    await como(P2);
    expect(await q(`delete from push_dispositivos where token = 'ExponentPushToken[p1]' returning id`)).toEqual([]);
    expect(await q(`delete from push_dispositivos where token = 'tok-p2-b' returning token`)).toEqual([{ token: 'tok-p2-b' }]);
  });

  it('quem perdeu o vínculo ainda apaga o próprio aparelho (como removerDispositivoPush: where token + returning)', async () => {
    // O DELETE com WHERE/RETURNING também passa pela policy de SELECT: ela não pode exigir vínculo.
    await admin(`insert into push_dispositivos (user_id, empresa_id, plataforma, token) values ($1, $2, 'expo', 'tok-p3-antigo')`, [P3, E1]);
    await como(P3);
    expect(await q(`delete from push_dispositivos where token = 'tok-p3-antigo' returning id`)).toHaveLength(1);
    expect(await admin(`select count(*)::int n from push_dispositivos where token = 'tok-p3-antigo'`)).toEqual([{ n: 0 }]);
  });
});

describe('097 em PGlite — registrar_push_dispositivo', () => {
  it('registra o aparelho na empresa ativa e, chamado de novo, troca a empresa (mesmo token)', async () => {
    await como(P1);
    await q(`select public.registrar_push_dispositivo($1, 'expo', ' tok-p1-novo ')`, [E1]);
    expect(await admin(`select user_id, empresa_id from push_dispositivos where token = 'tok-p1-novo'`)).toEqual([{ user_id: P1, empresa_id: E1 }]);
    await q(`select public.registrar_push_dispositivo($1, 'expo', 'tok-p1-novo')`, [E2]);
    expect(await admin(`select user_id, empresa_id from push_dispositivos where token = 'tok-p1-novo'`)).toEqual([{ user_id: P1, empresa_id: E2 }]);
  });

  it('o mesmo aparelho com outra conta passa a ser dessa conta (o login anterior para de receber)', async () => {
    await como(P2);
    await q(`select public.registrar_push_dispositivo($1, 'expo', 'tok-p1-novo')`, [E1]);
    expect(await admin(`select user_id, empresa_id from push_dispositivos where token = 'tok-p1-novo'`)).toEqual([{ user_id: P2, empresa_id: E1 }]);
  });

  it('recusa empresa sem vínculo ativo (42501, em português)', async () => {
    await como(P2);
    expect(await erro(() => q(`select public.registrar_push_dispositivo($1, 'expo', 'tok-z')`, [E3])))
      .toEqual({ msg: 'Você não tem vínculo ativo com esta empresa.', code: '42501' });
    await como(P3);
    expect((await erro(() => q(`select public.registrar_push_dispositivo($1, 'expo', 'tok-z')`, [E1]))).code).toBe('42501');
    expect(await admin(`select count(*)::int n from push_dispositivos where token = 'tok-z'`)).toEqual([{ n: 0 }]);
  });

  it('recusa sem sessão, plataforma inválida e token vazio', async () => {
    await como('');
    expect((await erro(() => q(`select public.registrar_push_dispositivo($1, 'expo', 'tok-y')`, [E1]))).code).toBe('42501');
    await como(P2);
    expect(await erro(() => q(`select public.registrar_push_dispositivo($1, 'sms', 'tok-y')`, [E1])))
      .toEqual({ msg: 'Plataforma de notificação inválida.', code: '22023' });
    expect(await erro(() => q(`select public.registrar_push_dispositivo($1, 'expo', '   ')`, [E1])))
      .toEqual({ msg: 'Token de notificação vazio.', code: '22023' });
  });

  it('anon não executa a função', async () => {
    await db.exec(`reset role; set role anon;`);
    expect((await erro(() => q(`select public.registrar_push_dispositivo($1, 'expo', 'tok-anon')`, [E1]))).msg)
      .toMatch(/permission denied/);
  });
});

describe('097 em PGlite — notificacoes: marcar como lida', () => {
  it('a dona da notificação marca como lida (e desmarca)', async () => {
    await como(P1);
    expect(await q(`update notificacoes set lida = true where id = $1 returning id`, [N1])).toEqual([{ id: N1 }]);
    await q(`update notificacoes set lida = false where id = $1`, [N1]);
    expect(await admin(`select lida from notificacoes where id = $1`, [N1])).toEqual([{ lida: false }]);
  });

  it('não marca a notificação de outra pessoa (0 linhas)', async () => {
    await como(P1);
    expect(await q(`update notificacoes set lida = true where id = $1 returning id`, [N2])).toEqual([]);
    expect(await admin(`select lida from notificacoes where id = $1`, [N2])).toEqual([{ lida: false }]);
  });

  it('recusa mudar qualquer outra coluna pela API, mesmo junto com lida', async () => {
    await como(P1);
    for (const set of [`titulo = 'x'`, `mensagem = 'x'`, `tipo = 'x'`, `empresa_id = '${E2}'`, `created_at = now() - interval '1 day'`, `lida = true, titulo = 'x'`]) {
      expect(await erro(() => q(`update notificacoes set ${set} where id = $1`, [N1])), set)
        .toEqual({ msg: 'Você só pode marcar a notificação como lida.', code: '42501' });
    }
    expect(await admin(`select titulo, lida from notificacoes where id = $1`, [N1])).toEqual([{ titulo: 'Lembrete', lida: false }]);
  });

  it('não passa a notificação para outra pessoa (user_id)', async () => {
    await como(P1);
    expect((await erro(() => q(`update notificacoes set user_id = $1 where id = $2`, [P2, N1]))).code).not.toBe('');
    expect(await admin(`select user_id from notificacoes where id = $1`, [N1])).toEqual([{ user_id: P1 }]);
  });

  it('service_role (crons) e funções do banco continuam livres', async () => {
    await db.exec(`reset role; set role service_role;`);
    await q(`update notificacoes set mensagem = 'ajustada' where id = $1`, [N2]);
    expect(await admin(`select mensagem from notificacoes where id = $1`, [N2])).toEqual([{ mensagem: 'ajustada' }]);
    await admin(`update notificacoes set titulo = 'Lembrete 2' where id = $1`, [N2]);
    expect(await admin(`select titulo from notificacoes where id = $1`, [N2])).toEqual([{ titulo: 'Lembrete 2' }]);
  });
});

describe('B4 — push só para aparelho visto nos últimos 30 dias', () => {
  const AGORA = new Date('2026-11-03T12:00:00Z');
  const linhas = [
    { user_id: 'u1', token: 'ExponentPushToken[novo]', visto_em: '2026-11-01T00:00:00Z' },
    { user_id: 'u1', token: 'ExponentPushToken[velho]', visto_em: '2026-09-01T00:00:00Z' },
  ];
  // db falso que aplica o filtro .gte('visto_em', x) de verdade
  function dbComFiltro() {
    const filtros: [string, string][] = [];
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b,
      gte: (col: string, v: string) => { filtros.push([col, v]); return b; },
      then: (ok: (v: unknown) => unknown) =>
        ok({ data: linhas.filter(l => filtros.every(([, v]) => l.visto_em >= v)), error: null }),
    };
    return { db: { from: () => b, rpc: () => Promise.resolve({}) }, filtros };
  }

  it('o cron lê com visto_em >= agora - 30 dias e o aparelho antigo não recebe push', async () => {
    const { db, filtros } = dbComFiltro();
    const disp = await carregarDispositivosExpo(db, 'emp-1', ['u1'], { legado: false, agora: AGORA });
    expect(filtros).toEqual([['visto_em', limiteVistoEm(AGORA)]]);
    expect(limiteVistoEm(AGORA)).toBe('2026-10-04T12:00:00.000Z');
    const chamadas: string[] = [];
    const fetchFn = (async (_u: string, init: RequestInit) => {
      const corpo = JSON.parse(String(init.body)) as { to: string }[];
      chamadas.push(...corpo.map(m => m.to));
      return new Response(JSON.stringify({ data: corpo.map(() => ({ status: 'ok', id: 'r' })) }), { status: 200 });
    }) as unknown as typeof fetch;
    const n = await enviarPushExpo(db, disp, [{ userId: 'u1', titulo: 'T', corpo: 'C' }], { fetchFn });
    expect(n).toBe(1);
    expect(chamadas).toEqual(['ExponentPushToken[novo]']);
  });

  it('o app renova o aparelho ao abrir sem nunca pedir permissão fora de ativarNotificacoes', () => {
    const layout = readFileSync(join(raiz, 'mobile', 'app', '_layout.tsx'), 'utf8');
    const notif = readFileSync(join(raiz, 'mobile', 'lib', 'notifications.ts'), 'utf8');
    expect(layout).toMatch(/sincronizarPushDispositivo\(\{[^}]*pedirPermissao: false/);
    expect(layout).not.toContain('requestPermissionsAsync');
    // o único pedido de permissão fica atrás de opts.pedirPermissao
    expect(notif.match(/requestPermissionsAsync/g)).toHaveLength(1);
    expect(notif).toMatch(/statusAtual !== 'granted' && opts\.pedirPermissao/);
  });
});
