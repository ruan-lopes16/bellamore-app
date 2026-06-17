import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

// ── Tipos ────────────────────────────────────────────────────

export interface ComissaoItem {
  id: string;
  profissional_id: string;
  agendamento_id: string;
  valor_servico: number;
  percentual: number;
  valor_comissao: number;
  status: 'pendente' | 'pago';
  created_at: string;
  servico_nome: string;
  categoria: string;
}

export interface ProfissionalComissao {
  profissional_id: string;
  nome: string;
  foto_url?: string;
  percentual: number;
  comissoes: ComissaoItem[];
  totalAtendimentos: number;
  totalPendente: number;
  totalPago: number;
  total: number;
}

export interface ResumoComissoes {
  total: number;
  pendente: number;
  pago: number;
}

// ── Hook ─────────────────────────────────────────────────────

export function useComissoesGestor(mesRef: Date) {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  const qc = useQueryClient();

  const ini = startOfMonth(mesRef).toISOString();
  const fim = endOfMonth(mesRef).toISOString();
  const chave = format(mesRef, 'yyyy-MM');

  const query = useQuery<ProfissionalComissao[]>({
    queryKey: ['comissoes-gestor', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('comissoes')
        .select(`
          id, profissional_id, agendamento_id,
          valor_servico, percentual, valor_comissao, status, created_at,
          profissional:users(nome, foto_url),
          agendamento:agendamentos(servico:servicos(nome, categoria))
        `)
        .eq('empresa_id', empresaId!)
        .gte('created_at', ini)
        .lte('created_at', fim)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Agrupa por profissional
      const map: Record<string, ProfissionalComissao> = {};

      (data ?? []).forEach((c: any) => {
        const pid = c.profissional_id;
        if (!map[pid]) {
          map[pid] = {
            profissional_id: pid,
            nome: c.profissional?.nome ?? 'Profissional',
            foto_url: c.profissional?.foto_url,
            percentual: c.percentual,
            comissoes: [],
            totalAtendimentos: 0,
            totalPendente: 0,
            totalPago: 0,
            total: 0,
          };
        }
        const item: ComissaoItem = {
          id: c.id,
          profissional_id: pid,
          agendamento_id: c.agendamento_id,
          valor_servico: Number(c.valor_servico),
          percentual: Number(c.percentual),
          valor_comissao: Number(c.valor_comissao),
          status: c.status,
          created_at: c.created_at,
          servico_nome: c.agendamento?.servico?.nome ?? 'Serviço',
          categoria: c.agendamento?.servico?.categoria ?? 'outros',
        };
        map[pid].comissoes.push(item);
        map[pid].totalAtendimentos += 1;
        map[pid].total += item.valor_comissao;
        if (item.status === 'pendente') map[pid].totalPendente += item.valor_comissao;
        else map[pid].totalPago += item.valor_comissao;
      });

      return Object.values(map).sort((a, b) => b.total - a.total);
    },
  });

  // Marcar todas as comissões de um profissional como pagas
  const marcarPago = useMutation({
    mutationFn: async (profissionalId: string) => {
      return supabase
        .from('comissoes')
        .update({ status: 'pago' })
        .eq('empresa_id', empresaId!)
        .eq('profissional_id', profissionalId)
        .eq('status', 'pendente')
        .gte('created_at', ini)
        .lte('created_at', fim);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['comissoes-gestor', empresaId, chave] }),
  });

  const lista = query.data ?? [];
  const resumo: ResumoComissoes = lista.reduce(
    (acc, p) => ({
      total:    acc.total    + p.total,
      pendente: acc.pendente + p.totalPendente,
      pago:     acc.pago     + p.totalPago,
    }),
    { total: 0, pendente: 0, pago: 0 }
  );

  return {
    profissionais: lista,
    resumo,
    isLoading: query.isLoading,
    refetch: query.refetch,
    marcarPago: (profissionalId: string) => marcarPago.mutate(profissionalId),
  };
}
