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
  PagamentoFinRow, ServicoExtraFinRow, TaxaPagaFinRow, VendaFinRow,
} from './kpis-financeiros';
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

/** Colunas dos agendamentos (inclui nomes para rankings e categoria/foto para o mobile). */
export const COLUNAS_AGENDAMENTO_FIN = `id, valor, status, data_hora_inicio, pacote_cliente_id, cliente_id, profissional_id, servico_id,
  servico:servicos(nome, categoria),
  profissional:users!agendamentos_profissional_id_fkey(nome, foto_url),
  cliente:clientes!agendamentos_cliente_id_fkey(nome)`;

/**
 * Colunas dos serviços extras da comanda. `comandas!inner` deixa filtrar pela
 * comanda (status e fechada_at) e descarta itens cuja comanda o RLS esconde.
 */
export const COLUNAS_SERVICO_EXTRA_FIN = `id, valor_unit, quantidade, profissional_id, servico_id, descricao,
  servico:servicos(nome),
  profissional:users(nome),
  comanda:comandas!inner(fechada_at, status, clientes_id, cliente:clientes!comandas_clientes_id_fkey(nome))`;

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
  const linhas = await buscarTodasOuLancar<ServicoExtraBrutoRow>((de, ate) => db.from('comanda_itens')
    .select(COLUNAS_SERVICO_EXTRA_FIN)
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
      buscarTodasOuLancar<AgendamentoFinRow>((de, ate) => db.from('agendamentos')
        .select(COLUNAS_AGENDAMENTO_FIN)
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
      buscarTodasOuLancar<TaxaPagaFinRow>((de, ate) => db.from('taxas_reserva')
        .select('id, valor, paga_em')
        .eq('empresa_id', empresaId).not('paga_em', 'is', null)
        .gte('paga_em', l.startIso).lte('paga_em', l.endIso)
        .order('paga_em').order('id')
        .range(de, ate)),
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
