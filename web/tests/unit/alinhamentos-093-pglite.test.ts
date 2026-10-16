// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Migration 093 executada de verdade num Postgres em memória (PGlite, sem rede, nada de banco real),
 * por cima da 090: vínculo ativo em comanda_pertence_ao_profissional, empresa conferida nas funções
 * e as policies novas de vendas, venda_itens, pacote_uso, pagamentos e comanda_itens.
 * Esquema: fixtures/schema-comanda-090.sql + fixtures/schema-alinhamentos-093.sql.
 * Complementa o teste de texto (alinhamentos-093.test.ts).
 */
const raiz = join(process.cwd(), '..');
const migr = (n: string) => readFileSync(join(raiz, 'supabase', 'migrations', n), 'utf8');
const fixture = (n: string) => readFileSync(join(process.cwd(), 'tests', 'unit', 'fixtures', n), 'utf8');

const id = (pfx: string, n: number) => `00000000-0000-0000-0000-${pfx}${String(n).padStart(12 - pfx.length, '0')}`;
const E = id('e', 1);
const E2 = id('e', 2);
const DONA = id('d', 1);
const DONA2 = id('d', 2);
const GE = id('a', 9);   // gestora de E
const P1 = id('a', 1);   // profissional de E
const P2 = id('a', 2);   // profissional de E
const P3 = id('a', 3);   // profissional só de E2
const CL = id('c', 1);
const CL2 = id('c', 2);  // cliente de E2
const SV = id('f', 1);
const PR = id('b', 1);
const MQ = id('9', 1);
const MQ2 = id('9', 2);  // maquininha de E2
const PC = id('7', 1);   // pacote vendido para CL
const PK = id('8', 1);
const ag = (n: number) => id('0', n);

/** Chaves que a profissional não tem no padrão (shared/permissoes.ts). */
const SEM_GESTAO = 'agenda.ver_equipe,agenda.gerenciar_outras,vendas.acessar,estoque.acessar,financeiro.ver';

let db: PGlite;

async function como(user: string, negar = '', verEquipe = false) {
  await db.exec(`reset role;
    select set_config('app.uid', '${user}', false);
    select set_config('app.negar', '${negar}', false);
    select set_config('app.ver_equipe', '${verEquipe ? '1' : ''}', false);
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
async function novoAtendimento(n: number, prof: string, valor = 100) {
  await admin(`insert into agendamentos (id, empresa_id, profissional_id, cliente_id, servico_id, valor)
    values ($1, $2, $3, $4, $5, $6)`, [ag(n), E, prof, CL, SV, valor]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(fixture('schema-comanda-090.sql'));
  await db.exec(migr('090_comanda_tudo_ou_nada.sql'));
  await db.exec(fixture('schema-alinhamentos-093.sql'));
  await db.exec(migr('093_alinhamentos_finais.sql'));
  await db.exec(migr('093_alinhamentos_finais.sql')); // idempotente
  await db.exec(`
    insert into empresas values ('${E}', '${DONA}'), ('${E2}', '${DONA2}');
    insert into empresa_membros values
      ('${E}', '${P1}', 40, 'profissional', true), ('${E}', '${P2}', 50, 'profissional', true),
      ('${E}', '${GE}', 0, 'gestor', true), ('${E2}', '${P3}', 30, 'profissional', true);
    insert into clientes values ('${CL}', '${E}'), ('${CL2}', '${E2}');
    insert into servicos values ('${SV}', '${E}', 'Corte');
    insert into produtos values ('${PR}', '${E}', 'Óleo', 'venda', true, 10, 0);
    insert into cartao_maquininhas values ('${MQ}', '${E}', 'Maquininha'), ('${MQ2}', '${E2}', 'Outra');
    insert into pacotes values ('${PK}', '${E}', 30, true);
    insert into pacote_clientes (id, empresa_id, pacote_id, cliente_id, status) values ('${PC}', '${E}', '${PK}', '${CL}', 'ativo');
  `);
  for (const [k, prof] of [[1, P1], [2, P1], [3, P2], [4, P1], [5, P1]] as const) await novoAtendimento(k, prof);
}, 60_000);

const C1 = id('c0', 1);
const C2 = id('c0', 2);

describe('profissional fecha a própria comanda com produto pela função (chaves padrão)', () => {
  it('comanda, itens, venda dos produtos, baixa e pagamento gravados', async () => {
    await como(P1, SEM_GESTAO);
    expect(await fechar({
      comanda_id: C1, empresa_id: E, cliente_id: CL, desconto: 0,
      atendimentos: [{ agendamento_id: ag(1), valor: 100 }],
      itens: [
        { tipo: 'produto', descricao: 'Óleo', produto_id: PR, quantidade: 1, valor_unit: 20 },
        { tipo: 'servico', descricao: 'Escova', servico_id: SV, profissional_id: P2, quantidade: 1, valor_unit: 30 },
      ],
      pagamentos: [{ valor: 150, metodo: 'credito', bandeira: 'visa', parcelas: 1, taxa_perc: 0.05, maquininha_id: MQ }],
    })).toBe(C1);
    expect(await admin(`select observacao from vendas`)).toEqual([{ observacao: 'Via comanda' }]);
    expect(await n(`select count(*) n from venda_itens`)).toBe(1);
    expect(await admin(`select maquininha_id from pagamentos where comanda_id = $1`, [C1])).toEqual([{ maquininha_id: MQ }]);
    expect(await n(`select count(*) n from comanda_itens where comanda_id = $1`, [C1])).toBe(2);
    expect(await n(`select count(*) n from estoque_movimentos where comanda_id = $1`, [C1])).toBe(1);
  });

  it('comanda só com extras (sem atendimento) também fecha', async () => {
    await como(P1, SEM_GESTAO);
    expect(await fechar({
      comanda_id: C2, empresa_id: E, cliente_id: null, desconto: 0, atendimentos: [],
      itens: [{ tipo: 'produto', descricao: 'Óleo', produto_id: PR, quantidade: 1, valor_unit: 20 }],
      pagamentos: [{ valor: 20, metodo: 'pix' }],
    })).toBe(C2);
    expect(await n(`select count(*) n from comandas where id = $1`, [C2])).toBe(1);
  });

  it('ela vê a própria comanda, itens e pagamentos, mas não as vendas', async () => {
    await como(P1, SEM_GESTAO);
    expect(await n(`select count(*) n from comandas where id = $1`, [C1])).toBe(1);
    expect(await n(`select count(*) n from comanda_itens where comanda_id = $1`, [C1])).toBe(2);
    expect(await n(`select count(*) n from pagamentos where comanda_id = $1`, [C1])).toBe(1);
    expect(await n(`select count(*) n from vendas`)).toBe(0);
  });
});

describe('item 9 — sem vínculo ativo perde o acesso', () => {
  it('desativada: não vê mais a comanda que fechou nem os itens; reativada, volta', async () => {
    await admin(`update empresa_membros set ativo = false where user_id = $1`, [P1]);
    await como(P1, SEM_GESTAO);
    expect((await q<{ ok: boolean }>(`select public.comanda_pertence_ao_profissional($1) as ok`, [C2]))[0].ok).toBe(false);
    expect((await q<{ ok: boolean }>(`select public.comanda_pertence_ao_profissional($1) as ok`, [C1]))[0].ok).toBe(false);
    expect(await n(`select count(*) n from comandas`)).toBe(0);
    expect(await n(`select count(*) n from comanda_itens`)).toBe(0);
    expect(await n(`select count(*) n from pagamentos`)).toBe(0);
    await q(`update comandas set desconto = 1 where id = $1`, [C2]);
    expect(await admin(`select desconto from comandas where id = $1`, [C2])).toEqual([{ desconto: '0.00' }]);

    await admin(`update empresa_membros set ativo = true where user_id = $1`, [P1]);
    await como(P1, SEM_GESTAO);
    expect(await n(`select count(*) n from comandas`)).toBe(2);
  });

  it('outra profissional da empresa não vê a comanda da colega', async () => {
    await como(P2, SEM_GESTAO);
    expect(await n(`select count(*) n from comandas where id = $1`, [C2])).toBe(0);
  });
});

describe('item 10 — vínculos de outra empresa recusados', () => {
  const base = (over: Record<string, unknown>) => ({
    comanda_id: id('c0', 9), empresa_id: E, cliente_id: CL, desconto: 0,
    atendimentos: [{ agendamento_id: ag(2), valor: 100 }], itens: [],
    pagamentos: [{ valor: 100, metodo: 'pix' }], ...over,
  });

  it('fechar_comanda: cliente de outra empresa e nada é gravado', async () => {
    await como(P1, SEM_GESTAO);
    expect(await erro(() => fechar(base({ cliente_id: CL2 })))).toBe('Cliente não encontrada nesta empresa.');
    expect(await admin(`select comanda_id from agendamentos where id = $1`, [ag(2)])).toEqual([{ comanda_id: null }]);
    expect(await n(`select count(*) n from comandas where id = $1`, [id('c0', 9)])).toBe(0);
  });

  it('fechar_comanda: maquininha e profissional do extra de outra empresa', async () => {
    await como(P1, SEM_GESTAO);
    expect(await erro(() => fechar(base({
      pagamentos: [{ valor: 100, metodo: 'debito', bandeira: 'visa', taxa_perc: 0.02, maquininha_id: MQ2 }],
    })))).toBe('Maquininha não encontrada nesta empresa.');
    expect(await erro(() => fechar(base({
      itens: [{ tipo: 'servico', descricao: 'Escova', servico_id: SV, profissional_id: P3, quantidade: 1, valor_unit: 10 }],
      pagamentos: [{ valor: 110, metodo: 'pix' }],
    })))).toBe('Profissional do serviço extra não faz parte desta empresa.');
    // a dona conta como profissional do extra
    expect(await fechar(base({
      itens: [{ tipo: 'servico', descricao: 'Escova', servico_id: SV, profissional_id: DONA, quantidade: 1, valor_unit: 10 }],
      pagamentos: [{ valor: 110, metodo: 'pix' }],
    }))).toBe(id('c0', 9));
  });

  it('editar_comanda: maquininha de outra empresa', async () => {
    await como(P1, SEM_GESTAO);
    const pag = await q<{ id: string }>(`select id from pagamentos where comanda_id = $1`, [id('c0', 9)]);
    const itens = await q<{ id: string }>(`select id from comanda_itens where comanda_id = $1`, [id('c0', 9)]);
    expect(await erro(() => db.query('select public.editar_comanda($1::jsonb)', [JSON.stringify({
      comanda_id: id('c0', 9), empresa_id: E, desconto: 0,
      atendimentos: [{ agendamento_id: ag(2), valor: 100 }],
      itens: [{ item_id: itens[0].id, tipo: 'servico', descricao: 'Escova', servico_id: SV, profissional_id: DONA, quantidade: 1, valor_unit: 10 }],
      pagamentos: [{ pagamento_id: pag[0].id, valor: 110, metodo: 'credito', bandeira: 'visa', parcelas: 1, taxa_perc: 0.05, maquininha_id: MQ2 }],
    })]))).toBe('Maquininha não encontrada nesta empresa.');
  });

  it('registrar_venda_avulsa_v2: cliente de outra empresa', async () => {
    await como(P1, 'agenda.ver_equipe'); // com vendas.acessar
    expect(await erro(() => db.query(
      'select public.registrar_venda_avulsa_v2($1, $2, $3, 0, $4::jsonb, $5::jsonb)',
      [id('5', 1), E, CL2, JSON.stringify([{ produto_id: PR, quantidade: 1, preco_unitario: 20 }]),
        JSON.stringify([{ valor: 20, metodo: 'pix' }])],
    ))).toBe('Cliente não encontrada nesta empresa.');
  });
});

describe('item 11 — vendas e venda_itens', () => {
  it('membro sem vendas.acessar nem financeiro.ver não lê, não altera e não apaga vendas', async () => {
    const total = Number((await admin<{ n: number }>(`select count(*) n from vendas`))[0].n);
    expect(total).toBeGreaterThan(0);
    await como(P2, SEM_GESTAO);
    expect(await n(`select count(*) n from vendas`)).toBe(0);
    expect(await n(`select count(*) n from venda_itens`)).toBe(0);
    await q(`update vendas set desconto = 1`);
    await q(`delete from venda_itens`);
    await q(`delete from vendas`);
    expect(Number((await admin<{ n: number }>(`select count(*) n from vendas where desconto = 0`))[0].n)).toBe(total);
    expect(Number((await admin<{ n: number }>(`select count(*) n from venda_itens`))[0].n)).toBeGreaterThan(0);
  });

  it('financeiro.ver, vendas.acessar, gestora e dona leem', async () => {
    const total = Number((await admin<{ n: number }>(`select count(*) n from vendas`))[0].n);
    await como(P2, 'vendas.acessar');           // só financeiro.ver
    expect(await n(`select count(*) n from vendas`)).toBe(total);
    await como(P2, 'financeiro.ver');           // só vendas.acessar
    expect(await n(`select count(*) n from vendas`)).toBe(total);
    await como(GE, 'vendas.acessar,financeiro.ver');
    expect(await n(`select count(*) n from venda_itens`)).toBeGreaterThan(0);
    await como(DONA);
    expect(await n(`select count(*) n from vendas`)).toBe(total);
  });

  it('membro de outra empresa não insere venda nesta', async () => {
    await como(P3);
    expect(await erro(() => q(`insert into vendas (empresa_id, valor_total) values ($1, 10)`, [E]))).toMatch(/row-level security/);
  });
});

describe('item 16 — pagamentos, comanda_itens e pacote_uso', () => {
  it('colega sem agenda.gerenciar_outras não lança pagamento nem item na comanda de outra', async () => {
    await como(P2, SEM_GESTAO);
    expect(await erro(() => q(`insert into pagamentos (empresa_id, comanda_id, valor, metodo, status) values ($1, $2, 5, 'pix', 'pago')`, [E, C1])))
      .toMatch(/row-level security/);
    expect(await erro(() => q(`insert into comanda_itens (comanda_id, empresa_id, tipo, descricao, quantidade, valor_unit) values ($1, $2, 'servico', 'X', 1, 5)`, [C1, E])))
      .toMatch(/row-level security/);
  });

  it('com agenda.gerenciar_outras (ou gestora) lança; pagamento de venda exige vendas.acessar', async () => {
    await como(P2, 'vendas.acessar,financeiro.ver');
    await q(`insert into comanda_itens (comanda_id, empresa_id, tipo, descricao, quantidade, valor_unit) values ($1, $2, 'servico', 'X', 1, 5)`, [C1, E]);
    await como(GE, 'agenda.gerenciar_outras');
    await q(`insert into pagamentos (empresa_id, comanda_id, valor, metodo, status) values ($1, $2, 5, 'pix', 'pago')`, [E, C1]);
    const [{ v }] = await admin<{ v: string }>(`select id v from vendas limit 1`);
    await como(P2, SEM_GESTAO);
    expect(await erro(() => q(`insert into pagamentos (empresa_id, venda_id, valor, metodo, status) values ($1, $2, 5, 'pix', 'pago')`, [E, v])))
      .toMatch(/row-level security/);
    await como(P2, 'agenda.gerenciar_outras');
    await q(`insert into pagamentos (empresa_id, venda_id, valor, metodo, status) values ($1, $2, 5, 'pix', 'pago')`, [E, v]);
  });

  it('pacote_uso: sem pacotes.vender só registra sessão de atendimento dela', async () => {
    await como(P2, `${SEM_GESTAO},pacotes.vender`);
    expect(await erro(() => q(`insert into pacote_uso (empresa_id, pacote_cliente_id) values ($1, $2)`, [E, PC]))).toMatch(/row-level security/);
    expect(await erro(() => q(`insert into pacote_uso (empresa_id, pacote_cliente_id, agendamento_id) values ($1, $2, $3)`, [E, PC, ag(4)])))
      .toMatch(/row-level security/);
    await q(`insert into pacote_uso (empresa_id, pacote_cliente_id, agendamento_id) values ($1, $2, $3)`, [E, PC, ag(3)]);
    expect(await n(`select count(*) n from pacote_uso`)).toBe(1);   // SELECT para membro
    await como(P2, SEM_GESTAO);                                      // padrão: tem pacotes.vender
    await q(`insert into pacote_uso (empresa_id, pacote_cliente_id) values ($1, $2)`, [E, PC]);
    await como(P1, `${SEM_GESTAO},pacotes.vender`);
    await q(`delete from pacote_uso`);                               // nenhuma é dela: nada apagado
    expect(Number((await admin<{ n: number }>(`select count(*) n from pacote_uso`))[0].n)).toBe(2);
  });

  it('consumo automático pelo trigger (security definer) segue para quem fecha sem pacotes.vender', async () => {
    await como(P1, `${SEM_GESTAO},pacotes.vender`);
    await fechar({ comanda_id: id('c0', 5), empresa_id: E, cliente_id: CL, desconto: 0,
      atendimentos: [{ agendamento_id: ag(5), valor: 0, pacote_cliente_id: PC }], itens: [], pagamentos: [] });
    expect(await admin(`select agendamento_id from pacote_uso where agendamento_id = $1`, [ag(5)])).toEqual([{ agendamento_id: ag(5) }]);
  });
});
