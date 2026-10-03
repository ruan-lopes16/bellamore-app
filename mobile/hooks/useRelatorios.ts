/**
 * @file useRelatorios.ts
 * Relatórios do app — mesmas abas, períodos, consultas e funções dos Relatórios
 * web (@shared/relatorios, @shared/kpis-financeiros, @shared/comissoes).
 * Comissões, Estoque e Avaliações só buscam quando a aba é aberta (como no web).
 */
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { invalidarFinanceiro } from '@/lib/invalidarFinanceiro';
import { temPermissao } from '@/lib/permissions';
import { limitesDoPeriodo, uniaoLimites, hojeBRT, type PeriodoRelatorio, type OpcoesPeriodo } from '@shared/periodos';
import {
  calcularKpisFinanceiros, recortarDados, rankingAtendimentos, clientesAtendidosNoPeriodo, metricasRetorno,
  clientesSumidas, serieFaturamento, retiradasDoPeriodo,
} from '@shared/kpis-financeiros';
import { carregarDadosFinanceiros, carregarClientesComHistoricoAntes, carregarRetiradas } from '@shared/kpis-financeiros-consultas';
import {
  rankingDespesasPorCategoria, comissaoPorProfissional, resumoInsumos, resumoAvaliacoes, type AbaRelatorio,
} from '@shared/relatorios';
import { carregarSaidasEstoque, carregarAvaliacoes } from '@shared/relatorios-consultas';
import { normalizarComissoes, comissoesPorProfissional, resumoComissoes, MENSAGEM_PAGAMENTO_PARCIAL } from '@shared/comissoes';
import { carregarComissoesDoPeriodo, pagarComissoes } from '@shared/comissoes-consultas';
import { carregarUltimasVisitas } from '@shared/dashboard-consultas';
import { datasDasUltimasVisitas } from '@shared/dashboard';

export type { PeriodoRelatorio };

export interface ResumoRelatorio {
  faturamento: number; faturamentoAnterior: number;
  atendimentos: number; atendimentosAnterior: number;
  ticketMedio: number; ticketMedioAnterior: number;
  totalAgendamentos: number; perdidos: number; pctCancelamento: number;
}
export interface MetricasCliente {
  novos: number; retornaram: number;
  sumidos: number | undefined;   // undefined = carregando/erro (a tela mostra '—')
  totalAtendidas: number; pctRetorno: number;
}
export interface ServicoRelatorio { servico_id: string; nome: string; quantidade: number; receita: number; percentual: number }
export interface ProfissionalRelatorio {
  profissional_id: string; nome: string; foto_url?: string; especialidades: string;
  atendimentos: number; faturamento: number; comissao: number; percentual: number;
}
export interface ClienteRelatorio { cliente_id: string; nome: string; visitas: number; total: number; percentual: number }

export function useRelatorios(periodo: PeriodoRelatorio, opcoes: OpcoesPeriodo, aba: AbaRelatorio = 'financeiro') {
  const { empresaAtiva, isOwner, roleAtivo } = useAuthStore();
  const role = isOwner ? 'owner' : (roleAtivo ?? 'profissional');
  const empresaId = empresaAtiva?.id;
  const qc = useQueryClient();

  const { atual, anterior } = limitesDoPeriodo(periodo, hojeBRT(), opcoes);
  const chave = `${periodo}_${atual.startDate}_${atual.endDate}`;

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

  // Sumidas: última visita concluída até o FIM do período há +60 dias (regra única; web igual).
  const sumidosQ = useQuery({
    queryKey: ['rel-sumidos', empresaId, periodo, atual.startIso, atual.endIso],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => clientesSumidas(datasDasUltimasVisitas(await carregarUltimasVisitas(supabase, empresaId!, atual.endIso)), atual.endIso),
  });

  const retiradasQ = useQuery({
    queryKey: ['fin-retiradas', empresaId],
    enabled: !!empresaId && isOwner,
    staleTime: 1000 * 60 * 5,
    queryFn: () => carregarRetiradas(supabase, empresaId!),
  });

  const comissoesQ = useQuery({
    queryKey: ['rel-comissoes', empresaId, chave],
    enabled: !!empresaId && aba === 'comissoes',
    staleTime: 1000 * 60 * 2,
    queryFn: async () => normalizarComissoes(await carregarComissoesDoPeriodo(supabase, empresaId!, atual)),
  });
  const estoqueQ = useQuery({
    queryKey: ['rel-estoque', empresaId, chave],
    enabled: !!empresaId && aba === 'estoque',
    staleTime: 1000 * 60 * 5,
    queryFn: () => carregarSaidasEstoque(supabase, empresaId!, atual),
  });
  const avaliacoesQ = useQuery({
    queryKey: ['rel-avaliacoes', empresaId, chave],
    enabled: !!empresaId && aba === 'avaliacoes',
    staleTime: 1000 * 60 * 5,
    queryFn: () => carregarAvaliacoes(supabase, empresaId!, atual),
  });

  const pagar = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!temPermissao(role, 'ver_comissoes_todas')) throw new Error('Sem permissão para pagar comissões.');
      if (ids.length === 0) return 0;
      const r = await pagarComissoes(supabase, empresaId!, ids);
      if (r.naoConfirmados.length > 0 || r.erro) throw new Error(r.erro ?? MENSAGEM_PAGAMENTO_PARCIAL);
      return r.confirmados.length;
    },
    onSettled: () => invalidarFinanceiro(qc),
  });

  const calculado = useMemo(() => {
    if (!dadosQ.data) return null;
    const { dados, historico } = dadosQ.data;
    const k = calcularKpisFinanceiros(dados, atual);
    const ka = calcularKpisFinanceiros(dados, anterior);
    const doPeriodo = recortarDados(dados, atual);
    const ags = doPeriodo.agendamentos;
    const retorno = metricasRetorno(ags, historico);
    const resumo: ResumoRelatorio = {
      faturamento: k.bruto, faturamentoAnterior: ka.bruto,
      atendimentos: k.atendimentos, atendimentosAnterior: ka.atendimentos,
      ticketMedio: k.ticketMedio, ticketMedioAnterior: ka.ticketMedio,
      totalAgendamentos: k.totalAgendamentos, perdidos: k.perdidos, pctCancelamento: k.pctCancelamento,
    };
    const servicos: ServicoRelatorio[] = rankingAtendimentos(ags, 'servico').map(s => ({
      servico_id: s.chave, nome: s.nome, quantidade: s.quantidade, receita: s.receita, percentual: Math.round(s.percentual),
    }));
    const comPorProf = comissaoPorProfissional(doPeriodo.comissoes);
    const extras: Record<string, { foto_url?: string; cats: Set<string> }> = {};
    for (const a of ags) {
      if (a.status !== 'concluido' || !a.profissional_id) continue;
      const e = (extras[a.profissional_id] ??= { foto_url: a.profissional?.foto_url ?? undefined, cats: new Set() });
      if (a.servico?.categoria) e.cats.add(a.servico.categoria);
    }
    const profissionais: ProfissionalRelatorio[] = rankingAtendimentos(ags, 'profissional').map(p => ({
      profissional_id: p.chave, nome: p.nome, foto_url: extras[p.chave]?.foto_url,
      especialidades: [...(extras[p.chave]?.cats ?? [])].slice(0, 2).join(' · ') || 'Geral',
      atendimentos: p.quantidade, faturamento: p.receita, comissao: comPorProf[p.chave] ?? 0, percentual: p.percentual,
    }));
    const topClientes: ClienteRelatorio[] = rankingAtendimentos(ags, 'cliente').slice(0, 10).map(c => ({
      cliente_id: c.chave, nome: c.nome, visitas: c.quantidade, total: c.receita, percentual: c.percentual,
    }));
    return {
      kpis: k, kpisAnt: ka, resumo, retorno, servicos, profissionais, topClientes,
      serie: serieFaturamento(dados, atual).map(p => ({ rotulo: p.rotulo, valor: p.valor })),
      despesasPorCategoria: rankingDespesasPorCategoria(doPeriodo.despesas),
      mesesComFechamento: k.mesesComFechamento,
    };
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

  const itensComissao = comissoesQ.data ?? [];

  // Consultas ativas agora: carga principal, sumidas, retiradas (dona) e a da aba aberta.
  const ativas: { isError: boolean; error: unknown; refetch: () => unknown }[] = [dadosQ, sumidosQ];
  if (isOwner) ativas.push(retiradasQ);
  if (aba === 'comissoes') ativas.push(comissoesQ);
  if (aba === 'estoque') ativas.push(estoqueQ);
  if (aba === 'avaliacoes') ativas.push(avaliacoesQ);

  return {
    resumo: calculado?.resumo,
    kpis: calculado?.kpis,
    kpisAnt: calculado?.kpisAnt,
    clientes,
    servicos: calculado?.servicos ?? [],
    profissionais: calculado?.profissionais ?? [],
    topClientes: calculado?.topClientes ?? [],
    serie: calculado?.serie ?? [],
    despesasPorCategoria: calculado?.despesasPorCategoria ?? [],
    mesesComFechamento: calculado?.mesesComFechamento ?? [],
    isOwner,
    retiradasPeriodo: isOwner ? retiradasDoPeriodo(retiradasQ.data?.rows ?? [], retiradasQ.data?.devs ?? [], atual) : 0,
    comissoes: {
      porProfissional: comissoesPorProfissional(itensComissao),
      resumo: resumoComissoes(itensComissao),
      pronto: comissoesQ.isSuccess, isError: comissoesQ.isError, refetch: comissoesQ.refetch,
    },
    insumos: resumoInsumos(estoqueQ.data ?? [], calculado?.kpis.atendimentos ?? 0),
    insumosPronto: estoqueQ.isSuccess, insumosErro: estoqueQ.isError,
    avaliacoes: resumoAvaliacoes(avaliacoesQ.data ?? []),
    avaliacoesRecentes: (avaliacoesQ.data ?? []).slice(0, 20),
    avaliacoesPronto: avaliacoesQ.isSuccess, avaliacoesErro: avaliacoesQ.isError,
    pagarComissoes: (ids: string[]) => pagar.mutateAsync(ids),
    pagando: pagar.isPending,
    atual,
    isLoading: dadosQ.isLoading,
    // Falha de qualquer consulta ATIVA (carga principal + a da aba aberta): a tela mostra erro, nunca zeros.
    isError: ativas.some(q => q.isError),
    erro: ativas.find(q => q.isError)?.error ?? null,
    // Refaz só o que está ativo (nada de buscar abas que não foram abertas).
    refetch: () => { ativas.forEach(q => { q.refetch(); }); },
  };
}
