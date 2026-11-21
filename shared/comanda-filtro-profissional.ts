/**
 * @file comanda-filtro-profissional.ts
 * Filtro "Profissional" da lista de comandas do dia e do aviso de comandas não fechadas
 * (web e app). Só filtra o que aparece: não muda nenhum cálculo nem gravação.
 */
import type { ClienteDb } from './kpis-financeiros-consultas';

/** Valor do filtro que mostra todas as profissionais. */
export const FILTRO_PROFISSIONAL_TODAS = '';

type ComProfissional = { profissional?: { id: string; nome: string } | null };

/**
 * Quem vê as comandas de todas as profissionais (e portanto ganha o filtro):
 * `agenda.ver_equipe` ou `agenda.gerenciar_outras`.
 */
export function podeFiltrarPorProfissional(verEquipe: boolean, gerenciarOutras: boolean): boolean {
  return verEquipe || gerenciarOutras;
}

/** Profissionais que aparecem nos atendimentos dos cartões, sem repetir, em ordem alfabética. */
export function opcoesProfissionaisDosCartoes(cartoes: { agendamentos: ComProfissional[] }[]): { id: string; nome: string }[] {
  const mapa = new Map<string, string>();
  for (const c of cartoes) {
    for (const a of c.agendamentos) {
      if (a.profissional?.id && !mapa.has(a.profissional.id)) mapa.set(a.profissional.id, a.profissional.nome);
    }
  }
  return [...mapa.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Cartões com ao menos um atendimento da profissional. Vazio = todos. Só extras some ao filtrar. */
export function filtrarCartoesPorProfissional<T extends { agendamentos: ComProfissional[] }>(cartoes: T[], profissionalId: string): T[] {
  if (!profissionalId) return cartoes;
  return cartoes.filter(c => c.agendamentos.some(a => a.profissional?.id === profissionalId));
}

/** Itens do aviso de comandas não fechadas só da profissional. Vazio = todos. */
export function filtrarBacklogPorProfissional<T extends { profissional_id?: string | null }>(itens: T[], profissionalId: string): T[] {
  if (!profissionalId) return itens;
  return itens.filter(i => i.profissional_id === profissionalId);
}

/** Mapa atendimento -> profissional dos atendimentos do backlog (mesma regra de `carregarBacklogComandas`). */
export async function carregarProfissionaisDoBacklog(db: ClienteDb, empresaId: string, agoraIso: string) {
  const { data, error } = await db.from('agendamentos')
    .select('id, profissional_id')
    .eq('empresa_id', empresaId)
    .is('comanda_id', null)
    .not('status', 'in', '("cancelado","faltou")')
    .lt('data_hora_fim', agoraIso)
    .order('data_hora_inicio', { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as { id: string; profissional_id: string | null }[]).map(r => [r.id, r.profissional_id]));
}
