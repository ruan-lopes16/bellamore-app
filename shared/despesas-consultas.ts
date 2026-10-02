/**
 * @file despesas-consultas.ts
 * Histórico ÚNICO das recorrentes mensais (auto-lançamento e contagem derivada),
 * web e mobile. Paginado (sem teto silencioso) e lança erro.
 */
import { buscarTodasOuLancar, type ClienteDb } from './kpis-financeiros-consultas';
import { chaveDespesa, type DespesaRecorrenteInsert, type DespesaRecorrenteTemplate } from './despesas';

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
 * Grava as linhas de `montarLancamentosRecorrentes` no mês `mesChave` ('AAAA-MM').
 * Imediatamente antes do insert, reconsulta no banco as despesas do mês (qualquer
 * status) e descarta as linhas cuja `chaveDespesa` já existe — protege contra toque
 * duplo ou web e app lançando juntos. Confere a contagem inserida (RLS pode devolver
 * sucesso com menos linhas). Lança erro.
 *
 * Nota: isso estreita a janela de corrida, mas não a elimina por completo sem um
 * índice único no banco (sugestão futura; sem migration nesta fase).
 * O chamador só pode usar depois de carregar com SUCESSO as despesas do mês.
 */
export async function lancarRecorrentesMensais(
  db: ClienteDb, empresaId: string, mesChave: string, linhas: DespesaRecorrenteInsert[],
): Promise<{ inseridas: number; jaExistiam: number }> {
  if (linhas.length === 0) return { inseridas: 0, jaExistiam: 0 };
  const k = mesChave.slice(0, 7);
  const [ano, mes] = k.split('-').map(Number);
  const fim = `${k}-${String(new Date(Date.UTC(ano, mes, 0)).getUTCDate()).padStart(2, '0')}`;
  const doMes = await buscarTodasOuLancar<{ descricao: string; categoria: string | null }>((de, ate) => db.from('despesas')
    .select('descricao, categoria')
    .eq('empresa_id', empresaId)
    .gte('data_vencimento', `${k}-01`).lte('data_vencimento', fim)
    .order('id')
    .range(de, ate));
  const existentes = new Set(doMes.map(chaveDespesa));
  const novas = linhas.filter(l => !existentes.has(chaveDespesa(l)));
  const jaExistiam = linhas.length - novas.length;
  if (novas.length === 0) return { inseridas: 0, jaExistiam };
  const { data, error } = await db.from('despesas').insert(novas).select('id');
  if (error) throw new Error(error.message);
  const n = (data ?? []).length;
  if (n !== novas.length) {
    throw new Error(`Só ${n} de ${novas.length} despesas recorrentes foram lançadas. Recarregue e confira.`);
  }
  return { inseridas: n, jaExistiam };
}
