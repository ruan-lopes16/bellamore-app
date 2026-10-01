/**
 * @file useRelatorios.ts
 * Relatórios do app. Períodos, limites (Brasília, semana no domingo) e números
 * vêm de @shared — as mesmas funções dos Relatórios web. Faturamento NÃO vem de
 * `pagamentos`. "Retornaram" = atendida no período e também antes dele.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { buscarTodasPaginas } from '@shared/paginacao';
import {
  limitesDoPeriodo, uniaoLimites, hojeBRT,
  type PeriodoRelatorio, type OpcoesPeriodo,
} from '@shared/periodos';
import {
  calcularKpisFinanceiros, recortarDados, rankingAtendimentos, clientesAtendidosNoPeriodo, metricasRetorno, clientesSumidas,
} from '@shared/kpis-financeiros';
import { carregarDadosFinanceiros, carregarClientesComHistoricoAntes } from '@shared/kpis-financeiros-consultas';

export type { PeriodoRelatorio };

export interface ResumoRelatorio {
  faturamento: number;
  faturamentoAnterior: number;
  atendimentos: number;
  atendimentosAnterior: number;
  ticketMedio: number;
  ticketMedioAnterior: number;
  totalAgendamentos: number;
  perdidos: number;
  pctCancelamento: number;
}

export interface MetricasCliente {
  novos: number;
  retornaram: number;
  sumidos: number | undefined; // undefined = ainda carregando/erro (a tela mostra '—');  sem visita há +60 dias (só no app por enquanto — Fase 2B)
  totalAtendidas: number;
  pctRetorno: number;
}

export interface ServicoRelatorio {
  servico_id: string;
  nome: string;
  quantidade: number;
  receita: number;
  percentual: number;
}

export interface ProfissionalRelatorio {
  profissional_id: string;
  nome: string;
  foto_url?: string;
  especialidades: string;
  atendimentos: number;
  faturamento: number;
}

export function useRelatorios(periodo: PeriodoRelatorio, opcoes: OpcoesPeriodo) {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  const { atual, anterior } = limitesDoPeriodo(periodo, hojeBRT(), opcoes);
  const chave = `${periodo}_${atual.startDate}_${atual.endDate}`;

  // Período + anterior (deltas) numa busca só, e o histórico de retorno.
  // As funções compartilhadas lançam erro se qualquer consulta falhar.
  const dadosQ = useQuery({
    queryKey: ['rel-dados', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const dados = await carregarDadosFinanceiros(supabase, empresaId!, uniaoLimites(anterior, atual));
      const ids = clientesAtendidosNoPeriodo(recortarDados(dados, atual).agendamentos);
      const historico = await carregarClientesComHistoricoAntes(supabase, empresaId!, ids, atual.startIso);
      return { dados, historico: [...historico] };
    },
  });

  // Clientes sumidas: última visita concluída até o FIM do período há +60 dias
  // (regra única clientesSumidas; quem voltou no período não entra).
  const sumidosQ = useQuery({
    queryKey: ['rel-sumidos', empresaId, periodo, atual.startIso, atual.endIso],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const linhas = await buscarTodasPaginas<{ cliente_id: string | null; data_hora_inicio: string }>(async (from, to) => {
        const r = await supabase
          .from('agendamentos')
          .select('cliente_id, data_hora_inicio')
          .eq('empresa_id', empresaId!)
          .eq('status', 'concluido')
          .lte('data_hora_inicio', atual.endIso)
          .order('data_hora_inicio', { ascending: false }).order('id')
          .range(from, to);
        if (r.error) throw r.error;
        return r;
      });
      // Ordem decrescente: a primeira linha de cada cliente é a última visita.
      const ultimo = new Map<string, string>();
      for (const a of linhas) if (a.cliente_id && !ultimo.has(a.cliente_id)) ultimo.set(a.cliente_id, a.data_hora_inicio);
      return clientesSumidas(ultimo, atual.endIso);
    },
  });

  const calculado = useMemo(() => {
    if (!dadosQ.data) return null;
    const { dados, historico } = dadosQ.data;
    const k  = calcularKpisFinanceiros(dados, atual);
    const ka = calcularKpisFinanceiros(dados, anterior);
    const ags = recortarDados(dados, atual).agendamentos;
    const retorno = metricasRetorno(ags, historico);

    const resumo: ResumoRelatorio = {
      faturamento: k.bruto,
      faturamentoAnterior: ka.bruto,
      atendimentos: k.atendimentos,
      atendimentosAnterior: ka.atendimentos,
      ticketMedio: k.ticketMedio,
      ticketMedioAnterior: ka.ticketMedio,
      totalAgendamentos: k.totalAgendamentos,
      perdidos: k.perdidos,
      pctCancelamento: k.pctCancelamento,
    };

    const servicos: ServicoRelatorio[] = rankingAtendimentos(ags, 'servico').slice(0, 5).map(s => ({
      servico_id: s.chave, nome: s.nome, quantidade: s.quantidade, receita: s.receita, percentual: Math.round(s.percentual),
    }));

    const extras: Record<string, { foto_url?: string; cats: Set<string> }> = {};
    for (const a of ags) {
      if (a.status !== 'concluido' || !a.profissional_id) continue;
      const e = (extras[a.profissional_id] ??= { foto_url: a.profissional?.foto_url ?? undefined, cats: new Set() });
      if (a.servico?.categoria) e.cats.add(a.servico.categoria);
    }
    const profissionais: ProfissionalRelatorio[] = rankingAtendimentos(ags, 'profissional').map(p => ({
      profissional_id: p.chave,
      nome: p.nome,
      foto_url: extras[p.chave]?.foto_url,
      especialidades: [...(extras[p.chave]?.cats ?? [])].slice(0, 2).join(' · ') || 'Geral',
      atendimentos: p.quantidade,
      faturamento: p.receita,
    }));

    return { resumo, retorno, servicos, profissionais, mesesComFechamento: k.mesesComFechamento };
    // `chave` resume `atual`/`anterior` (objetos novos a cada render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dadosQ.data, chave]);

  const clientes: MetricasCliente | undefined = calculado ? {
    novos: calculado.retorno.novas,
    retornaram: calculado.retorno.retornaram,
    sumidos: sumidosQ.data,
    totalAtendidas: calculado.retorno.atendidas,
    pctRetorno: calculado.retorno.pctRetorno,
  } : undefined;

  return {
    resumo:        calculado?.resumo,
    clientes,
    servicos:      calculado?.servicos ?? [],
    profissionais: calculado?.profissionais ?? [],
    mesesComFechamento: calculado?.mesesComFechamento ?? [],
    atual,
    isLoading: dadosQ.isLoading,
    // Falha de qualquer consulta: a tela mostra erro em vez de zeros/números velhos.
    isError: dadosQ.isError || sumidosQ.isError,
    refetch: () => { dadosQ.refetch(); sumidosQ.refetch(); },
  };
}
