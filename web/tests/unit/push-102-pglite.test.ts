// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Migration 102 (push de bloqueio e recibos; spec docs/superpowers/specs/2026-11-20-push-graficos-design.md,
 * C14 e B14) em cima da cadeia 090 → 101, em PGlite (nada de banco real). Carregador igual ao de
 * conferencias-101-pglite.test.ts.
 */
const raiz = join(process.cwd(), '..');
const migr = (n: string) => readFileSync(join(raiz, 'supabase', 'migrations', n), 'utf8');
const fixture = (n: string) => readFileSync(join(process.cwd(), 'tests', 'unit', 'fixtures', n), 'utf8');
const SQL = migr('102_push_bloqueio_e_recibos.sql');

const id = (pfx: string, n: number) => `00000000-0000-0000-0000-${pfx}${String(n).padStart(12 - pfx.length, '0')}`;
const E = id('e', 1);
const E2 = id('e', 2);
const DONA = id('d', 1);
const DONA2 = id('d', 2);
const P1 = id('a', 1);
const SV_PACOTE = id('f', 3);
const N_ANTIGA = id('b1', 1);
const N_NOVA = id('b1', 2);
const MSG_LIDA = 'Você só pode marcar a notificação como lida.';

let db: PGlite;

async function como(role: 'authenticated' | 'service_role', user = '') {
  await db.exec(`reset role; select set_config('app.uid', '${user}', false); set role ${role};`);
}
async function admin<T = Record<string, unknown>>(q: string, p: unknown[] = []): Promise<T[]> {
  await db.exec('reset role');
  return (await db.query<T>(q, p)).rows;
}
async function erro(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); } catch (e) { return (e as Error).message; }
  return '(sem erro)';
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(fixture('schema-comanda-090.sql'));
  await db.exec(fixture('schema-cadeia-090-093.sql'));
  await db.exec(fixture('schema-alinhamentos-093.sql'));
  for (const m of ['090_comanda_tudo_ou_nada.sql', '091_taxa_cancelamento_por_atendimento.sql',
    '092_convites_e_historico_equipe.sql', '093_alinhamentos_finais.sql']) {
    await db.exec(migr(m));
  }
  await db.exec(`
    alter table empresa_membros add column if not exists id uuid default gen_random_uuid();
    create table avaliacoes (id uuid primary key default gen_random_uuid(), empresa_id uuid not null,
      agendamento_id uuid unique references agendamentos(id) on delete cascade, cliente_id uuid not null,
      profissional_id uuid, nota smallint not null, comentario text);
    alter table avaliacoes enable row level security;
    grant all on avaliacoes to authenticated;
  `);
  await db.exec(migr('094_agenda_status_avaliacao_preferencia.sql'));
  await db.exec(migr('095_clientes_endereco.sql'));
  await db.exec(fixture('schema-pacotes-096.sql'));
  await db.exec(fixture('schema-pendencias-100.sql'));
  await db.exec(`
    insert into empresas (id, owner_id, nome) values ('${E}', '${DONA}', 'Bellamore'), ('${E2}', '${DONA2}', 'Outra');
    insert into users (id, nome, email) values ('${DONA}', 'Dona', 'd@x.com'), ('${P1}', 'P1', 'p1@x.com'),
      ('${DONA2}', 'Dona2', 'd2@x.com');
    insert into empresa_membros (empresa_id, user_id, percentual_comissao, role, ativo) values
      ('${E}', '${P1}', 40, 'profissional', true);
    insert into clientes values ('${id('c', 1)}', '${E}');
    insert into servicos values ('${SV_PACOTE}', '${E}', 'Drenagem');
    insert into cartao_maquininhas (id, empresa_id, nome) values ('${id('9', 1)}', '${E}', 'Maquininha');
    insert into cartao_bandeiras (id, empresa_id, chave, nome) values ('${id('8', 1)}', '${E}', 'visa', 'Visa');
  `);
  for (const m of ['096_pacotes_venda_unica.sql', '096_despesas_recorrentes_puladas.sql',
    '097_push_dispositivos_e_notificacoes.sql', '098_cartoes_restaurar_taxas_originais.sql',
    '099_pagbank_recalcular_taxas_cartao.sql', '100_pendencias_dinheiro_falhas.sql',
    '101_conferencias_banco.sql']) {
    await db.exec(migr(m));
  }
  // service_role não vem nos fixtures da cadeia 090 (só no da 097): garante o role e os privilégios.
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
    end $$;
    grant usage on schema public, auth to service_role;
    grant all on all tables in schema public to service_role;
    alter default privileges in schema public grant all on tables to service_role, authenticated, anon;
    alter table notificacoes add column if not exists created_at timestamptz default now();
    insert into notificacoes (id, user_id, empresa_id, tipo, titulo, mensagem) values
      ('${N_ANTIGA}', '${DONA}', '${E}', 'bloqueio_pendente', 'Antiga', 'ja existia');
  `);

  await db.exec(SQL);
  await db.exec(SQL); // idempotente
}, 90_000);

describe('102 — pré-requisito', () => {
  it('recusa rodar sem a 101', async () => {
    const outro = new PGlite();
    expect(await erro(() => outro.exec(SQL))).toBe('Rode a 101 antes da 102.');
    await outro.close();
  });
});

describe('102 — push_enviado_em', () => {
  it('backfill marca o que já existia; rodar de novo não marca avisos novos', async () => {
    expect((await admin<{ p: string | null }>(`select push_enviado_em p from notificacoes where id = $1`, [N_ANTIGA]))[0].p).not.toBeNull();
    await admin(`insert into notificacoes (id, user_id, empresa_id, tipo, titulo, mensagem) values ($1, $2, $3, 'bloqueio_pendente', 'Nova', 'x')`,
      [N_NOVA, DONA, E]);
    await db.exec(SQL); // 3ª execução (idempotente) NÃO pode marcar a nova
    expect((await admin<{ p: string | null }>(`select push_enviado_em p from notificacoes where id = $1`, [N_NOVA]))[0].p).toBeNull();
  });

  it('índice parcial das pendentes existe', async () => {
    const r = await admin<{ indexdef: string }>(`select indexdef from pg_indexes where indexname = 'idx_notificacoes_push_pendente'`);
    expect(r).toHaveLength(1);
    expect(r[0].indexdef.toLowerCase()).toContain('push_enviado_em is null');
  });

  it('service role (cron) consegue gravar push_enviado_em (o trigger da 097 não barra) e só uma vez', async () => {
    await como('service_role');
    const r = await db.query<{ id: string }>(
      `update notificacoes set push_enviado_em = now() where id = $1 and push_enviado_em is null returning id`, [N_NOVA]);
    expect(r.rows).toEqual([{ id: N_NOVA }]);
    const r2 = await db.query(`update notificacoes set push_enviado_em = now() where id = $1 and push_enviado_em is null returning id`, [N_NOVA]);
    expect(r2.rows).toEqual([]);
  });

  it('pela API a pessoa continua mudando SÓ `lida`: push_enviado_em e outras colunas são recusadas', async () => {
    await como('authenticated', DONA);
    await db.query(`update notificacoes set lida = true where id = $1`, [N_NOVA]);
    expect(await erro(() => db.query(`update notificacoes set push_enviado_em = null where id = $1`, [N_NOVA]))).toBe(MSG_LIDA);
    expect(await erro(() => db.query(`update notificacoes set titulo = 'x' where id = $1`, [N_NOVA]))).toBe(MSG_LIDA);
    const [n] = await admin<{ lida: boolean; p: string | null }>(`select lida, push_enviado_em p from notificacoes where id = $1`, [N_NOVA]);
    expect(n.lida).toBe(true);
    expect(n.p).not.toBeNull();
  });

  it('trigger da 097 intacto (invoker) e a 102 não o redefine', async () => {
    expect(await admin(`select prosecdef from pg_proc where proname = 'fn_notificacoes_so_lida'`)).toEqual([{ prosecdef: false }]);
    expect(SQL).not.toMatch(/create (or replace )?function public\.fn_notificacoes_so_lida/i);
  });
});

describe('102 — push_recibos', () => {
  it('RLS ligada, nenhuma policy, API sem acesso; service role lê e grava', async () => {
    expect(await admin(`select relrowsecurity from pg_class where relname = 'push_recibos'`)).toEqual([{ relrowsecurity: true }]);
    expect(await admin(`select count(*)::int n from pg_policies where tablename = 'push_recibos'`)).toEqual([{ n: 0 }]);
    await como('authenticated', DONA);
    expect(await erro(() => db.query(`select * from push_recibos`))).toMatch(/permission denied/);
    expect(await erro(() => db.query(`insert into push_recibos (ticket_id, token) values ('t', 'x')`))).toMatch(/permission denied/);
    await como('service_role');
    await db.query(`insert into push_recibos (ticket_id, token) values ('t1', 'ExponentPushToken[a]') on conflict do nothing`);
    await db.query(`insert into push_recibos (ticket_id, token) values ('t1', 'ExponentPushToken[a]') on conflict do nothing`);
    expect((await db.query(`select * from push_recibos`)).rows).toHaveLength(1);
  });
});
