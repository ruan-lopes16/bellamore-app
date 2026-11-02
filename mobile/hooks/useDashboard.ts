/**
 * @file useDashboard.ts
 * Dashboard do app — mesmas regras e fontes do Dashboard web (@shared/dashboard,
 * @shared/kpis-financeiros, @shared/dashboard-consultas). Mês navegável (nunca o
 * futuro); "hoje" sempre em Brasília; "Agenda hoje" não conta cancelados.
 */
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import type { Agendamento, Produto } from '@/types';
import { hojeBRT, limitesDias, limitesMes, uniaoLimites } from '@shared/periodos';
import {
  calcularKpisFinanceiros, variacaoPercentual, resumoComissoesPendentes, receitaAcumuladaPorDia,
  retiradasDoPeriodo, DADOS_VAZIOS,
} from '@shared/kpis-financeiros';
import { carregarDadosFinanceiros, carregarComissoesPendentes, carregarRetiradas } from '@shared/kpis-financeiros-consultas';
import { somaDevolucoesPorRetirada, saldoDevedorTotal } from '@shared/retiradas-socia';
import {
  navegacaoMesDashboard, clientesParaReconquistar, aniversariantesProximos, resumoComandasNaoFechadas, progressoMetaEmpresa,
} from '@shared/dashboard';
import {
  carregarComandasNaoFechadas, carregarDespesasVencendo, carregarUltimasVisitas, carregarAniversariantes,
} from '@shared/dashboard-consultas';

/** Permissões vêm da tela (mesma regra do web): sem elas as consultas nem rodam. */
export function useDashboard(
  mesSolicitado: string | null = null,
  { podeVerFinanceiro = false, podeFecharComanda = false }: { podeVerFinanceiro?: boolean; podeFecharComanda?: boolean } = {},
) {
  const { empresaAtiva, isOwner } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  const hoje    = hojeBRT();
  const nav     = navegacaoMesDashboard(mesSolicitado, hoje);
  const limHoje = limitesDias(hoje, hoje);
  const limMes  = limitesMes(nav.chave);
  const limAnt  = limitesMes(nav.anterior);

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

  // Mês exibido + anterior (delta) numa busca só.
  const financeiro = useQuery({
    queryKey: ['dash-financeiro', empresaId, nav.chave],
    enabled: !!empresaId && podeVerFinanceiro,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60,
    queryFn: () => carregarDadosFinanceiros(supabase, empresaId!, uniaoLimites(limAnt, limMes)),
  });
  // "Receita hoje" quando o mês exibido não é o atual (mesma regra do web).
  const financeiroHoje = useQuery({
    queryKey: ['dash-financeiro', empresaId, 'hoje', hoje],
    enabled: !!empresaId && podeVerFinanceiro && !nav.isMesAtual,
    staleTime: 1000 * 60,
    queryFn: () => carregarDadosFinanceiros(supabase, empresaId!, limHoje),
  });

  // Comissões pendentes — TODAS, de qualquer mês (mesma regra do alerta do web)
  const comissoesPendentes = useResumoComissoesPendentes(podeVerFinanceiro);

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

  const comandasNaoFechadas = useQuery({
    queryKey: ['comandas-nao-fechadas', empresaId],
    enabled: !!empresaId && podeFecharComanda,
    staleTime: 1000 * 60,
    queryFn: async () => resumoComandasNaoFechadas(await carregarComandasNaoFechadas(supabase, empresaId!, new Date().toISOString())),
  });
  const despesasVencendo = useQuery({
    queryKey: ['despesas-vencendo', empresaId, hoje],
    enabled: !!empresaId && podeVerFinanceiro,
    staleTime: 1000 * 60 * 5,
    queryFn: () => carregarDespesasVencendo(supabase, empresaId!, hoje),
  });
  const reconquista = useQuery({
    queryKey: ['dash-reconquista', empresaId, hoje],
    enabled: !!empresaId && podeVerFinanceiro,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => clientesParaReconquistar(await carregarUltimasVisitas(supabase, empresaId!), hoje),
  });
  const aniversariantes = useQuery({
    queryKey: ['dash-aniversariantes', empresaId, hoje],
    enabled: !!empresaId && podeVerFinanceiro,
    staleTime: 1000 * 60 * 30,
    queryFn: async () => aniversariantesProximos(await carregarAniversariantes(supabase, empresaId!), hoje),
  });
  // Meta lida do banco (o web lê a empresa a cada carga; o store do app pode estar velho).
  const meta = useQuery({
    queryKey: ['dash-meta', empresaId],
    enabled: !!empresaId && podeVerFinanceiro,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const { data, error } = await supabase.from('empresas').select('meta_mensal').eq('id', empresaId!).single();
      if (error) throw error;
      return Number((data as { meta_mensal: number | string | null } | null)?.meta_mensal ?? 0);
    },
  });
  // Retiradas da dona (owner-only) — mesma chave/consulta do Financeiro.
  const retiradas = useQuery({
    queryKey: ['fin-retiradas', empresaId],
    enabled: !!empresaId && podeVerFinanceiro && isOwner,
    staleTime: 1000 * 60 * 5,
    queryFn: () => carregarRetiradas(supabase, empresaId!),
  });

  const dados    = financeiro.data ?? DADOS_VAZIOS;
  const kpisMes  = calcularKpisFinanceiros(dados, limMes);
  const kpisAnt  = calcularKpisFinanceiros(dados, limAnt);
  const kpisHoje = calcularKpisFinanceiros(nav.isMesAtual ? dados : (financeiroHoje.data ?? DADOS_VAZIOS), limHoje);
  const rowsRet  = retiradas.data?.rows ?? [];
  const devsRet  = retiradas.data?.devs ?? [];

  // Só as consultas ATIVAS contam para erro e para atualizar: refetch() ignora `enabled`.
  const ativas = [
    agendamentosHoje, estoqueBaixo,
    ...(podeVerFinanceiro ? [financeiro, comissoesPendentes, despesasVencendo, reconquista, aniversariantes, meta] : []),
    ...(podeVerFinanceiro && !nav.isMesAtual ? [financeiroHoje] : []),
    ...(podeVerFinanceiro && isOwner ? [retiradas] : []),
    ...(podeFecharComanda ? [comandasNaoFechadas] : []),
  ];

  return {
    nav,
    agendamentosHoje: agendamentosHoje.data ?? [],
    kpisMes,
    kpisAnt,
    receitaHoje: kpisHoje.bruto,
    receitaMes: kpisMes.bruto,
    variacaoReceitaMes: financeiro.data && !financeiro.isPlaceholderData ? variacaoPercentual(kpisMes.bruto, kpisAnt.bruto) : null,
    sparkline: financeiro.data && !financeiro.isPlaceholderData ? receitaAcumuladaPorDia(dados, limMes, nav.isMesAtual ? hoje : limMes.endDate) : [],
    meta: progressoMetaEmpresa(kpisMes.bruto, meta.data ?? 0),
    metaValor: meta.data ?? 0,
    metaPronta: meta.isSuccess && financeiro.isSuccess && !financeiro.isPlaceholderData,
    isOwner,
    retiradasMes: retiradasDoPeriodo(rowsRet, devsRet, limMes),
    emprestimosAbertos: saldoDevedorTotal(rowsRet, somaDevolucoesPorRetirada(devsRet)),
    comissoesPendentes: comissoesPendentes.data ?? { quantidade: 0, total: 0 },
    estoqueBaixo: estoqueBaixo.data ?? [],
    comandasNaoFechadas: comandasNaoFechadas.data ?? { quantidade: 0, maisAntiga: null },
    despesasVencendo: despesasVencendo.data ?? [],
    reconquista: reconquista.data ?? [],
    aniversariantes: aniversariantes.data ?? [],
    // Só vale número com a consulta certa: carregando ou com erro a tela mostra '—'.
    financeiroPronto: financeiro.isSuccess && !financeiro.isPlaceholderData,
    hojePronto: nav.isMesAtual ? financeiro.isSuccess && !financeiro.isPlaceholderData : financeiroHoje.isSuccess,
    comissoesPendentesPronto: comissoesPendentes.isSuccess,
    isLoading: agendamentosHoje.isLoading || financeiro.isLoading,
    isError: ativas.some(q => q.isError),
    erro: (ativas.find(q => q.isError)?.error ?? null) as Error | null,
    refetch: () => Promise.all(ativas.map(q => q.refetch())),
  };
}

/** TODAS as comissões pendentes da empresa (alerta do Dashboard e badge do menu "Mais"). */
export function useResumoComissoesPendentes(ativa = true) {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  return useQuery({
    queryKey: ['comissoes-pendentes', empresaId],
    enabled: !!empresaId && ativa,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => resumoComissoesPendentes(await carregarComissoesPendentes(supabase, empresaId!)),
  });
}
