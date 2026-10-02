/**
 * @file relatorios-consultas.ts
 * Consultas ÚNICAS das abas sob demanda dos Relatórios (Estoque, Avaliações).
 * Paginadas e lançam erro.
 */
import { buscarTodasOuLancar, type ClienteDb } from './kpis-financeiros-consultas';
import type { Limites } from './periodos';
import type { AvaliacaoRow, MovEstoqueRow } from './relatorios';

export async function carregarSaidasEstoque(db: ClienteDb, empresaId: string, l: Limites): Promise<MovEstoqueRow[]> {
  return buscarTodasOuLancar<MovEstoqueRow>((de, ate) => db.from('estoque_movimentos')
    .select('produto_id, quantidade, produto:produtos(nome, preco_custo)')
    .eq('empresa_id', empresaId).eq('tipo', 'saida')
    .gte('created_at', l.startIso).lte('created_at', l.endIso)
    .order('created_at').order('id')
    .range(de, ate));
}

/**
 * avaliacoes.profissional_id aponta para empresa_membros (que NÃO tem nome):
 * o nome vem de empresa_membros → users. O embed antigo `empresa_membros(nome)`
 * fazia a aba Avaliações do web falhar sempre.
 */
export const COLUNAS_AVALIACAO = `nota, comentario, created_at, profissional_id,
  profissional:empresa_membros!avaliacoes_profissional_id_fkey(user:users!empresa_membros_user_id_fkey(nome)),
  cliente:clientes!avaliacoes_cliente_id_fkey(nome)`;

export async function carregarAvaliacoes(db: ClienteDb, empresaId: string, l: Limites): Promise<AvaliacaoRow[]> {
  return buscarTodasOuLancar<AvaliacaoRow>((de, ate) => db.from('avaliacoes')
    .select(COLUNAS_AVALIACAO)
    .eq('empresa_id', empresaId)
    .gte('created_at', l.startIso).lte('created_at', l.endIso)
    .order('created_at', { ascending: false }).order('id')
    .range(de, ate));
}
