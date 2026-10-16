// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * As quatro migrations pendentes rodadas em SEQUÊNCIA, como em produção (banco na 089):
 * 090 → 091 → 092 → 093, num Postgres em memória (PGlite, nada de banco real). Confere a costura:
 * nenhuma recriação desfaz a anterior e os fluxos do dia a dia passam pelas policies finais com as
 * chaves padrão (shared/permissoes.ts).
 * Esquema: schema-comanda-090.sql + schema-cadeia-090-093.sql + schema-alinhamentos-093.sql (RLS
 * de produção na 089).
 */
const raiz = join(process.cwd(), '..');
const migr = (n: string) => readFileSync(join(raiz, 'supabase', 'migrations', n), 'utf8');
const fixture = (n: string) => readFileSync(join(process.cwd(), 'tests', 'unit', 'fixtures', n), 'utf8');

const id = (pfx: string, n: number) => `00000000-0000-0000-0000-${pfx}${String(n).padStart(12 - pfx.length, '0')}`;
const E = id('e', 1);
const DONA = id('d', 1);
const GE = id('a', 9);
const P1 = id('a', 1);
const P2 = id('a', 2);
const P4 = id('a', 4);   // entra por convite (092)
const CL = id('c', 1);
const SV = id('f', 1);
const PR = id('b', 1);
const MQ = id('9', 1);
const ag = (n: number) => id('0', n);

/** Chaves que a profissional não tem no padrão. */
const PADRAO_PROFISSIONAL = 'agenda.ver_equipe,agenda.gerenciar_outras,vendas.acessar,estoque.acessar,financeiro.ver,equipe.gerenciar';

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
async function q<T = Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, p)).rows;
}
async function n(sql: string, p: unknown[] = []): Promise<number> {
  return Number((await q<{ n: number }>(sql, p))[0].n);
}
async function fechar(p: unknown) {
  return (await db.query<{ id: string }>('select public.fechar_comanda($1::jsonb) as id', [JSON.stringify(p)])).rows[0].id;
}
async function erro(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); } catch (e) { return (e as Error).message; }
  return '(sem erro)';
}
async function novoAtendimento(k: number, prof: string, valor = 100) {
  await admin(`insert into agendamentos (id, empresa_id, profissional_id, cliente_id, servico_id, valor)
    values ($1, $2, $3, $4, $5, $6)`, [ag(k), E, prof, CL, SV, valor]);
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
    insert into empresas (id, owner_id, nome, taxa_cancelamento_ativa, taxa_cancelamento_valor)
      values ('${E}', '${DONA}', 'Bellamore', true, 10);
    insert into users (id, nome, email) values
      ('${DONA}', 'Dona', 'dona@x.com'), ('${GE}', 'Gestora', 'ge@x.com'), ('${P1}', 'P1', 'p1@x.com'),
      ('${P2}', 'P2', 'p2@x.com'), ('${P4}', 'P4', 'p4@x.com');
    insert into auth.users (id, email) values ('${P4}', 'p4@x.com');
    insert into empresa_membros (empresa_id, user_id, percentual_comissao, role, ativo) values
      ('${E}', '${P1}', 40, 'profissional', true), ('${E}', '${P2}', 50, 'profissional', true),
      ('${E}', '${GE}', 0, 'gestor', true);
    insert into clientes values ('${CL}', '${E}');
    insert into servicos values ('${SV}', '${E}', 'Corte');
    insert into produtos values ('${PR}', '${E}', 'Óleo', 'venda', true, 10, 0);
    insert into cartao_maquininhas values ('${MQ}', '${E}', 'Maquininha');
  `);
  for (let k = 1; k <= 6; k++) await novoAtendimento(k, P1);
}, 60_000);

describe('cadeia 090 → 091 → 092 → 093: funções finais', () => {
  it('cada função tem o corpo da última migration que a recriou', async () => {
    const src = (nome: string) => admin<{ s: string }>(
      `select prosrc s from pg_proc where proname = $1`, [nome]).then(r => r[0].s);
    expect(await src('fechar_comanda')).toContain('conferir_vinculos_empresa');            // 093
    expect(await src('editar_comanda')).toContain('conferir_vinculos_empresa');            // 093
    expect(await src('registrar_venda_avulsa_v2')).toContain('conferir_vinculos_empresa'); // 093
    expect(await src('comanda_pertence_ao_profissional')).toContain('m.ativo = true');     // 093
    expect(await src('gerar_taxa_cancelamento')).toContain('cobrar_taxa_cancelamento');    // 091
    expect(await src('aceitar_convite')).toContain('convites_equipe');                     // 092
  });

  it('policies finais: nenhuma ampla sobrou e o INSERT direto em empresa_membros saiu (092)', async () => {
    const nomes = (await admin<{ p: string }>(`select tablename || ': ' || policyname p from pg_policies`)).map(r => r.p);
    for (const ampla of ['vendas: vendas: membro gerencia', 'venda_itens: venda_itens: membro gerencia',
      'pacote_uso: pacote_uso: membro gerencia', 'pagamentos: pagamentos: membro insere',
      'comanda_itens: comanda_itens: membro insere', 'empresa_membros: membros: gestor ou owner convida']) {
      expect(nomes).not.toContain(ampla);
    }
    expect(nomes).toContain('pagamentos: pagamentos: quem fecha insere');
    expect(nomes).toContain('estoque_movimentos: estoque_movimentos: gestor pode inserir'); // 090
  });
});

describe('profissional fecha a própria comanda (chaves padrão)', () => {
  it('pela função, com produto, serviço extra e cartão com taxa 0% (grava 0, líquido = valor)', async () => {
    await como(P1, PADRAO_PROFISSIONAL);
    const C = id('c0', 1);
    expect(await fechar({
      comanda_id: C, empresa_id: E, cliente_id: CL, desconto: 0,
      atendimentos: [{ agendamento_id: ag(1), valor: 100 }],
      itens: [
        { tipo: 'produto', descricao: 'Óleo', produto_id: PR, quantidade: 1, valor_unit: 20 },
        { tipo: 'servico', descricao: 'Escova', servico_id: SV, profissional_id: P2, quantidade: 1, valor_unit: 30 },
      ],
      pagamentos: [{ valor: 150, metodo: 'debito', bandeira: 'visa', taxa_perc: 0, maquininha_id: MQ }],
    })).toBe(C);
    expect(await admin(`select taxa_perc, valor_liquido from pagamentos where comanda_id = $1`, [C]))
      .toEqual([{ taxa_perc: '0.0000', valor_liquido: '150.00' }]);
    expect(await admin(`select status::text s from agendamentos where id = $1`, [ag(1)])).toEqual([{ s: 'concluido' }]);
    expect(await n(`select count(*) n from comanda_itens where comanda_id = $1`, [C])).toBe(2);
    expect(await admin(`select estoque_atual from produtos where id = $1`, [PR])).toEqual([{ estoque_atual: '9.000' }]);
    expect(await admin<{ o: string }>(`select observacao o from vendas`)).toEqual([{ o: 'Via comanda' }]);
  });

  it('editar pela função: pagamento novo no cartão com 0% grava 0', async () => {
    await como(P1, PADRAO_PROFISSIONAL);
    const C = id('c0', 6);
    await fechar({ comanda_id: C, empresa_id: E, cliente_id: CL, desconto: 0,
      atendimentos: [{ agendamento_id: ag(6), valor: 100 }], itens: [], pagamentos: [{ valor: 100, metodo: 'pix' }] });
    await db.query('select public.editar_comanda($1::jsonb)', [JSON.stringify({
      comanda_id: C, empresa_id: E, desconto: 0, atendimentos: [{ agendamento_id: ag(6), valor: 100 }], itens: [],
      pagamentos: [{ valor: 100, metodo: 'credito', bandeira: 'visa', parcelas: 1, taxa_perc: 0, maquininha_id: MQ }],
    })]);
    expect(await admin(`select metodo::text m, taxa_perc, valor_liquido from pagamentos where comanda_id = $1`, [C]))
      .toEqual([{ m: 'credito', taxa_perc: '0.0000', valor_liquido: '100.00' }]);
  });

  it('pelo caminho antigo (telas sem a 090: passos, sem RETURNING) passa pelas policies da 093', async () => {
    await como(P1, PADRAO_PROFISSIONAL);
    const C = id('c0', 2);
    const V = id('5', 2);
    await q(`insert into comandas (id, empresa_id, cliente_id, profissional_id, status, valor_total, fechada_at)
      values ($1, $2, $3, $4, 'fechada', 150, now())`, [C, E, CL, P1]);
    await q(`update agendamentos set comanda_id = $1, status = 'concluido' where id = $2`, [C, ag(2)]);
    await q(`insert into comanda_itens (comanda_id, empresa_id, tipo, descricao, servico_id, profissional_id, quantidade, valor_unit)
      values ($1, $2, 'servico', 'Escova', $3, $4, 1, 30), ($1, $2, 'produto', 'Óleo', null, null, 1, 20)`, [C, E, SV, P2]);
    await q(`insert into vendas (id, empresa_id, cliente_id, valor_total, observacao) values ($1, $2, $3, 20, 'Via comanda')`, [V, E, CL]);
    await q(`insert into venda_itens (empresa_id, venda_id, produto_id, quantidade, preco_unitario) values ($1, $2, $3, 1, 20)`, [E, V, PR]);
    await q(`insert into estoque_movimentos (empresa_id, produto_id, tipo, quantidade, motivo, agendamento_id)
      values ($1, $2, 'saida', 1, 'Produto via comanda', $3)`, [E, PR, ag(2)]);
    await q(`insert into pagamentos (empresa_id, comanda_id, valor, metodo, status) values ($1, $2, 150, 'pix', 'pago')`, [E, C]);
    expect(await admin(`select count(*)::int n from pagamentos where comanda_id = $1`, [C])).toEqual([{ n: 1 }]);
    expect(await admin(`select count(*)::int n from comanda_itens where comanda_id = $1`, [C])).toEqual([{ n: 2 }]);
    expect(await admin(`select estoque_atual from produtos where id = $1`, [PR])).toEqual([{ estoque_atual: '8.000' }]);
  });
});

describe('profissional cancela com taxa (091 depois da 090)', () => {
  it('cancelar cria a taxa; dispensado no cancelamento, nenhuma', async () => {
    await como(P1, PADRAO_PROFISSIONAL);
    await q(`update agendamentos set status = 'cancelado' where id = $1`, [ag(3)]);
    await q(`update agendamentos set status = 'cancelado', cobrar_taxa_cancelamento = false where id = $1`, [ag(4)]);
    expect(await admin(`select agendamento_id a, status, valor from taxas_cancelamento order by agendamento_id`))
      .toEqual([{ a: ag(3), status: 'pendente', valor: '10.00' }]);
  });

  it('atendimento cancelado continua fora da comanda', async () => {
    await como(P1, PADRAO_PROFISSIONAL);
    expect(await erro(() => fechar({ comanda_id: id('c0', 3), empresa_id: E, cliente_id: CL, desconto: 0,
      atendimentos: [{ agendamento_id: ag(3), valor: 100 }], itens: [], pagamentos: [{ valor: 100, metodo: 'pix' }] })))
      .toBe('Atendimento cancelado ou com falta não entra na comanda.');
  });
});

describe('gestora vende avulso e a dona vê os números', () => {
  it('gestora: registrar_venda_avulsa_v2 com cartão 0% e lê a venda', async () => {
    await como(GE);
    const V = id('5', 3);
    expect((await q<{ v: string }>('select public.registrar_venda_avulsa_v2($1, $2, $3, 0, $4::jsonb, $5::jsonb) v', [
      V, E, CL, JSON.stringify([{ produto_id: PR, quantidade: 1, preco_unitario: 20 }]),
      JSON.stringify([{ valor: 20, metodo: 'credito', bandeira: 'visa', parcelas: 1, taxa_perc: 0, valor_liquido: 20, maquininha_id: MQ }]),
    ]))[0].v).toBe(V);
    expect(await n(`select count(*) n from vendas where id = $1`, [V])).toBe(1);
    expect(await n(`select count(*) n from pagamentos where venda_id = $1`, [V])).toBe(1);
  });

  it('dona (Financeiro/Relatórios) lê vendas, itens, pagamentos e extras de todas', async () => {
    const total = async (t: string) => Number((await admin<{ n: number }>(`select count(*) n from ${t}`))[0].n);
    const tot = { vendas: await total('vendas'), venda_itens: await total('venda_itens'),
      pagamentos: await total('pagamentos'), comanda_itens: await total('comanda_itens') };
    await como(DONA);
    for (const [t, v] of Object.entries(tot)) expect(await n(`select count(*) n from ${t}`)).toBe(v);
  });

  it('profissional no padrão não lê vendas (só as próprias comandas)', async () => {
    await como(P2, PADRAO_PROFISSIONAL);
    expect(await n(`select count(*) n from vendas`)).toBe(0);
    expect(await n(`select count(*) n from comandas`)).toBe(0);
  });
});

describe('092 + 093: entra por convite, fecha comanda, perde acesso ao ser desativada', () => {
  it('INSERT direto em empresa_membros recusado; aceite cria o vínculo', async () => {
    await como(GE);
    expect(await erro(() => q(`insert into empresa_membros (empresa_id, user_id, role) values ($1, $2, 'profissional')`, [E, P4])))
      .toMatch(/row-level security/);
    await admin(`insert into convites_equipe (id, empresa_id, user_id, email, role, convidado_por)
      values ($1, $2, $3, 'p4@x.com', 'profissional', $4)`, [id('7', 1), E, P4, DONA]);
    await como(P4);
    await q(`select public.aceitar_convite($1)`, [id('7', 1)]);
    expect(await admin(`select ativo from empresa_membros where user_id = $1`, [P4])).toEqual([{ ativo: true }]);
  });

  it('a convidada fecha a própria comanda; desativada, perde a comanda (item 9) e fica no histórico', async () => {
    await novoAtendimento(7, P4);
    await como(P4, PADRAO_PROFISSIONAL);
    const C = id('c0', 7);
    await fechar({ comanda_id: C, empresa_id: E, cliente_id: CL, desconto: 0,
      atendimentos: [{ agendamento_id: ag(7), valor: 100 }], itens: [], pagamentos: [{ valor: 100, metodo: 'pix' }] });
    expect(await n(`select count(*) n from comandas where id = $1`, [C])).toBe(1);
    await como(DONA);
    await q(`update empresa_membros set ativo = false where user_id = $1`, [P4]);
    expect(await admin<{ a: string }>(`select acao a from equipe_historico where alvo_user_id = $1 and acao = 'desativado'`, [P4]))
      .toEqual([{ a: 'desativado' }]);
    await como(P4, PADRAO_PROFISSIONAL);
    expect(await n(`select count(*) n from comandas`)).toBe(0);
    expect(await n(`select count(*) n from pagamentos`)).toBe(0);
  });
});

describe('ordem: a 093 sem a 090', () => {
  it('é recusada logo no início e não cria nada (fechar_comanda criada sem as colunas da 090 quebraria as telas)', async () => {
    const vazio = new PGlite();
    await vazio.exec(fixture('schema-comanda-090.sql'));
    await vazio.exec(fixture('schema-cadeia-090-093.sql'));
    await vazio.exec(fixture('schema-alinhamentos-093.sql'));
    let msg = '(sem erro)';
    try { await vazio.exec(migr('093_alinhamentos_finais.sql')); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('Rode a migration 090 antes da 093');
    const r = await vazio.query<{ n: number }>(
      `select count(*)::int n from pg_proc where proname in ('fechar_comanda', 'conferir_vinculos_empresa')`);
    expect(r.rows[0].n).toBe(0);
    await vazio.close();
  });
});
