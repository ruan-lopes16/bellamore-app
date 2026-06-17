import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

// ── Tipos ────────────────────────────────────────────────────

export type MovimentoTipo = 'entrada' | 'saida' | 'ajuste';

export interface Produto {
  id: string;
  nome: string;
  categoria: string;
  unidade: string;
  preco_custo: number;
  estoque_atual: number;
  estoque_minimo: number;
  ativo: boolean;
  status: 'critico' | 'baixo' | 'ok';
}

// ── Hook ─────────────────────────────────────────────────────

export function useEstoque() {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  const qc = useQueryClient();

  const query = useQuery<Produto[]>({
    queryKey: ['estoque', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('produtos')
        .select('*')
        .eq('empresa_id', empresaId!)
        .eq('ativo', true)
        .order('estoque_atual', { ascending: true });

      if (error) throw error;

      return (data ?? []).map((p) => {
        const atual = Number(p.estoque_atual);
        const min   = Number(p.estoque_minimo);
        let status: Produto['status'] = 'ok';
        if (atual <= 0)          status = 'critico';
        else if (atual < min)    status = 'baixo';
        return { ...p, estoque_atual: atual, estoque_minimo: min, status };
      });
    },
  });

  // Registrar entrada/saída
  const registrarMovimento = useMutation({
    mutationFn: async ({
      produtoId, tipo, quantidade, motivo,
    }: {
      produtoId: string;
      tipo: MovimentoTipo;
      quantidade: number;
      motivo?: string;
    }) => {
      return supabase.from('estoque_movimentos').insert({
        produto_id:  produtoId,
        empresa_id:  empresaId!,
        tipo,
        quantidade,
        motivo: motivo ?? null,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['estoque', empresaId] }),
  });

  const produtos   = query.data ?? [];
  const criticos   = produtos.filter((p) => p.status === 'critico');
  const baixos     = produtos.filter((p) => p.status === 'baixo');
  const normais    = produtos.filter((p) => p.status === 'ok');

  return {
    produtos,
    criticos,
    baixos,
    normais,
    totalProdutos: produtos.length,
    totalCriticos: criticos.length,
    totalAtencao:  baixos.length,
    isLoading: query.isLoading,
    refetch: query.refetch,
    registrarMovimento: (
      produtoId: string, tipo: MovimentoTipo, quantidade: number, motivo?: string
    ) => registrarMovimento.mutateAsync({ produtoId, tipo, quantidade, motivo }),
  };
}
