/**
 * @file useComissoesGestor.ts
 * Comissões da equipe no app — mesma fonte, períodos e regras do web
 * (ComissoesGestorView): @shared/comissoes + @shared/comissoes-consultas.
 * "Pagar" = só as pendentes do período exibido.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { invalidarFinanceiro } from '@/lib/invalidarFinanceiro';
import { hojeBRT, limitesPeriodoComissao, type PeriodoComissao } from '@shared/periodos';
import {
  normalizarComissoes, comissoesPorProfissional, resumoComissoes, MENSAGEM_PAGAMENTO_PARCIAL,
  type ComissoesDaProfissional,
} from '@shared/comissoes';
import { carregarComissoesDoPeriodo, pagarComissoes } from '@shared/comissoes-consultas';
import type { CategoriaCustom } from '@shared/categorias';

export function useComissoesGestor(periodo: PeriodoComissao, deslocamento: number, habilitado = true) {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  const qc = useQueryClient();
  const limites = limitesPeriodoComissao(periodo, hojeBRT(), deslocamento);

  const query = useQuery({
    queryKey: ['comissoes-gestor', empresaId, limites.startIso, limites.endIso],
    enabled: !!empresaId && habilitado,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => normalizarComissoes(await carregarComissoesDoPeriodo(supabase, empresaId!, limites)),
  });

  const categorias = useQuery({
    queryKey: ['categorias-servico', empresaId],
    enabled: !!empresaId && habilitado,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const { data, error } = await supabase.from('categorias_servico').select('*').eq('empresa_id', empresaId!).order('nome');
      if (error) throw error;
      return (data ?? []) as CategoriaCustom[];
    },
  });

  const pagar = useMutation({
    mutationFn: async (ids: string[]) => {
      const r = await pagarComissoes(supabase, empresaId!, ids);
      if (r.naoConfirmados.length > 0) throw new Error(r.erro ?? MENSAGEM_PAGAMENTO_PARCIAL);
      return r.confirmados.length;
    },
    onSettled: () => invalidarFinanceiro(qc),   // lucro, pendentes e badge mudam em todas as telas
  });

  const itens = query.data ?? [];
  return {
    limites,
    itens,
    profissionais: comissoesPorProfissional(itens),
    resumo: resumoComissoes(itens),
    categorias: categorias.data ?? [],
    pronto: query.isSuccess,
    isLoading: query.isLoading,
    isFetching: query.isFetching || categorias.isFetching,
    isError: query.isError || categorias.isError,
    erro: (query.error ?? categorias.error) as Error | null,
    refetch: () => Promise.all([query.refetch(), categorias.refetch()]),
    pagar: (p: ComissoesDaProfissional) => pagar.mutateAsync(p.idsPendentes),
  };
}
