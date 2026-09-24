import { useQuery } from '@tanstack/react-query';
import { startOfDay, endOfDay, startOfMonth, endOfMonth, format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import type { Agendamento, Produto } from '@/types';

// ============================================================
// HOOK PRINCIPAL DO DASHBOARD
// ============================================================

export function useDashboard() {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  const hoje = new Date();
  const inicioHoje = startOfDay(hoje).toISOString();
  const fimHoje = endOfDay(hoje).toISOString();
  const inicioMes = startOfMonth(hoje).toISOString();
  const fimMes = endOfMonth(hoje).toISOString();

  // Agendamentos de hoje com joins
  const agendamentosHoje = useQuery({
    queryKey: ['agendamentos-hoje', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60, // 1 min
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agendamentos')
        .select(`
          *,
          cliente:users!agendamentos_cliente_id_fkey(id, nome, foto_url),
          profissional:users!agendamentos_profissional_id_fkey(id, nome),
          servico:servicos(id, nome, duracao_minutos)
        `)
        .eq('empresa_id', empresaId!)
        .gte('data_hora_inicio', inicioHoje)
        .lte('data_hora_inicio', fimHoje)
        .neq('status', 'cancelado')
        .order('data_hora_inicio', { ascending: true });

      if (error) throw error;
      return data as (Agendamento & {
        cliente: { id: string; nome: string; foto_url?: string };
        profissional: { id: string; nome: string };
        servico: { id: string; nome: string; duracao_minutos: number };
      })[];
    },
  });

  // Receita de hoje (agendamentos concluídos)
  const receitaHoje = useQuery({
    queryKey: ['receita-hoje', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pagamentos')
        .select('valor')
        .eq('empresa_id', empresaId!)
        .eq('status', 'pago')
        .gte('created_at', inicioHoje)
        .lte('created_at', fimHoje);

      if (error) throw error;
      return data.reduce((acc, p) => acc + Number(p.valor), 0);
    },
  });

  // Receita do mês
  const receitaMes = useQuery({
    queryKey: ['receita-mes', empresaId, format(hoje, 'yyyy-MM')],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pagamentos')
        .select('valor')
        .eq('empresa_id', empresaId!)
        .eq('status', 'pago')
        .gte('created_at', inicioMes)
        .lte('created_at', fimMes);

      if (error) throw error;
      return data.reduce((acc, p) => acc + Number(p.valor), 0);
    },
  });

  // Comissões pendentes
  const comissoesPendentes = useQuery({
    queryKey: ['comissoes-pendentes', empresaId, format(hoje, 'yyyy-MM')],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('comissoes')
        .select('valor_comissao')
        .eq('empresa_id', empresaId!)
        .eq('status', 'pendente')
        .gte('created_at', inicioMes)
        .lte('created_at', fimMes);

      if (error) throw error;
      return {
        quantidade: data.length,
        total: data.reduce((acc, c) => acc + Number(c.valor_comissao), 0),
      };
    },
  });

  // Produtos com estoque baixo
  const estoqueBaixo = useQuery({
    queryKey: ['estoque-baixo', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_produtos_estoque_baixo')
        .select('id, nome, estoque_atual, estoque_minimo')
        .eq('empresa_id', empresaId!)
        .eq('ativo', true);

      if (error) throw error;
      return data as Pick<Produto, 'id' | 'nome' | 'estoque_atual' | 'estoque_minimo'>[];
    },
  });

  // Comandas não fechadas — atendimentos já ocorridos (data_hora_fim passada),
  // sem comanda_id, que não foram cancelados/faltaram. Cobre tanto quem
  // esqueceu de fechar quanto o atalho "Marcar como concluído" desta tela,
  // que muda o status sem nunca gerar a comanda (fechamento fica pendente).
  const comandasNaoFechadas = useQuery({
    queryKey: ['comandas-nao-fechadas', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agendamentos')
        .select('id, data_hora_inicio')
        .eq('empresa_id', empresaId!)
        .is('comanda_id', null)
        .not('status', 'in', '("cancelado","faltou")')
        .lt('data_hora_fim', new Date().toISOString())
        .order('data_hora_inicio', { ascending: true })
        .limit(500);

      if (error) throw error;
      return data as { id: string; data_hora_inicio: string }[];
    },
  });

  const isLoading =
    agendamentosHoje.isLoading ||
    receitaHoje.isLoading ||
    receitaMes.isLoading;

  return {
    agendamentosHoje: agendamentosHoje.data ?? [],
    receitaHoje: receitaHoje.data ?? 0,
    receitaMes: receitaMes.data ?? 0,
    comissoesPendentes: comissoesPendentes.data ?? { quantidade: 0, total: 0 },
    estoqueBaixo: estoqueBaixo.data ?? [],
    comandasNaoFechadas: comandasNaoFechadas.data ?? [],
    isLoading,
    refetch: () => {
      agendamentosHoje.refetch();
      receitaHoje.refetch();
      receitaMes.refetch();
      comissoesPendentes.refetch();
      estoqueBaixo.refetch();
      comandasNaoFechadas.refetch();
    },
  };
}
