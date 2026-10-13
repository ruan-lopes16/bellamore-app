import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { statusEstoque, resumoProdutos, type StatusEstoque } from '@shared/estoque';
import {
  carregarProdutosEstoque, carregarMovimentosMes, carregarUnidadesVisiveis,
  movimentarEstoque, salvarUnidadesVisiveis, type ProdutoEstoque,
} from '@shared/estoque-consultas';

// ── Tipos ────────────────────────────────────────────────────

export type MovimentoTipo = 'entrada' | 'saida' | 'ajuste';

export type Produto = ProdutoEstoque & { status: StatusEstoque };

// ── Hooks ────────────────────────────────────────────────────

/**
 * Estoque da empresa ativa: produtos com status, resumo, unidades visíveis e as ações de
 * movimentar e ajustar unidades. Toda consulta lança erro (nada de lista vazia silenciosa).
 */
export function useEstoque() {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  const qc = useQueryClient();

  const query = useQuery<ProdutoEstoque[]>({
    queryKey: ['estoque', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 2,
    queryFn: () => carregarProdutosEstoque(supabase, empresaId!),
  });

  const unidadesQuery = useQuery({
    queryKey: ['estoque-unidades', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: () => carregarUnidadesVisiveis(supabase, empresaId!),
  });

  const produtos: Produto[] = (query.data ?? []).map((p) => ({
    ...p, status: statusEstoque(p.estoque_atual, p.estoque_minimo),
  }));
  const criticos = produtos.filter((p) => p.status === 'critico');
  const baixos   = produtos.filter((p) => p.status === 'baixo');
  const normais  = produtos.filter((p) => p.status === 'ok');

  /** Entrada/saída manual. Lança `Error` com mensagem em português. */
  async function movimentar(
    produto: ProdutoEstoque, tipo: 'entrada' | 'saida', quantidade: number, motivo: string,
  ): Promise<{ novoSaldo: number }> {
    const r = await movimentarEstoque(supabase, { empresaId: empresaId!, produto, tipo, quantidade, motivo });
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['estoque', empresaId] }),
      qc.invalidateQueries({ queryKey: ['estoque-movimentos', empresaId] }),
    ]);
    return r;
  }

  /** Grava as unidades visíveis da empresa. */
  async function salvarUnidades(lista: string[]): Promise<string[]> {
    const r = await salvarUnidadesVisiveis(supabase, empresaId!, lista);
    await qc.invalidateQueries({ queryKey: ['estoque-unidades', empresaId] });
    return r;
  }

  return {
    produtos,
    criticos,
    baixos,
    normais,
    totalProdutos: produtos.length,
    totalCriticos: criticos.length,
    totalAtencao:  baixos.length,
    resumo: resumoProdutos(produtos),
    isLoading: query.isLoading,
    isError: query.isError,
    erro: query.error ? (query.error instanceof Error ? query.error.message : 'Não foi possível carregar o estoque.') : null,
    refetch: query.refetch,
    unidadesVisiveis: unidadesQuery.data?.unidades ?? null,
    unidadesDisponivel: unidadesQuery.data?.disponivel ?? false,
    erroUnidades: unidadesQuery.error ? (unidadesQuery.error instanceof Error ? unidadesQuery.error.message : 'Não foi possível carregar as unidades.') : null,
    movimentar,
    salvarUnidades,
  };
}

/** Movimentações do mês (`mesChave` = 'AAAA-MM'); só consulta quando `ativo`. */
export function useMovimentosMes(mesChave: string, ativo: boolean) {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  return useQuery({
    queryKey: ['estoque-movimentos', empresaId, mesChave],
    enabled: !!empresaId && ativo,
    queryFn: () => carregarMovimentosMes(supabase, empresaId!, mesChave),
    placeholderData: keepPreviousData,
  });
}
