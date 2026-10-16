// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Migration 092 (convite com aceite + histórico da Equipe): por texto e executada de verdade num
 * Postgres em memória (PGlite, sem rede, nada de banco real). Esquema mínimo em
 * tests/unit/fixtures/schema-convites-092.sql, com os triggers de empresa_membros de produção
 * (043/083). As funções rodam com o papel `authenticated`.
 */
const raiz = join(process.cwd(), '..');
const sql092 = readFileSync(join(raiz, 'supabase', 'migrations', '092_convites_e_historico_equipe.sql'), 'utf8');
const stub = readFileSync(join(process.cwd(), 'tests', 'unit', 'fixtures', 'schema-convites-092.sql'), 'utf8');

/** Corpo de `create or replace function public.<nome>(...)` até o `$$;` que o fecha. */
function corpo(nome: string): string {
  const i = sql092.indexOf(`create or replace function public.${nome}(`);
  expect(i, nome).toBeGreaterThanOrEqual(0);
  const ini = sql092.indexOf('$$', i);
  return sql092.slice(i, sql092.indexOf('$$;', ini + 2) + 3);
}

describe('092 por texto', () => {
  it('cabeçalho com rollback e notify no fim', () => {
    expect(sql092).toMatch(/-- Rollback:/);
    expect(sql092).toMatch(/drop table if exists public\.convites_equipe;/);
    expect(sql092).toMatch(/drop table if exists public\.equipe_historico;/);
    expect(sql092.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it('tabelas com RLS, sem escrita para anon/authenticated e com um pendente por (empresa, conta)', () => {
    for (const t of ['convites_equipe', 'equipe_historico']) {
      expect(sql092).toContain(`create table if not exists public.${t} (`);
      expect(sql092).toContain(`alter table public.${t} enable row level security;`);
      expect(sql092).toContain(`revoke insert, update, delete, truncate on public.${t} from anon, authenticated;`);
      expect(sql092).not.toMatch(new RegExp(`on public\\.${t} for (insert|update|delete|all)`));
    }
    expect(sql092).toMatch(/create unique index if not exists convites_equipe_um_pendente\s+on public\.convites_equipe \(empresa_id, user_id\) where status = 'pendente';/);
    expect(sql092).toMatch(/using \(user_id = auth\.uid\(\) or tem_permissao\(empresa_id, 'equipe\.gerenciar'\)\)/);
    for (const a of ['convite_enviado', 'convite_aceito', 'convite_recusado', 'convite_cancelado', 'login_trocado',
      'desativado', 'reativado', 'papel_trocado', 'comissao_trocada', 'contrato_trocado']) {
      expect(sql092).toContain(`'${a}'`);
    }
  });

  it('funções security definer com search_path, conferência de auth.uid() e execute só para authenticated', () => {
    for (const [nome, assinatura] of [
      ['aceitar_convite', 'uuid'], ['recusar_convite', 'uuid'], ['cancelar_convite', 'uuid, uuid'],
      ['listar_historico_equipe', 'uuid, integer, integer'],
    ] as const) {
      const c = corpo(nome);
      expect(c).toMatch(/security definer set search_path = public/);
      expect(c).toMatch(/auth\.uid\(\)\s+is null|v_uid is null/);
      expect(sql092).toContain(`revoke all on function public.${nome}(${assinatura}) from public, anon;`);
      expect(sql092).toContain(`grant execute on function public.${nome}(${assinatura}) to authenticated;`);
    }
    expect(corpo('meus_convites')).toMatch(/security definer set search_path = public/);
    expect(corpo('meus_convites')).toMatch(/c\.user_id = auth\.uid\(\)/);
    for (const nome of ['fn_equipe_historico_convite', 'fn_equipe_historico_membro']) {
      expect(corpo(nome)).toMatch(/security definer set search_path = public/);
    }
  });

  it('aceite confere a conta (id e e-mail do login) e o convite pendente', () => {
    const c = corpo('aceitar_convite');
    expect(c).toMatch(/v\.user_id <> v_uid/);
    expect(c).toMatch(/from auth\.users where id = v_uid/);
    expect(c).toMatch(/v\.status <> 'pendente'/);
    expect(c).toMatch(/for update/);
  });

  it('derruba o INSERT direto em empresa_membros (vínculo só pela rota com service role ou pelo aceite)', () => {
    expect(sql092).toContain('drop policy if exists "membros: gestor ou owner convida" on public.empresa_membros;');
    expect(sql092).not.toMatch(/^create policy [^\n]*on public\.empresa_membros for insert/m);
  });

  it('idempotente: tudo com if not exists / or replace / drop if exists', () => {
    expect(sql092).not.toMatch(/^create table (?!if not exists)/m);
    expect(sql092).not.toMatch(/^create (unique )?index (?!if not exists)/m);
    expect(sql092).not.toMatch(/^create function/m);
    const policies = sql092.match(/^create policy "([^"]+)"/gm) ?? [];
    for (const p of policies) expect(sql092).toContain(`drop policy if exists ${p.slice('create policy '.length)}`);
    const triggers = sql092.match(/^create trigger (\w+)/gm) ?? [];
    for (const t of triggers) expect(sql092).toContain(`drop trigger if exists ${t.slice('create trigger '.length)}`);
  });
});

// ── PGlite ──────────────────────────────────────────────────────────────────

const E = '00000000-0000-0000-0000-0000000000e1';
const E2 = '00000000-0000-0000-0000-0000000000e2';
const DONA = '00000000-0000-0000-0000-0000000000d1';
const GES = '00000000-0000-0000-0000-0000000000a3';
const PROF = '00000000-0000-0000-0000-0000000000a1';
const ANA = '00000000-0000-0000-0000-0000000000b1';   // conta existente, dona de outra empresa
const BIA = '00000000-0000-0000-0000-0000000000b2';   // conta existente, ex-profissional (vínculo inativo)
const CAU = '00000000-0000-0000-0000-0000000000b3';   // conta existente sem vínculo
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

let db: PGlite;

async function como(user: string | null, negar = '') {
  await db.exec(`reset role;
    select set_config('app.uid', '${user ?? ''}', false);
    select set_config('app.negar', '${negar}', false);
    set role authenticated;`);
}
async function admin<T = Record<string, unknown>>(q: string, p: unknown[] = []): Promise<T[]> {
  await db.exec('reset role');
  return (await db.query<T>(q, p)).rows;
}
async function erro(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); } catch (e) { return (e as Error).message; }
  return '(sem erro)';
}
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
async function convite(n: number, user: string, email: string, extra: { role?: string; por?: string; comissao?: number; contrato?: string | null } = {}) {
  await admin(`insert into convites_equipe (id, empresa_id, user_id, email, nome, role, percentual_comissao, tipo_contrato, convidado_por)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id(n), E, user, email, 'Nome ' + n, extra.role ?? 'profissional', extra.comissao ?? 40, 'contrato' in extra ? extra.contrato : 'pj', extra.por ?? DONA]);
}
const historico = (acao: string) => admin<{ alvo_user_id: string; feito_por: string | null; detalhe: Record<string, unknown> }>(
  `select alvo_user_id, feito_por, detalhe from equipe_historico where acao = $1 order by criado_em, id`, [acao]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(stub);
  await db.exec(sql092);
  await db.exec(sql092); // idempotente
  await db.exec(`
    insert into users values ('${DONA}', 'Dona', 'dona@x.com'), ('${GES}', 'Gisa', 'gisa@x.com'),
      ('${PROF}', 'Paula', 'paula@x.com'), ('${ANA}', 'Ana', 'ana@x.com'), ('${BIA}', 'Bia', 'bia@x.com'),
      ('${CAU}', 'Cau', 'cau@x.com');
    insert into auth.users values ('${DONA}', 'dona@x.com'), ('${GES}', 'gisa@x.com'), ('${PROF}', 'paula@x.com'),
      ('${ANA}', 'Ana@X.com'), ('${BIA}', 'bia@x.com'), ('${CAU}', 'cau@x.com');
    insert into empresas values ('${E}', '${DONA}', 'Bellamore'), ('${E2}', '${ANA}', 'Studio Ana');
    insert into empresa_membros (empresa_id, user_id, role, percentual_comissao, tipo_contrato, ativo) values
      ('${E}', '${DONA}', 'owner', 0, null, true), ('${E}', '${GES}', 'gestor', 0, null, true),
      ('${E}', '${PROF}', 'profissional', 30, null, true), ('${E}', '${BIA}', 'profissional', 10, 'clt', false),
      ('${E2}', '${ANA}', 'owner', 0, null, true);
  `);
}, 60_000);

describe('aceitar_convite', () => {
  it('a convidada vê o convite (com o nome da empresa) e aceita: vínculo novo com papel, comissão e contrato do convite', async () => {
    await convite(1, ANA, 'ana@x.com', { comissao: 45.5, contrato: 'pj' });
    await como(ANA);
    const meus = await q<{ id: string; empresa_nome: string; role: string; convidado_por_nome: string }>('select * from public.meus_convites()');
    expect(meus).toMatchObject([{ id: id(1), empresa_nome: 'Bellamore', role: 'profissional', convidado_por_nome: 'Dona' }]);
    // Antes de aceitar, nenhum vínculo.
    expect(await admin(`select 1 from empresa_membros where empresa_id = $1 and user_id = $2`, [E, ANA])).toHaveLength(0);
    await como(ANA);
    const [{ e }] = await q<{ e: string }>('select public.aceitar_convite($1) as e', [id(1)]);
    expect(e).toBe(E);
    expect(await admin(`select role::text, percentual_comissao, tipo_contrato, ativo from empresa_membros where empresa_id = $1 and user_id = $2`, [E, ANA]))
      .toEqual([{ role: 'profissional', percentual_comissao: '45.50', tipo_contrato: 'pj', ativo: true }]);
    expect(await admin(`select status, respondido_em is not null as r from convites_equipe where id = $1`, [id(1)])).toEqual([{ status: 'aceito', r: true }]);
    const aceito = await historico('convite_aceito');
    expect(aceito).toHaveLength(1);
    expect(aceito[0]).toMatchObject({ alvo_user_id: ANA, feito_por: ANA });
    const enviado = (await historico('convite_enviado')).filter(h => h.alvo_user_id === ANA);
    expect(enviado[0]).toMatchObject({ feito_por: DONA, detalhe: { email: 'ana@x.com', role: 'profissional' } });
    await como(ANA);
    expect(await q('select * from public.meus_convites()')).toHaveLength(0);
  });

  it('vínculo inativo: reativa sem mudar o papel, com a comissão e o contrato do convite, sem histórico duplicado', async () => {
    await convite(2, BIA, 'bia@x.com', { comissao: 50, contrato: null });
    await como(BIA);
    await q('select public.aceitar_convite($1)', [id(2)]);
    expect(await admin(`select role::text, percentual_comissao, tipo_contrato, ativo from empresa_membros where empresa_id = $1 and user_id = $2`, [E, BIA]))
      .toEqual([{ role: 'profissional', percentual_comissao: '50.00', tipo_contrato: null, ativo: true }]);
    expect((await admin(`select acao from equipe_historico where alvo_user_id = $1 order by criado_em, id`, [BIA])).map(r => r.acao))
      .toEqual(['convite_enviado', 'convite_aceito']);
  });

  it('só a conta convidada: outra conta, e-mail do login diferente, sem sessão e convite já respondido são recusados', async () => {
    await convite(3, CAU, 'cau@x.com');
    await como(PROF);
    expect(await erro(() => q('select public.aceitar_convite($1)', [id(3)]))).toBe('Convite não encontrado.');
    expect(await erro(() => q('select public.recusar_convite($1)', [id(3)]))).toBe('Convite não encontrado.');
    await como(null);
    expect(await erro(() => q('select public.aceitar_convite($1)', [id(3)]))).toBe('Sessão expirada. Entre de novo.');
    // Login trocado depois do convite: o e-mail não bate mais.
    await admin(`update auth.users set email = 'outro@x.com' where id = $1`, [CAU]);
    await como(CAU);
    expect(await erro(() => q('select public.aceitar_convite($1)', [id(3)]))).toBe('Convite não encontrado.');
    expect(await q('select * from public.meus_convites()')).toHaveLength(0);
    await admin(`update auth.users set email = 'cau@x.com' where id = $1`, [CAU]);
    await como(ANA);
    expect(await erro(() => q('select public.aceitar_convite($1)', [id(1)]))).toBe('Este convite já foi respondido ou cancelado.');
    expect(await admin(`select 1 from empresa_membros where empresa_id = $1 and user_id = $2`, [E, CAU])).toHaveLength(0);
  });

  it('convite de gestora feito por quem não é a dona é inválido; papel diferente do vínculo inativo = desatualizado', async () => {
    await admin(`delete from convites_equipe where id = $1`, [id(3)]);
    await convite(4, CAU, 'cau@x.com', { role: 'gestor', por: GES });
    await como(CAU);
    expect(await erro(() => q('select public.aceitar_convite($1)', [id(4)]))).toBe('Convite inválido: só a dona pode convidar uma gestora.');
    await admin(`delete from convites_equipe where id = $1`, [id(4)]);
    await admin(`update empresa_membros set ativo = false where empresa_id = $1 and user_id = $2`, [E, BIA]);
    await admin(`insert into convites_equipe (id, empresa_id, user_id, email, role, convidado_por) values ($1, $2, $3, 'bia@x.com', 'gestor', $4)`, [id(5), E, BIA, DONA]);
    await como(BIA);
    expect(await erro(() => q('select public.aceitar_convite($1)', [id(5)])))
      .toBe('Este convite está desatualizado: o papel desta pessoa na equipe mudou. Peça um novo convite.');
    expect(await admin(`select ativo, role::text from empresa_membros where empresa_id = $1 and user_id = $2`, [E, BIA])).toEqual([{ ativo: false, role: 'profissional' }]);
    expect(await admin(`select status from convites_equipe where id = $1`, [id(5)])).toEqual([{ status: 'pendente' }]);
  });
});

describe('recusar_convite e cancelar_convite', () => {
  it('recusar marca recusado, não cria vínculo e grava no histórico', async () => {
    await convite(6, CAU, 'cau@x.com');
    await como(CAU);
    await q('select public.recusar_convite($1)', [id(6)]);
    expect(await admin(`select status from convites_equipe where id = $1`, [id(6)])).toEqual([{ status: 'recusado' }]);
    expect(await admin(`select 1 from empresa_membros where empresa_id = $1 and user_id = $2`, [E, CAU])).toHaveLength(0);
    expect((await historico('convite_recusado')).map(h => h.feito_por)).toEqual([CAU]);
    expect(await erro(() => q('select public.recusar_convite($1)', [id(6)]))).toBe('Este convite já foi respondido ou cancelado.');
  });

  it('um pendente por (empresa, conta)', async () => {
    await convite(7, CAU, 'cau@x.com');
    expect(await erro(() => convite(8, CAU, 'cau@x.com'))).toMatch(/duplicate key|convites_equipe_um_pendente/);
  });

  it('cancelar: equipe.gerenciar; gestora não cancela convite de gestora; profissional sem a chave recusada', async () => {
    await como(PROF, 'equipe.gerenciar');
    expect(await erro(() => q('select public.cancelar_convite($1, $2)', [E, id(7)]))).toBe('Sem permissão para gerenciar a equipe.');
    await como(GES);
    expect(await erro(() => q('select public.cancelar_convite($1, $2)', [E2, id(7)]))).toBe('Sem permissão para gerenciar a equipe.');
    await q('select public.cancelar_convite($1, $2)', [E, id(7)]);
    expect(await admin(`select status from convites_equipe where id = $1`, [id(7)])).toEqual([{ status: 'cancelado' }]);
    expect((await historico('convite_cancelado')).map(h => h.feito_por)).toEqual([GES]);
    await como(GES);
    expect(await erro(() => q('select public.cancelar_convite($1, $2)', [E, id(5)]))).toBe('Só a dona pode cancelar o convite de uma gestora.');
    await como(DONA);
    await q('select public.cancelar_convite($1, $2)', [E, id(5)]);
    expect(await erro(() => q('select public.cancelar_convite($1, $2)', [E, id(5)]))).toBe('Este convite já foi respondido ou cancelado.');
    expect(await erro(() => q('select public.cancelar_convite($1, $2)', [E, id(999)]))).toBe('Convite não encontrado.');
  });
});

describe('RLS e privilégios', () => {
  it('authenticated não grava nas tabelas novas; leitura de convites só da convidada e de quem tem equipe.gerenciar', async () => {
    await como(CAU);
    expect(await erro(() => q(`insert into convites_equipe (empresa_id, user_id, email, role) values ($1, $2, 'cau@x.com', 'profissional')`, [E, CAU])))
      .toMatch(/permission denied/);
    expect(await erro(() => q(`update convites_equipe set status = 'aceito'`))).toMatch(/permission denied/);
    expect(await erro(() => q(`insert into equipe_historico (empresa_id, acao) values ($1, 'desativado')`, [E]))).toMatch(/permission denied/);
    expect(await erro(() => q(`delete from equipe_historico`))).toMatch(/permission denied/);
    const meus = await q<{ user_id: string }>('select user_id from convites_equipe');
    expect(meus.length).toBeGreaterThan(0);
    expect(meus.every(c => c.user_id === CAU)).toBe(true);
    await como(PROF, 'equipe.gerenciar');
    expect(await q('select 1 from convites_equipe')).toHaveLength(0);
    await como(GES);
    expect((await q('select 1 from convites_equipe')).length).toBeGreaterThan(1);
    // Histórico direto: só a dona.
    expect(await q('select 1 from equipe_historico')).toHaveLength(0);
    await como(DONA);
    expect((await q('select 1 from equipe_historico')).length).toBeGreaterThan(0);
    await db.exec('reset role; set role anon');
    expect(await erro(() => q('select public.meus_convites()'))).toMatch(/permission denied/);
    expect(await erro(() => q('select 1 from convites_equipe'))).toMatch(/permission denied/);
  });

  it('ninguém vincula conta existente direto pela API REST: INSERT em empresa_membros recusado, nem pela dona', async () => {
    // O user_id da convidada é visível para quem convidou (convites_equipe e resposta da rota).
    for (const [quem, role] of [[GES, 'profissional'], [DONA, 'profissional'], [DONA, 'gestor']] as const) {
      await como(quem);
      expect(await erro(() => q(`insert into empresa_membros (empresa_id, user_id, role, ativo) values ($1, $2, $3, true)`, [E, CAU, role])))
        .toMatch(/row-level security|permission denied/);
    }
    // Reatribuir um vínculo existente a outra conta continua barrado (043).
    await como(GES);
    expect(await erro(() => q(`update empresa_membros set user_id = $1 where empresa_id = $2 and user_id = $3`, [CAU, E, PROF])))
      .toMatch(/reatribuir/);
    expect(await admin(`select 1 from empresa_membros where empresa_id = $1 and user_id = $2`, [E, CAU])).toHaveLength(0);
  });
});

describe('histórico de empresa_membros e listar_historico_equipe', () => {
  it('desativar, reativar, comissão, contrato e papel viram linhas; e-mail mascarado para quem não é a dona', async () => {
    await admin(`delete from equipe_historico`);
    await como(DONA);
    await q(`update empresa_membros set ativo = false where empresa_id = $1 and user_id = $2`, [E, PROF]);
    await q(`update empresa_membros set ativo = true, percentual_comissao = 35, tipo_contrato = 'clt' where empresa_id = $1 and user_id = $2`, [E, PROF]);
    await q(`update empresa_membros set role = 'gestor' where empresa_id = $1 and user_id = $2`, [E, PROF]);
    // login_trocado: a rota (service role) grava direto.
    await admin(`insert into equipe_historico (empresa_id, alvo_user_id, acao, detalhe, feito_por)
      values ($1, $2, 'login_trocado', '{"de":"paula@x.com","para":"pa@novo.com"}', $3)`, [E, PROF, DONA]);
    const acoes = (await admin<{ acao: string; detalhe: unknown }>(`select acao, detalhe from equipe_historico order by criado_em, id`));
    expect(acoes.map(a => a.acao).sort()).toEqual(['comissao_trocada', 'contrato_trocado', 'desativado', 'login_trocado', 'papel_trocado', 'reativado'].sort());
    expect(acoes.find(a => a.acao === 'comissao_trocada')?.detalhe).toEqual({ de: 30, para: 35 });
    expect(acoes.find(a => a.acao === 'contrato_trocado')?.detalhe).toEqual({ de: null, para: 'clt' });
    expect(acoes.find(a => a.acao === 'papel_trocado')?.detalhe).toEqual({ de: 'profissional', para: 'gestor' });

    await como(DONA);
    const daDona = await q<{ acao: string; detalhe: Record<string, unknown>; alvo_nome: string; feito_por_nome: string }>(
      'select * from public.listar_historico_equipe($1, 50, 0)', [E]);
    expect(daDona[0]).toMatchObject({ acao: 'login_trocado', detalhe: { de: 'paula@x.com', para: 'pa@novo.com' }, alvo_nome: 'Paula', feito_por_nome: 'Dona' });
    await como(GES);
    const daGestora = await q<{ acao: string; detalhe: Record<string, unknown> }>('select * from public.listar_historico_equipe($1, 50, 0)', [E]);
    expect(daGestora[0].detalhe).toEqual({ de: 'pa***@x.com', para: 'p***@novo.com' });
    expect(daGestora).toHaveLength(daDona.length);
    const pagina = await q('select * from public.listar_historico_equipe($1, 2, 2)', [E]);
    expect(pagina).toHaveLength(2);
    await como(PROF, 'equipe.gerenciar');
    expect(await erro(() => q('select * from public.listar_historico_equipe($1, 50, 0)', [E]))).toBe('Sem permissão para ver o histórico da equipe.');
  });

  it('mascarar_email', async () => {
    const m = async (e: string | null) => (await admin<{ r: string | null }>('select public.mascarar_email($1) as r', [e]))[0].r;
    expect(await m('thalia@gmail.com')).toBe('th***@gmail.com');
    expect(await m('a@x.com')).toBe('a***@x.com');
    expect(await m('sem-arroba')).toBe('sem-arroba');
    expect(await m(null)).toBeNull();
  });
});
