// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Migration 105 (C8: vincular/desvincular pacote ao editar comanda fechada) em cima da cadeia
 * 090 → 101, em PGlite (nada de banco real). Carregador igual ao de conferencias-101-pglite.test.ts.
 */
const raiz = join(process.cwd(), '..');
const migr = (n: string) => readFileSync(join(raiz, 'supabase', 'migrations', n), 'utf8');
const fixture = (n: string) => readFileSync(join(process.cwd(), 'tests', 'unit', 'fixtures', n), 'utf8');
const SQL = migr('105_vincular_pacote_comanda_fechada.sql');

const id = (pfx: string, n: number) => `00000000-0000-0000-0000-${pfx}${String(n).padStart(12 - pfx.length, '0')}`;
const E = id('e', 1);
const DONA = id('d', 1);
const P1 = id('a', 1);
const CL = id('c', 1);
const CL2 = id('c', 2);
const PK = id('f0', 1);
const SV = id('f', 3);
const ag = (n: number) => id('ab', n);
const cmd = (n: number) => id('c0', n);
const pc = (n: number) => id('ad', n);

const PADRAO_PROFISSIONAL = 'agenda.ver_equipe,agenda.gerenciar_outras,vendas.acessar,estoque.acessar,financeiro.ver,equipe.gerenciar';
const MSG_PAGA = 'A comissão deste atendimento já foi paga. Não é possível mudar o vínculo de pacote.';

let db: PGlite;

async function como(user: string, negar = '') {
  await db.exec(`reset role;
    select set_config('app.uid', '${user}', false);
    select set_config('app.negar', '${negar}', false);
    select set_config('app.ver_equipe', '${user === DONA ? '1' : ''}', false);
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
const novoAg = (n: number, cliente = CL) =>
  admin(`insert into agendamentos (id, empresa_id, profissional_id, cliente_id, servico_id, status, valor)
    values ($1, $2, $3, $4, $5, 'agendado', 100)`, [ag(n), E, P1, cliente, SV]);
const novoPacote = (n: number, cliente = CL, cobranca = 'paga') =>
  admin(`insert into pacote_clientes (id, empresa_id, pacote_id, cliente_id, data_inicio, data_validade, valor_pago, status, cobranca)
    values ($1, $2, $3, $4, current_date, current_date + 30, 300, 'ativo', $5)`, [pc(n), E, PK, cliente, cobranca]);
const fechar = (n: number, valor: number, pacote?: string) =>
  db.query('select public.fechar_comanda($1::jsonb)', [JSON.stringify({
    comanda_id: cmd(n), empresa_id: E, cliente_id: CL, desconto: 0,
    atendimentos: [{ agendamento_id: ag(n), valor, ...(pacote ? { pacote_cliente_id: pacote } : {}) }],
    itens: [], pagamentos: valor > 0 ? [{ valor, metodo: 'pix' }] : [],
  })]);
const editarV2 = (n: number, at: Record<string, unknown>, pagamentos: unknown[], desconto = 0) =>
  db.query('select public.editar_comanda_v2($1::jsonb)', [JSON.stringify({
    comanda_id: cmd(n), empresa_id: E, desconto, atendimentos: [{ agendamento_id: ag(n), ...at }], itens: [], pagamentos,
  })]);
const estado = async (n: number) => (await admin<{ pc: string | null; valor: string; usos: number; com: string | null }>(
  `select a.pacote_cliente_id pc, a.valor,
     (select count(*)::int from pacote_uso u where u.agendamento_id = a.id) usos,
     (select string_agg(c.valor_servico::text || '/' || c.status::text || '/' || to_char(c.created_at, 'YYYY-MM-DD'), ',')
        from comissoes c where c.agendamento_id = a.id) com
     from agendamentos a where a.id = $1`, [ag(n)]))[0];

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
    insert into empresas (id, owner_id, nome) values ('${E}', '${DONA}', 'Bellamore');
    insert into users (id, nome, email) values ('${DONA}', 'Dona', 'd@x.com'), ('${P1}', 'P1', 'p1@x.com');
    insert into empresa_membros (empresa_id, user_id, percentual_comissao, role, ativo) values
      ('${E}', '${P1}', 40, 'profissional', true);
    insert into clientes values ('${CL}', '${E}'), ('${CL2}', '${E}');
    insert into servicos values ('${SV}', '${E}', 'Drenagem');
    insert into pacotes (id, empresa_id, validade_dias, nome, ativo, preco) values ('${PK}', '${E}', 30, 'Drenagem x3', true, 300);
    insert into pacote_servicos (pacote_id, servico_id, quantidade) values ('${PK}', '${SV}', 3);
  `);
  for (const m of ['096_pacotes_venda_unica.sql', '096_despesas_recorrentes_puladas.sql',
    '097_push_dispositivos_e_notificacoes.sql', '098_cartoes_restaurar_taxas_originais.sql',
    '099_pagbank_recalcular_taxas_cartao.sql', '100_pendencias_dinheiro_falhas.sql', '101_conferencias_banco.sql']) {
    await db.exec(migr(m));
  }
  await db.exec(SQL);
  await db.exec(SQL); // idempotente
}, 90_000);

describe('105 — vincular pacote ao editar comanda fechada', () => {
  it('cobrada cheia por engano: vincular zera, consome a sessão e apaga a comissão pendente', async () => {
    await novoAg(1);
    await novoPacote(1);
    await como(P1, PADRAO_PROFISSIONAL);
    await fechar(1, 100);
    expect(await estado(1)).toMatchObject({ pc: null, valor: '100.00', usos: 0 });
    expect((await estado(1)).com).toMatch(/^100\.00\/pendente\//);

    await como(P1, PADRAO_PROFISSIONAL);
    await editarV2(1, { valor: 0, pacote_cliente_id: pc(1) }, [{ valor: 100, metodo: 'pix' }]);
    expect(await estado(1)).toEqual({ pc: pc(1), valor: '0.00', usos: 1, com: null });
    expect(await admin(`select valor_total from comandas where id = $1`, [cmd(1)])).toEqual([{ valor_total: '0.00' }]);
  });

  it('desvincular devolve a sessão e cria a comissão sobre o valor cobrado, datada no fechamento', async () => {
    await admin(`update comandas set fechada_at = '2026-10-05T15:00:00Z' where id = $1`, [cmd(1)]);
    await como(DONA);
    await editarV2(1, { valor: 120, pacote_cliente_id: null }, [{ valor: 120, metodo: 'pix' }], 20);
    expect(await estado(1)).toEqual({ pc: null, valor: '120.00', usos: 0, com: '100.00/pendente/2026-10-05' });
  });

  it('sem a chave pacote_cliente_id o vínculo gravado fica como está', async () => {
    await novoAg(2);
    await novoPacote(2);
    await como(DONA);
    await fechar(2, 0, pc(2));
    expect(await estado(2)).toEqual({ pc: pc(2), valor: '0.00', usos: 1, com: null });
    await editarV2(2, { valor: 0 }, []);
    expect(await estado(2)).toEqual({ pc: pc(2), valor: '0.00', usos: 1, com: null });
  });

  it('trocar de um pacote para outro move a sessão', async () => {
    await novoPacote(3);
    await como(DONA);
    await editarV2(2, { valor: 0, pacote_cliente_id: pc(3) }, []);
    expect(await estado(2)).toEqual({ pc: pc(3), valor: '0.00', usos: 1, com: null });
    expect(await admin(`select pacote_cliente_id from pacote_uso where agendamento_id = $1`, [ag(2)]))
      .toEqual([{ pacote_cliente_id: pc(3) }]);
  });
});

describe('105 — recusas', () => {
  it('vincular com valor maior que zero', async () => {
    await novoAg(10);
    await novoPacote(10);
    await como(DONA);
    await fechar(10, 100);
    await como(DONA);
    expect(await erro(() => editarV2(10, { valor: 100, pacote_cliente_id: pc(10) }, [{ valor: 100, metodo: 'pix' }])))
      .toBe('Atendimento coberto por pacote deve ficar com valor R$ 0,00.');
  });

  it('pacote de outra cliente', async () => {
    await novoPacote(11, CL2);
    await como(DONA);
    expect(await erro(() => editarV2(10, { valor: 0, pacote_cliente_id: pc(11) }, [{ valor: 100, metodo: 'pix' }])))
      .toBe('Este pacote é de outra cliente.');
  });

  it('pacote ainda a cobrar', async () => {
    await novoPacote(12, CL, 'pendente');
    await como(DONA);
    expect(await erro(() => editarV2(10, { valor: 0, pacote_cliente_id: pc(12) }, [{ valor: 100, metodo: 'pix' }])))
      .toBe('Este pacote ainda está a cobrar. Cobre o pacote antes de usar a sessão numa comanda já fechada.');
  });

  it('comissão já paga: nada muda', async () => {
    await admin(`update comissoes set status = 'pago' where agendamento_id = $1`, [ag(10)]);
    await como(DONA);
    expect(await erro(() => editarV2(10, { valor: 0, pacote_cliente_id: pc(10) }, [{ valor: 100, metodo: 'pix' }])))
      .toBe(MSG_PAGA);
    expect(await estado(10)).toMatchObject({ pc: null, valor: '100.00', usos: 0 });
  });

  it('sem comanda.editar_fechada as funções auxiliares recusam também pela API', async () => {
    await como(P1, PADRAO_PROFISSIONAL + ',comanda.editar_fechada');
    expect(await erro(() => db.query('select public.aplicar_vinculo_pacote_edicao($1, now())', [ag(1)])))
      .toBe('Você não tem permissão para editar comanda fechada.');
    expect(await erro(() => db.query('select public.comissao_paga_do_atendimento($1)', [ag(1)])))
      .toBe('Você não tem permissão para editar comanda fechada.');
  });

  it('auxiliar chamada direto não muda vínculo nem valor (só deixa sessão/comissão coerentes)', async () => {
    const antes = await estado(2);
    await como(DONA);
    await db.query('select public.aplicar_vinculo_pacote_edicao($1, now())', [ag(2)]);
    expect(await estado(2)).toEqual(antes);
  });
});

describe('105 — editar_comanda (093) fica intocada', () => {
  it('a v1 continua ignorando o vínculo', async () => {
    await como(DONA);
    await db.query('select public.editar_comanda($1::jsonb)', [JSON.stringify({
      comanda_id: cmd(2), empresa_id: E, desconto: 0,
      atendimentos: [{ agendamento_id: ag(2), valor: 0, pacote_cliente_id: null }], itens: [], pagamentos: [],
    })]);
    expect((await estado(2)).pc).toBe(pc(3));
  });

  it('auxiliares definer com search_path; v2 invoker', async () => {
    const r = await admin<{ proname: string; prosecdef: boolean }>(
      `select proname, prosecdef from pg_proc where proname in
        ('editar_comanda_v2', 'comissao_paga_do_atendimento', 'aplicar_vinculo_pacote_edicao') order by proname`);
    expect(r).toEqual([
      { proname: 'aplicar_vinculo_pacote_edicao', prosecdef: true },
      { proname: 'comissao_paga_do_atendimento', prosecdef: true },
      { proname: 'editar_comanda_v2', prosecdef: false },
    ]);
  });
});
