/**
 * @file kpis-financeiros-consultas.ts
 * Consultas ÚNICAS que trazem as linhas usadas por kpis-financeiros.ts. Web
 * (client pages e o server component do Dashboard) e mobile (hooks do
 * TanStack Query) chamam estas funções passando o próprio client do Supabase.
 * Assim as duas plataformas buscam exatamente o mesmo conjunto de linhas, com
 * os mesmos filtros, ordenação estável (`id` como desempate) e paginação além
 * do teto silencioso de 1000 linhas do PostgREST.
 *
 * Por que uma função que recebe o client, e não só uma lista de colunas?
 * Os filtros foram o que mais divergiu entre as telas (UTC × Brasília,
 * `pagamentos` × agendamentos, pacote incluído ou não, created_at ×
 * data_pagamento). Centralizar a consulta inteira elimina essa classe de erro.
 * `ClienteDb` é estrutural para shared/ não depender do pacote @supabase/*.
 *
 * Toda consulta LANÇA erro em vez de devolver lista vazia: um KPI zerado por
 * falha de rede ou de RLS é pior que uma mensagem de erro.
 */
import { buscarTodasPaginas } from './paginacao';
import type { Limites } from './periodos';
import type {
  AgendamentoFinRow, ComissaoFinRow, DadosFinanceiros, DespesaFinRow,
  PagamentoFinRow, ServicoExtraFinRow, TaxaPagaFinRow, TaxaReservaFinRow, VendaFinRow,
  ComandaReservaRow, TaxaReservaComandaRow,
} from './kpis-financeiros';
import { parteReservaNaoDescontada } from './kpis-financeiros';
import type { FinanceiroFechamentoRow } from './fechamentos-mensais';
import type { RetiradaSociaDevolucaoRow, RetiradaSociaRow } from './retiradas-socia';

/** O mínimo do client supabase-js usado aqui (web: @supabase/ssr; mobile: @supabase/supabase-js). */
export interface ClienteDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabela: string): any;
}

type RespostaDb<T> = { data: T[] | null; error: { message: string } | null };

/** Pagina com buscarTodasPaginas e LANÇA o erro do banco — base de todas as consultas de shared. */
export async function buscarTodasOuLancar<T>(montar: (de: number, ate: number) => PromiseLike<RespostaDb<T>>): Promise<T[]> {
  return buscarTodasPaginas<T>(async (de, ate) => {
    const r = await montar(de, ate);
    if (r.error) throw new Error(r.error.message);
    return r;
  });
}

/**
 * Coluna da migration 090 (aplicada à mão no SQL Editor): enquanto ela não existe, o PostgREST
 * recusa o SELECT inteiro (42703 "column ... desconto_rateado does not exist"). As consultas que a
 * pedem refazem a busca sem ela (`buscarComDescontoRateado`) e a regra trata a ausência como 0.
 */
const DESCONTO_RATEADO = 'desconto_rateado';

/** Erro de "a coluna desconto_rateado ainda não existe" (antes da 090). */
export function erroSemDescontoRateado(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : (e as { message?: string } | null)?.message ?? '';
  return msg.includes(DESCONTO_RATEADO);
}

/**
 * Busca com `desconto_rateado` e, se a coluna ainda não existe (antes da 090), refaz sem ela. Só
 * esse erro desce para a versão sem a coluna; qualquer outro é lançado.
 */
export async function buscarComDescontoRateado<T>(
  colunas: string, colunasLegado: string,
  montar: (colunas: string) => (de: number, ate: number) => PromiseLike<RespostaDb<T>>,
): Promise<T[]> {
  try {
    return await buscarTodasOuLancar<T>(montar(colunas));
  } catch (e) {
    if (!erroSemDescontoRateado(e)) throw e;
    return buscarTodasOuLancar<T>(montar(colunasLegado));
  }
}

const RELACOES_AGENDAMENTO_FIN = `
  servico:servicos(nome, categoria),
  profissional:users!agendamentos_profissional_id_fkey(nome, foto_url),
  cliente:clientes!agendamentos_cliente_id_fkey(nome)`;

/** Colunas dos agendamentos antes da 090 (sem `desconto_rateado`). */
export const COLUNAS_AGENDAMENTO_FIN_LEGADO = `id, valor, status, data_hora_inicio, pacote_cliente_id, cliente_id, profissional_id, servico_id,${RELACOES_AGENDAMENTO_FIN}`;

/** Colunas dos agendamentos (inclui nomes para rankings e categoria/foto para o mobile). */
export const COLUNAS_AGENDAMENTO_FIN = `id, valor, ${DESCONTO_RATEADO}, status, data_hora_inicio, pacote_cliente_id, cliente_id, profissional_id, servico_id,${RELACOES_AGENDAMENTO_FIN}`;

/**
 * Colunas dos serviços extras da comanda. `comandas!inner` deixa filtrar pela
 * comanda (status e fechada_at) e descarta itens cuja comanda o RLS esconde.
 */
const RELACOES_SERVICO_EXTRA_FIN = `
  servico:servicos(nome),
  profissional:users(nome),
  comanda:comandas!inner(fechada_at, status, clientes_id, cliente:clientes!comandas_clientes_id_fkey(nome))`;
export const COLUNAS_SERVICO_EXTRA_FIN = `id, valor_unit, quantidade, ${DESCONTO_RATEADO}, profissional_id, servico_id, descricao,${RELACOES_SERVICO_EXTRA_FIN}`;
/** Antes da 090 (sem `desconto_rateado`). */
export const COLUNAS_SERVICO_EXTRA_FIN_LEGADO = `id, valor_unit, quantidade, profissional_id, servico_id, descricao,${RELACOES_SERVICO_EXTRA_FIN}`;

type ServicoExtraBrutoRow = Omit<ServicoExtraFinRow, 'fechada_at' | 'cliente_id' | 'cliente'> & {
  comanda: { fechada_at: string; clientes_id: string | null; cliente?: { nome: string } | null } | null;
};

/**
 * Serviços extras (comanda_itens tipo 'servico') das comandas FECHADAS com
 * fechada_at dentro dos limites — receita desde 2026-10-08 (decisão do dono).
 * RLS: a profissional só recebe os itens das comandas que ela enxerga; a
 * consulta não falha por isso, igual às demais.
 */
export async function carregarServicosExtras(db: ClienteDb, empresaId: string, l: Limites): Promise<ServicoExtraFinRow[]> {
  const linhas = await buscarComDescontoRateado<ServicoExtraBrutoRow>(COLUNAS_SERVICO_EXTRA_FIN, COLUNAS_SERVICO_EXTRA_FIN_LEGADO,
    colunas => (de, ate) => db.from('comanda_itens')
      .select(colunas)
      .eq('empresa_id', empresaId).eq('tipo', 'servico')
      .eq('comanda.status', 'fechada')
      .gte('comanda.fechada_at', l.startIso).lte('comanda.fechada_at', l.endIso)
      .order('id')
      .range(de, ate));
  return linhas
    .filter(x => x.comanda?.fechada_at)
    .map(({ comanda, ...x }) => ({
      ...x,
      fechada_at: comanda!.fechada_at,
      cliente_id: comanda!.clientes_id ?? null,
      cliente: comanda!.cliente ?? null,
    }));
}

/** Busca paginada em lotes de ids (`.in()`), sem N+1; lança o erro do banco. */
async function buscarEmLotes<T>(
  ids: string[], montar: (lote: string[]) => (de: number, ate: number) => PromiseLike<RespostaDb<T>>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    out.push(...await buscarTodasOuLancar<T>(montar(ids.slice(i, i + LOTE_IDS))));
  }
  return out;
}

const COLUNAS_TAXA_RESERVA_FIN = 'id, valor, paga_em, status, agendamento_id';
type AgComandaRow = { id: string; comanda_id: string | null };

/**
 * Taxas de reserva pagas (paga_em) dentro de `l`, cada uma com `valor_receita` = a parte que a
 * comanda NÃO descontou (regra no topo de kpis-financeiros.ts). Para a distribuição do
 * `comandas.desconto_reserva` sair certa, carrega TODAS as taxas pagas das comandas envolvidas,
 * mesmo as pagas fora do período. Atendimento ou comanda que o RLS esconde vira "sem comanda"
 * (a taxa conta inteira).
 */
export async function carregarTaxasReservaReceita(db: ClienteDb, empresaId: string, l: Limites): Promise<TaxaReservaFinRow[]> {
  const doPeriodo = await buscarTodasOuLancar<TaxaReservaFinRow>((de, ate) => db.from('taxas_reserva')
    .select(COLUNAS_TAXA_RESERVA_FIN)
    .eq('empresa_id', empresaId).neq('status', 'cancelada').not('paga_em', 'is', null)
    .gte('paga_em', l.startIso).lte('paga_em', l.endIso)
    .order('paga_em').order('id')
    .range(de, ate));
  const agIds = [...new Set(doPeriodo.map(t => t.agendamento_id).filter((x): x is string => !!x))];
  if (agIds.length === 0) return doPeriodo;

  const ags = await buscarEmLotes<AgComandaRow>(agIds, lote => (de, ate) => db.from('agendamentos')
    .select('id, comanda_id')
    .eq('empresa_id', empresaId).in('id', lote)
    .order('id')
    .range(de, ate));
  const comandaIds = [...new Set(ags.map(a => a.comanda_id).filter((x): x is string => !!x))];
  if (comandaIds.length === 0) return doPeriodo;

  const [comandas, agsDasComandas] = await Promise.all([
    buscarEmLotes<ComandaReservaRow>(comandaIds, lote => (de, ate) => db.from('comandas')
      .select('id, desconto_reserva')
      .eq('empresa_id', empresaId).in('id', lote)
      .order('id')
      .range(de, ate)),
    buscarEmLotes<AgComandaRow>(comandaIds, lote => (de, ate) => db.from('agendamentos')
      .select('id, comanda_id')
      .eq('empresa_id', empresaId).in('comanda_id', lote)
      .order('id')
      .range(de, ate)),
  ]);
  const comandaDoAg = new Map<string, string>();
  for (const a of [...ags, ...agsDasComandas]) if (a.comanda_id) comandaDoAg.set(a.id, a.comanda_id);

  // Taxas pagas de todos os atendimentos dessas comandas (inclusive pagas fora do período).
  const taxasDasComandas = await buscarEmLotes<TaxaReservaFinRow>([...comandaDoAg.keys()], lote => (de, ate) => db.from('taxas_reserva')
    .select(COLUNAS_TAXA_RESERVA_FIN)
    .eq('empresa_id', empresaId).neq('status', 'cancelada').not('paga_em', 'is', null)
    .in('agendamento_id', lote)
    .order('id')
    .range(de, ate));

  const porId = new Map<string, TaxaReservaFinRow>();
  for (const t of [...doPeriodo, ...taxasDasComandas]) porId.set(t.id, t);
  const taxas: TaxaReservaComandaRow[] = [...porId.values()].map(t => ({
    id: t.id, valor: t.valor, paga_em: t.paga_em,
    comanda_id: t.agendamento_id ? comandaDoAg.get(t.agendamento_id) ?? null : null,
  }));
  const parte = parteReservaNaoDescontada(taxas, comandas);
  return doPeriodo.map(t => ({ ...t, valor_receita: parte.get(t.id) ?? t.valor }));
}

export const COLUNAS_RETIRADA =
  'id,empresa_id,tipo,valor,data,descricao,metodo,parcelado,total_parcelas,valor_parcela,primeira_parcela_em,convertido_em,created_at';

/**
 * Todas as linhas financeiras dos limites `l`. Para comparar com o período
 * anterior, passe `uniaoLimites(anterior, atual)` e calcule os dois períodos
 * sobre o mesmo resultado — calcularKpisFinanceiros recorta sozinho.
 */
export async function carregarDadosFinanceiros(db: ClienteDb, empresaId: string, l: Limites): Promise<DadosFinanceiros> {
  const [agendamentos, vendas, taxasCancelamento, taxasReserva, pagamentos, comissoes, despesas, fechamentos, servicosExtras] =
    await Promise.all([
      buscarComDescontoRateado<AgendamentoFinRow>(COLUNAS_AGENDAMENTO_FIN, COLUNAS_AGENDAMENTO_FIN_LEGADO,
        colunas => (de, ate) => db.from('agendamentos')
          .select(colunas)
          .eq('empresa_id', empresaId)
          .gte('data_hora_inicio', l.startIso).lte('data_hora_inicio', l.endIso)
          .order('data_hora_inicio').order('id')
          .range(de, ate)),
      buscarTodasOuLancar<VendaFinRow>((de, ate) => db.from('vendas')
        .select('id, valor_final, created_at')
        .eq('empresa_id', empresaId)
        .gte('created_at', l.startIso).lte('created_at', l.endIso)
        .order('created_at').order('id')
        .range(de, ate)),
      buscarTodasOuLancar<TaxaPagaFinRow>((de, ate) => db.from('taxas_cancelamento')
        .select('id, valor, paga_em')
        .eq('empresa_id', empresaId).eq('status', 'pago')
        .gte('paga_em', l.startIso).lte('paga_em', l.endIso)
        .order('paga_em').order('id')
        .range(de, ate)),
      carregarTaxasReservaReceita(db, empresaId, l),
      buscarTodasOuLancar<PagamentoFinRow>((de, ate) => db.from('pagamentos')
        .select('id, metodo, valor, valor_liquido, created_at')
        .eq('empresa_id', empresaId).eq('status', 'pago')
        .gte('created_at', l.startIso).lte('created_at', l.endIso)
        .order('created_at').order('id')
        .range(de, ate)),
      buscarTodasOuLancar<ComissaoFinRow>((de, ate) => db.from('comissoes')
        .select('id, profissional_id, valor_comissao, status, created_at')
        .eq('empresa_id', empresaId)
        .gte('created_at', l.startIso).lte('created_at', l.endIso)
        .order('created_at').order('id')
        .range(de, ate)),
      buscarTodasOuLancar<DespesaFinRow>((de, ate) => db.from('despesas')
        .select('id, valor, categoria, status, data_pagamento')
        .eq('empresa_id', empresaId).eq('status', 'pago')
        .gte('data_pagamento', l.startDate).lte('data_pagamento', l.endDate)
        .order('data_pagamento').order('id')
        .range(de, ate)),
      buscarTodasOuLancar<FinanceiroFechamentoRow>((de, ate) => db.from('financeiro_ajustes_mensais')
        .select('mes, receita_bruta, comissao_paga')
        .eq('empresa_id', empresaId)
        .gte('mes', `${l.startDate.slice(0, 7)}-01`).lte('mes', l.endDate)
        .order('mes').order('id')
        .range(de, ate)),
      carregarServicosExtras(db, empresaId, l),
    ]);
  return { agendamentos, vendas, taxasCancelamento, taxasReserva, pagamentos, comissoes, despesas, fechamentos, servicosExtras };
}

export type ComissaoPendenteRow = { id: string; profissional_id: string; valor_comissao: number | string; created_at: string };

/** Todas as comissões pendentes da empresa, de qualquer mês (alerta do Dashboard, badge do menu e Equipe). */
export async function carregarComissoesPendentes(db: ClienteDb, empresaId: string): Promise<ComissaoPendenteRow[]> {
  return buscarTodasOuLancar<ComissaoPendenteRow>((de, ate) => db.from('comissoes')
    .select('id, profissional_id, valor_comissao, created_at')
    .eq('empresa_id', empresaId).eq('status', 'pendente')
    .order('created_at').order('id')
    .range(de, ate));
}

const LOTE_IDS = 150; // mantém a URL do PostgREST curta (~6 KB por lote)

/** Das `clienteIds`, quais já tinham atendimento concluído antes de `antesIso`. */
export async function carregarClientesComHistoricoAntes(
  db: ClienteDb, empresaId: string, clienteIds: string[], antesIso: string,
): Promise<Set<string>> {
  const comHistorico = new Set<string>();
  for (let i = 0; i < clienteIds.length; i += LOTE_IDS) {
    const lote = clienteIds.slice(i, i + LOTE_IDS);
    const linhas = await buscarTodasOuLancar<{ cliente_id: string }>((de, ate) => db.from('agendamentos')
      .select('cliente_id')
      .eq('empresa_id', empresaId).eq('status', 'concluido')
      .lt('data_hora_inicio', antesIso)
      .in('cliente_id', lote)
      .order('id')
      .range(de, ate));
    for (const l of linhas) comHistorico.add(l.cliente_id);
  }
  return comHistorico;
}

/**
 * TODAS as retiradas/empréstimos da dona e devoluções da empresa. O saldo
 * "a dona deve" é histórico; a lista e o total do período saem de
 * listarRetiradasDoPeriodo / retiradasDoPeriodo. RLS: só a dona enxerga.
 */
export async function carregarRetiradas(
  db: ClienteDb, empresaId: string,
): Promise<{ rows: RetiradaSociaRow[]; devs: RetiradaSociaDevolucaoRow[] }> {
  const [rows, devs] = await Promise.all([
    buscarTodasOuLancar<RetiradaSociaRow>((de, ate) => db.from('retiradas_socia')
      .select(COLUNAS_RETIRADA)
      .eq('empresa_id', empresaId)
      .order('data', { ascending: false }).order('id')
      .range(de, ate)),
    buscarTodasOuLancar<RetiradaSociaDevolucaoRow>((de, ate) => db.from('retiradas_socia_devolucoes')
      .select('id,retirada_id,valor,data,metodo')
      .eq('empresa_id', empresaId)
      .order('id')
      .range(de, ate)),
  ]);
  return { rows, devs };
}

/** Filtro `.or()` da LISTA de despesas do mês: vencimento OU pagamento dentro do mês. */
export function filtroDespesasDoMes(l: Limites): string {
  return `and(data_vencimento.gte.${l.startDate},data_vencimento.lte.${l.endDate}),`
    + `and(data_pagamento.gte.${l.startDate},data_pagamento.lte.${l.endDate})`;
}
