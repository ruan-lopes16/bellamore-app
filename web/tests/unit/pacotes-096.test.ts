// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { mensagemErroBanco } from '@shared/erros';

/**
 * Migration 096 (venda única de pacote, pacote "a cobrar" na comanda, exclusões conferidas) em cima
 * da cadeia de produção 090 → 095, em PGlite (nada de banco real). Mesmo esquema da cadeia 090–094.
 */
const raiz = join(process.cwd(), '..');
const migr = (n: string) => readFileSync(join(raiz, 'supabase', 'migrations', n), 'utf8');
const fixture = (n: string) => readFileSync(join(process.cwd(), 'tests', 'unit', 'fixtures', n), 'utf8');
const SQL = migr('096_pacotes_venda_unica.sql');

const id = (pfx: string, n: number) => `00000000-0000-0000-0000-${pfx}${String(n).padStart(12 - pfx.length, '0')}`;
const E = id('e', 1);
const E2 = id('e', 2);
const DONA = id('d', 1);
const DONA2 = id('d', 2);
const P1 = id('a', 1);
const G1 = id('b', 1);
const CL = id('c', 1);
const CL2 = id('c', 2);
const CL_OUTRA = id('c', 9);
const PK = id('f0', 1);       // pacote com validade de 30 dias
const PK_SEM = id('f0', 2);   // pacote sem validade
const PK_OUTRA = id('f0', 9); // pacote de outra empresa
const SV = id('f', 1);
const SV_LIVRE = id('f', 2);
const SV_PACOTE = id('f', 3);
const MAQ = id('9', 1);
const MAQ_OUTRA = id('9', 2);
const chave = (n: number) => id('7', n);
const cmd = (n: number) => id('c0', n);
const SEM_VENDAS = 'vendas.acessar,financeiro.ver';

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
async function erro(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); } catch (e) { return (e as Error).message; }
  return '(sem erro)';
}
const vender = (p: Record<string, unknown>) => db.query('select public.vender_pacote($1::jsonb)', [JSON.stringify(p)]);
const fechar = (p: Record<string, unknown>) => db.query('select public.fechar_comanda($1::jsonb)', [JSON.stringify(p)]);
const excluirPc = (e: string, pc: string) => db.query('select public.excluir_pacote_cliente($1, $2)', [e, pc]);
const excluirSv = (e: string, s: string) => db.query('select public.excluir_servico($1, $2)', [e, s]);
const base = (n: number, extra: Record<string, unknown> = {}) => ({
  venda_id: chave(n), empresa_id: E, cliente_id: CL, pacote_id: PK, quantidade: 1, valor_unit: 300,
  desconto: 0, cobranca: 'agora', pagamentos: [{ valor: 300, metodo: 'pix' }], ...extra,
});
const hojeBRT = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

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
  await db.exec(`
    insert into empresas (id, owner_id, nome) values ('${E}', '${DONA}', 'Bellamore'), ('${E2}', '${DONA2}', 'Outra');
    insert into users (id, nome, email) values ('${DONA}', 'Dona', 'd@x.com'), ('${P1}', 'P1', 'p1@x.com'),
      ('${G1}', 'G1', 'g1@x.com'), ('${DONA2}', 'Dona2', 'd2@x.com');
    insert into empresa_membros (empresa_id, user_id, percentual_comissao, role, ativo) values
      ('${E}', '${P1}', 40, 'profissional', true), ('${E}', '${G1}', 0, 'gestor', true);
    insert into clientes values ('${CL}', '${E}'), ('${CL2}', '${E}'), ('${CL_OUTRA}', '${E2}');
    insert into servicos values ('${SV}', '${E}', 'Limpeza'), ('${SV_LIVRE}', '${E}', 'Novo'),
      ('${SV_PACOTE}', '${E}', 'Drenagem');
    insert into pacotes (id, empresa_id, validade_dias, nome, ativo) values
      ('${PK}', '${E}', 30, 'Limpeza x3', true), ('${PK_SEM}', '${E}', null, 'Combo', true),
      ('${PK_OUTRA}', '${E2}', 30, 'Outra', true);
    insert into pacote_servicos (pacote_id, servico_id, quantidade) values ('${PK}', '${SV_PACOTE}', 3);
    insert into cartao_maquininhas values ('${MAQ}', '${E}', 'Maq'), ('${MAQ_OUTRA}', '${E2}', 'Maq2');
    insert into servico_produtos (servico_id, quantidade) values ('${SV_LIVRE}', 1);
  `);
  // Pacote antigo, cobrado pelo caminho anterior à 096 (backfill: cobranca 'paga', venda_id nulo).
  await admin(`insert into pacote_clientes (id, empresa_id, pacote_id, cliente_id, data_inicio, valor_pago, status)
    values ($1, $2, $3, $4, current_date, 100, 'ativo')`, [id('aa', 1), E, PK, CL]);
  await db.exec(SQL);
  // Rodar de novo: idempotente.
  await db.exec(SQL);
}, 60_000);

describe('096 — colunas e backfill', () => {
  it('pacote existente fica cobranca = paga e venda_id nulo', async () => {
    expect(await admin(`select cobranca, venda_id from pacote_clientes where id = $1`, [id('aa', 1)]))
      .toEqual([{ cobranca: 'paga', venda_id: null }]);
  });
  it('cobranca só aceita paga/pendente', async () => {
    expect(await erro(() => admin(`update pacote_clientes set cobranca = 'x' where id = $1`, [id('aa', 1)])))
      .toMatch(/pacote_clientes_cobranca_check/);
  });
});

describe('vender_pacote — cobrar agora', () => {
  it('grava venda, pagamentos e pacotes que batem; a repetição não duplica', async () => {
    // Profissional sem vendas.acessar nem financeiro.ver: só pacotes.vender.
    await como(P1, SEM_VENDAS);
    const p = base(1, {
      quantidade: 2, valor_unit: 100, desconto: 0.01,
      pagamentos: [{ valor: 150, metodo: 'credito', parcelas: 2, bandeira: 'visa', taxa_perc: 0.05, maquininha_id: MAQ },
        { valor: 50, metodo: 'pix' }],
    });
    await vender(p);
    await vender(p); // nova tentativa (queda de rede)
    expect(await admin(`select valor_total, desconto, valor_final, observacao, cliente_id from vendas where id = $1`, [chave(1)]))
      .toEqual([{ valor_total: '200.00', desconto: '0.01', valor_final: '199.99', observacao: 'Pacote', cliente_id: CL }]);
    const pcs = await admin<{ id: string; valor_pago: string; cobranca: string; data_validade: unknown; data_inicio: unknown }>(
      `select id, valor_pago, cobranca, to_char(data_validade, 'YYYY-MM-DD') data_validade,
              to_char(data_inicio, 'YYYY-MM-DD') data_inicio
         from pacote_clientes where venda_id = $1 order by valor_pago desc`, [chave(1)]);
    expect(pcs.map(x => [x.valor_pago, x.cobranca])).toEqual([['100.00', 'paga'], ['99.99', 'paga']]);
    expect(pcs.some(x => x.id === chave(1))).toBe(true);
    expect(pcs[0].data_inicio).toBe(hojeBRT());
    expect(pcs[0].data_validade).not.toBeNull();
    const pags = await admin(`select valor, metodo::text, parcelas, taxa_perc, valor_liquido, maquininha_id, bandeira
      from pagamentos where venda_id = $1 order by valor desc`, [chave(1)]);
    expect(pags).toEqual([
      { valor: '150.00', metodo: 'credito', parcelas: 2, taxa_perc: '0.0500', valor_liquido: '142.50', maquininha_id: MAQ, bandeira: 'visa' },
      { valor: '50.00', metodo: 'pix', parcelas: 1, taxa_perc: null, valor_liquido: null, maquininha_id: null, bandeira: null },
    ]);
  });

  it('pacote sem validade grava data_validade nula; troco permitido', async () => {
    await como(DONA);
    await vender(base(2, { pacote_id: PK_SEM, pagamentos: [{ valor: 350, metodo: 'dinheiro' }] }));
    expect(await admin(`select data_validade from pacote_clientes where id = $1`, [chave(2)])).toEqual([{ data_validade: null }]);
    expect(await admin(`select valor from pagamentos where venda_id = $1`, [chave(2)])).toEqual([{ valor: '350.00' }]);
  });

  it('recusas: pagamento curto, sem pagamento, quantidade, desconto acima do subtotal — nada é gravado', async () => {
    await como(DONA);
    expect(await erro(() => vender(base(3, { pagamentos: [{ valor: 299, metodo: 'pix' }] }))))
      .toBe('O pagamento não cobre o total da venda.');
    expect(await erro(() => vender(base(3, { pagamentos: [] })))).toBe('Pagamento não informado.');
    expect(await erro(() => vender(base(3, { quantidade: 0 })))).toBe('Quantidade de pacotes inválida (de 1 a 100).');
    expect(await erro(() => vender(base(3, { quantidade: 1.5 })))).toBe('Quantidade de pacotes inválida (de 1 a 100).');
    expect(await erro(() => vender(base(3, { desconto: 301 })))).toBe('O desconto não pode ser maior que o subtotal.');
    expect(await erro(() => vender(base(3, { cliente_id: null })))).toBe('Para vender pacote, escolha uma cliente cadastrada.');
    expect(await admin(`select count(*)::int n from vendas where id = $1`, [chave(3)])).toEqual([{ n: 0 }]);
    expect(await admin(`select count(*)::int n from pacote_clientes where id = $1`, [chave(3)])).toEqual([{ n: 0 }]);
  });

  it('permissões e empresa conferidas', async () => {
    await como(P1, 'pacotes.vender');
    expect(await erro(() => vender(base(4)))).toBe('Você não tem permissão para vender pacotes.');
    await como(P1, 'comanda.desconto');
    expect(await erro(() => vender(base(4, { desconto: 10 })))).toBe('Você não tem permissão para dar desconto ou cortesia.');
    expect(await erro(() => vender(base(4, { pagamentos: [{ valor: 300, metodo: 'cortesia' }] }))))
      .toBe('Você não tem permissão para dar desconto ou cortesia.');
    await como(P1);
    expect(await erro(() => vender(base(4, { cliente_id: CL_OUTRA })))).toBe('Cliente não encontrada nesta empresa.');
    expect(await erro(() => vender(base(4, { pacote_id: PK_OUTRA })))).toBe('Pacote não encontrado nesta empresa.');
    expect(await erro(() => vender(base(4, { pagamentos: [{ valor: 300, metodo: 'debito', maquininha_id: MAQ_OUTRA }] }))))
      .toBe('Maquininha não encontrada nesta empresa.');
    await como(DONA2);
    expect(await erro(() => vender(base(4)))).toBe('Você não tem permissão para vender pacotes.');
    // A chave de uma venda de outra empresa não é reaproveitada (nem revela de quem é: a RLS esconde).
    expect(await erro(() => vender({ ...base(1), empresa_id: E2, cliente_id: CL_OUTRA, pacote_id: PK_OUTRA })))
      .toBe('Este código de venda já foi usado. Recarregue a tela e tente de novo.');
    expect(await admin(`select count(*)::int n from pacote_clientes where empresa_id = $1`, [E2])).toEqual([{ n: 0 }]);
  });
});

describe('vender_pacote — cobrar na comanda + fechar_comanda', () => {
  it('pendente: nada no faturamento; fechar a comanda cobra uma vez, com desconto rateado', async () => {
    await como(P1, SEM_VENDAS);
    await vender(base(10, { cobranca: 'comanda', valor_unit: 200, pagamentos: [] }));
    const vendasAntes = await admin<{ n: number }>(`select count(*)::int n from vendas`);
    expect(await admin(`select cobranca, venda_id, valor_pago from pacote_clientes where id = $1`, [chave(10)]))
      .toEqual([{ cobranca: 'pendente', venda_id: null, valor_pago: '200.00' }]);
    expect(await admin(`select count(*)::int n from vendas where id = $1`, [chave(10)])).toEqual([{ n: 0 }]);
    expect(await erro(() => vender(base(11, { cobranca: 'comanda', pagamentos: [{ valor: 1, metodo: 'pix' }] }))))
      .toBe('Na cobrança pela comanda, o pagamento é lançado ao fechar a comanda.');

    // Fecha: item a cobrar (200) + serviço extra (100), desconto 30 → rateio 20 / 10.
    await como(P1, 'pacotes.vender');  // cobrar o já vendido não exige pacotes.vender
    const C = {
      comanda_id: cmd(1), empresa_id: E, cliente_id: CL, desconto: 30, atendimentos: [],
      itens: [
        { tipo: 'pacote', pacote_id: PK, pacote_cliente_id: chave(10), descricao: 'Pacote Limpeza x3 — a cobrar', quantidade: 1, valor_unit: 200 },
        { tipo: 'servico', servico_id: SV, descricao: 'Limpeza', quantidade: 1, valor_unit: 100 },
      ],
      pagamentos: [{ valor: 270, metodo: 'pix' }],
    };
    await fechar(C);
    await fechar(C); // repetição devolve a mesma comanda
    const [pc] = await admin<{ cobranca: string; valor_pago: string; venda_id: string }>(
      `select cobranca, valor_pago, venda_id from pacote_clientes where id = $1`, [chave(10)]);
    expect(pc.cobranca).toBe('paga');
    expect(pc.valor_pago).toBe('180.00');
    expect(await admin(`select valor_total, desconto, valor_final, observacao from vendas where id = $1`, [pc.venda_id]))
      .toEqual([{ valor_total: '200.00', desconto: '20.00', valor_final: '180.00', observacao: 'Pacote(s) via comanda' }]);
    expect(await admin<{ n: number }>(`select count(*)::int n from vendas`)).toEqual([{ n: vendasAntes[0].n + 1 }]);
    // Não criou outro pacote_clientes; o item ficou na comanda com o pacote do catálogo.
    expect(await admin(`select count(*)::int n from pacote_clientes where cliente_id = $1 and pacote_id = $2 and venda_id = $3`,
      [CL, PK, pc.venda_id])).toEqual([{ n: 1 }]);
    expect(await admin(`select pacote_id, desconto_rateado from comanda_itens where comanda_id = $1 and tipo = 'pacote'`, [cmd(1)]))
      .toEqual([{ pacote_id: PK, desconto_rateado: '20.00' }]);

    // Cobrar de novo em outra comanda: recusado.
    await como(P1);
    expect(await erro(() => fechar({ ...C, comanda_id: cmd(2), desconto: 0, pagamentos: [{ valor: 300, metodo: 'pix' }] })))
      .toBe('Este pacote já foi cobrado: Pacote Limpeza x3 — a cobrar. Tire o item da comanda.');
    // editar_comanda segue funcionando com o item de pacote congelado.
    const itens = await admin<{ id: string; tipo: string; descricao: string; quantidade: string; valor_unit: string; pacote_id: string; servico_id: string }>(
      `select id, tipo, descricao, quantidade, valor_unit, pacote_id, servico_id from comanda_itens where comanda_id = $1 order by tipo`, [cmd(1)]);
    await como(P1);
    await db.query('select public.editar_comanda($1::jsonb)', [JSON.stringify({
      comanda_id: cmd(1), empresa_id: E, desconto: 30, atendimentos: [],
      itens: itens.map(i => ({ item_id: i.id, tipo: i.tipo, descricao: i.descricao, quantidade: Number(i.quantidade),
        valor_unit: Number(i.valor_unit), pacote_id: i.pacote_id, servico_id: i.servico_id,
        pacote_cliente_id: i.tipo === 'pacote' ? chave(10) : undefined })),
      pagamentos: [{ valor: 270, metodo: 'dinheiro' }],
    })]);
    expect(await admin(`select cobranca, valor_pago from pacote_clientes where id = $1`, [chave(10)]))
      .toEqual([{ cobranca: 'paga', valor_pago: '180.00' }]);
  });

  it('tirar o item a cobrar mantém o pacote pendente', async () => {
    await como(DONA);
    await vender(base(12, { cobranca: 'comanda', pagamentos: [] }));
    await fechar({ comanda_id: cmd(3), empresa_id: E, cliente_id: CL, desconto: 0, atendimentos: [],
      itens: [{ tipo: 'servico', servico_id: SV, descricao: 'Limpeza', quantidade: 1, valor_unit: 100 }],
      pagamentos: [{ valor: 100, metodo: 'pix' }] });
    expect(await admin(`select cobranca, venda_id from pacote_clientes where id = $1`, [chave(12)]))
      .toEqual([{ cobranca: 'pendente', venda_id: null }]);
  });

  it('pacote a cobrar de outra cliente, repetido ou com quantidade 2: recusado', async () => {
    await como(DONA);
    const item = { tipo: 'pacote', pacote_id: PK, pacote_cliente_id: chave(12), descricao: 'Pacote X — a cobrar', quantidade: 1, valor_unit: 300 };
    const C = { comanda_id: cmd(4), empresa_id: E, cliente_id: CL2, desconto: 0, atendimentos: [], itens: [item],
      pagamentos: [{ valor: 300, metodo: 'pix' }] };
    expect(await erro(() => fechar(C))).toBe('Este pacote a cobrar é de outra cliente: Pacote X — a cobrar.');
    expect(await erro(() => fechar({ ...C, cliente_id: CL, itens: [item, item], pagamentos: [{ valor: 600, metodo: 'pix' }] })))
      .toBe('Pacote a cobrar repetido na comanda.');
    expect(await erro(() => fechar({ ...C, cliente_id: CL, itens: [{ ...item, quantidade: 2 }], pagamentos: [{ valor: 600, metodo: 'pix' }] })))
      .toBe('Pacote a cobrar entra na comanda com quantidade 1.');
    expect(await erro(() => fechar({ ...C, cliente_id: CL, itens: [{ ...item, pacote_cliente_id: id('aa', 99) }] })))
      .toBe('Pacote a cobrar não encontrado: Pacote X — a cobrar.');
    expect(await admin(`select count(*)::int n from comandas where id = $1`, [cmd(4)])).toEqual([{ n: 0 }]);
  });

  it('pacote novo pela comanda grava venda_id (mesmo de R$ 0)', async () => {
    await como(DONA);
    await fechar({ comanda_id: cmd(5), empresa_id: E, cliente_id: CL2, desconto: 0, atendimentos: [],
      itens: [{ tipo: 'pacote', pacote_id: PK_SEM, descricao: 'Combo', quantidade: 1, valor_unit: 0 }], pagamentos: [] });
    const [pc] = await admin<{ venda_id: string | null; cobranca: string }>(
      `select venda_id, cobranca from pacote_clientes where cliente_id = $1 and pacote_id = $2`, [CL2, PK_SEM]);
    expect(pc.cobranca).toBe('paga');
    expect(pc.venda_id).not.toBeNull();
    expect(await admin(`select valor_final from vendas where id = $1`, [pc.venda_id])).toEqual([{ valor_final: '0.00' }]);
  });

  it('nenhum pacote cobrado depois da 096 fica sem venda', async () => {
    expect(await admin(`select count(*)::int n from pacote_clientes
      where cobranca = 'paga' and venda_id is null and id <> $1`, [id('aa', 1)])).toEqual([{ n: 0 }]);
  });
});

describe('excluir_pacote_cliente', () => {
  it('sem uso: apaga o pacote e a venda (com os pagamentos) quando a venda era só dele', async () => {
    await como(DONA);
    await vender(base(20));
    await como(P1, SEM_VENDAS);
    await excluirPc(E, chave(20));
    expect(await admin(`select count(*)::int n from pacote_clientes where id = $1`, [chave(20)])).toEqual([{ n: 0 }]);
    expect(await admin(`select count(*)::int n from vendas where id = $1`, [chave(20)])).toEqual([{ n: 0 }]);
    expect(await admin(`select count(*)::int n from pagamentos where venda_id = $1`, [chave(20)])).toEqual([{ n: 0 }]);
  });

  it('venda com outros pacotes: o valor_total cai pelo valor deste', async () => {
    await como(DONA);
    await vender(base(21, { quantidade: 2, valor_unit: 100, desconto: 0.01, pagamentos: [{ valor: 199.99, metodo: 'pix' }] }));
    await excluirPc(E, chave(21));  // a unidade de 100,00
    expect(await admin(`select valor_total, desconto, valor_final from vendas where id = $1`, [chave(21)]))
      .toEqual([{ valor_total: '100.00', desconto: '0.01', valor_final: '99.99' }]);
    expect(await admin(`select sum(valor_pago)::text s from pacote_clientes where venda_id = $1`, [chave(21)]))
      .toEqual([{ s: '99.99' }]);
  });

  it('desvincula atendimentos; com sessão usada a exclusão é recusada', async () => {
    await como(DONA);
    await vender(base(22));
    await vender(base(23));
    await admin(`insert into agendamentos (id, empresa_id, profissional_id, cliente_id, servico_id, valor, pacote_cliente_id)
      values ($1, $2, $3, $4, $5, 0, $6)`, [id('0', 1), E, P1, CL, SV_PACOTE, chave(22)]);
    await admin(`insert into pacote_uso (empresa_id, pacote_cliente_id, servico_id) values ($1, $2, $3)`, [E, chave(23), SV_PACOTE]);
    await como(DONA);
    await excluirPc(E, chave(22));
    expect(await admin(`select pacote_cliente_id from agendamentos where id = $1`, [id('0', 1)])).toEqual([{ pacote_cliente_id: null }]);
    expect(await erro(() => excluirPc(E, chave(23)))).toBe('Este pacote já tem sessões usadas. Para cancelar, fale com a dona.');
    expect(await admin(`select count(*)::int n from vendas where id = $1`, [chave(23)])).toEqual([{ n: 1 }]);
  });

  it('permissões e empresa; delete direto só gestora/dona', async () => {
    await como(DONA);
    await vender(base(24));
    await como(P1, 'pacotes.vender');
    expect(await erro(() => excluirPc(E, chave(24)))).toBe('Você não tem permissão para excluir pacote vendido.');
    await como(DONA2);
    expect(await erro(() => excluirPc(E, chave(24)))).toBe('Você não faz parte desta empresa.');
    expect(await erro(() => excluirPc(E2, chave(24)))).toBe('Pacote vendido não encontrado.');
    await como(P1);
    expect(await q(`delete from pacote_clientes where id = $1 returning id`, [chave(24)])).toEqual([]);
    await como(G1, 'pacotes.vender');  // gestora sem a chave ainda exclui
    await excluirPc(E, chave(24));
    expect(await admin(`select count(*)::int n from pacote_clientes where id = $1`, [chave(24)])).toEqual([{ n: 0 }]);
  });
});

describe('excluir_servico', () => {
  it('serviço usado é recusado (atendimento, pacote, item de comanda)', async () => {
    await como(DONA);
    for (const s of [SV, SV_PACOTE]) {
      expect(await erro(() => excluirSv(E, s))).toBe('Este serviço já foi usado. Desative em vez de excluir.');
    }
    expect(await admin(`select count(*)::int n from pacote_servicos where servico_id = $1`, [SV_PACOTE])).toEqual([{ n: 1 }]);
  });
  it('permissões e empresa; serviço nunca usado sai com os insumos', async () => {
    await como(P1, 'servicos.gerenciar');
    expect(await erro(() => excluirSv(E, SV_LIVRE))).toBe('Você não tem permissão para excluir serviços.');
    await como(DONA2);
    expect(await erro(() => excluirSv(E, SV_LIVRE))).toBe('Você não faz parte desta empresa.');
    expect(await erro(() => excluirSv(E2, SV_LIVRE))).toBe('Serviço não encontrado.');
    await como(DONA);
    await excluirSv(E, SV_LIVRE);
    expect(await admin(`select count(*)::int n from servicos where id = $1`, [SV_LIVRE])).toEqual([{ n: 0 }]);
    expect(await admin(`select count(*)::int n from servico_produtos where servico_id = $1`, [SV_LIVRE])).toEqual([{ n: 0 }]);
  });
});

describe('096 — revisão (pacote cobrado na comanda, guardas de cobrança, pagamentos)', () => {
  const MSG_COMANDA = 'Este pacote foi cobrado numa comanda e não pode ser excluído aqui. Para cancelar, fale com a dona.';
  const aCobrar = (pc: string, valor = 300) => ({ tipo: 'pacote', pacote_id: PK, pacote_cliente_id: pc,
    descricao: 'Pacote X — a cobrar', quantidade: 1, valor_unit: valor });

  it('excluir pacote "a cobrar" depois de cobrado na comanda: recusado; venda e comanda intactas', async () => {
    await como(DONA);
    await vender(base(40, { cobranca: 'comanda', pagamentos: [] }));
    await fechar({ comanda_id: cmd(40), empresa_id: E, cliente_id: CL, desconto: 0, atendimentos: [],
      itens: [aCobrar(chave(40))], pagamentos: [{ valor: 300, metodo: 'pix' }] });
    const [pc] = await admin<{ comanda_id: string; venda_id: string }>(
      `select comanda_id, venda_id from pacote_clientes where id = $1`, [chave(40)]);
    expect(pc.comanda_id).toBe(cmd(40));
    expect(await erro(() => excluirPc(E, chave(40)))).toBe(MSG_COMANDA);
    expect(await admin(`select count(*)::int n from pacote_clientes where id = $1`, [chave(40)])).toEqual([{ n: 1 }]);
    expect(await admin(`select valor_final from vendas where id = $1`, [pc.venda_id])).toEqual([{ valor_final: '300.00' }]);
  });

  it('excluir pacote novo vendido pela comanda: recusado', async () => {
    await como(DONA);
    await fechar({ comanda_id: cmd(41), empresa_id: E, cliente_id: CL, desconto: 0, atendimentos: [],
      itens: [{ tipo: 'pacote', pacote_id: PK, descricao: 'Limpeza x3', quantidade: 1, valor_unit: 100 }],
      pagamentos: [{ valor: 100, metodo: 'pix' }] });
    const [pc] = await admin<{ id: string }>(`select id from pacote_clientes where comanda_id = $1`, [cmd(41)]);
    expect(await erro(() => excluirPc(E, pc.id))).toBe(MSG_COMANDA);
  });

  it('excluir pacote "a cobrar" ainda não cobrado: só o pacote sai', async () => {
    await como(DONA);
    await vender(base(42, { cobranca: 'comanda', pagamentos: [] }));
    const antes = await admin<{ n: number }>(`select count(*)::int n from vendas`);
    await excluirPc(E, chave(42));
    expect(await admin(`select count(*)::int n from pacote_clientes where id = $1`, [chave(42)])).toEqual([{ n: 0 }]);
    expect(await admin(`select count(*)::int n from vendas`)).toEqual(antes);
  });

  it('valor do pacote "a cobrar" na comanda é o combinado (desconto só pelo desconto da comanda)', async () => {
    await como(P1, 'comanda.desconto');
    await vender(base(43, { cobranca: 'comanda', pagamentos: [] }));
    const C = { comanda_id: cmd(43), empresa_id: E, cliente_id: CL, desconto: 0, atendimentos: [],
      itens: [aCobrar(chave(43), 0)], pagamentos: [] };
    expect(await erro(() => fechar(C)))
      .toBe('O valor do pacote a cobrar não pode ser alterado: Pacote X — a cobrar. Para dar desconto, use o desconto da comanda.');
    expect(await erro(() => fechar({ ...C, desconto: 300, itens: [aCobrar(chave(43))] })))
      .toBe('Você não tem permissão para dar desconto ou cortesia.');
    expect(await admin(`select cobranca from pacote_clientes where id = $1`, [chave(43)])).toEqual([{ cobranca: 'pendente' }]);
  });

  it('cobrança, venda e valor do pacote vendido não mudam por escrita direta; status muda', async () => {
    await como(P1);
    expect(await erro(() => q(`insert into pacote_clientes (empresa_id, pacote_id, cliente_id, data_inicio, valor_pago, status)
      values ($1, $2, $3, current_date, 10, 'ativo')`, [E, PK, CL])))
      .toBe('Pacote vendido só é gravado pela venda de pacote. Recarregue a tela e tente de novo.');
    const MSG = 'A cobrança do pacote vendido só muda pela venda ou pela comanda.';
    expect(await erro(() => q(`update pacote_clientes set cobranca = 'paga' where id = $1`, [chave(43)]))).toBe(MSG);
    expect(await erro(() => q(`update pacote_clientes set valor_pago = 1 where id = $1`, [chave(43)]))).toBe(MSG);
    expect(await erro(() => q(`update pacote_clientes set venda_id = $2 where id = $1`, [chave(43), chave(1)]))).toBe(MSG);
    await q(`update pacote_clientes set status = 'concluido' where id = $1`, [chave(43)]);
    expect(await admin(`select status, cobranca, valor_pago from pacote_clientes where id = $1`, [chave(43)]))
      .toEqual([{ status: 'concluido', cobranca: 'pendente', valor_pago: '300.00' }]);
  });

  it('venda de pacote não é apagada direto (o pacote ficaria cobrado sem venda)', async () => {
    const [pc] = await admin<{ venda_id: string }>(`select venda_id from pacote_clientes where comanda_id = $1`, [cmd(41)]);
    await como(DONA);
    expect(await erro(() => q(`delete from vendas where id = $1`, [pc.venda_id])))
      .toBe('Esta venda é de pacote e não pode ser apagada aqui. Para desfazer, exclua o pacote vendido em Pacotes.');
    expect(await admin(`select count(*)::int n from vendas where id = $1`, [pc.venda_id])).toEqual([{ n: 1 }]);
  });

  it('pagamento avulso numa venda de pacote: recusado para quem só tem pacotes.vender', async () => {
    await como(P1, SEM_VENDAS);
    expect(await erro(() => q(`insert into pagamentos (empresa_id, venda_id, valor, metodo, status)
      values ($1, $2, 10, 'pix', 'pago')`, [E, chave(1)]))).toMatch(/row-level security/);
    const [pc] = await admin<{ venda_id: string }>(`select venda_id from pacote_clientes where comanda_id = $1`, [cmd(41)]);
    await como(P1, SEM_VENDAS);
    expect(await erro(() => q(`insert into pagamentos (empresa_id, venda_id, valor, metodo, status)
      values ($1, $2, 10, 'pix', 'pago')`, [E, pc.venda_id]))).toMatch(/row-level security/);
  });

  it('a mesma chave em outro modo de cobrança é recusada (nunca "sucesso" de uma venda que não houve)', async () => {
    await como(DONA);
    await vender(base(44, { cobranca: 'comanda', pagamentos: [] }));
    expect(await erro(() => vender(base(44)))).toBe('Este código de venda já foi usado. Recarregue a tela e tente de novo.');
    await vender(base(45));
    expect(await erro(() => vender(base(45, { cobranca: 'comanda', pagamentos: [] }))))
      .toBe('Este código de venda já foi usado. Recarregue a tela e tente de novo.');
    expect(await admin(`select count(*)::int n from pagamentos where venda_id = $1`, [chave(44)])).toEqual([{ n: 0 }]);
  });
});

describe('096 — texto', () => {
  it('vender_pacote é invoker; exclusões são definer com search_path; grants só authenticated', () => {
    expect(SQL).toMatch(/function public\.vender_pacote\(p jsonb\)\s+returns void\s+language plpgsql\s+security invoker\s+set search_path = public/);
    for (const f of ['excluir_pacote_cliente', 'excluir_servico']) {
      expect(SQL).toMatch(new RegExp(`function public\\.${f}\\(p_empresa uuid, p_id uuid\\)\\s+returns void\\s+language plpgsql\\s+security definer\\s+set search_path = public`));
      expect(SQL).toContain(`revoke all on function public.${f}(uuid, uuid) from public, anon;`);
    }
    expect(SQL).toContain('revoke all on function public.vender_pacote(jsonb) from public, anon;');
    expect(SQL).toContain('revoke all on function public.fechar_comanda(jsonb) from public, anon;');
    expect(SQL).toContain("notify pgrst, 'reload schema';");
    expect(SQL).not.toMatch(/returning/i);
  });

  it('as mensagens novas passam por mensagemErroBanco sem virar texto genérico', () => {
    const msgs = [...SQL.matchAll(/raise exception '([^']+)'/g)].map(m => m[1].replace(/%/g, 'X'));
    expect(msgs.length).toBeGreaterThan(20);
    for (const m of msgs) {
      expect(mensagemErroBanco({ code: 'P0001', message: m }, 'vender o pacote')).toBe(m);
    }
    for (const m of ['Você não tem permissão para vender pacotes.', 'Você não tem permissão para excluir pacote vendido.',
      'Você não tem permissão para excluir serviços.', 'Você não faz parte desta empresa.']) {
      expect(mensagemErroBanco({ code: '42501', message: m }, 'excluir')).toBe(m);
    }
  });
});
