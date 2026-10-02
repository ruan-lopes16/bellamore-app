/**
 * @file dashboard-consultas.ts
 * Consultas ÚNICAS do Dashboard (web server component, Sidebar e app). Lançam
 * erro. Os `aplicarFiltro...` recebem um builder pronto (ex.: com
 * `{ count: 'exact', head: true }` no Sidebar) e só aplicam os filtros da regra.
 */
import { buscarTodasOuLancar, type ClienteDb } from './kpis-financeiros-consultas';
import { janelaDespesasVencendo, type ClienteAniversario, type ComandaNaoFechadaRow, type UltimaVisita } from './dashboard';

/** Última visita concluída por cliente (até `ateIso`, se informado). Sem teto de linhas. */
export async function carregarUltimasVisitas(db: ClienteDb, empresaId: string, ateIso?: string): Promise<Map<string, UltimaVisita>> {
  const linhas = await buscarTodasOuLancar<{ cliente_id: string | null; data_hora_inicio: string; cliente: { nome: string | null } | null }>(
    (de, ate) => {
      let q = db.from('agendamentos')
        .select('cliente_id, data_hora_inicio, cliente:clientes!agendamentos_cliente_id_fkey(nome)')
        .eq('empresa_id', empresaId).eq('status', 'concluido');
      if (ateIso) q = q.lte('data_hora_inicio', ateIso);
      return q.order('data_hora_inicio', { ascending: false }).order('id').range(de, ate);
    });
  // Ordem decrescente: a 1ª linha de cada cliente é a última visita.
  const mapa = new Map<string, UltimaVisita>();
  for (const a of linhas) {
    if (a.cliente_id && !mapa.has(a.cliente_id)) mapa.set(a.cliente_id, { nome: a.cliente?.nome || 'Cliente', ultimaVisita: a.data_hora_inicio });
  }
  return mapa;
}

/** Atendimento que já terminou e nunca virou comanda (nem cancelado/falta). */
export function aplicarFiltroComandasNaoFechadas<Q>(q: Q, empresaId: string, agoraIso: string): Q {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (q as any).eq('empresa_id', empresaId).is('comanda_id', null)
    .not('status', 'in', '("cancelado","faltou")').lt('data_hora_fim', agoraIso);
}

export async function carregarComandasNaoFechadas(db: ClienteDb, empresaId: string, agoraIso: string): Promise<ComandaNaoFechadaRow[]> {
  return buscarTodasOuLancar<ComandaNaoFechadaRow>((de, ate) =>
    aplicarFiltroComandasNaoFechadas(db.from('agendamentos').select('id, data_hora_inicio'), empresaId, agoraIso)
      .order('data_hora_inicio', { ascending: true }).order('id').range(de, ate));
}

export function aplicarFiltroDespesasVencendo<Q>(q: Q, empresaId: string, hoje: string): Q {
  const { de, ate } = janelaDespesasVencendo(hoje);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (q as any).eq('empresa_id', empresaId).eq('status', 'pendente')
    .gte('data_vencimento', de).lte('data_vencimento', ate);
}

export type DespesaVencendoRow = { id: string; descricao: string; valor: number | string; data_vencimento: string };

export async function carregarDespesasVencendo(db: ClienteDb, empresaId: string, hoje: string): Promise<DespesaVencendoRow[]> {
  return buscarTodasOuLancar<DespesaVencendoRow>((de, ate) =>
    aplicarFiltroDespesasVencendo(db.from('despesas').select('id, descricao, valor, data_vencimento'), empresaId, hoje)
      .order('data_vencimento').order('id').range(de, ate));
}

export async function carregarAniversariantes(db: ClienteDb, empresaId: string): Promise<ClienteAniversario[]> {
  return buscarTodasOuLancar<ClienteAniversario>((de, ate) => db.from('clientes')
    .select('id, nome, data_nascimento, telefone')
    .eq('empresa_id', empresaId).eq('ativo', true).not('data_nascimento', 'is', null)
    .order('id').range(de, ate));
}
