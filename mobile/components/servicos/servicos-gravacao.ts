/**
 * Cargas do cadastro de serviço no app, com o erro de cada uma conferido, e o ativar/desativar.
 * As gravações (insumos por diferença, exclusão conferida pela 096) são as de
 * `shared/servicos-consultas.ts`, as mesmas do web.
 */
import { supabase } from '@/lib/supabase';
import { mensagemErroBanco } from '@shared/erros';
import { mapearInsumosCarregados, SELECT_INSUMOS_SERVICO, type InsumoItem } from '@shared/servicos-consultas';
import type { CategoriaCustom } from '@shared/categorias';

export type { InsumoItem };

export type ProdutoInsumo = { id: string; nome: string; unidade: string };

export type ServicoCarregado = {
  id: string; nome: string; descricao: string | null;
  categoria: string | null; categoria_id: string | null;
  preco: number; custo: number; duracao_minutos: number; ativo: boolean;
};

type Resultado<T> = { dados: T; erro: null } | { dados: null; erro: string };

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
    supabase.from('servico_produtos').select(SELECT_INSUMOS_SERVICO).eq('servico_id', id),
  ]);
  const errServ = rServ.error;
  if (errServ) return { dados: null, erro: mensagemErroBanco(errServ, 'carregar o serviço') };
  if (!rServ.data) return { dados: null, erro: 'Serviço não encontrado.' };
  const errInsumos = rIns.error;
  if (errInsumos) return { dados: null, erro: mensagemErroBanco(errInsumos, 'carregar os insumos do serviço') };
  const insumos = mapearInsumosCarregados((rIns.data ?? []) as unknown[]);
  return { dados: { servico: rServ.data as ServicoCarregado, insumos }, erro: null };
}

/** Ativa ou desativa o serviço, conferindo as linhas alteradas (RLS recusa em silêncio). */
export async function definirAtivoServico(id: string, ativo: boolean): Promise<string | null> {
  const { data: alterados, error } = await supabase.from('servicos').update({ ativo }).eq('id', id).select('id');
  if (error || !alterados || alterados.length === 0) {
    return mensagemErroBanco(error ?? { code: '42501' }, 'alterar o serviço');
  }
  return null;
}
