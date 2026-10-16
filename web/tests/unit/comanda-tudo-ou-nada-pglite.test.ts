// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Migration 090 executada de verdade num Postgres em memória (PGlite, sem rede, nada de banco real).
 * Esquema mínimo em tests/unit/fixtures/schema-comanda-090.sql. As funções rodam com o papel
 * `authenticated` (RLS real em agendamentos). Complementa o teste de texto
 * (comanda-tudo-ou-nada-migration.test.ts).
 */
const raiz = join(process.cwd(), '..');
const sql090 = readFileSync(join(raiz, 'supabase', 'migrations', '090_comanda_tudo_ou_nada.sql'), 'utf8');
const stub = readFileSync(join(process.cwd(), 'tests', 'unit', 'fixtures', 'schema-comanda-090.sql'), 'utf8');

const E = '00000000-0000-0000-0000-0000000000e1';
const A1 = '00000000-0000-0000-0000-0000000000a1';
const A2 = '00000000-0000-0000-0000-0000000000a2';
const GES = '00000000-0000-0000-0000-0000000000a3';
const CL = '00000000-0000-0000-0000-0000000000c1';
const SV = '00000000-0000-0000-0000-0000000000f1';
const PR1 = '00000000-0000-0000-0000-0000000000b1';
const PR2 = '00000000-0000-0000-0000-0000000000b2';
const PK = '00000000-0000-0000-0000-0000000000a9';
const ag = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const uuid = (pfx: string, n: number) => `00000000-0000-0000-0000-${pfx}${String(n).padStart(12 - pfx.length, '0')}`;

let db: PGlite;

async function como(user: string, opts: { negar?: string; verEquipe?: boolean } = {}) {
  await db.exec(`reset role;
    select set_config('app.uid', '${user}', false);
    select set_config('app.negar', '${opts.negar ?? ''}', false);
    select set_config('app.ver_equipe', '${opts.verEquipe ? '1' : ''}', false);
    set role authenticated;`);
}
async function admin<T = Record<string, unknown>>(q: string, p: unknown[] = []): Promise<T[]> {
  await db.exec('reset role');
  return (await db.query<T>(q, p)).rows;
}
async function fechar(p: unknown) {
  return (await db.query<{ id: string }>('select public.fechar_comanda($1::jsonb) as id', [JSON.stringify(p)])).rows[0].id;
}
async function editar(p: unknown) {
  await db.query('select public.editar_comanda($1::jsonb)', [JSON.stringify(p)]);
}
async function erro(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); } catch (e) { return (e as Error).message; }
  return '(sem erro)';
}
async function novoAtendimento(n: number, valor: number, prof = A1, extra = '') {
  await admin(`insert into agendamentos (id, empresa_id, profissional_id, cliente_id, servico_id, valor${extra ? ', status' : ''})
    values ($1, $2, $3, $4, $5, $6${extra ? ", '" + extra + "'" : ''})`, [ag(n), E, prof, CL, SV, valor]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(stub);
  await db.exec(sql090);
  await db.exec(sql090); // idempotente
  await db.exec(`
    insert into empresas values ('${E}', '${GES}');
    insert into empresa_membros values ('${E}', '${A1}', 40, 'profissional', true), ('${E}', '${A2}', 50, 'profissional', true);
    insert into clientes values ('${CL}', '${E}');
    insert into servicos values ('${SV}', '${E}', 'Corte');
    insert into produtos values ('${PR1}', '${E}', 'Óleo', 'venda', true, 1, 0), ('${PR2}', '${E}', 'Creme', 'venda', true, 5, 0);
    insert into pacotes values ('${PK}', '${E}', 30, true);
  `);
}, 60_000);

describe('ratear_desconto_centavos', () => {
  it('soma exata, resto na maior parte, nunca acima do peso, peso 0 recebe 0', async () => {
    await como(A1);
    const r = async (d: number, pesos: number[]) =>
      (await db.query<{ r: number[] }>('select public.ratear_desconto_centavos($1, $2::bigint[]) as r', [d, pesos])).rows[0].r.map(Number);
    expect(await r(299, [100, 100, 100])).toEqual([100, 100, 99]);
    expect(await r(1000, [3333, 0, 6667, 1])).toEqual([333, 0, 667, 0]);
    expect(await r(2, [100, 100, 100])).toEqual([2, 0, 0]);
    expect(await r(0, [])).toEqual([]);
    for (const [d, pesos] of [[7, [3, 3, 3]], [12345, [1000, 2000, 9999, 1]], [1, [0, 5]]] as const) {
      const c = await r(d, [...pesos]);
      expect(c.reduce((a, b) => a + b, 0)).toBe(d);
      c.forEach((x, i) => expect(x).toBeLessThanOrEqual(pesos[i]));
    }
  });
});

describe('fechar_comanda', () => {
  const C = uuid('c', 1);
  const payload = () => ({
    comanda_id: C, empresa_id: E, cliente_id: CL, desconto: 33.33,
    atendimentos: [
      { agendamento_id: ag(102), linhas: [{ ag_servico_id: uuid('5', 201), valor: 50 }, { ag_servico_id: uuid('5', 202), valor: 30 }] },
      { agendamento_id: ag(101), valor: 100 },
    ],
    itens: [
      { tipo: 'servico', descricao: 'Escova', servico_id: SV, profissional_id: A2, quantidade: 1, valor_unit: 40 },
      { tipo: 'produto', descricao: 'Óleo', produto_id: PR1, quantidade: 2, valor_unit: 15 },
      { tipo: 'pacote', descricao: 'Pacote', pacote_id: PK, quantidade: 1, valor_unit: 200 },
    ],
    pagamentos: [
      { valor: 300, metodo: 'pix', maquininha_id: '' },
      { valor: 96.67, metodo: 'credito', bandeira: 'visa', parcelas: 2, taxa_perc: 0.0559, maquininha_id: '' },
    ],
  });

  beforeAll(async () => {
    await novoAtendimento(101, 100);
    await novoAtendimento(102, 80);
    await admin(`insert into agendamento_servicos (id, agendamento_id, servico_id, valor, empresa_id) values
      ($1, $3, $4, 50, $5), ($2, $3, $4, 30, $5)`, [uuid('5', 201), uuid('5', 202), ag(102), SV, E]);
    await admin(`insert into taxas_reserva (empresa_id, agendamento_id, valor, status) values ($1, $2, 20, 'pago')`, [E, ag(101)]);
  });

  it('grava tudo numa transação, com totais, rateio, comissões, baixa e vendas calculados no banco', async () => {
    await como(A1);
    expect(await fechar(payload())).toBe(C);
    const [cmd] = await admin<Record<string, string>>(`select valor_total, desconto, desconto_reserva, profissional_id from comandas where id = $1`, [C]);
    expect(cmd).toMatchObject({ valor_total: '450.00', desconto: '53.33', desconto_reserva: '20.00', profissional_id: A1 });
    const [{ soma }] = await admin<{ soma: string }>(`select sum(d) as soma from (
      select desconto_rateado d from agendamentos where comanda_id = $1
      union all select desconto_rateado from comanda_itens where comanda_id = $1) x`, [C]);
    expect(soma).toBe('33.33');
    const [{ linhas, atend }] = await admin<{ linhas: string; atend: string }>(`select
      (select sum(desconto_rateado) from agendamento_servicos where agendamento_id = $1) as linhas,
      (select desconto_rateado from agendamentos where id = $1) as atend`, [ag(102)]);
    expect(linhas).toBe(atend);
    const comissoes = await admin<{ valor_servico: string }>(`select valor_servico from comissoes order by valor_servico`);
    expect(comissoes.map(c => c.valor_servico)).toEqual(['37.04', '74.08', '92.60']); // 40−2,96; 80−5,92; 100−7,40
    expect(await admin(`select observacao, valor_total, desconto from vendas order by observacao`)).toEqual([
      { observacao: 'Pacote(s) via comanda', valor_total: '200.00', desconto: '14.83' },
      { observacao: 'Via comanda', valor_total: '30.00', desconto: '2.22' },
    ]);
    // M4: valor pago do pacote com a parte do desconto rateado (200 − 14,83), igual à venda.
    expect(await admin(`select valor_pago from pacote_clientes where pacote_id = $1`, [PK])).toEqual([{ valor_pago: '185.17' }]);
    expect((await admin<{ e: string }>(`select estoque_atual e from produtos where id = $1`, [PR1]))[0].e).toBe('-1.000');
    expect(await admin(`select metodo::text, valor_liquido, maquininha_id from pagamentos where comanda_id = $1 order by metodo`, [C])).toEqual([
      { metodo: 'credito', valor_liquido: '91.27', maquininha_id: null },
      { metodo: 'pix', valor_liquido: null, maquininha_id: null },
    ]);
  });

  it('nova tentativa com o mesmo comanda_id devolve o id sem gravar de novo', async () => {
    await como(A1);
    expect(await fechar(payload())).toBe(C);
    expect((await admin<{ n: number }>(`select count(*)::int n from pagamentos where comanda_id = $1`, [C]))[0].n).toBe(2);
  });

  it('outra comanda com o mesmo atendimento: "já teve a comanda fechada" e nada é gravado', async () => {
    await como(A1);
    expect(await erro(() => fechar({ ...payload(), comanda_id: uuid('c', 2) }))).toBe('Este atendimento já teve a comanda fechada.');
    expect((await admin<{ n: number }>(`select count(*)::int n from comandas where id = $1`, [uuid('c', 2)]))[0].n).toBe(0);
  });

  it('recusa atendimento cancelado ou com falta', async () => {
    await novoAtendimento(103, 50, A1, 'cancelado');
    await como(A1);
    expect(await erro(() => fechar({ comanda_id: uuid('c', 3), empresa_id: E, cliente_id: CL, desconto: 0,
      atendimentos: [{ agendamento_id: ag(103), valor: 50 }], itens: [], pagamentos: [{ valor: 50, metodo: 'pix' }] })))
      .toBe('Atendimento cancelado ou com falta não entra na comanda.');
  });

  it('permissões no banco: desconto e pacote', async () => {
    await novoAtendimento(104, 50);
    await como(A1, { negar: 'comanda.desconto' });
    expect(await erro(() => fechar({ comanda_id: uuid('c', 4), empresa_id: E, cliente_id: CL, desconto: 5,
      atendimentos: [{ agendamento_id: ag(104), valor: 50 }], itens: [], pagamentos: [{ valor: 45, metodo: 'pix' }] })))
      .toBe('Você não tem permissão para dar desconto ou cortesia.');
    await como(A1, { negar: 'pacotes.vender' });
    expect(await erro(() => fechar({ comanda_id: uuid('c', 4), empresa_id: E, cliente_id: CL, desconto: 0,
      atendimentos: [], itens: [{ tipo: 'pacote', descricao: 'P', pacote_id: PK, quantidade: 1, valor_unit: 10 }],
      pagamentos: [{ valor: 10, metodo: 'pix' }] })))
      .toBe('Você não tem permissão para vender pacotes.');
  });

  it('total zero sem pagamento vira uma Cortesia R$ 0', async () => {
    await como(A1);
    const id = await fechar({ comanda_id: uuid('c', 5), empresa_id: E, cliente_id: null, desconto: 10, atendimentos: [],
      itens: [{ tipo: 'produto', descricao: 'Creme', produto_id: PR2, quantidade: 1, valor_unit: 10 }], pagamentos: [] });
    expect(await admin(`select metodo::text, valor from pagamentos where comanda_id = $1`, [id])).toEqual([{ metodo: 'cortesia', valor: '0.00' }]);
  });
});

describe('editar_comanda', () => {
  const C = uuid('d', 1);
  let itens: { id: string; tipo: string; descricao: string; produto_id: string | null; pacote_id: string | null; profissional_id: string | null; q: number; v: number }[];
  let pags: { id: string; metodo: string; v: number; parcelas: number; bandeira: string | null }[];

  async function base() {
    itens = await admin(`select id, tipo, descricao, produto_id, pacote_id, profissional_id, quantidade::float q, valor_unit::float v
      from comanda_itens where comanda_id = $1 order by tipo`, [C]);
    pags = await admin(`select id, metodo::text, valor::float v, parcelas, bandeira from pagamentos where comanda_id = $1`, [C]);
  }
  const payload = (over: Record<string, unknown> = {}) => ({
    comanda_id: C, empresa_id: E, desconto: 10,
    atendimentos: [{ agendamento_id: ag(201), valor: 100 }],
    itens: itens.map(i => ({ item_id: i.id, tipo: i.tipo, descricao: i.descricao, produto_id: i.produto_id, pacote_id: i.pacote_id,
      profissional_id: i.profissional_id, quantidade: i.q, valor_unit: i.v })),
    pagamentos: pags.map(p => ({ pagamento_id: p.id, valor: p.v, metodo: p.metodo, parcelas: p.parcelas, bandeira: p.bandeira })),
    ...over,
  });

  beforeAll(async () => {
    await novoAtendimento(201, 100);
    await como(A1);
    await fechar({ comanda_id: C, empresa_id: E, cliente_id: CL, desconto: 10,
      atendimentos: [{ agendamento_id: ag(201), valor: 100 }],
      itens: [
        { tipo: 'servico', descricao: 'Escova', profissional_id: A2, quantidade: 1, valor_unit: 100 },
        { tipo: 'produto', descricao: 'Creme', produto_id: PR2, quantidade: 1, valor_unit: 100 },
      ],
      pagamentos: [{ valor: 290, metodo: 'credito', bandeira: 'visa', parcelas: 1, taxa_perc: 0.05 }] });
    await base();
  });

  it('nada de dinheiro mudou: mantém o desconto_rateado gravado (sem re-rateio)', async () => {
    // força cotas diferentes das que um re-rateio daria (5/5/0 → re-rateio daria 5/5 nas editáveis menos o congelado)
    await admin(`update agendamentos set desconto_rateado = 7 where id = $1`, [ag(201)]);
    await admin(`update comanda_itens set desconto_rateado = case tipo when 'servico' then 2 else 1 end where comanda_id = $1`, [C]);
    await como(A1);
    await editar(payload({ pagamentos: [{ valor: 290, metodo: 'pix' }] }));
    expect((await admin<{ d: string }>(`select desconto_rateado d from agendamentos where id = $1`, [ag(201)]))[0].d).toBe('7.00');
    expect(await admin(`select tipo, desconto_rateado from comanda_itens where comanda_id = $1 order by tipo`, [C])).toEqual([
      { tipo: 'produto', desconto_rateado: '1.00' }, { tipo: 'servico', desconto_rateado: '2.00' }]);
    expect(await admin(`select metodo::text, created_at = (select fechada_at from comandas where id = $1) as na_data from pagamentos where comanda_id = $1`, [C]))
      .toEqual([{ metodo: 'pix', na_data: true }]);
    await base();
  });

  it('comanda anterior à 090 (desconto > 0, rateio 0) continua sem rateio quando nada muda', async () => {
    await admin(`update agendamentos set desconto_rateado = 0 where id = $1`, [ag(201)]);
    await admin(`update comanda_itens set desconto_rateado = 0 where comanda_id = $1`, [C]);
    await como(A1);
    await editar(payload());
    const [{ s }] = await admin<{ s: string }>(`select (select sum(desconto_rateado) from comanda_itens where comanda_id = $1)
      + (select desconto_rateado from agendamentos where id = $2) as s`, [C, ag(201)]);
    expect(s).toBe('0.00');
  });

  it('mudou o desconto: re-rateia entre as partes editáveis (produto congelado)', async () => {
    await como(A1);
    await editar(payload({ desconto: 20, pagamentos: [{ valor: 280, metodo: 'pix' }] }));
    expect((await admin<{ d: string }>(`select desconto_rateado d from agendamentos where id = $1`, [ag(201)]))[0].d).toBe('10.00');
    expect(await admin(`select tipo, desconto_rateado from comanda_itens where comanda_id = $1 order by tipo`, [C])).toEqual([
      { tipo: 'produto', desconto_rateado: '0.00' }, { tipo: 'servico', desconto_rateado: '10.00' }]);
    expect((await admin<{ v: string }>(`select valor_servico v from comissoes where agendamento_id = $1`, [ag(201)]))[0].v).toBe('90.00');
    await base();
  });

  it('atendimento com pacote e valor > 0 já gravado assim continua editável; mudar o valor é recusado', async () => {
    await admin(`insert into pacote_clientes (id, empresa_id, pacote_id, cliente_id) values ($1, $2, $3, $4)`, [uuid('e', 1), E, PK, CL]);
    await admin(`update agendamentos set pacote_cliente_id = $1 where id = $2`, [uuid('e', 1), ag(201)]);
    await como(A1);
    await editar(payload({ desconto: 20, pagamentos: [{ valor: 280, metodo: 'pix' }] }));
    expect(await erro(() => editar(payload({ desconto: 20, atendimentos: [{ agendamento_id: ag(201), valor: 90 }],
      pagamentos: [{ valor: 280, metodo: 'pix' }] }))))
      .toBe('Atendimento coberto por pacote deve ficar com valor R$ 0,00.');
    await admin(`update agendamentos set pacote_cliente_id = null where id = $1`, [ag(201)]);
  });

  it('atendimento de colega invisível para quem edita: recusa 42501 sem gravar', async () => {
    const C2 = uuid('d', 2);
    await novoAtendimento(301, 100, A1);
    await novoAtendimento(302, 100, A2);
    await como(GES, { verEquipe: true });
    await fechar({ comanda_id: C2, empresa_id: E, cliente_id: CL, desconto: 20,
      atendimentos: [{ agendamento_id: ag(301), valor: 100 }, { agendamento_id: ag(302), valor: 100 }],
      itens: [], pagamentos: [{ valor: 180, metodo: 'pix' }] });
    await como(A1);
    const msg = await erro(() => editar({ comanda_id: C2, empresa_id: E, desconto: 20,
      atendimentos: [{ agendamento_id: ag(301), valor: 100 }], itens: [], pagamentos: [{ valor: 180, metodo: 'debito' }] }));
    expect(msg).toBe('Esta comanda tem atendimento de outra profissional que você não pode ver. Peça à dona ou à gestora para editar.');
    expect((await admin<{ v: string }>(`select valor_total v from comandas where id = $1`, [C2]))[0].v).toBe('200.00');
    expect(await admin(`select metodo::text from pagamentos where comanda_id = $1`, [C2])).toEqual([{ metodo: 'pix' }]);
  });

  it('produto e pacote continuam só leitura', async () => {
    await como(A1);
    expect(await erro(() => editar(payload({ itens: [...payload().itens as object[],
      { item_id: uuid('f', 1), tipo: 'produto', descricao: 'x', produto_id: PR2, quantidade: 1, valor_unit: 1 }] }))))
      .toBe('Produtos e pacotes não podem ser incluídos na edição.');
  });
});

describe('registrar_venda_avulsa_v2', () => {
  it('nova tentativa com o mesmo p_venda_id devolve o id sem baixar o estoque de novo', async () => {
    const V = uuid('a', 1);
    const args = [V, E, null, 0, JSON.stringify([{ produto_id: PR2, quantidade: 1, preco_unitario: 10 }]), JSON.stringify([{ valor: 10, metodo: 'pix' }])];
    const antes = Number((await admin<{ e: string }>(`select estoque_atual e from produtos where id = $1`, [PR2]))[0].e);
    await como(A1);
    const call = async () => (await db.query<{ id: string }>(
      'select public.registrar_venda_avulsa_v2($1, $2, $3, $4, $5::jsonb, $6::jsonb) as id', args)).rows[0].id;
    expect(await call()).toBe(V);
    expect(await call()).toBe(V);
    expect(Number((await admin<{ e: string }>(`select estoque_atual e from produtos where id = $1`, [PR2]))[0].e)).toBe(antes - 1);
  });
});
