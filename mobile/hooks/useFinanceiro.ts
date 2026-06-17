import { useQuery } from '@tanstack/react-query';
import {
  startOfMonth, endOfMonth, subMonths, format,
} from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import type { PagamentoMetodo } from '@/types';

// ── Tipos ────────────────────────────────────────────────────

export interface ResumoMes {
  receita: number;
  gastos: number;
  lucro: number;
  receitaAnterior: number;
  gastosAnterior: number;
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
  data_vencimento?: string;
  data_pagamento?: string;
  status: 'pendente' | 'pago';
}

export interface EvolucaoMes {
  mes: string;       // 'Jan', 'Fev' …
  receita: number;
  gastos: number;
}

// ── Hook principal ───────────────────────────────────────────

export function useFinanceiro(mesRef: Date) {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  const inicio = startOfMonth(mesRef).toISOString();
  const fim    = endOfMonth(mesRef).toISOString();
  const inicioAnterior = startOfMonth(subMonths(mesRef, 1)).toISOString();
  const fimAnterior    = endOfMonth(subMonths(mesRef, 1)).toISOString();
  const chave          = format(mesRef, 'yyyy-MM');

  // ── Resumo receita / gastos ──────────────────────────────
  const resumo = useQuery<ResumoMes>({
    queryKey: ['fin-resumo', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const [pagMes, pagAnt, despMes, despAnt] = await Promise.all([
        supabase.from('pagamentos').select('valor').eq('empresa_id', empresaId!).eq('status', 'pago').gte('created_at', inicio).lte('created_at', fim),
        supabase.from('pagamentos').select('valor').eq('empresa_id', empresaId!).eq('status', 'pago').gte('created_at', inicioAnterior).lte('created_at', fimAnterior),
        supabase.from('despesas').select('valor').eq('empresa_id', empresaId!).eq('status', 'pago').gte('data_pagamento', inicio.slice(0,10)).lte('data_pagamento', fim.slice(0,10)),
        supabase.from('despesas').select('valor').eq('empresa_id', empresaId!).eq('status', 'pago').gte('data_pagamento', inicioAnterior.slice(0,10)).lte('data_pagamento', fimAnterior.slice(0,10)),
      ]);

      const receita         = (pagMes.data  ?? []).reduce((s, p) => s + Number(p.valor), 0);
      const receitaAnterior = (pagAnt.data  ?? []).reduce((s, p) => s + Number(p.valor), 0);
      const gastos          = (despMes.data ?? []).reduce((s, d) => s + Number(d.valor), 0);
      const gastosAnterior  = (despAnt.data ?? []).reduce((s, d) => s + Number(d.valor), 0);

      return { receita, gastos, lucro: receita - gastos, receitaAnterior, gastosAnterior };
    },
  });

  // ── Métodos de pagamento ─────────────────────────────────
  const metodos = useQuery<MetodoPagamento[]>({
    queryKey: ['fin-metodos', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data } = await supabase
        .from('pagamentos')
        .select('metodo, valor')
        .eq('empresa_id', empresaId!)
        .eq('status', 'pago')
        .gte('created_at', inicio)
        .lte('created_at', fim);

      const map: Record<string, { valor: number; quantidade: number }> = {};
      (data ?? []).forEach((p) => {
        if (!map[p.metodo]) map[p.metodo] = { valor: 0, quantidade: 0 };
        map[p.metodo].valor     += Number(p.valor);
        map[p.metodo].quantidade += 1;
      });

      const total = Object.values(map).reduce((s, m) => s + m.valor, 0);

      return Object.entries(map)
        .map(([metodo, m]) => ({
          metodo: metodo as PagamentoMetodo,
          valor: m.valor,
          quantidade: m.quantidade,
          percentual: total > 0 ? Math.round((m.valor / total) * 100) : 0,
        }))
        .sort((a, b) => b.valor - a.valor);
    },
  });

  // ── Top serviços ─────────────────────────────────────────
  const topServicos = useQuery<TopServico[]>({
    queryKey: ['fin-servicos', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data } = await supabase
        .from('agendamentos')
        .select('servico_id, valor, servico:servicos(nome)')
        .eq('empresa_id', empresaId!)
        .eq('status', 'concluido')
        .gte('data_hora_inicio', inicio)
        .lte('data_hora_inicio', fim);

      const map: Record<string, { nome: string; qtd: number; receita: number }> = {};
      (data ?? []).forEach((a: any) => {
        const id   = a.servico_id;
        const nome = a.servico?.nome ?? 'Serviço';
        if (!map[id]) map[id] = { nome, qtd: 0, receita: 0 };
        map[id].qtd     += 1;
        map[id].receita += Number(a.valor);
      });

      const lista = Object.entries(map)
        .map(([id, s]) => ({ servico_id: id, nome: s.nome, quantidade: s.qtd, receita: s.receita, percentual: 0 }))
        .sort((a, b) => b.receita - a.receita)
        .slice(0, 5);

      const max = lista[0]?.receita ?? 1;
      return lista.map((s) => ({ ...s, percentual: Math.round((s.receita / max) * 100) }));
    },
  });

  // ── Despesas do mês ──────────────────────────────────────
  const despesas = useQuery<DespesaItem[]>({
    queryKey: ['fin-despesas', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data } = await supabase
        .from('despesas')
        .select('*')
        .eq('empresa_id', empresaId!)
        .or(`data_vencimento.gte.${inicio.slice(0,10)},data_pagamento.gte.${inicio.slice(0,10)}`)
        .lte('data_vencimento', fim.slice(0,10))
        .order('data_vencimento', { ascending: true });

      return (data ?? []) as DespesaItem[];
    },
  });

  // ── Evolução últimos 6 meses ─────────────────────────────
  const evolucao = useQuery<EvolucaoMes[]>({
    queryKey: ['fin-evolucao', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const meses = Array.from({ length: 6 }, (_, i) => subMonths(mesRef, 5 - i));

      const resultados = await Promise.all(
        meses.map(async (m) => {
          const ini = startOfMonth(m).toISOString();
          const fim = endOfMonth(m).toISOString();
          const [pag, desp] = await Promise.all([
            supabase.from('pagamentos').select('valor').eq('empresa_id', empresaId!).eq('status', 'pago').gte('created_at', ini).lte('created_at', fim),
            supabase.from('despesas').select('valor').eq('empresa_id', empresaId!).eq('status', 'pago').gte('data_pagamento', ini.slice(0,10)).lte('data_pagamento', fim.slice(0,10)),
          ]);
          return {
            mes: format(m, 'MMM', { locale: { code: 'pt-BR' } as any }),
            receita: (pag.data ?? []).reduce((s, p) => s + Number(p.valor), 0),
            gastos:  (desp.data ?? []).reduce((s, d) => s + Number(d.valor), 0),
          };
        })
      );

      return resultados;
    },
  });

  const isLoading = resumo.isLoading || metodos.isLoading || topServicos.isLoading;

  return {
    resumo:      resumo.data,
    metodos:     metodos.data ?? [],
    topServicos: topServicos.data ?? [],
    despesas:    despesas.data ?? [],
    evolucao:    evolucao.data ?? [],
    isLoading,
    refetch: () => {
      resumo.refetch();
      metodos.refetch();
      topServicos.refetch();
      despesas.refetch();
      evolucao.refetch();
    },
  };
}
