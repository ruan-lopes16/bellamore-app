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

const ERRO_TABELA_PULADAS = 'Falta aplicar a migration 096 (despesas_recorrentes_puladas) no Supabase.';
function tabelaPuladasAusente(msg: string): boolean { return /despesas_recorrentes_puladas/.test(msg) && /(does not exist|schema cache|not find)/i.test(msg); }

/** Chaves das séries marcadas "pular" no mês `inicioMes` ('yyyy-MM-dd'). Sem a migration 096 = lista vazia. Lança outros erros. */
export async function carregarChavesPuladas(db: ClienteDb, empresaId: string, inicioMes: string): Promise<string[]> {
  const { data, error } = await db.from('despesas_recorrentes_puladas')
    .select('chave').eq('empresa_id', empresaId).eq('mes', `${inicioMes.slice(0, 7)}-01`);
  if (error) {
    if (tabelaPuladasAusente(error.message)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as { chave: string }[]).map(r => r.chave);
}

/** Marca a série como "não vale neste mês". Idempotente. Lança erro. */
export async function pularMesRecorrente(db: ClienteDb, empresaId: string, chave: string, inicioMes: string): Promise<void> {
  const { error } = await db.from('despesas_recorrentes_puladas')
    .upsert({ empresa_id: empresaId, chave, mes: `${inicioMes.slice(0, 7)}-01` }, { onConflict: 'empresa_id,chave,mes', ignoreDuplicates: true });
  if (error) throw new Error(tabelaPuladasAusente(error.message) ? ERRO_TABELA_PULADAS : error.message);
}

/** Encerra a série: grava `recorrencia_ate` ('yyyy-MM-dd') no modelo mais recente. No banner use `fimDoMesAnterior(inicioMes)`. Lança erro. */
export async function encerrarSerieRecorrente(db: ClienteDb, empresaId: string, modeloId: string, recorrenciaAte: string): Promise<void> {
  const { data, error } = await db.from('despesas')
    .update({ recorrencia_ate: recorrenciaAte }).eq('id', modeloId).eq('empresa_id', empresaId).select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('Sem permissão para encerrar esta recorrência.');
}

/** Lançamentos recorrentes de uma série (descrição+categoria), para a confirmação de exclusão. Lança erro. */
export async function carregarSerieRecorrente(
  db: ClienteDb, empresaId: string, d: { descricao: string; categoria?: string | null },
): Promise<{ id: string; status: string; data_vencimento: string | null }[]> {
  const linhas = await buscarTodasOuLancar<{ id: string; status: string; data_vencimento: string | null; categoria: string | null }>((de, ate) => db.from('despesas')
    .select('id, status, data_vencimento, categoria, descricao')
    .eq('empresa_id', empresaId).eq('recorrente', true).eq('descricao', d.descricao)
    .order('id').range(de, ate));
  const chave = chaveDespesa(d);
  return linhas.filter(l => chaveDespesa({ descricao: d.descricao, categoria: l.categoria }) === chave);
}

/**
 * Exclui uma recorrência. Sempre impede a volta: marca o mês como pulado (`escopo: 'uma'`) ou
 * encerra o modelo (`'serie'`, se sobrar linha paga, senão não sobra nada para sugerir).
 * Confere as linhas apagadas (DELETE é só da dona; RLS devolve sucesso com 0 linhas). Lança erro.
 */
export async function excluirRecorrencia(
  db: ClienteDb, empresaId: string,
  p: { chave: string; escopo: 'uma' | 'serie'; apagar: string[]; mesPulado: string; modeloRestante?: { id: string; data_vencimento: string } },
): Promise<void> {
  if (p.escopo === 'uma') await pularMesRecorrente(db, empresaId, p.chave, p.mesPulado);
  if (p.apagar.length > 0) {
    const { data, error } = await db.from('despesas').delete().eq('empresa_id', empresaId).in('id', p.apagar).select('id');
    if (error) throw new Error(error.message);
    if ((data ?? []).length !== p.apagar.length) throw new Error('Só a dona pode excluir despesas (nem todas foram apagadas).');
  }
  // Sobrou linha (paga): ela viraria o modelo e a série voltaria — encerra no próprio vencimento.
  if (p.escopo === 'serie' && p.modeloRestante) {
    await encerrarSerieRecorrente(db, empresaId, p.modeloRestante.id, p.modeloRestante.data_vencimento);
  }
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
