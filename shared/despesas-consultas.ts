/**
 * @file despesas-consultas.ts
 * Histórico ÚNICO das recorrentes mensais (auto-lançamento e contagem derivada),
 * web e mobile. Paginado (sem teto silencioso) e lança erro.
 */
import { buscarTodasOuLancar, type ClienteDb } from './kpis-financeiros-consultas';
import type { DespesaRecorrenteInsert, DespesaRecorrenteTemplate } from './despesas';

export const COLUNAS_HISTORICO_RECORRENTE =
  'id, descricao, categoria, valor, periodicidade, data_vencimento, recorrencia_ate, parcela_atual, total_parcelas, valor_total_compra';

/** Recorrentes MENSAIS com vencimento antes de `antesDe` ('yyyy-MM-dd'), mais recentes primeiro. */
export async function carregarHistoricoRecorrentesMensais(
  db: ClienteDb, empresaId: string, antesDe: string,
): Promise<DespesaRecorrenteTemplate[]> {
  return buscarTodasOuLancar<DespesaRecorrenteTemplate>((de, ate) => db.from('despesas')
    .select(COLUNAS_HISTORICO_RECORRENTE)
    .eq('empresa_id', empresaId).eq('recorrente', true).eq('periodicidade', 'mensal')
    .lt('data_vencimento', antesDe)
    .order('data_vencimento', { ascending: false }).order('id')
    .range(de, ate));
}

/**
 * Grava as linhas de `montarLancamentosRecorrentes` e confere a contagem inserida
 * (RLS pode devolver sucesso com menos linhas). Lança erro; devolve quantas gravou.
 * O chamador só pode usar depois de carregar com SUCESSO as despesas do mês
 * (senão duplicaria tudo) e deve recarregar a lista antes de permitir novo clique.
 */
export async function lancarRecorrentesMensais(
  db: ClienteDb, linhas: DespesaRecorrenteInsert[],
): Promise<number> {
  if (linhas.length === 0) return 0;
  const { data, error } = await db.from('despesas').insert(linhas).select('id');
  if (error) throw new Error(error.message);
  const n = (data ?? []).length;
  if (n !== linhas.length) {
    throw new Error(`Só ${n} de ${linhas.length} despesas recorrentes foram lançadas. Recarregue e confira.`);
  }
  return n;
}
