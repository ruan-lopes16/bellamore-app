import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { CATEGORIA_CONFIG } from '@/hooks/useAgenda';
import type { Servico } from '@/types';

// ── Serviços ativos da empresa ───────────────────────────────

export interface ServicoCliente extends Servico {
  categoriaCor: string;
}

export function useServicosEmpresa() {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  return useQuery({
    queryKey: ['servicos-empresa', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('servicos')
        .select('*')
        .eq('empresa_id', empresaId!)
        .eq('ativo', true)
        .order('categoria')
        .order('nome');

      if (error) throw error;

      return (data ?? []).map((s) => ({
        ...s,
        categoriaCor: CATEGORIA_CONFIG[s.categoria as keyof typeof CATEGORIA_CONFIG]?.border ?? '#9B6FE8',
      })) as ServicoCliente[];
    },
  });
}
