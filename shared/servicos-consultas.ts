/**
 * Gravações do cadastro de serviço, iguais no web e no app (uma cópia só):
 * - `excluirServicoConferido`: pela função `excluir_servico` (096); sem ela, a mesma checagem de uso
 *   feita no cliente antes do delete, com as linhas apagadas conferidas;
 * - insumos (`servico_produtos`) por diferença: upsert pela chave única (servico_id, produto_id) e só
 *   depois o delete do que saiu — uma falha nunca apaga a receita inteira.
 * Todas devolvem/lançam a mensagem pronta para a tela.
 */
import { mensagemErroBanco } from './erros';
import { excluirServico, SemMigration096, ErroPacote, type ClienteDbRpc } from './pacotes-venda';

/** Mensagem exata da função `excluir_servico` quando o serviço já foi usado. */
export const MSG_SERVICO_USADO = 'Este serviço já foi usado. Desative em vez de excluir.';

/** Cliente mínimo: `rpc` + `from` (supabase-js serve). Estrutural: shared não depende do @supabase/*. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClienteDbServicos = ClienteDbRpc & { from(tabela: string): any };

/** Tabelas que referenciam o serviço — a mesma lista que `excluir_servico` (096) confere. */
export const TABELAS_USO_SERVICO = ['agendamentos', 'agendamento_servicos', 'comanda_itens', 'pacote_servicos', 'pacote_uso'] as const;

/**
 * Exclui o serviço. Lança `Error` com a mensagem pronta para a tela: `MSG_SERVICO_USADO`, recusa de
 * permissão ou falha. Sem a 096, nada é apagado se qualquer conferência de uso falhar.
 */
export async function excluirServicoConferido(db: ClienteDbServicos, empresaId: string, servicoId: string): Promise<void> {
  try {
    await excluirServico(db, empresaId, servicoId);
    return;
  } catch (e) {
    if (!(e instanceof SemMigration096)) {
      if (e instanceof ErroPacote) throw e;
      throw new Error(mensagemErroBanco(e as { code?: string; message?: string }, 'excluir o serviço'));
    }
  }
  const usos = await Promise.all(TABELAS_USO_SERVICO.map(t =>
    db.from(t).select('servico_id', { count: 'exact', head: true }).eq('servico_id', servicoId)));
  for (const r of usos) {
    if (r.error) throw new Error(mensagemErroBanco(r.error, 'conferir o uso do serviço'));
  }
  if (usos.some(r => (r.count ?? 0) > 0)) throw new Error(MSG_SERVICO_USADO);
  const { data, error } = await db.from('servicos').delete().eq('id', servicoId).eq('empresa_id', empresaId).select('id');
  if (error) throw new Error(mensagemErroBanco(error, 'excluir o serviço'));
  if (!data || data.length === 0) throw new Error('Você não tem permissão para excluir serviços.');
}

/** Insumo no editor. `quantidade` é texto (input controlado). */
export type InsumoItem = { produto_id: string; nome: string; unidade: string; quantidade: string };

/** Quantidade digitada ('1,5' ou '1.5') → número; inválida → NaN. */
export function quantidadeInsumo(txt: string): number {
  return parseFloat(txt.replace(',', '.'));
}

/**
 * Diferença entre a receita gravada (`originais`, ids de produto) e a do editor.
 * Insumo com quantidade ≤ 0 ou inválida conta como removido (igual ao comportamento anterior).
 */
export function diffInsumos(originais: string[], insumos: InsumoItem[]): {
  gravar: { produto_id: string; quantidade: number }[];
  remover: string[];
} {
  const gravar = insumos
    .map(i => ({ produto_id: i.produto_id, quantidade: quantidadeInsumo(i.quantidade) }))
    .filter(i => Number.isFinite(i.quantidade) && i.quantidade > 0);
  const ficam = new Set(gravar.map(g => g.produto_id));
  const remover = [...new Set(originais)].filter(id => !ficam.has(id));
  return { gravar, remover };
}

/**
 * Grava os insumos por diferença: upsert dos que ficam (chave única servico_id + produto_id) e só
 * depois remove os que saíram. Se o upsert falha, a receita antiga fica intacta.
 * Devolve a mensagem de erro ou null.
 */
export async function sincronizarInsumos(
  db: ClienteDbServicos, servicoId: string, originais: string[], insumos: InsumoItem[],
): Promise<string | null> {
  const { gravar, remover } = diffInsumos(originais, insumos);
  if (gravar.length > 0) {
    const { data, error } = await db.from('servico_produtos')
      .upsert(gravar.map(g => ({ servico_id: servicoId, ...g })), { onConflict: 'servico_id,produto_id' })
      .select('produto_id');
    if (error) return mensagemErroBanco(error, 'salvar os insumos do serviço');
    if (!data || data.length < gravar.length) {
      return mensagemErroBanco({ code: '42501' }, 'salvar os insumos do serviço');
    }
  }
  if (remover.length > 0) {
    // Apagar menos linhas que o pedido é legítimo (já removidas); o erro é conferido.
    const { error } = await db.from('servico_produtos').delete()
      .eq('servico_id', servicoId).in('produto_id', remover).select('produto_id');
    if (error) return mensagemErroBanco(error, 'salvar os insumos do serviço');
  }
  return null;
}

/** Linhas de `servico_produtos` com o embed `produto:produtos(nome, unidade)` → itens do editor. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapearInsumosCarregados(linhas: any[]): InsumoItem[] {
  return linhas.map(r => {
    const produto = Array.isArray(r.produto) ? r.produto[0] : r.produto;
    return {
      produto_id: r.produto_id as string,
      nome: (produto?.nome ?? 'Produto') as string,
      unidade: (produto?.unidade ?? '') as string,
      quantidade: String(r.quantidade),
    };
  });
}

/** Colunas lidas para o editor de insumos. */
export const SELECT_INSUMOS_SERVICO = 'produto_id, quantidade, produto:produtos(nome, unidade)';
