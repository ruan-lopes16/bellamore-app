// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Migration 094 (spec docs/superpowers/specs/2026-10-19-paridade-agenda-design.md, "Migration 094"):
 * trava de Concluído com comanda, avaliação com o profissional certo e preferência de abertura da
 * agenda. Lida como texto e exercitada num Postgres em memória (PGlite, nada de banco real) sobre
 * fixtures/schema-agenda-094.sql (RLS e triggers de produção na 093).
 */
const raiz = join(process.cwd(), '..');
const migr = (n: string) => readFileSync(join(raiz, 'supabase', 'migrations', n), 'utf8');
const fixture = (n: string) => readFileSync(join(process.cwd(), 'tests', 'unit', 'fixtures', n), 'utf8');

const ARQ = '094_agenda_status_avaliacao_preferencia.sql';
const sql = migr(ARQ).toLowerCase().replace(/\r\n/g, '\n');
const semComentario = (s: string) => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const corpo = semComentario(sql);

function policy(nome: string): string {
  const ini = corpo.indexOf(`create policy "${nome}"`);
  expect(ini, `policy ${nome} não encontrada`).toBeGreaterThanOrEqual(0);
  return corpo.slice(ini, corpo.indexOf(';', ini));
}
function funcao(nome: string): string {
  const ini = corpo.indexOf(`create or replace function public.${nome}(`);
  expect(ini, `função ${nome} não encontrada`).toBeGreaterThanOrEqual(0);
  const fim = corpo.indexOf('$$;', corpo.indexOf('as $$', ini) + 5);
  return corpo.slice(ini, fim + 3);
}

describe('migration 094 — texto', () => {
  it('trava de Concluído: trigger BEFORE UPDATE OF status em agendamentos, recriado de forma idempotente', () => {
    expect(corpo).toContain('drop trigger if exists trg_trava_concluido_com_comanda on public.agendamentos;');
    expect(corpo).toMatch(/create trigger trg_trava_concluido_com_comanda\s+before update of status on public\.agendamentos/);
    const f = funcao('fn_trava_concluido_com_comanda');
    expect(f).toContain("old.status = 'concluido'");
    expect(f).toContain('old.comanda_id is not null');
    expect(f).toContain("new.status <> 'concluido'");
    expect(migr(ARQ)).toContain('Já fechado na comanda. Para mudar, edite a comanda.');
  });

  it('avaliação: trigger BEFORE INSERT OR UPDATE, security definer com search_path fixo', () => {
    expect(corpo).toContain('drop trigger if exists trg_avaliacao_profissional on public.avaliacoes;');
    expect(corpo).toMatch(/create trigger trg_avaliacao_profissional\s+before insert or update on public\.avaliacoes/);
    const f = funcao('fn_avaliacao_profissional');
    expect(f).toContain('security definer');
    expect(f).toContain('set search_path = public');
    expect(f).toContain('new.profissional_id');
    expect(f).toContain('public.empresa_membros');
  });

  it('avaliação: a policy ampla da 030 sai e entram as 4 novas (cada uma com drop antes)', () => {
    expect(corpo).toContain('drop policy if exists "empresa_all_avaliacoes" on public.avaliacoes;');
    for (const nome of ['avaliacoes: membro ve', 'avaliacoes: quem atende grava', 'avaliacoes: quem atende altera', 'avaliacoes: gestor apaga']) {
      const drop = corpo.indexOf(`drop policy if exists "${nome}" on public.avaliacoes;`);
      expect(drop, `drop de ${nome}`).toBeGreaterThanOrEqual(0);
      expect(drop).toBeLessThan(corpo.indexOf(`create policy "${nome}"`));
    }
    expect(policy('avaliacoes: membro ve')).toContain('for select');
    expect(policy('avaliacoes: quem atende grava')).toContain('for insert');
    expect(policy('avaliacoes: quem atende grava')).toContain("agenda.gerenciar_outras");
    expect(policy('avaliacoes: quem atende grava')).toContain('is_gestor_ou_owner');
    expect(policy('avaliacoes: quem atende altera')).toContain('for update');
    expect(policy('avaliacoes: gestor apaga')).toContain('for delete');
    expect(policy('avaliacoes: gestor apaga')).toContain('is_gestor_ou_owner');
  });

  it('preferência: coluna com default e check, função security definer, sem returning, revoke/grant e notify', () => {
    expect(corpo).toMatch(/add column if not exists agenda_abre_em text not null default 'propria'/);
    expect(corpo).toContain("check (agenda_abre_em in ('propria', 'todas'))");
    const f = funcao('salvar_preferencia_agenda');
    expect(f).toContain('returns void');
    expect(f).toContain('security definer');
    expect(f).toContain('set search_path = public');
    expect(f).toContain('auth.uid()');
    expect(f).toContain("'agenda.ver_equipe'");
    expect(f).toContain('get diagnostics');
    expect(f).not.toContain('returning');
    expect(corpo).toContain('revoke all on function public.salvar_preferencia_agenda(uuid, text) from public, anon;');
    expect(corpo).toContain('grant execute on function public.salvar_preferencia_agenda(uuid, text) to authenticated;');
    expect(corpo.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it('conferência: editar_comanda da 093 só muda valor e desconto do atendimento (nunca o status)', () => {
    const t = migr('093_alinhamentos_finais.sql').toLowerCase().replace(/\r\n/g, '\n');
    const ini = t.indexOf('create or replace function public.editar_comanda(');
    const fim = t.indexOf('$$;', ini);
    const ed = t.slice(ini, fim);
    const upd = ed.slice(ed.indexOf('update public.agendamentos'), ed.indexOf(';', ed.indexOf('update public.agendamentos')));
    expect(upd).toContain('set valor');
    expect(upd).not.toContain('status');
    expect(ed.match(/update public\.agendamentos/g)).toHaveLength(1);
  });
});

// ── PGlite ─────────────────────────────────────────────────────

const id = (pfx: string, n: number) => `00000000-0000-0000-0000-${pfx}${String(n).padStart(12 - pfx.length, '0')}`;
const E = id('e', 1);
const E2 = id('e', 2);
const DONA = id('d', 1);
const GE = id('a', 9);
const P1 = id('a', 1);
const P2 = id('a', 2);
const CL = id('c', 1);
const CL2 = id('c', 2);
const CM = id('f', 1);
const ag = (n: number) => id('0', n);
/** Chaves que a profissional não tem no padrão (shared/permissoes.ts). */
const PADRAO_PROFISSIONAL = 'agenda.ver_equipe,agenda.gerenciar_outras,equipe.gerenciar';

let db: PGlite;

async function como(user: string, negar = '') {
  await db.exec(`reset role;
    select set_config('app.uid', '${user}', false);
    select set_config('app.negar', '${negar}', false);
    set role authenticated;`);
}
async function admin<T = Record<string, unknown>>(q: string, p: unknown[] = []): Promise<T[]> {
  await db.exec('reset role');
  return (await db.query<T>(q, p)).rows;
}
async function q<T = Record<string, unknown>>(s: string, p: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(s, p)).rows;
}
async function erro(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); } catch (e) { return (e as Error).message; }
  return '(sem erro)';
}
const membroId = async (user: string) =>
  (await admin<{ id: string }>(`select id from empresa_membros where empresa_id = $1 and user_id = $2`, [E, user]))[0].id;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(fixture('schema-agenda-094.sql'));
  await db.exec(migr(ARQ));
  await db.exec(`
    insert into empresas values ('${E}', '${DONA}'), ('${E2}', '${id('d', 2)}');
    insert into empresa_membros (empresa_id, user_id, role) values
      ('${E}', '${DONA}', 'owner'), ('${E}', '${GE}', 'gestor'),
      ('${E}', '${P1}', 'profissional'), ('${E}', '${P2}', 'profissional');
    insert into empresa_membros (empresa_id, user_id, role) values ('${E2}', '${P1}', 'profissional');
    insert into clientes values ('${CL}', '${E}'), ('${CL2}', '${E}');
    insert into comandas values ('${CM}', '${E}');
    insert into agendamentos (id, empresa_id, profissional_id, cliente_id, comanda_id, status) values
      ('${ag(1)}', '${E}', '${P1}', '${CL}', '${CM}', 'concluido'),
      ('${ag(2)}', '${E}', '${P1}', '${CL}', null,    'concluido'),
      ('${ag(3)}', '${E}', '${P1}', '${CL}', null,    'concluido'),
      ('${ag(4)}', '${E}', '${P2}', '${CL}', null,    'concluido'),
      ('${ag(5)}', '${E}', '${P1}', '${CL2}', null,   'concluido');
  `);
}, 60_000);

describe('094 em PGlite — trava de Concluído', () => {
  it('Concluído fechado na comanda não volta para outro status (nem para a dona)', async () => {
    await como(DONA);
    expect(await erro(() => q(`update agendamentos set status = 'agendado' where id = $1`, [ag(1)])))
      .toBe('Já fechado na comanda. Para mudar, edite a comanda.');
    expect(await admin(`select status::text s from agendamentos where id = $1`, [ag(1)])).toEqual([{ s: 'concluido' }]);
  });

  it('o erro sai como P0001 (mensagemErroBanco mostra o texto)', async () => {
    await db.exec('reset role');
    let code = '';
    try { await db.query(`update agendamentos set status = 'cancelado' where id = $1`, [ag(1)]); }
    catch (e) { code = (e as { code?: string }).code ?? ''; }
    expect(code).toBe('P0001');
  });

  it('mexer em outra coluna do atendimento fechado continua passando', async () => {
    await como(P1, PADRAO_PROFISSIONAL);
    await q(`update agendamentos set valor = 80 where id = $1`, [ag(1)]);
    await q(`update agendamentos set status = 'concluido' where id = $1`, [ag(1)]);
    expect(await admin(`select valor from agendamentos where id = $1`, [ag(1)])).toEqual([{ valor: '80.00' }]);
  });

  it('Concluído sem comanda (atalho do app) pode voltar', async () => {
    await como(P1, PADRAO_PROFISSIONAL);
    await q(`update agendamentos set status = 'agendado' where id = $1`, [ag(2)]);
    expect(await admin(`select status::text s from agendamentos where id = $1`, [ag(2)])).toEqual([{ s: 'agendado' }]);
  });
});

describe('094 em PGlite — avaliação', () => {
  it('profissional_id vindo da tela é ignorado: grava o empresa_membros.id da profissional do atendimento', async () => {
    await como(P1, PADRAO_PROFISSIONAL);
    await q(`insert into avaliacoes (empresa_id, agendamento_id, cliente_id, profissional_id, nota)
      values ($1, $2, $3, $4, 5)`, [E, ag(3), CL, await membroId(P2)]);
    expect(await admin(`select profissional_id p from avaliacoes where agendamento_id = $1`, [ag(3)]))
      .toEqual([{ p: await membroId(P1) }]);
  });

  it('com profissional_id lixo (users.id, como o web mandava) também grava o id certo', async () => {
    await como(P1, PADRAO_PROFISSIONAL);
    await q(`update avaliacoes set profissional_id = null, nota = 4 where agendamento_id = $1`, [ag(3)]);
    expect(await admin(`select profissional_id p, nota from avaliacoes where agendamento_id = $1`, [ag(3)]))
      .toEqual([{ p: await membroId(P1), nota: 4 }]);
  });

  it('upsert por agendamento_id (editar a avaliação) passa', async () => {
    await como(P1, PADRAO_PROFISSIONAL);
    await q(`insert into avaliacoes (empresa_id, agendamento_id, cliente_id, nota, comentario) values ($1, $2, $3, 2, 'ok')
      on conflict (agendamento_id) do update set nota = excluded.nota, comentario = excluded.comentario`, [E, ag(3), CL]);
    expect(await admin(`select nota, comentario c, profissional_id p from avaliacoes where agendamento_id = $1`, [ag(3)]))
      .toEqual([{ nota: 2, c: 'ok', p: await membroId(P1) }]);
  });

  it('cliente de outro atendimento é recusado', async () => {
    await como(P1, PADRAO_PROFISSIONAL);
    expect(await erro(() => q(`insert into avaliacoes (empresa_id, agendamento_id, cliente_id, nota) values ($1, $2, $3, 5)`,
      [E, ag(5), CL]))).toBe('A cliente não confere com a do atendimento.');
  });

  it('empresa diferente da do atendimento é recusada', async () => {
    await como(P1, PADRAO_PROFISSIONAL);
    expect(await erro(() => q(`insert into avaliacoes (empresa_id, agendamento_id, cliente_id, nota) values ($1, $2, $3, 5)`,
      [E2, ag(5), CL2]))).toBe('Atendimento não encontrado nesta empresa.');
  });

  it('sem atendimento é recusada', async () => {
    await como(P1, PADRAO_PROFISSIONAL);
    expect(await erro(() => q(`insert into avaliacoes (empresa_id, cliente_id, nota) values ($1, $2, 5)`, [E, CL])))
      .toBe('A avaliação precisa de um atendimento.');
  });

  it('profissional não avalia o atendimento de colega sem agenda.gerenciar_outras', async () => {
    await como(P1, PADRAO_PROFISSIONAL);
    expect(await erro(() => q(`insert into avaliacoes (empresa_id, agendamento_id, cliente_id, nota) values ($1, $2, $3, 5)`,
      [E, ag(4), CL]))).toMatch(/row-level security/);
  });

  it('com agenda.gerenciar_outras avalia o de colega (grava a colega como profissional)', async () => {
    await como(P1, 'agenda.ver_equipe');
    await q(`insert into avaliacoes (empresa_id, agendamento_id, cliente_id, nota) values ($1, $2, $3, 3)`, [E, ag(4), CL]);
    expect(await admin(`select profissional_id p from avaliacoes where agendamento_id = $1`, [ag(4)]))
      .toEqual([{ p: await membroId(P2) }]);
  });

  it('todo membro lê; só gestora/dona apaga', async () => {
    await como(P2, PADRAO_PROFISSIONAL);
    expect((await q(`select id from avaliacoes`)).length).toBe(2);
    await q(`delete from avaliacoes where agendamento_id = $1`, [ag(4)]);
    expect((await admin(`select id from avaliacoes where agendamento_id = $1`, [ag(4)])).length).toBe(1);
    await como(GE);
    await q(`delete from avaliacoes where agendamento_id = $1`, [ag(4)]);
    expect((await admin(`select id from avaliacoes where agendamento_id = $1`, [ag(4)])).length).toBe(0);
  });
});

describe('094 em PGlite — preferência da agenda', () => {
  it('a coluna nasce com "propria" para todos', async () => {
    expect(await admin(`select distinct agenda_abre_em v from empresa_membros`)).toEqual([{ v: 'propria' }]);
  });

  it('"todas" sem agenda.ver_equipe é recusada', async () => {
    await como(P1, PADRAO_PROFISSIONAL);
    expect(await erro(() => q(`select public.salvar_preferencia_agenda($1, 'todas')`, [E])))
      .toBe('Você não tem permissão para ver a agenda da equipe.');
    expect(await admin(`select agenda_abre_em v from empresa_membros where empresa_id = $1 and user_id = $2`, [E, P1]))
      .toEqual([{ v: 'propria' }]);
  });

  it('com a permissão grava "todas" só na própria linha, sem histórico e sem passar pela policy da equipe', async () => {
    await como(P1, 'equipe.gerenciar');
    await q(`select public.salvar_preferencia_agenda($1, 'todas')`, [E]);
    expect(await admin(`select user_id u, agenda_abre_em v from empresa_membros where agenda_abre_em = 'todas'`))
      .toEqual([{ u: P1, v: 'todas' }]);
    expect(await admin(`select count(*)::int n from equipe_historico`)).toEqual([{ n: 0 }]);
    await q(`select public.salvar_preferencia_agenda($1, 'propria')`, [E]);
    expect(await admin(`select count(*)::int n from empresa_membros where agenda_abre_em = 'todas'`)).toEqual([{ n: 0 }]);
  });

  it('não altera a linha da mesma pessoa em outra empresa', async () => {
    await como(P1, '');
    await q(`select public.salvar_preferencia_agenda($1, 'todas')`, [E]);
    expect(await admin(`select agenda_abre_em v from empresa_membros where empresa_id = $1 and user_id = $2`, [E2, P1]))
      .toEqual([{ v: 'propria' }]);
    await q(`select public.salvar_preferencia_agenda($1, 'propria')`, [E]);
  });

  it('empresa em que a pessoa não está (ou vínculo inativo) é recusada', async () => {
    await como(GE);
    expect(await erro(() => q(`select public.salvar_preferencia_agenda($1, 'propria')`, [E2])))
      .toBe('Seu vínculo com esta empresa não foi encontrado.');
    await admin(`update empresa_membros set ativo = false where empresa_id = $1 and user_id = $2`, [E, P2]);
    await como(P2);
    expect(await erro(() => q(`select public.salvar_preferencia_agenda($1, 'propria')`, [E])))
      .toBe('Seu vínculo com esta empresa não foi encontrado.');
    await admin(`update empresa_membros set ativo = true where empresa_id = $1 and user_id = $2`, [E, P2]);
  });

  it('valor inválido e sessão sem usuário são recusados', async () => {
    await como(P1);
    expect(await erro(() => q(`select public.salvar_preferencia_agenda($1, 'outra')`, [E]))).toBe('Preferência de agenda inválida.');
    await como('');
    expect(await erro(() => q(`select public.salvar_preferencia_agenda($1, 'propria')`, [E]))).toBe('Sessão expirada. Entre de novo.');
  });

  it('anon não executa a função', async () => {
    await db.exec(`reset role; set role anon;`);
    expect(await erro(() => q(`select public.salvar_preferencia_agenda($1, 'propria')`, [E]))).toMatch(/permission denied/);
    await db.exec('reset role');
  });
});

describe('094 em PGlite — idempotência', () => {
  it('roda duas vezes sem erro e sem duplicar nada', async () => {
    await db.exec('reset role');
    await db.exec(migr(ARQ));
    await db.exec(migr(ARQ));
    const pols = await admin<{ p: string }>(`select policyname p from pg_policies where tablename = 'avaliacoes' order by 1`);
    expect(pols.map(r => r.p)).toEqual([
      'avaliacoes: gestor apaga', 'avaliacoes: membro ve', 'avaliacoes: quem atende altera', 'avaliacoes: quem atende grava',
    ]);
    const trg = await admin<{ t: string }>(`select tgname t from pg_trigger
      where tgname in ('trg_trava_concluido_com_comanda', 'trg_avaliacao_profissional') order by 1`);
    expect(trg.map(r => r.t)).toEqual(['trg_avaliacao_profissional', 'trg_trava_concluido_com_comanda']);
    await como(DONA);
    expect(await erro(() => q(`update agendamentos set status = 'agendado' where id = $1`, [ag(1)])))
      .toBe('Já fechado na comanda. Para mudar, edite a comanda.');
  });
});
