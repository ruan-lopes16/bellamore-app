import { useQuery } from '@tanstack/react-query';
import { isPast, parseISO } from 'date-fns';
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

// ── Pacotes vendidos (instâncias por cliente) ────────────────

export type PacoteVendidoServico = {
  servico_id: string;
  nome: string;
  /** null = sessões ilimitadas para este serviço */
  quantidade: number | null;
};

export type PacoteVendido = {
  id: string;
  pacote: {
    id: string;
    nome: string;
    preco: number;
    validade_dias: number | null;
    controla_sessoes: boolean;
    servicos: PacoteVendidoServico[];
  };
  cliente: { id: string; nome: string };
  data_inicio: string;
  data_validade: string | null;
  valor_pago: number | null;
  status: string;
  observacao: string | null;
  /** Σ das quantidades; null = ilimitado ou combo (não rastreia sessões) */
  total_sessoes: number | null;
  /** COUNT(pacote_uso) desta venda */
  usadas: number;
};

/**
 * Pacotes já vendidos a clientes, com progresso de sessões calculado.
 * Espelha a aba "Vendidos" do módulo de pacotes na web.
 */
export function usePacotesVendidos() {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  return useQuery({
    queryKey: ['pacotes-vendidos', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pacote_clientes')
        .select(`
          id, data_inicio, data_validade, valor_pago, status, observacao,
          pacote:pacotes(id, nome, preco, validade_dias, controla_sessoes,
            servicos:pacote_servicos(servico_id, quantidade, servico:servicos(nome))),
          cliente:clientes(id, nome),
          uso:pacote_uso(id)
        `)
        .eq('empresa_id', empresaId!)
        .order('created_at', { ascending: false });
      if (error) throw error;

      return ((data ?? []) as any[]).map((v) => {
        const controla = v.pacote?.controla_sessoes ?? true;
        const servicos: PacoteVendidoServico[] = (v.pacote?.servicos ?? []).map((s: any) => ({
          servico_id: s.servico_id,
          nome: s.servico?.nome ?? 'Serviço',
          quantidade: s.quantidade,
        }));
        const temIlimitado = servicos.some((s) => s.quantidade == null);
        const totalSessoes = !controla || temIlimitado
          ? null
          : servicos.reduce((acc: number, s) => acc + (s.quantidade ?? 0), 0);
        const usadas = (v.uso ?? []).length;

        // Auto-status: combo não conclui por sessão — só por vencimento ou ação manual
        let status = v.status;
        if (status === 'ativo') {
          if (controla && totalSessoes !== null && totalSessoes > 0 && usadas >= totalSessoes) status = 'concluido';
          else if (v.data_validade && isPast(parseISO(v.data_validade))) status = 'expirado';
        }

        return {
          id: v.id,
          pacote: {
            id: v.pacote?.id,
            nome: v.pacote?.nome ?? '—',
            preco: v.pacote?.preco ?? 0,
            validade_dias: v.pacote?.validade_dias ?? null,
            controla_sessoes: controla,
            servicos,
          },
          cliente: { id: v.cliente?.id, nome: v.cliente?.nome ?? '—' },
          data_inicio: v.data_inicio,
          data_validade: v.data_validade,
          valor_pago: v.valor_pago,
          status,
          observacao: v.observacao,
          total_sessoes: totalSessoes,
          usadas,
        } as PacoteVendido;
      });
    },
  });
}
