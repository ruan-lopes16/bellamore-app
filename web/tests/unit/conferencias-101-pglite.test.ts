// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Migration 101 (conferências no banco; spec docs/superpowers/specs/2026-11-10-permissoes-pendencias-c-design.md,
 * seção B13) em cima da cadeia 090 → 100, em PGlite (nada de banco real). Carregador igual ao de
 * pendencias-100-pglite.test.ts.
 */
const raiz = join(process.cwd(), '..');
const migr = (n: string) => readFileSync(join(raiz, 'supabase', 'migrations', n), 'utf8');
const fixture = (n: string) => readFileSync(join(process.cwd(), 'tests', 'unit', 'fixtures', n), 'utf8');
const SQL = migr('101_conferencias_banco.sql');

const id = (pfx: string, n: number) => `00000000-0000-0000-0000-${pfx}${String(n).padStart(12 - pfx.length, '0')}`;
const E = id('e', 1);
const E2 = id('e', 2);
const DONA = id('d', 1);
const DONA2 = id('d', 2);
const P1 = id('a', 1);
const CL = id('c', 1);
const PK = id('f0', 1);
const PK2 = id('f0', 2);
const SV_PACOTE = id('f', 3);
const PR = id('b0', 1);
const MQ = id('9', 1);
const MQ2 = id('9', 2);
const BD = id('8', 1);
const BD2 = id('8', 2);
const chave = (n: number) => id('7', n);
const ag = (n: number) => id('ab', n);
const cmd = (n: number) => id('c0', n);
const pc = (n: number) => id('ad', n);

const MSG_CARTAO = 'Maquininha ou bandeira de outra empresa.';
const PADRAO_PROFISSIONAL = 'agenda.ver_equipe,agenda.gerenciar_outras,vendas.acessar,estoque.acessar,financeiro.ver,equipe.gerenciar';

let db: PGlite;
let politicaAntes: { qual: string; with_check: string };

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
const novoAg = (n: number) =>
  admin(`insert into agendamentos (id, empresa_id, profissional_id, cliente_id, servico_id, status, valor)
    values ($1, $2, $3, $4, $5, 'agendado', 100)`, [ag(n), E, P1, CL, SV_PACOTE]);
const cartao = (valor: number) => ({ valor, metodo: 'credito', bandeira: 'visa', parcelas: 1, taxa_perc: 0.05, maquininha_id: MQ });
const pagamentosDuplos = async () =>
  (await admin<{ n: number }>(`select count(*)::int n from pagamentos where comanda_id is not null and venda_id is not null`))[0].n;

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
      ('${PK}', '${E}', 30, 'Drenagem x3', true, 300), ('${PK2}', '${E2}', 30, 'Outro', true, 300);
    insert into pacote_servicos (pacote_id, servico_id, quantidade) values ('${PK}', '${SV_PACOTE}', 3);
    insert into produtos (id, empresa_id, nome, tipo, ativo, estoque_atual, estoque_minimo) values
      ('${PR}', '${E}', 'Óleo', 'venda', true, 10, 0);
    insert into cartao_maquininhas (id, empresa_id, nome) values ('${MQ}', '${E}', 'Maquininha'), ('${MQ2}', '${E2}', 'Outra');
    insert into cartao_bandeiras (id, empresa_id, chave, nome) values ('${BD}', '${E}', 'visa', 'Visa'),
      ('${BD2}', '${E2}', 'visa', 'Visa');
  `);
  for (const m of ['096_pacotes_venda_unica.sql', '096_despesas_recorrentes_puladas.sql',
    '097_push_dispositivos_e_notificacoes.sql', '098_cartoes_restaurar_taxas_originais.sql',
    '099_pagbank_recalcular_taxas_cartao.sql', '100_pendencias_dinheiro_falhas.sql']) {
    await db.exec(migr(m));
  }
  politicaAntes = (await admin<{ qual: string; with_check: string }>(
    `select qual, with_check from pg_policies where tablename = 'pacote_uso' and policyname = 'pacote_uso: altera'`))[0];

  await db.exec(SQL);
  await db.exec(SQL); // idempotente
}, 90_000);

describe('101 — pré-requisito', () => {
  it('recusa rodar sem a 100', async () => {
    const outro = new PGlite();
    expect(await (async () => { try { await outro.exec(SQL); } catch (e) { return (e as Error).message; } return '(sem erro)'; })())
      .toBe('Rode a 100 antes da 101.');
    await outro.close();
  });
});

describe('101 — 1: pacote_uso UPDATE confere a empresa do pacote', () => {
  it('UPDATE apontando o uso para pacote de outra empresa é recusado; para pacote da empresa passa', async () => {
    await admin(`insert into pacote_clientes (id, empresa_id, pacote_id, cliente_id, data_inicio, data_validade, valor_pago, status)
      values ($1, $2, $3, $4, current_date, current_date + 30, 300, 'ativo'),
             ($5, $2, $3, $4, current_date, current_date + 30, 300, 'ativo'),
             ($6, $7, $8, $4, current_date, current_date + 30, 300, 'ativo')`,
    [pc(1), E, PK, CL, pc(2), pc(3), E2, PK2]);
    const [u] = await admin<{ id: string }>(
      `insert into pacote_uso (empresa_id, pacote_cliente_id, servico_id) values ($1, $2, $3) returning id`, [E, pc(1), SV_PACOTE]);
    await como(DONA);
    expect(await erro(() => db.query(`update pacote_uso set pacote_cliente_id = $1 where id = $2`, [pc(3), u.id])))
      .toMatch(/row-level security/);
    expect(await admin(`select pacote_cliente_id from pacote_uso where id = $1`, [u.id])).toEqual([{ pacote_cliente_id: pc(1) }]);
    await como(DONA);
    await db.query(`update pacote_uso set pacote_cliente_id = $1 where id = $2`, [pc(2), u.id]);
    expect(await admin(`select pacote_cliente_id from pacote_uso where id = $1`, [u.id])).toEqual([{ pacote_cliente_id: pc(2) }]);
  });

  it('policy = a da 093 com só a conferência do pacote acrescentada no with check', async () => {
    const [depois] = await admin<{ qual: string; with_check: string }>(
      `select qual, with_check from pg_policies where tablename = 'pacote_uso' and policyname = 'pacote_uso: altera'`);
    expect(depois.qual).toBe(politicaAntes.qual);
    expect(politicaAntes.with_check).not.toContain('pacote_clientes');
    expect(depois.with_check).toContain('pacote_clientes');
    // "registra" (INSERT) continua com a conferência da 093.
    const [reg] = await admin<{ with_check: string }>(
      `select with_check from pg_policies where tablename = 'pacote_uso' and policyname = 'pacote_uso: registra'`);
    expect(reg.with_check).toContain('pacote_clientes');
  });
});

describe('101 — 2: pagamento é da comanda OU da venda', () => {
  it('INSERT e UPDATE com as duas colunas são recusados', async () => {
    await admin(`insert into comandas (id, empresa_id, status) values ($1, $2, 'fechada')`, [cmd(1), E]);
    await admin(`insert into vendas (id, empresa_id, valor_total) values ($1, $2, 10)`, [chave(1), E]);
    expect(await erro(() => admin(`insert into pagamentos (empresa_id, comanda_id, venda_id, valor, metodo, status)
      values ($1, $2, $3, 10, 'pix', 'pago')`, [E, cmd(1), chave(1)]))).toMatch(/pagamentos_comanda_xor_venda/);
    const [p] = await admin<{ id: string }>(`insert into pagamentos (empresa_id, comanda_id, valor, metodo, status)
      values ($1, $2, 10, 'pix', 'pago') returning id`, [E, cmd(1)]);
    expect(await erro(() => admin(`update pagamentos set venda_id = $1 where id = $2`, [chave(1), p.id])))
      .toMatch(/pagamentos_comanda_xor_venda/);
  });

  it('constraint not valid (linhas antigas não são conferidas)', async () => {
    expect(await admin(`select convalidated from pg_constraint where conname = 'pagamentos_comanda_xor_venda'`))
      .toEqual([{ convalidated: false }]);
  });
});

describe('101 — 3: cartões entre empresas', () => {
  it('cartao_taxas: maquininha ou bandeira de outra empresa é recusada; da empresa passa', async () => {
    const ins = (maq: string, band: string | null) => admin(
      `insert into cartao_taxas (empresa_id, maquininha_id, bandeira_id, modalidade, parcelas, taxa) values ($1, $2, $3, 'credito', 2, 0.05)`,
      [E, maq, band]);
    expect(await erro(() => ins(MQ2, null))).toBe(MSG_CARTAO);
    expect(await erro(() => ins(MQ, BD2))).toBe(MSG_CARTAO);
    await ins(MQ, null);
    await ins(MQ, BD);
    expect(await erro(() => admin(`update cartao_taxas set bandeira_id = $1 where bandeira_id = $2`, [BD2, BD]))).toBe(MSG_CARTAO);
    expect(await erro(() => admin(`update cartao_taxas set maquininha_id = $1 where maquininha_id = $2`, [MQ2, MQ]))).toBe(MSG_CARTAO);
  });

  it('pagamentos: maquininha de outra empresa é recusada no INSERT e no UPDATE', async () => {
    expect(await erro(() => admin(`insert into pagamentos (empresa_id, comanda_id, valor, metodo, status, maquininha_id)
      values ($1, $2, 10, 'credito', 'pago', $3)`, [E, cmd(1), MQ2]))).toBe(MSG_CARTAO);
    const [p] = await admin<{ id: string }>(`insert into pagamentos (empresa_id, comanda_id, valor, metodo, status, maquininha_id)
      values ($1, $2, 10, 'credito', 'pago', $3) returning id`, [E, cmd(1), MQ]);
    expect(await erro(() => admin(`update pagamentos set maquininha_id = $1 where id = $2`, [MQ2, p.id]))).toBe(MSG_CARTAO);
    // Pela API também (authenticated).
    await como(DONA);
    expect(await erro(() => db.query(`insert into pagamentos (empresa_id, comanda_id, valor, metodo, status, maquininha_id)
      values ($1, $2, 10, 'credito', 'pago', $3)`, [E, cmd(1), MQ2]))).toBe(MSG_CARTAO);
  });

  it('linha antiga torta não trava update de outra coluna (recálculo de taxa como na 098/099)', async () => {
    await admin('alter table pagamentos disable trigger trg_pagamentos_maquininha_mesma_empresa');
    const [p] = await admin<{ id: string }>(`insert into pagamentos (empresa_id, comanda_id, valor, metodo, status, maquininha_id)
      values ($1, $2, 10, 'credito', 'pago', $3) returning id`, [E, cmd(1), MQ2]);
    await admin('alter table pagamentos enable trigger trg_pagamentos_maquininha_mesma_empresa');
    await admin(`update pagamentos set taxa_perc = 0.04, valor_liquido = 9.6 where id = $1`, [p.id]);
    expect(await admin(`select taxa_perc from pagamentos where id = $1`, [p.id])).toEqual([{ taxa_perc: '0.0400' }]);
  });

  it('função invoker com search_path; triggers por coluna', async () => {
    const r = await admin<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select prosecdef, proconfig from pg_proc where proname = 'fn_cartao_mesma_empresa'`);
    expect(r[0].prosecdef).toBe(false);
    expect(r[0].proconfig).toContain('search_path=public');
    const t = SQL.toLowerCase().replace(/\s+/g, ' ');
    expect(t).toContain('before insert or update of empresa_id, maquininha_id, bandeira_id on public.cartao_taxas');
    expect(t).toContain('before insert or update of empresa_id, maquininha_id on public.pagamentos');
    expect(t).toContain("notify pgrst, 'reload schema';");
  });
});

describe('101 — caminhos normais continuam passando (cartão com maquininha da empresa)', () => {
  it('fechar_comanda (profissional, com produto e cartão) e editar_comanda', async () => {
    await novoAg(1);
    const C = cmd(10);
    await como(P1, PADRAO_PROFISSIONAL);
    await db.query('select public.fechar_comanda($1::jsonb)', [JSON.stringify({
      comanda_id: C, empresa_id: E, cliente_id: CL, desconto: 0,
      atendimentos: [{ agendamento_id: ag(1), valor: 100 }],
      itens: [{ tipo: 'produto', descricao: 'Óleo', produto_id: PR, quantidade: 1, valor_unit: 20 }],
      pagamentos: [cartao(120)],
    })]);
    expect(await admin(`select maquininha_id, venda_id from pagamentos where comanda_id = $1`, [C]))
      .toEqual([{ maquininha_id: MQ, venda_id: null }]);

    const [pag] = await admin<{ id: string }>(`select id from pagamentos where comanda_id = $1`, [C]);
    const [item] = await admin<{ id: string }>(`select id from comanda_itens where comanda_id = $1`, [C]);
    await como(P1, PADRAO_PROFISSIONAL);
    await db.query('select public.editar_comanda($1::jsonb)', [JSON.stringify({
      comanda_id: C, empresa_id: E, desconto: 0,
      atendimentos: [{ agendamento_id: ag(1), valor: 100 }],
      itens: [{ item_id: item.id, tipo: 'produto', descricao: 'Óleo', produto_id: PR, quantidade: 1, valor_unit: 20 }],
      pagamentos: [{ pagamento_id: pag.id, ...cartao(70) }, { ...cartao(50), metodo: 'debito' }],
    })]);
    expect(await admin(`select valor, maquininha_id from pagamentos where comanda_id = $1 order by valor`, [C]))
      .toEqual([{ valor: '50.00', maquininha_id: MQ }, { valor: '70.00', maquininha_id: MQ }]);
    expect(await pagamentosDuplos()).toBe(0);
  });

  it('registrar_venda_avulsa_v2 com cartão', async () => {
    await como(DONA);
    await db.query('select public.registrar_venda_avulsa_v2($1, $2, $3, 0, $4::jsonb, $5::jsonb)', [
      chave(20), E, CL, JSON.stringify([{ produto_id: PR, quantidade: 1, preco_unitario: 20 }]), JSON.stringify([cartao(20)]),
    ]);
    expect(await admin(`select maquininha_id, comanda_id from pagamentos where venda_id = $1`, [chave(20)]))
      .toEqual([{ maquininha_id: MQ, comanda_id: null }]);
  });

  it('vender_pacote com cartão ("Cobrar agora")', async () => {
    await como(DONA);
    await db.query('select public.vender_pacote($1::jsonb)', [JSON.stringify({
      venda_id: chave(30), empresa_id: E, cliente_id: CL, pacote_id: PK, quantidade: 1, valor_unit: 300,
      desconto: 0, cobranca: 'agora', pagamentos: [cartao(300)],
    })]);
    expect(await admin(`select maquininha_id, comanda_id from pagamentos where venda_id = $1`, [chave(30)]))
      .toEqual([{ maquininha_id: MQ, comanda_id: null }]);
    expect(await pagamentosDuplos()).toBe(0);
  });
});
