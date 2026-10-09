/**
 * @file comanda-consultas.ts
 * Consultas ÚNICAS da tela de comanda (web e app).
 */
import type { ClienteDb } from './kpis-financeiros-consultas';
import type { Limites } from './periodos';
import type { ComandaSoExtras } from './comanda';

/**
 * Atendimentos que já terminaram e não têm comanda (esqueceram de fechar, ou foram marcados
 * "concluído" sem comanda pelo atalho do app). Mais antigo primeiro, até 500.
 */
export async function carregarBacklogComandas(db: ClienteDb, empresaId: string, agoraIso: string) {
  const { data, error } = await db.from('agendamentos')
    .select('id, data_hora_inicio')
    .eq('empresa_id', empresaId)
    .is('comanda_id', null)
    .not('status', 'in', '("cancelado","faltou")')
    .lt('data_hora_fim', agoraIso)
    .order('data_hora_inicio', { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; data_hora_inicio: string }[];
}

/** Comandas fechadas no dia que não têm nenhum atendimento (só produtos/serviços extras). */
export async function carregarComandasSoExtrasDoDia(db: ClienteDb, empresaId: string, l: Limites): Promise<ComandaSoExtras[]> {
  const { data, error } = await db.from('comandas')
    .select('id, fechada_at, cliente:clientes!comandas_clientes_id_fkey(id, nome, telefone), agendamentos(id)')
    .eq('empresa_id', empresaId)
    .eq('status', 'fechada')
    .gte('fechada_at', l.startIso)
    .lte('fechada_at', l.endIso)
    .order('fechada_at');
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; fechada_at: string; cliente: ComandaSoExtras['cliente']; agendamentos?: unknown[] }[])
    .filter(c => (c.agendamentos ?? []).length === 0)
    .map(c => ({ id: c.id, fechada_at: c.fechada_at, cliente: c.cliente ?? null }));
}

/**
 * Ids de `comanda_itens` cuja comissão já foi paga (trava profissional/remover na edição).
 * Sem a migration 085 a coluna não existe: devolve vazio (não há comissão de item).
 */
export async function carregarComissoesPagasDosItens(db: ClienteDb, itemIds: string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const { data, error } = await db.from('comissoes')
    .select('comanda_item_id').in('comanda_item_id', itemIds).eq('status', 'pago');
  if (error) return new Set();
  return new Set(((data ?? []) as { comanda_item_id: string }[]).map(r => r.comanda_item_id));
}
