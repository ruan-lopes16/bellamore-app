/**
 * Acesso ao banco do Estoque (web e app). Toda consulta LANÇA erro em vez de devolver lista vazia.
 * A movimentação manual passa pela função `movimentar_estoque` (migration 088: trava e recusa
 * saída maior que o saldo); sem a 088 (`PGRST202`) usa o caminho antigo.
 */
import { buscarTodasOuLancar, type ClienteDb } from './kpis-financeiros-consultas';
import { limitesMes } from './periodos';
import { mensagemErroBanco } from './erros';
import { normalizarUnidadesVisiveis } from './estoque';

export type ProdutoEstoque = {
  id: string; empresa_id: string; nome: string; categoria: string; unidade: string; qtd_por_unidade: number;
  estoque_atual: number; estoque_minimo: number; preco_custo: number; preco_venda: number;
  tipo: 'material' | 'venda'; ativo: boolean;
};

export type MovimentoEstoque = {
  id: string; tipo: 'entrada' | 'saida' | 'ajuste'; quantidade: number; motivo: string | null; created_at: string;
  agendamento_id: string | null; produto_id: string; produto: { nome: string; unidade: string } | null;
};

/** Cliente do banco com `rpc` (a função da 088). Estrutural. */
export type ClienteDbEstoque = ClienteDb & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any;
};

const num = (v: unknown, padrao = 0) => { const n = Number(v); return Number.isFinite(n) ? n : padrao; };

/** Produtos ativos da empresa (ordem categoria/nome), com os numéricos convertidos. */
export async function carregarProdutosEstoque(db: ClienteDb, empresaId: string): Promise<ProdutoEstoque[]> {
  const linhas = await buscarTodasOuLancar<Record<string, unknown>>((de, ate) => db.from('produtos')
    .select('*')
    .eq('empresa_id', empresaId).eq('ativo', true)
    .order('categoria').order('nome').order('id')
    .range(de, ate));
  return linhas.map(p => ({
    ...(p as unknown as ProdutoEstoque),
    estoque_atual: num(p.estoque_atual),
    estoque_minimo: num(p.estoque_minimo),
    preco_custo: num(p.preco_custo),
    preco_venda: num(p.preco_venda),
    qtd_por_unidade: num(p.qtd_por_unidade, 1) || 1,
  }));
}

/** Movimentos do mês 'yyyy-MM' (limites em Brasília), mais recentes primeiro. */
export async function carregarMovimentosMes(db: ClienteDb, empresaId: string, mesChave: string): Promise<MovimentoEstoque[]> {
  const { startIso, endIso } = limitesMes(mesChave);
  const linhas = await buscarTodasOuLancar<Record<string, unknown>>((de, ate) => db.from('estoque_movimentos')
    .select('id, tipo, quantidade, motivo, created_at, agendamento_id, produto_id, produto:produtos(nome, unidade)')
    .eq('empresa_id', empresaId)
    .gte('created_at', startIso).lte('created_at', endIso)
    .order('created_at', { ascending: false }).order('id')
    .range(de, ate));
  return linhas.map(m => ({ ...(m as unknown as MovimentoEstoque), quantidade: num(m.quantidade) }));
}

const SEM_RESPOSTA = 'Sem resposta do servidor: a movimentação pode ter sido registrada. Confira em Movimentações antes de repetir.';
const fmtSaldo = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

/**
 * Entrada ou saída manual. Pela função da 088 (saldo conferido e travado no banco; devolve o saldo
 * real). Sem a 088 (`PGRST202`): confere o saldo da tela e grava o movimento (o trigger baixa o
 * saldo). Lança `Error` com a mensagem para a tela.
 */
export async function movimentarEstoque(
  db: ClienteDbEstoque,
  d: { empresaId: string; produto: { id: string; estoque_atual: number; nome: string; unidade: string }; tipo: 'entrada' | 'saida'; quantidade: number; motivo: string },
): Promise<{ novoSaldo: number }> {
  if (!(d.quantidade > 0)) throw new Error('Informe uma quantidade maior que zero.');
  const motivo = d.motivo.trim();
  const { data, error } = await db.rpc('movimentar_estoque', {
    p_produto: d.produto.id, p_tipo: d.tipo, p_quantidade: d.quantidade, p_motivo: motivo,
  });
  if (error?.code !== 'PGRST202') {
    if (error) throw new Error(error.code ? mensagemErroBanco(error, 'movimentar o estoque') : SEM_RESPOSTA);
    const saldo = Number(data);
    if (data === null || data === undefined || !Number.isFinite(saldo)) throw new Error(SEM_RESPOSTA);
    return { novoSaldo: saldo };
  }

  // Sem a 088: caminho antigo, saldo conferido contra o que a tela mostra.
  if (d.tipo === 'saida' && d.quantidade > d.produto.estoque_atual) {
    throw new Error(`Estoque insuficiente: ${d.produto.nome} (restam ${fmtSaldo(d.produto.estoque_atual)} ${d.produto.unidade})`);
  }
  const { error: eIns } = await db.from('estoque_movimentos').insert({
    produto_id: d.produto.id, empresa_id: d.empresaId, tipo: d.tipo, quantidade: d.quantidade, motivo: motivo || null,
  });
  if (eIns) throw new Error(mensagemErroBanco(eIns, 'movimentar o estoque'));
  const novo = d.tipo === 'entrada' ? d.produto.estoque_atual + d.quantidade : d.produto.estoque_atual - d.quantidade;
  return { novoSaldo: Math.round(novo * 1000) / 1000 };
}

/** Tabela inexistente (a 088 não foi rodada). */
const tabelaInexistente = (e: { code?: string | null; message?: string | null }) =>
  e.code === 'PGRST205' || e.code === '42P01' || /could not find the table|does not exist/i.test(e.message ?? '');

/**
 * Unidades visíveis da empresa. `unidades: null` = usar o padrão; `disponivel: false` = sem a 088
 * (a tela esconde o ajuste de unidades).
 */
export async function carregarUnidadesVisiveis(db: ClienteDb, empresaId: string): Promise<{ unidades: string[] | null; disponivel: boolean }> {
  const { data, error } = await db.from('estoque_unidades_empresa').select('unidades').eq('empresa_id', empresaId);
  if (error) {
    if (tabelaInexistente(error)) return { unidades: null, disponivel: false };
    throw new Error(mensagemErroBanco(error, 'carregar as unidades de medida'));
  }
  const linha = (data ?? [])[0] as { unidades?: string[] } | undefined;
  const unidades = linha?.unidades ? normalizarUnidadesVisiveis(linha.unidades) : [];
  return { unidades: unidades.length > 0 ? unidades : null, disponivel: true };
}

/** Grava as unidades visíveis (normalizadas). Devolve a lista gravada. */
export async function salvarUnidadesVisiveis(db: ClienteDb, empresaId: string, unidades: string[]): Promise<string[]> {
  const lista = normalizarUnidadesVisiveis(unidades);
  if (lista.length === 0) throw new Error('Deixe pelo menos uma unidade ligada.');
  const { data, error } = await db.from('estoque_unidades_empresa')
    .upsert({ empresa_id: empresaId, unidades: lista, atualizado_em: new Date().toISOString() })
    .select('empresa_id');
  if (error) throw new Error(mensagemErroBanco(error, 'ajustar as unidades'));
  if (!data || data.length === 0) throw new Error('Você não tem permissão para ajustar as unidades. Fale com a dona ou a gestora.');
  return lista;
}
