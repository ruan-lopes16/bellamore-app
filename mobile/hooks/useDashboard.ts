/**
 * @file useDashboard.ts
 * Dados do Dashboard do app. Receita do mês e de hoje pelas funções únicas de
 * @shared/kpis-financeiros (mesmo número do Dashboard e do Financeiro web, com
 * fechamento importado). Comissões pendentes: TODAS, de qualquer mês.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import type { Agendamento, Produto } from '@/types';
import { hojeBRT, limitesDias, limitesMes, somarMeses, uniaoLimites } from '@shared/periodos';
import {
  calcularKpisFinanceiros, variacaoPercentual, resumoComissoesPendentes, DADOS_VAZIOS,
} from '@shared/kpis-financeiros';
import { carregarDadosFinanceiros, carregarComissoesPendentes } from '@shared/kpis-financeiros-consultas';

export function useDashboard() {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  const hoje     = hojeBRT();
  const chaveMes = hoje.slice(0, 7);
  const limHoje  = limitesDias(hoje, hoje);
  const limMes   = limitesMes(chaveMes);
  const limAnt   = limitesMes(somarMeses(chaveMes, -1));

  // Agendamentos de hoje com joins
  const agendamentosHoje = useQuery({
    queryKey: ['agendamentos-hoje', empresaId, hoje],
    enabled: !!empresaId,
    staleTime: 1000 * 60, // 1 min
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agendamentos')
        .select(`
          *,
          cliente:clientes!agendamentos_cliente_id_fkey(id, nome),
          profissional:users!agendamentos_profissional_id_fkey(id, nome),
          servico:servicos(id, nome, duracao_minutos)
        `)
        .eq('empresa_id', empresaId!)
        .gte('data_hora_inicio', limHoje.startIso)
        .lte('data_hora_inicio', limHoje.endIso)
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

  // Mês atual + anterior (delta) numa busca só; hoje está dentro do mês atual.
  const financeiro = useQuery({
    queryKey: ['dash-financeiro', empresaId, chaveMes],
    enabled: !!empresaId,
    staleTime: 1000 * 60,
    queryFn: () => carregarDadosFinanceiros(supabase, empresaId!, uniaoLimites(limAnt, limMes)),
  });

  // Comissões pendentes — TODAS, de qualquer mês (mesma regra do alerta do web)
  const comissoesPendentes = useQuery({
    queryKey: ['comissoes-pendentes', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => resumoComissoesPendentes(await carregarComissoesPendentes(supabase, empresaId!)),
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
  // sem comanda_id, que não foram cancelados/faltaram.
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

  const dados    = financeiro.data ?? DADOS_VAZIOS;
  const kpisMes  = calcularKpisFinanceiros(dados, limMes);
  const kpisAnt  = calcularKpisFinanceiros(dados, limAnt);
  const kpisHoje = calcularKpisFinanceiros(dados, limHoje);

  return {
    agendamentosHoje: agendamentosHoje.data ?? [],
    receitaHoje: kpisHoje.bruto,
    receitaMes: kpisMes.bruto,
    variacaoReceitaMes: financeiro.data ? variacaoPercentual(kpisMes.bruto, kpisAnt.bruto) : null,
    comissoesPendentes: comissoesPendentes.data ?? { quantidade: 0, total: 0 },
    estoqueBaixo: estoqueBaixo.data ?? [],
    comandasNaoFechadas: comandasNaoFechadas.data ?? [],
    // Só vale número quando a consulta deu certo: carregando ou com erro a tela mostra '—', nunca R$ 0,00.
    financeiroPronto: financeiro.isSuccess,
    comissoesPendentesPronto: comissoesPendentes.isSuccess,
    isLoading: agendamentosHoje.isLoading || financeiro.isLoading,
    // Falha em qualquer consulta: a tela mostra aviso em vez de zeros enganosos.
    isError: agendamentosHoje.isError || financeiro.isError || comissoesPendentes.isError
      || estoqueBaixo.isError || comandasNaoFechadas.isError,
    erro: (agendamentosHoje.error ?? financeiro.error ?? comissoesPendentes.error
      ?? estoqueBaixo.error ?? comandasNaoFechadas.error) as Error | null,
    refetch: () => {
      agendamentosHoje.refetch();
      financeiro.refetch();
      comissoesPendentes.refetch();
      estoqueBaixo.refetch();
      comandasNaoFechadas.refetch();
    },
  };
}
