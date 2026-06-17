import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import type { Pacote, Servico } from '@/types';

export type PacoteServico = {
  quantidade: number;
  servico: Servico;
};

export type PacoteComServicos = Omit<Pacote, 'servicos'> & {
  pacote_servicos: PacoteServico[];
};

export function usePacotes() {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  return useQuery({
    queryKey: ['pacotes', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pacotes')
        .select(`
          *,
          pacote_servicos (
            quantidade,
            servico:servicos (*)
          )
        `)
        .eq('empresa_id', empresaId!)
        .order('nome');
      if (error) throw error;
      return (data ?? []) as PacoteComServicos[];
    },
  });
}
