/**
 * @file useFinanceiro.ts
 * Dados do Financeiro do app. Os números vêm de @shared/kpis-financeiros sobre
 * as linhas de @shared/kpis-financeiros-consultas — exatamente as mesmas
 * funções do Financeiro web. Receita NÃO vem de `pagamentos` (só taxa de
 * cartão e formas de pagamento). Mês em Brasília (@shared/periodos).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidarFinanceiro } from '@/lib/invalidarFinanceiro';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import type { PagamentoMetodo, TaxaCancelamento, TaxaReserva } from '@/types';
import { recorrentesParaLancarNoMes, montarLancamentosRecorrentes, type DespesaRecorrenteTemplate } from '@shared/despesas';
import { carregarHistoricoRecorrentesMensais, lancarRecorrentesMensais } from '@shared/despesas-consultas';
import { limitesMes, somarMeses, uniaoLimites, chaveDoMesExibido } from '@shared/periodos';
import {
  calcularKpisFinanceiros, recortarDados, evolucaoMensal, rankingAtendimentos,
  resumoMetodosPagamento, retiradasDoPeriodo, listarRetiradasDoPeriodo, resultadoAposRetiradas,
  DADOS_VAZIOS,
} from '@shared/kpis-financeiros';
import {
  carregarDadosFinanceiros, carregarRetiradas, filtroDespesasDoMes,
} from '@shared/kpis-financeiros-consultas';
import { somaDevolucoesPorRetirada, saldoDevedorTotal } from '@shared/retiradas-socia';

// ── Tipos ────────────────────────────────────────────────────

export interface ResumoMes {
  /** Faturamento bruto (mesmo número do web). */
  receita: number;
  receitaAnterior: number;
  taxasCartao: number;
  liquidoAposTaxas: number;
  comissoes: number;
  comissoesAnterior: number;
  gastos: number;
  gastosAnterior: number;
  lucro: number;
  /** Lucro − retiradas da dona no mês (só faz sentido para a dona). */
  aposRetiradas: number;
  taxasCancelamento: number;
  taxasReserva: number;
  /** Serviços extras da comanda (já incluídos em `receita`). */
  servicosExtras: number;
  mesesComFechamento: string[];
}

export interface MetodoPagamento {
  metodo: PagamentoMetodo;
  valor: number;
  quantidade: number;
  percentual: number;
}

export interface TopServico {
  servico_id: string;
  nome: string;
  quantidade: number;
  receita: number;
  percentual: number;
}

export interface DespesaItem {
  id: string;
  descricao: string;
  categoria?: string;
  valor: number;
  recorrente: boolean;
  periodicidade?: string;
  data_vencimento?: string;
  recorrencia_ate?: string;
  parcela_atual?: number;
  total_parcelas?: number;
  valor_total_compra?: number;
  data_pagamento?: string;
  created_at?: string;
  status: 'pendente' | 'pago';
}

export interface EvolucaoMes {
  mes: string;       // 'jan', 'fev' … (rotuloMesCurto)
  receita: number;
  gastos: number;
}

// ── Hook principal ───────────────────────────────────────────

export function useFinanceiro(mesRef: Date) {
  const { empresaAtiva, isOwner } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  const chave   = chaveDoMesExibido(mesRef);           // mês que a tela mostra
  const periodo = limitesMes(chave);                   // limites em Brasília
  const chaves6 = Array.from({ length: 6 }, (_, i) => somarMeses(chave, i - 5));

  // KPIs do mês, do anterior e os 6 meses do gráfico: uma busca só.
  // (a chave 'fin-resumo' é a que as telas já invalidam após salvar)
  const dadosQ = useQuery({
    queryKey: ['fin-resumo', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: () => carregarDadosFinanceiros(supabase, empresaId!, uniaoLimites(limitesMes(chaves6[0]), periodo)),
  });

  // ── Despesas do mês (vencimento OU pagamento no mês — mesmo filtro do web)
  const despesas = useQuery<DespesaItem[]>({
    queryKey: ['fin-despesas', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('despesas')
        .select('*')
        .eq('empresa_id', empresaId!)
        .or(filtroDespesasDoMes(periodo))
        .order('data_vencimento', { ascending: true });
      if (error) throw error;
      return (data ?? []) as DespesaItem[];
    },
  });

  // ── Histórico das recorrentes mensais (auto-lançamento + contagem derivada) — consulta única de shared
  const historicoQ = useQuery<DespesaRecorrenteTemplate[]>({
    queryKey: ['fin-despesas-historico', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: () => carregarHistoricoRecorrentesMensais(supabase, empresaId!, periodo.startDate),
  });

  // Só propõe lançar quando as DUAS listas vieram com sucesso e não estão
  // recarregando: com erro (ou dado velho) proporia duplicar as recorrentes.
  const qc = useQueryClient();
  const recorrentesParaLancar = despesas.isSuccess && historicoQ.isSuccess && !despesas.isFetching && !historicoQ.isFetching
    ? recorrentesParaLancarNoMes(historicoQ.data, despesas.data, periodo.startDate)
    : [];

  const lancar = useMutation({
    mutationFn: async () => {
      if (recorrentesParaLancar.length === 0) return { inseridas: 0, jaExistiam: 0 };
      const linhas = montarLancamentosRecorrentes(recorrentesParaLancar, empresaId!, chave);
      // Reconsulta o mês antes de inserir e descarta as já existentes (toque duplo / web em paralelo).
      return lancarRecorrentesMensais(supabase, empresaId!, chave, linhas);
    },
    onSettled: () => invalidarFinanceiro(qc),
  });

  // ── Taxas de cancelamento do mês
  const taxasCancelamento = useQuery<(TaxaCancelamento & { cliente: { nome: string } | null })[]>({
    queryKey: ['fin-taxas-cancelamento', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('taxas_cancelamento')
        .select('*, cliente:clientes(nome)')
        .eq('empresa_id', empresaId!)
        .neq('status', 'cancelada')
        .gte('created_at', periodo.startIso).lte('created_at', periodo.endIso)
        .order('status').order('created_at');
      if (error) throw error;
      return (data ?? []) as (TaxaCancelamento & { cliente: { nome: string } | null })[];
    },
  });

  // ── Taxas de reserva do mês
  const taxasReserva = useQuery<(TaxaReserva & { cliente: { nome: string } | null })[]>({
    queryKey: ['fin-taxas-reserva', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('taxas_reserva')
        .select('*, cliente:clientes(nome)')
        .eq('empresa_id', empresaId!)
        .neq('status', 'cancelada')   // encerradas ao concluir o atendimento (migration 061)
        .gte('created_at', periodo.startIso).lte('created_at', periodo.endIso)
        .order('status').order('created_at');
      if (error) throw error;
      return (data ?? []) as (TaxaReserva & { cliente: { nome: string } | null })[];
    },
  });

  // ── Retiradas/empréstimos da dona (owner-only): TODAS, o saldo é histórico
  const retiradasQ = useQuery({
    queryKey: ['fin-retiradas', empresaId],
    enabled: !!empresaId && isOwner,
    staleTime: 1000 * 60 * 5,
    queryFn: () => carregarRetiradas(supabase, empresaId!),
  });

  // ── Números (mesmas funções do web)
  const dados   = dadosQ.data ?? DADOS_VAZIOS;
  const kpis    = calcularKpisFinanceiros(dados, periodo);
  const kpisAnt = calcularKpisFinanceiros(dados, limitesMes(somarMeses(chave, -1)));
  const doMes   = recortarDados(dados, periodo);

  const todasRetiradas   = retiradasQ.data?.rows ?? [];
  const retiradasDevs    = retiradasQ.data?.devs ?? [];
  const retiradas        = listarRetiradasDoPeriodo(todasRetiradas, periodo);
  const aDonaDeve        = saldoDevedorTotal(todasRetiradas, somaDevolucoesPorRetirada(retiradasDevs));
  const retiradasPeriodo = retiradasDoPeriodo(todasRetiradas, retiradasDevs, periodo);

  // Falha na busca dos KPIs: a tela mostra erro, nunca zeros nem números velhos.
  const erroKpis = dadosQ.isError ? dadosQ.error : null;

  const resumo: ResumoMes | undefined = dadosQ.data && !erroKpis ? {
    receita: kpis.bruto,
    receitaAnterior: kpisAnt.bruto,
    taxasCartao: kpis.taxasCartao,
    liquidoAposTaxas: kpis.liquidoAposTaxas,
    comissoes: kpis.comissoes,
    comissoesAnterior: kpisAnt.comissoes,
    gastos: kpis.despesas,
    gastosAnterior: kpisAnt.despesas,
    lucro: kpis.lucro,
    aposRetiradas: resultadoAposRetiradas(kpis.lucro, retiradasPeriodo),
    taxasCancelamento: kpis.receitaTaxasCancelamento,
    taxasReserva: kpis.receitaTaxasReserva,
    servicosExtras: kpis.receitaServicosExtras,
    mesesComFechamento: kpis.mesesComFechamento,
  } : undefined;

  const metodos: MetodoPagamento[] = resumoMetodosPagamento(doMes.pagamentos)
    .map(m => ({ ...m, metodo: m.metodo as PagamentoMetodo }));

  const topServicos: TopServico[] = rankingAtendimentos(doMes.agendamentos, 'servico', doMes.servicosExtras).slice(0, 5)
    .map(s => ({ servico_id: s.chave, nome: s.nome, quantidade: s.quantidade, receita: s.receita, percentual: Math.round(s.percentual) }));

  const evolucao: EvolucaoMes[] = dadosQ.data && !erroKpis
    ? evolucaoMensal(dados, chaves6).map(p => ({ mes: p.rotulo, receita: p.bruto, gastos: p.despesas }))
    : [];

  return {
    resumo,
    metodos,
    topServicos,
    despesas:          despesas.data ?? [],
    despesasHistorico: historicoQ.data ?? [],
    recorrentesParaLancar,
    /** Lança as recorrentes pendentes do mês; resolve com { inseridas, jaExistiam } e lança erro. */
    lancarRecorrentes: () => lancar.mutateAsync(),
    lancandoRecorrentes: lancar.isPending,
    taxasCancelamento: taxasCancelamento.data ?? [],
    taxasReserva:      taxasReserva.data ?? [],
    evolucao,
    isOwner,
    retiradas,
    retiradasDevs,
    aDonaDeve,
    retiradasPeriodo,
    isLoading: dadosQ.isLoading,
    /** Alguma consulta que alimenta a tela falhou (KPIs, despesas, taxas ou retiradas). */
    isError: !!erroKpis || despesas.isError || historicoQ.isError || taxasCancelamento.isError || taxasReserva.isError || retiradasQ.isError,
    /** Erro da consulta dos KPIs (números do topo e gráfico), ou null. */
    erroKpis: erroKpis as Error | null,
    refetch: () => {
      dadosQ.refetch();
      despesas.refetch();
      historicoQ.refetch();
      taxasCancelamento.refetch();
      taxasReserva.refetch();
      retiradasQ.refetch();
    },
  };
}
