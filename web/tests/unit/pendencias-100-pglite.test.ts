// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Migration 100 (pendências de dinheiro e falhas silenciosas; spec
 * docs/superpowers/specs/2026-11-03-pendencias-dinheiro-falhas-design.md, seção "Banco") em cima da
 * cadeia 090 → 099, em PGlite (nada de banco real). Esquema montado como no teste pacotes-096, mais
 * fixtures/schema-pendencias-100.sql para a 097–099 e para agendamentos.data_hora_inicio.
 */
const raiz = join(process.cwd(), '..');
const migr = (n: string) => readFileSync(join(raiz, 'supabase', 'migrations', n), 'utf8');
const fixture = (n: string) => readFileSync(join(process.cwd(), 'tests', 'unit', 'fixtures', n), 'utf8');
const ARQ = '100_pendencias_dinheiro_falhas.sql';
const SQL = migr(ARQ);

const id = (pfx: string, n: number) => `00000000-0000-0000-0000-${pfx}${String(n).padStart(12 - pfx.length, '0')}`;
const E = id('e', 1);
const E2 = id('e', 2);
const DONA = id('d', 1);
const DONA2 = id('d', 2);
const P1 = id('a', 1);
const CL = id('c', 1);
const PK = id('f0', 1);
const SV_PACOTE = id('f', 3);
const chave = (n: number) => id('7', n);
const ag = (n: number) => id('ab', n);
const tx = (n: number) => id('ac', n);
const cmd = (n: number) => id('c0', n);
const pc = (n: number) => id('ad', n);

const MSG_VARIOS = (n: number) =>
  `Esta venda tem ${n} pacotes. Para tirar só um, exclua a venda inteira e venda de novo os que ficam.`;
const MSG_SESSAO = 'Um dos pacotes desta venda já tem sessões usadas. Para cancelar, fale com a dona.';
const MSG_TRAVA = 'Já fechado na comanda. Para mudar, edite a comanda.';

let db: PGlite;

async function como(user: string, negar = '') {
  await db.exec(`reset role;
    select set_config('app.uid', '${user}', false);
    select set_config('app.negar', '${negar}', false);
    select set_config('app.ver_equipe', '', false);
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
const vender = (p: Record<string, unknown>) => db.query('select public.vender_pacote($1::jsonb)', [JSON.stringify(p)]);
const excluirPc = (e: string, x: string) => db.query('select public.excluir_pacote_cliente($1, $2)', [e, x]);
const excluirVenda = (e: string, v: string) => db.query('select public.excluir_venda_pacotes($1, $2)', [e, v]);
const venda = (n: number, extra: Record<string, unknown> = {}) => ({
  venda_id: chave(n), empresa_id: E, cliente_id: CL, pacote_id: PK, quantidade: 2, valor_unit: 300,
  desconto: 0, cobranca: 'agora', pagamentos: [{ valor: 600, metodo: 'pix' }], ...extra,
});
const statusTaxa = async (t: string) =>
  (await admin<{ status: string }>('select status from taxas_reserva where id = $1', [t]))[0]?.status;
const novoAg = (n: number, status: string, extra = '') =>
  admin(`insert into agendamentos (id, empresa_id, profissional_id, cliente_id, servico_id, status, valor${extra ? ', ' + extra.split('=')[0] : ''})
    values ($1, $2, $3, $4, $5, $6, 100${extra ? ', ' + extra.split('=')[1] : ''})`, [ag(n), E, P1, CL, SV_PACOTE, status]);
const novaTaxa = (n: number, agN: number, status: string, paga: boolean) =>
  admin(`insert into taxas_reserva (id, empresa_id, agendamento_id, valor, status, paga_em)
    values ($1, $2, $3, 50, $4, ${paga ? "now()" : 'null'})`, [tx(n), E, ag(agN), status]);

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
    insert into clientes values ('${CL}', '${E}');
    insert into servicos values ('${SV_PACOTE}', '${E}', 'Drenagem');
    insert into pacotes (id, empresa_id, validade_dias, nome, ativo, preco) values
      ('${PK}', '${E}', 30, 'Drenagem x3', true, 300);
    insert into pacote_servicos (pacote_id, servico_id, quantidade) values ('${PK}', '${SV_PACOTE}', 3);
  `);
  for (const m of ['096_pacotes_venda_unica.sql', '096_despesas_recorrentes_puladas.sql',
    '097_push_dispositivos_e_notificacoes.sql', '098_cartoes_restaurar_taxas_originais.sql',
    '099_pagbank_recalcular_taxas_cartao.sql']) {
    await db.exec(migr(m));
  }

  // Backfill: taxas 'retida' de atendimentos reabertos ANTES da 100 (o trigger antigo não as devolvia).
  await novoAg(90, 'agendado');
  await novoAg(91, 'confirmado');
  await novoAg(92, 'cancelado');
  await novoAg(93, 'concluido');
  await novaTaxa(90, 90, 'retida', true);
  await novaTaxa(91, 91, 'retida', false);
  await novaTaxa(92, 92, 'retida', true);
  await novaTaxa(93, 93, 'retida', true);

  await db.exec(SQL);
  await db.exec(SQL); // idempotente
}, 90_000);

describe('100 — A1: taxa de reserva retida volta ao reabrir o atendimento', () => {
  it('cancelado → agendado: retida com paga_em volta a pago; sem paga_em volta a pendente', async () => {
    await novoAg(1, 'agendado');
    await novaTaxa(1, 1, 'pago', true);
    await novaTaxa(2, 1, 'pendente', false);
    await admin(`update agendamentos set status = 'cancelado' where id = $1`, [ag(1)]);
    expect([await statusTaxa(tx(1)), await statusTaxa(tx(2))]).toEqual(['retida', 'retida']);
    await admin(`update agendamentos set status = 'agendado' where id = $1`, [ag(1)]);
    expect([await statusTaxa(tx(1)), await statusTaxa(tx(2))]).toEqual(['pago', 'pendente']);
  });

  it('faltou → confirmado também reabre', async () => {
    await novoAg(2, 'agendado');
    await novaTaxa(3, 2, 'pago', true);
    await admin(`update agendamentos set status = 'faltou' where id = $1`, [ag(2)]);
    expect(await statusTaxa(tx(3))).toBe('retida');
    await admin(`update agendamentos set status = 'confirmado' where id = $1`, [ag(2)]);
    expect(await statusTaxa(tx(3))).toBe('pago');
  });

  it('cancelado → concluido direto: a pendente reaberta vira cancelada e a paga continua paga', async () => {
    await novoAg(3, 'cancelado');
    await novaTaxa(4, 3, 'retida', true);
    await novaTaxa(5, 3, 'retida', false);
    await admin(`update agendamentos set status = 'concluido' where id = $1`, [ag(3)]);
    expect([await statusTaxa(tx(4)), await statusTaxa(tx(5))]).toEqual(['pago', 'cancelada']);
  });

  it('cancelado → faltou não mexe na retida (continua não comparecimento)', async () => {
    await novoAg(4, 'cancelado');
    await novaTaxa(6, 4, 'retida', true);
    await admin(`update agendamentos set status = 'faltou' where id = $1`, [ag(4)]);
    expect(await statusTaxa(tx(6))).toBe('retida');
  });

  it('regras da 061 mantidas: concluir cancela a pendente; desfazer a conclusão reativa', async () => {
    await novoAg(5, 'agendado');
    await novaTaxa(7, 5, 'pendente', false);
    await admin(`update agendamentos set status = 'concluido' where id = $1`, [ag(5)]);
    expect(await statusTaxa(tx(7))).toBe('cancelada');
    await admin(`update agendamentos set status = 'agendado' where id = $1`, [ag(5)]);
    expect(await statusTaxa(tx(7))).toBe('pendente');
  });

  it('backfill: só atendimentos hoje agendado/confirmado; cancelado e concluído ficam retida', async () => {
    expect(await statusTaxa(tx(90))).toBe('pago');
    expect(await statusTaxa(tx(91))).toBe('pendente');
    expect(await statusTaxa(tx(92))).toBe('retida');
    expect(await statusTaxa(tx(93))).toBe('retida');
  });
});

describe('100 — A5: validade da sessão pelo dia do atendimento (Brasília)', () => {
  it('atendimento às 22h de Brasília do último dia (01h UTC do dia seguinte) consome a sessão', async () => {
    await admin(`insert into pacote_clientes (id, empresa_id, pacote_id, cliente_id, data_inicio, data_validade, valor_pago, status)
      values ($1, $2, $3, $4, date '2025-12-11', date '2026-01-10', 300, 'ativo')`, [pc(1), E, PK, CL]);
    await novoAg(10, 'agendado', `data_hora_inicio=timestamptz '2026-01-11 01:00:00+00'`);
    await admin(`update agendamentos set status = 'concluido' where id = $1`, [ag(10)]);
    expect(await admin(`select pacote_cliente_id from pacote_uso where agendamento_id = $1`, [ag(10)]))
      .toEqual([{ pacote_cliente_id: pc(1) }]);
  });

  it('atendimento à 01h de Brasília do dia seguinte à validade não consome', async () => {
    await novoAg(11, 'agendado', `data_hora_inicio=timestamptz '2026-01-11 04:00:00+00'`);
    await admin(`update agendamentos set status = 'concluido' where id = $1`, [ag(11)]);
    expect(await admin(`select count(*)::int n from pacote_uso where agendamento_id = $1`, [ag(11)])).toEqual([{ n: 0 }]);
  });

  it('corpo da função = corpo da 078 com só a troca de CURRENT_DATE', () => {
    const corpo = (s: string, marca: RegExp) => {
      const t = s.replace(/\r\n/g, '\n');
      const ini = t.search(marca);
      expect(ini, 'função no arquivo').toBeGreaterThanOrEqual(0);
      const a = t.indexOf('$$', ini) + 2;
      return t.slice(a, t.indexOf('$$;', a));
    };
    const de078 = corpo(migr('078_pacote_uso_so_automatico_fora_comanda.sql'), /CREATE OR REPLACE FUNCTION fn_registrar_uso_pacote\(\)/);
    const de100 = corpo(SQL, /create or replace function public\.fn_registrar_uso_pacote\(\)/i);
    expect(de078.split('CURRENT_DATE').length).toBe(2);
    expect(de100).toBe(de078.replace('CURRENT_DATE', "(NEW.data_hora_inicio at time zone 'America/Sao_Paulo')::date"));
  });

  it('search_path fixo e security definer', async () => {
    const r = await admin<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select prosecdef, proconfig from pg_proc where proname = 'fn_registrar_uso_pacote'`);
    expect(r[0].prosecdef).toBe(true);
    expect(r[0].proconfig).toContain('search_path=public');
  });
});

describe('100 — A2: venda com vários pacotes só sai inteira', () => {
  it('excluir_pacote_cliente recusa quando a venda tem 2 pacotes; nada é apagado', async () => {
    await como(DONA);
    await vender(venda(1));
    expect(await erro(() => excluirPc(E, chave(1)))).toBe(MSG_VARIOS(2));
    expect(await admin(`select count(*)::int n from pacote_clientes where venda_id = $1`, [chave(1)])).toEqual([{ n: 2 }]);
    expect(await admin(`select count(*)::int n from vendas where id = $1`, [chave(1)])).toEqual([{ n: 1 }]);
  });

  it('excluir_pacote_cliente com 1 pacote na venda segue apagando venda e pagamentos (096)', async () => {
    await como(DONA);
    await vender(venda(2, { quantidade: 1, pagamentos: [{ valor: 300, metodo: 'pix' }] }));
    await excluirPc(E, chave(2));
    expect(await admin(`select count(*)::int n from vendas where id = $1`, [chave(2)])).toEqual([{ n: 0 }]);
    expect(await admin(`select count(*)::int n from pagamentos where venda_id = $1`, [chave(2)])).toEqual([{ n: 0 }]);
  });

  it('excluir_venda_pacotes apaga pacotes, pagamentos e a venda; desliga os atendimentos', async () => {
    const pcs = await admin<{ id: string }>(`select id from pacote_clientes where venda_id = $1`, [chave(1)]);
    await novoAg(20, 'agendado');
    await admin(`update agendamentos set pacote_cliente_id = $1 where id = $2`, [pcs[0].id, ag(20)]);
    await como(DONA);
    await excluirVenda(E, chave(1));
    expect(await admin(`select count(*)::int n from pacote_clientes where venda_id = $1 or id = any($2)`,
      [chave(1), pcs.map(x => x.id)])).toEqual([{ n: 0 }]);
    expect(await admin(`select count(*)::int n from pagamentos where venda_id = $1`, [chave(1)])).toEqual([{ n: 0 }]);
    expect(await admin(`select count(*)::int n from vendas where id = $1`, [chave(1)])).toEqual([{ n: 0 }]);
    expect(await admin(`select pacote_cliente_id from agendamentos where id = $1`, [ag(20)])).toEqual([{ pacote_cliente_id: null }]);
  });

  it('recusa com sessão usada e com pacote cobrado numa comanda; nada é apagado', async () => {
    await como(DONA);
    await vender(venda(3));
    const [u] = await admin<{ id: string }>(`select id from pacote_clientes where venda_id = $1 limit 1`, [chave(3)]);
    await admin(`insert into pacote_uso (empresa_id, pacote_cliente_id, servico_id) values ($1, $2, $3)`, [E, u.id, SV_PACOTE]);
    await como(DONA);
    expect(await erro(() => excluirVenda(E, chave(3)))).toBe(MSG_SESSAO);

    await como(DONA);
    await vender(venda(4));
    await admin(`insert into comandas (id, empresa_id, status) values ($1, $2, 'fechada')`, [cmd(1), E]);
    await admin(`update pacote_clientes set comanda_id = $1 where id = $2`, [cmd(1), chave(4)]);
    await como(DONA);
    expect(await erro(() => excluirVenda(E, chave(4)))).toMatch(/cobrado numa comanda/);
    for (const v of [chave(3), chave(4)]) {
      expect(await admin(`select count(*)::int n from pacote_clientes where venda_id = $1`, [v])).toEqual([{ n: 2 }]);
      expect(await admin(`select count(*)::int n from vendas where id = $1`, [v])).toEqual([{ n: 1 }]);
    }
  });

  it('empresa, permissão e venda que não é de pacote', async () => {
    await como(DONA);
    await vender(venda(5));
    expect(await erro(() => excluirVenda(E2, chave(5)))).toBe('Você não faz parte desta empresa.');
    await como(DONA2);
    expect(await erro(() => excluirVenda(E2, chave(5)))).toBe('Venda não encontrada.');
    await como(P1, 'pacotes.vender');
    expect(await erro(() => excluirVenda(E, chave(5)))).toBe('Você não tem permissão para excluir pacote vendido.');
    await admin(`insert into vendas (id, empresa_id, valor_total) values ($1, $2, 10)`, [chave(6), E]);
    await como(DONA);
    expect(await erro(() => excluirVenda(E, chave(6)))).toBe('Esta venda não é de pacote.');
    expect(await admin(`select count(*)::int n from pacote_clientes where venda_id = $1`, [chave(5)])).toEqual([{ n: 2 }]);
  });

  it('definer, search_path, sem returning, grant só para authenticated', async () => {
    const r = await admin<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select prosecdef, proconfig from pg_proc where proname = 'excluir_venda_pacotes'`);
    expect(r[0].prosecdef).toBe(true);
    expect(r[0].proconfig).toContain('search_path=public');
    const t = SQL.toLowerCase();
    expect(t).toContain('revoke all on function public.excluir_venda_pacotes(uuid, uuid) from public, anon;');
    expect(t).toContain('grant execute on function public.excluir_venda_pacotes(uuid, uuid) to authenticated;');
    const ini = t.indexOf('create or replace function public.excluir_venda_pacotes(');
    expect(t.slice(ini, t.indexOf('$$;', t.indexOf('as $$', ini) + 5))).not.toMatch(/\breturning\b/);
    expect(t).toContain("notify pgrst, 'reload schema';");
  });
});

describe('100 — B1: vínculo com a comanda não sai pela API', () => {
  it('authenticated não troca nem apaga comanda_id já gravado; o dono da função (postgres) passa', async () => {
    await admin(`insert into comandas (id, empresa_id, status) values ($1, $2, 'fechada'), ($3, $2, 'fechada')`,
      [cmd(10), E, cmd(11)]);
    await novoAg(30, 'agendado');
    await admin(`update agendamentos set comanda_id = $1 where id = $2`, [cmd(10), ag(30)]);
    await como(P1);
    expect(await erro(() => db.query(`update agendamentos set comanda_id = null where id = $1`, [ag(30)]))).toBe(MSG_TRAVA);
    expect(await erro(() => db.query(`update agendamentos set comanda_id = $1 where id = $2`, [cmd(11), ag(30)]))).toBe(MSG_TRAVA);
    // Mesmo valor passa (fechar_comanda/editar_comanda regravam o mesmo id).
    await db.query(`update agendamentos set comanda_id = $1 where id = $2`, [cmd(10), ag(30)]);
    await admin(`update agendamentos set comanda_id = null where id = $1`, [ag(30)]);
    expect(await admin(`select comanda_id from agendamentos where id = $1`, [ag(30)])).toEqual([{ comanda_id: null }]);
  });

  it('authenticated grava comanda_id em linha sem vínculo (caminho do fechamento)', async () => {
    await novoAg(31, 'agendado');
    await como(P1);
    await db.query(`update agendamentos set comanda_id = $1 where id = $2`, [cmd(10), ag(31)]);
    expect(await admin(`select comanda_id from agendamentos where id = $1`, [ag(31)])).toEqual([{ comanda_id: cmd(10) }]);
  });

  it('função invoker com search_path; trigger before update of comanda_id', async () => {
    const r = await admin<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select prosecdef, proconfig from pg_proc where proname = 'fn_trava_vinculo_comanda'`);
    expect(r[0].prosecdef).toBe(false);
    expect(r[0].proconfig).toContain('search_path=public');
    expect(SQL.toLowerCase().replace(/\s+/g, ' '))
      .toContain('create trigger trg_trava_vinculo_comanda before update of comanda_id on public.agendamentos');
  });
});

// Padrão do papel Profissional (mesmo do cadeia-090-094): a profissional do atendimento fecha a comanda.
const PADRAO_PROFISSIONAL = 'agenda.ver_equipe,agenda.gerenciar_outras,vendas.acessar,estoque.acessar,financeiro.ver,equipe.gerenciar';

describe('100 — B1 encadeado: fechar_comanda e editar_comanda como authenticated passam pela trava', () => {
  it('fecha a comanda e depois edita, sem erro da trg_trava_vinculo_comanda', async () => {
    await novoAg(40, 'agendado');
    const C = cmd(40);
    await como(P1, PADRAO_PROFISSIONAL);
    await db.query('select public.fechar_comanda($1::jsonb)', [JSON.stringify({
      comanda_id: C, empresa_id: E, cliente_id: CL, desconto: 0,
      atendimentos: [{ agendamento_id: ag(40), valor: 100 }], itens: [], pagamentos: [{ valor: 100, metodo: 'pix' }],
    })]);
    expect(await admin(`select comanda_id, status::text s from agendamentos where id = $1`, [ag(40)]))
      .toEqual([{ comanda_id: C, s: 'concluido' }]);

    await como(P1, PADRAO_PROFISSIONAL);
    await db.query('select public.editar_comanda($1::jsonb)', [JSON.stringify({
      comanda_id: C, empresa_id: E, desconto: 10, atendimentos: [{ agendamento_id: ag(40), valor: 100 }], itens: [],
      pagamentos: [{ valor: 90, metodo: 'pix' }],
    })]);
    expect(await admin(`select comanda_id, desconto_rateado d from agendamentos where id = $1`, [ag(40)]))
      .toEqual([{ comanda_id: C, d: '10.00' }]);
    // A trava continua valendo para a API depois do fechamento.
    await como(P1, PADRAO_PROFISSIONAL);
    expect(await erro(() => db.query(`update agendamentos set comanda_id = null where id = $1`, [ag(40)]))).toBe(MSG_TRAVA);
  });
});
