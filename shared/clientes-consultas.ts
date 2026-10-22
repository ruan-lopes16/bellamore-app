/**
 * @file clientes-consultas.ts
 * Consultas ÚNICAS de Clientes (web e app; spec docs/superpowers/specs/2026-10-22-paridade-clientes-design.md).
 * - `carregarBaseClientes`: tudo o que a lista precisa para segmentos/filtros/KPIs.
 * - `carregarHistoricoCliente`: fonte única do perfil (histórico numa lista só + agregado).
 * - `arquivarCliente`/`reativarCliente`: gravação com conferência das linhas afetadas.
 * Tudo paginado (teto silencioso de 1000 linhas do PostgREST) com desempate por id, e toda
 * consulta LANÇA o erro do banco: um total zerado por falha de rede ou RLS é pior que uma mensagem.
 */
import { buscarComDescontoRateado, buscarTodasOuLancar, type ClienteDb } from './kpis-financeiros-consultas';
import { valorCobradoAtendimento } from './kpis-financeiros';
import { descreverServicos } from './atendimento-detalhe';
import { mensagemErroBanco } from './erros';
import {
  agregarClientes, type Agregado, type AtendimentoBase, type ClienteBase, type ExtraBase, type VendaBase,
} from './clientes-segmentos';

export type BaseClientes = { clientes: ClienteBase[]; atendimentos: AtendimentoBase[]; extras: ExtraBase[]; vendas: VendaBase[] };

export type ItemHistorico =
  | { tipo: 'atendimento'; id: string; data: string; servicos: string; profissional: string | null; valor: number; status: string; comandaId: string | null; pacote: boolean }
  | { tipo: 'extra'; id: string; data: string; descricao: string; valor: number; comandaId: string }
  | { tipo: 'venda'; id: string; data: string; itens: { nome: string; quantidade: number }[]; valor: number }
  | { tipo: 'taxa_reserva' | 'taxa_cancelamento'; id: string; data: string; valor: number; status: string; metodo: string | null };

type Num = number | string | null | undefined;
const num = (v: Num): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const numOuNull = (v: Num): number | null => (v === null || v === undefined ? null : num(v));

const COLUNAS_CLIENTE_BASE = 'id, nome, telefone, email, data_nascimento, ativo, created_at';

type AtendBaseRow = {
  cliente_id: string | null; data_hora_inicio: string; valor: Num; desconto_rateado?: Num;
  pacote_cliente_id: string | null; servico_id: string | null; servico?: { nome: string } | null;
};
type ComandaRef = { fechada_at: string | null; status?: string; clientes_id: string | null } | null;
type ExtraBaseRow = { valor_unit: Num; quantidade: Num; desconto_rateado?: Num; comanda: ComandaRef };
type VendaBaseRow = { cliente_id: string | null; valor_final: Num; created_at: string };

const paraAtendimentoBase = (a: AtendBaseRow): AtendimentoBase => ({
  cliente_id: a.cliente_id, data_hora_inicio: a.data_hora_inicio, valor: numOuNull(a.valor),
  desconto_rateado: numOuNull(a.desconto_rateado), pacote_cliente_id: a.pacote_cliente_id,
  servico_id: a.servico_id, servico_nome: a.servico?.nome ?? null,
});

const valorExtra = (x: { valor_unit: Num; quantidade: Num; desconto_rateado?: Num }): number =>
  Math.max(num(x.valor_unit) * num(x.quantidade) - num(x.desconto_rateado), 0);

/**
 * Base da lista de clientes: clientes (ativas E arquivadas), atendimentos concluídos com cliente,
 * serviços extras de comandas FECHADAS com cliente (data = `fechada_at`) e vendas com cliente.
 * Entra direto em `agregarClientes`/`contarSegmentos`/`filtrarClientes`.
 */
export async function carregarBaseClientes(db: ClienteDb, empresaId: string): Promise<BaseClientes> {
  const [clientes, atend, extras, vendas] = await Promise.all([
    buscarTodasOuLancar<ClienteBase>((de, ate) => db.from('clientes')
      .select(COLUNAS_CLIENTE_BASE)
      .eq('empresa_id', empresaId)
      .order('id')
      .range(de, ate)),
    buscarComDescontoRateado<AtendBaseRow>(
      'id, cliente_id, data_hora_inicio, valor, desconto_rateado, pacote_cliente_id, servico_id, servico:servicos(nome)',
      'id, cliente_id, data_hora_inicio, valor, pacote_cliente_id, servico_id, servico:servicos(nome)',
      colunas => (de, ate) => db.from('agendamentos')
        .select(colunas)
        .eq('empresa_id', empresaId).eq('status', 'concluido')
        .not('cliente_id', 'is', null)
        .order('id')
        .range(de, ate)),
    buscarComDescontoRateado<ExtraBaseRow>(
      'id, valor_unit, quantidade, desconto_rateado, comanda:comandas!inner(fechada_at, status, clientes_id)',
      'id, valor_unit, quantidade, comanda:comandas!inner(fechada_at, status, clientes_id)',
      colunas => (de, ate) => db.from('comanda_itens')
        .select(colunas)
        .eq('empresa_id', empresaId).eq('tipo', 'servico')
        .eq('comanda.status', 'fechada')
        .not('comanda.clientes_id', 'is', null)
        .order('id')
        .range(de, ate)),
    buscarTodasOuLancar<VendaBaseRow>((de, ate) => db.from('vendas')
      .select('id, cliente_id, valor_final, created_at')
      .eq('empresa_id', empresaId)
      .not('cliente_id', 'is', null)
      .order('id')
      .range(de, ate)),
  ]);
  return {
    clientes,
    atendimentos: atend.map(paraAtendimentoBase),
    extras: extras
      .filter(x => x.comanda?.fechada_at && x.comanda.clientes_id)
      .map(x => ({
        cliente_id: x.comanda!.clientes_id, valor_unit: num(x.valor_unit), quantidade: num(x.quantidade),
        desconto_rateado: numOuNull(x.desconto_rateado), fechada_at: x.comanda!.fechada_at!,
      })),
    vendas: vendas.map(v => ({ cliente_id: v.cliente_id, valor_final: num(v.valor_final), created_at: v.created_at })),
  };
}

type AtendHistRow = AtendBaseRow & {
  id: string; status: string; comanda_id: string | null;
  agendamento_servicos?: { ordem: number; servico: { nome: string } | null }[] | null;
  profissional?: { nome: string } | null;
};
type ExtraHistRow = ExtraBaseRow & { id: string; comanda_id: string; descricao: string | null; servico?: { nome: string } | null };
type VendaHistRow = VendaBaseRow & { id: string; venda_itens?: { quantidade: Num; produto: { nome: string } | null }[] | null };
type TaxaHistRow = { id: string; valor: Num; status: string; created_at: string; paga_em: string | null; metodo: string | null };
/** Data da taxa no histórico: a do pagamento quando paga (mesma data do Financeiro), senão a de criação. */
const dataTaxa = (t: TaxaHistRow): string => t.paga_em ?? t.created_at;

const RELACOES_ATEND_HIST = `servico:servicos(nome),
  agendamento_servicos(ordem, servico:servicos(nome)),
  profissional:users!agendamentos_profissional_id_fkey(nome)`;
const COLUNAS_ATEND_HIST_LEGADO = `id, cliente_id, data_hora_inicio, valor, status, comanda_id, pacote_cliente_id, servico_id, ${RELACOES_ATEND_HIST}`;
const COLUNAS_ATEND_HIST = `id, cliente_id, data_hora_inicio, valor, desconto_rateado, status, comanda_id, pacote_cliente_id, servico_id, ${RELACOES_ATEND_HIST}`;
const RELACOES_EXTRA_HIST = 'servico:servicos(nome), comanda:comandas!inner(fechada_at, status, clientes_id)';
const COLUNAS_TAXA_HIST = 'id, valor, status, created_at, paga_em, metodo';

/**
 * Fonte única do perfil da cliente: atendimentos (todos os status, com serviços e profissional),
 * serviços extras de comandas fechadas, vendas avulsas com os itens e taxas de reserva/cancelamento
 * com a forma de pagamento (encerradas, status `cancelada`, ficam fora). Uma lista só, da data mais
 * recente para a mais antiga. O agregado (KPIs) vem de `agregarClientes` aplicado só a esta cliente,
 * com os atendimentos concluídos: sessão de pacote conta visita e vale R$ 0.
 */
export async function carregarHistoricoCliente(
  db: ClienteDb, empresaId: string, clienteId: string,
): Promise<{ itens: ItemHistorico[]; agregado: Agregado }> {
  const taxas = (tabela: string) => buscarTodasOuLancar<TaxaHistRow>((de, ate) => db.from(tabela)
    .select(COLUNAS_TAXA_HIST)
    .eq('empresa_id', empresaId).eq('cliente_id', clienteId)
    .neq('status', 'cancelada')   // encerradas ao concluir o atendimento (061) ou dispensadas (091)
    .order('created_at', { ascending: false }).order('id')
    .range(de, ate));

  const [ags, extrasBrutos, vendas, reservas, cancelamentos] = await Promise.all([
    buscarComDescontoRateado<AtendHistRow>(COLUNAS_ATEND_HIST, COLUNAS_ATEND_HIST_LEGADO,
      colunas => (de, ate) => db.from('agendamentos')
        .select(colunas)
        .eq('empresa_id', empresaId).eq('cliente_id', clienteId)
        .order('data_hora_inicio', { ascending: false }).order('id')
        .range(de, ate)),
    buscarComDescontoRateado<ExtraHistRow>(
      `id, comanda_id, descricao, valor_unit, quantidade, desconto_rateado, ${RELACOES_EXTRA_HIST}`,
      `id, comanda_id, descricao, valor_unit, quantidade, ${RELACOES_EXTRA_HIST}`,
      colunas => (de, ate) => db.from('comanda_itens')
        .select(colunas)
        .eq('empresa_id', empresaId).eq('tipo', 'servico')
        .eq('comanda.clientes_id', clienteId)
        .eq('comanda.status', 'fechada')
        .order('id')
        .range(de, ate)),
    buscarTodasOuLancar<VendaHistRow>((de, ate) => db.from('vendas')
      .select('id, cliente_id, valor_final, created_at, venda_itens(quantidade, produto:produtos(nome))')
      .eq('empresa_id', empresaId).eq('cliente_id', clienteId)
      .order('created_at', { ascending: false }).order('id')
      .range(de, ate)),
    taxas('taxas_reserva'),
    taxas('taxas_cancelamento'),
  ]);
  const extras = extrasBrutos.filter(x => x.comanda?.fechada_at);

  const itens: ItemHistorico[] = [
    ...ags.map((a): ItemHistorico => ({
      tipo: 'atendimento', id: a.id, data: a.data_hora_inicio,
      servicos: descreverServicos(a) ?? '',
      profissional: a.profissional?.nome ?? null,
      valor: a.pacote_cliente_id ? 0 : valorCobradoAtendimento({ valor: num(a.valor), desconto_rateado: num(a.desconto_rateado) }),
      status: a.status, comandaId: a.comanda_id ?? null, pacote: !!a.pacote_cliente_id,
    })),
    ...extras.map((x): ItemHistorico => ({
      tipo: 'extra', id: x.id, data: x.comanda!.fechada_at!,
      descricao: x.servico?.nome ?? x.descricao ?? 'Serviço', valor: valorExtra(x), comandaId: x.comanda_id,
    })),
    ...vendas.map((v): ItemHistorico => ({
      tipo: 'venda', id: v.id, data: v.created_at, valor: num(v.valor_final),
      itens: (v.venda_itens ?? []).map(i => ({ nome: i.produto?.nome ?? 'Produto', quantidade: num(i.quantidade) })),
    })),
    ...reservas.map((t): ItemHistorico => ({
      tipo: 'taxa_reserva', id: t.id, data: dataTaxa(t), valor: num(t.valor), status: t.status, metodo: t.metodo ?? null,
    })),
    ...cancelamentos.map((t): ItemHistorico => ({
      tipo: 'taxa_cancelamento', id: t.id, data: dataTaxa(t), valor: num(t.valor), status: t.status, metodo: t.metodo ?? null,
    })),
  ];
  // Mais recente primeiro; empate de instante desempata pelo id (ordem estável entre plataformas).
  itens.sort((a, b) => (Date.parse(b.data) - Date.parse(a.data)) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

  const ag = agregarClientes(
    ags.filter(a => a.status === 'concluido').map(paraAtendimentoBase),
    extras.map(x => ({
      cliente_id: clienteId, valor_unit: num(x.valor_unit), quantidade: num(x.quantidade),
      desconto_rateado: numOuNull(x.desconto_rateado), fechada_at: x.comanda!.fechada_at!,
    }) satisfies ExtraBase),
    vendas.map(v => ({ cliente_id: clienteId, valor_final: num(v.valor_final), created_at: v.created_at }) satisfies VendaBase),
  );
  const agregado = ag.get(clienteId) ?? { atendimentos: 0, totalGasto: 0, ultimaVisita: null, servicoFavorito: null };
  return { itens, agregado };
}

const SEM_PERMISSAO_ARQUIVAR = 'Você não tem permissão para arquivar ou reativar esta cliente.';

async function gravarAtivo(db: ClienteDb, empresaId: string, id: string, ativo: boolean): Promise<void> {
  const { data, error } = await db.from('clientes')
    .update({ ativo })
    .eq('id', id).eq('empresa_id', empresaId)
    .select('id');
  if (error) throw new Error(mensagemErroBanco(error, ativo ? 'reativar a cliente' : 'arquivar a cliente'));
  // RLS que recusa o UPDATE devolve sucesso com 0 linhas: nunca tratar como gravado.
  if (!data || data.length === 0) throw new Error(SEM_PERMISSAO_ARQUIVAR);
}

/** Arquiva (`ativo = false`): some da lista e dos segmentos, histórico preservado. */
export async function arquivarCliente(db: ClienteDb, empresaId: string, id: string): Promise<void> {
  return gravarAtivo(db, empresaId, id, false);
}

/** Reativa uma cliente arquivada (`ativo = true`). Mesma permissão de arquivar. */
export async function reativarCliente(db: ClienteDb, empresaId: string, id: string): Promise<void> {
  return gravarAtivo(db, empresaId, id, true);
}
