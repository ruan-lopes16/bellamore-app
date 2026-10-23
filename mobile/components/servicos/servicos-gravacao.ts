/**
 * Cargas e gravações do cadastro de serviço no app — as mesmas do web
 * (web/app/(app)/servicos/page.tsx): insumos em `servico_produtos` (apaga e reinsere) e exclusão
 * pela função `excluir_servico` (096), com o caminho antigo conferido quando a 096 ainda não existe.
 * Todas devolvem a mensagem de erro pronta para a tela (nunca engolem o erro).
 */
import { supabase } from '@/lib/supabase';
import { mensagemErroBanco } from '@shared/erros';
import { excluirServico, SemMigration096, ErroPacote } from '@shared/pacotes-venda';
import type { CategoriaCustom } from '@shared/categorias';

/** Mensagem exata da função `excluir_servico` quando o serviço já foi usado. */
export const MSG_SERVICO_USADO = 'Este serviço já foi usado. Desative em vez de excluir.';

export type ProdutoInsumo = { id: string; nome: string; unidade: string };

/** Insumo no editor. `quantidade` é texto (input controlado), igual ao web. */
export type InsumoItem = { produto_id: string; nome: string; unidade: string; quantidade: string };

export type ServicoCarregado = {
  id: string; nome: string; descricao: string | null;
  categoria: string | null; categoria_id: string | null;
  preco: number; custo: number; duracao_minutos: number; ativo: boolean;
};

type Resultado<T> = { dados: T; erro: null } | { dados: null; erro: string };

/** Quantidade digitada ('1,5' ou '1.5') → número; inválida → NaN. */
export function quantidadeInsumo(txt: string): number {
  return parseFloat(txt.replace(',', '.'));
}

/** Categorias personalizadas da empresa. */
export async function carregarCategorias(empresaId: string): Promise<Resultado<CategoriaCustom[]>> {
  const { data, error: errCat } = await supabase.from('categorias_servico').select('*')
    .eq('empresa_id', empresaId).order('nome');
  if (errCat) return { dados: null, erro: mensagemErroBanco(errCat, 'carregar as categorias') };
  return { dados: (data ?? []) as CategoriaCustom[], erro: null };
}

/** Produtos ativos da empresa, para o seletor de insumos. */
export async function carregarProdutosInsumo(empresaId: string): Promise<Resultado<ProdutoInsumo[]>> {
  const { data, error: errProd } = await supabase.from('produtos').select('id, nome, unidade')
    .eq('empresa_id', empresaId).eq('ativo', true).order('nome');
  if (errProd) return { dados: null, erro: mensagemErroBanco(errProd, 'carregar os produtos') };
  return { dados: (data ?? []) as ProdutoInsumo[], erro: null };
}

/** Serviço a editar, já com os insumos vinculados. */
export async function carregarServicoComInsumos(
  empresaId: string, id: string,
): Promise<Resultado<{ servico: ServicoCarregado; insumos: InsumoItem[] }>> {
  const [rServ, rIns] = await Promise.all([
    supabase.from('servicos').select('*').eq('id', id).eq('empresa_id', empresaId).maybeSingle(),
    supabase.from('servico_produtos')
      .select('produto_id, quantidade, produto:produtos(nome, unidade)')
      .eq('servico_id', id),
  ]);
  const errServ = rServ.error;
  if (errServ) return { dados: null, erro: mensagemErroBanco(errServ, 'carregar o serviço') };
  if (!rServ.data) return { dados: null, erro: 'Serviço não encontrado.' };
  const errInsumos = rIns.error;
  if (errInsumos) return { dados: null, erro: mensagemErroBanco(errInsumos, 'carregar os insumos do serviço') };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insumos = ((rIns.data ?? []) as any[]).map((r) => {
    const produto = Array.isArray(r.produto) ? r.produto[0] : r.produto;
    return {
      produto_id: r.produto_id as string,
      nome: (produto?.nome ?? 'Produto') as string,
      unidade: (produto?.unidade ?? '') as string,
      quantidade: String(r.quantidade),
    };
  });
  return { dados: { servico: rServ.data as ServicoCarregado, insumos }, erro: null };
}

/**
 * Apaga os insumos existentes e reinsere os de quantidade > 0 (mesma gravação do web).
 * Devolve a mensagem de erro ou null.
 */
export async function sincronizarInsumos(servicoId: string, insumos: InsumoItem[]): Promise<string | null> {
  const { error: errDel } = await supabase.from('servico_produtos').delete().eq('servico_id', servicoId);
  if (errDel) return mensagemErroBanco(errDel, 'salvar os insumos do serviço');
  const validos = insumos.filter((i) => quantidadeInsumo(i.quantidade) > 0);
  if (validos.length === 0) return null;
  const { error: errIns } = await supabase.from('servico_produtos').insert(
    validos.map((i) => ({
      servico_id: servicoId,
      produto_id: i.produto_id,
      quantidade: quantidadeInsumo(i.quantidade) || 1,
    })),
  );
  return errIns ? mensagemErroBanco(errIns, 'salvar os insumos do serviço') : null;
}

/** Ativa ou desativa o serviço, conferindo as linhas alteradas (RLS recusa em silêncio). */
export async function definirAtivoServico(id: string, ativo: boolean): Promise<string | null> {
  const { data: alterados, error } = await supabase.from('servicos').update({ ativo }).eq('id', id).select('id');
  if (error || !alterados || alterados.length === 0) {
    return mensagemErroBanco(error ?? { code: '42501' }, 'alterar o serviço');
  }
  return null;
}

/**
 * Sem a 096: a mesma checagem de uso que `excluir_servico` faz (atendimento, agendamento_servicos,
 * item de comanda, pacote e pacote_uso). Devolve a mensagem de recusa/erro ou null (livre para excluir).
 */
async function conferirUsoServico(id: string): Promise<string | null> {
  const consultas = await Promise.all([
    supabase.from('agendamentos').select('servico_id', { count: 'exact', head: true }).eq('servico_id', id),
    supabase.from('agendamento_servicos').select('servico_id', { count: 'exact', head: true }).eq('servico_id', id),
    supabase.from('comanda_itens').select('servico_id', { count: 'exact', head: true }).eq('servico_id', id),
    supabase.from('pacote_servicos').select('servico_id', { count: 'exact', head: true }).eq('servico_id', id),
    supabase.from('pacote_uso').select('servico_id', { count: 'exact', head: true }).eq('servico_id', id),
  ]);
  for (const r of consultas) {
    if (r.error) return mensagemErroBanco(r.error, 'conferir o uso do serviço');
  }
  return consultas.some((r) => (r.count ?? 0) > 0) ? MSG_SERVICO_USADO : null;
}

/**
 * Exclui o serviço: pela função `excluir_servico` (096); sem ela, confere o uso no app e apaga direto,
 * conferindo as linhas apagadas. Devolve a mensagem de erro (ex.: MSG_SERVICO_USADO) ou null.
 */
export async function excluirServicoConferido(empresaId: string, id: string): Promise<string | null> {
  try {
    await excluirServico(supabase, empresaId, id);
    return null;
  } catch (e) {
    if (e instanceof ErroPacote) return e.message;
    if (!(e instanceof SemMigration096)) return 'Não foi possível excluir o serviço.';
  }
  const uso = await conferirUsoServico(id);
  if (uso) return uso;
  const { data: apagados, error } = await supabase.from('servicos').delete()
    .eq('id', id).eq('empresa_id', empresaId)
    .select('id');
  if (error) return mensagemErroBanco(error, 'excluir o serviço');
  if (!apagados || apagados.length === 0) return 'Você não tem permissão para excluir serviços.';
  return null;
}
