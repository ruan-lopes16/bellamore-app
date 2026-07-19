import { useQuery } from '@tanstack/react-query';
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter, startOfYear, endOfYear,
  subWeeks, subMonths, subQuarters, subYears,
  differenceInDays,
} from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

// ── Tipos ────────────────────────────────────────────────────

export type Periodo = '7d' | '30d' | '90d' | '1y';

export interface ResumoRelatorio {
  faturamento: number;
  faturamentoAnterior: number;
  atendimentos: number;
  atendimentosAnterior: number;
  ticketMedio: number;
  ticketMedioAnterior: number;
}

export interface MetricasCliente {
  novos: number;
  retornaram: number;
  sumidos: number; // sem visita há +60 dias
  totalAtendidas: number;
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

/**
 * Busca todas as páginas de uma query (o PostgREST limita a 1000 linhas por
 * requisição por padrão) — evita truncar silenciosamente relatórios de
 * empresas com muito movimento no período selecionado (ex: período "1y").
 */
async function buscarTodasPaginas<T>(
  montarQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  tamanhoPagina = 1000,
): Promise<T[]> {
  const todas: T[] = [];
  let from = 0;
  for (;;) {
    const { data } = await montarQuery(from, from + tamanhoPagina - 1);
    const linhas = data ?? [];
    todas.push(...linhas);
    if (linhas.length < tamanhoPagina) break;
    from += tamanhoPagina;
  }
  return todas;
}

// ── Helpers de range ─────────────────────────────────────────

export function getRanges(periodo: Periodo, ref = new Date()) {
  switch (periodo) {
    case '7d': {
      const ini = startOfWeek(ref, { weekStartsOn: 1 });
      const fim = endOfWeek(ref, { weekStartsOn: 1 });
      const iniAnt = startOfWeek(subWeeks(ref, 1), { weekStartsOn: 1 });
      const fimAnt = endOfWeek(subWeeks(ref, 1), { weekStartsOn: 1 });
      return { ini, fim, iniAnt, fimAnt };
    }
    case '30d': {
      const ini = startOfMonth(ref);
      const fim = endOfMonth(ref);
      const iniAnt = startOfMonth(subMonths(ref, 1));
      const fimAnt = endOfMonth(subMonths(ref, 1));
      return { ini, fim, iniAnt, fimAnt };
    }
    case '90d': {
      const ini = startOfQuarter(ref);
      const fim = endOfQuarter(ref);
      const iniAnt = startOfQuarter(subQuarters(ref, 1));
      const fimAnt = endOfQuarter(subQuarters(ref, 1));
      return { ini, fim, iniAnt, fimAnt };
    }
    case '1y': {
      const ini = startOfYear(ref);
      const fim = endOfYear(ref);
      const iniAnt = startOfYear(subYears(ref, 1));
      const fimAnt = endOfYear(subYears(ref, 1));
      return { ini, fim, iniAnt, fimAnt };
    }
  }
}

// ── Hook principal ───────────────────────────────────────────

export function useRelatorios(periodo: Periodo, ref: Date = new Date()) {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  const { ini, fim, iniAnt, fimAnt } = getRanges(periodo, ref);
  const iniISO    = ini.toISOString();
  const fimISO    = fim.toISOString();
  const iniAntISO = iniAnt.toISOString();
  const fimAntISO = fimAnt.toISOString();
  // Chave de cache — muda quando o usuário navega para outra semana/período de referência
  const refKey = ref.toISOString().slice(0, 10);

  // ── Resumo (faturamento + atendimentos) ──────────────────
  const resumo = useQuery<ResumoRelatorio>({
    queryKey: ['rel-resumo', empresaId, periodo, refKey],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const [pagAtual, pagAnt, agAtual, agAnt] = await Promise.all([
        buscarTodasPaginas<{ valor: number }>((from, to) =>
          supabase.from('pagamentos').select('valor')
            .eq('empresa_id', empresaId!).eq('status', 'pago')
            .gte('created_at', iniISO).lte('created_at', fimISO)
            .range(from, to)
        ),
        buscarTodasPaginas<{ valor: number }>((from, to) =>
          supabase.from('pagamentos').select('valor')
            .eq('empresa_id', empresaId!).eq('status', 'pago')
            .gte('created_at', iniAntISO).lte('created_at', fimAntISO)
            .range(from, to)
        ),
        buscarTodasPaginas<{ id: string }>((from, to) =>
          supabase.from('agendamentos').select('id')
            .eq('empresa_id', empresaId!).eq('status', 'concluido')
            .gte('data_hora_inicio', iniISO).lte('data_hora_inicio', fimISO)
            .range(from, to)
        ),
        buscarTodasPaginas<{ id: string }>((from, to) =>
          supabase.from('agendamentos').select('id')
            .eq('empresa_id', empresaId!).eq('status', 'concluido')
            .gte('data_hora_inicio', iniAntISO).lte('data_hora_inicio', fimAntISO)
            .range(from, to)
        ),
      ]);

      const fat    = pagAtual.reduce((s, p) => s + Number(p.valor), 0);
      const fatAnt = pagAnt.reduce((s, p) => s + Number(p.valor), 0);
      const atend    = agAtual.length;
      const atendAnt = agAnt.length;

      return {
        faturamento:        fat,
        faturamentoAnterior: fatAnt,
        atendimentos:        atend,
        atendimentosAnterior: atendAnt,
        ticketMedio:        atend  > 0 ? fat    / atend    : 0,
        ticketMedioAnterior: atendAnt > 0 ? fatAnt / atendAnt : 0,
      };
    },
  });

  // ── Métricas de clientes ─────────────────────────────────
  const clientes = useQuery<MetricasCliente>({
    queryKey: ['rel-clientes', empresaId, periodo, refKey],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      // Clientes únicos atendidos no período atual
      const agAtual = await buscarTodasPaginas<{ cliente_id: string; data_hora_inicio: string }>((from, to) =>
        supabase
          .from('agendamentos')
          .select('cliente_id, data_hora_inicio')
          .eq('empresa_id', empresaId!)
          .eq('status', 'concluido')
          .gte('data_hora_inicio', iniISO)
          .lte('data_hora_inicio', fimISO)
          .range(from, to)
      );

      const idsAtual = [...new Set(agAtual.map((a) => a.cliente_id))];

      // Clientes que JÁ tinham histórico antes do período (retornaram)
      const agAntes = await buscarTodasPaginas<{ cliente_id: string }>((from, to) =>
        supabase
          .from('agendamentos')
          .select('cliente_id')
          .eq('empresa_id', empresaId!)
          .eq('status', 'concluido')
          .lt('data_hora_inicio', iniISO)
          .in('cliente_id', idsAtual.length > 0 ? idsAtual : ['00000000-0000-0000-0000-000000000000'])
          .range(from, to)
      );

      const idsAntes = new Set(agAntes.map((a) => a.cliente_id));
      const novos      = idsAtual.filter((id) => !idsAntes.has(id)).length;
      const retornaram = idsAtual.filter((id) => idsAntes.has(id)).length;

      // Clientes sumidos: último atendimento há +60 dias e antes do período
      const ultimosAg = await buscarTodasPaginas<{ cliente_id: string; data_hora_inicio: string }>((from, to) =>
        supabase
          .from('agendamentos')
          .select('cliente_id, data_hora_inicio')
          .eq('empresa_id', empresaId!)
          .eq('status', 'concluido')
          .lt('data_hora_inicio', iniISO)
          .order('data_hora_inicio', { ascending: false })
          .range(from, to)
      );

      const ultimoPorCliente: Record<string, Date> = {};
      ultimosAg.forEach((a) => {
        if (!ultimoPorCliente[a.cliente_id]) {
          ultimoPorCliente[a.cliente_id] = new Date(a.data_hora_inicio);
        }
      });
      const sumidos = Object.values(ultimoPorCliente).filter(
        (d) => differenceInDays(new Date(), d) > 60
      ).length;

      return {
        novos,
        retornaram,
        sumidos,
        totalAtendidas: idsAtual.length,
      };
    },
  });

  // ── Top serviços ─────────────────────────────────────────
  const servicos = useQuery<ServicoRelatorio[]>({
    queryKey: ['rel-servicos', empresaId, periodo, refKey],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const data = await buscarTodasPaginas<any>((from, to) =>
        supabase
          .from('agendamentos')
          .select('servico_id, valor, servico:servicos(nome)')
          .eq('empresa_id', empresaId!)
          .eq('status', 'concluido')
          .gte('data_hora_inicio', iniISO)
          .lte('data_hora_inicio', fimISO)
          .range(from, to)
      );

      const map: Record<string, { nome: string; qtd: number; receita: number }> = {};
      data.forEach((a: any) => {
        const id = a.servico_id;
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

  // ── Por profissional ─────────────────────────────────────
  const profissionais = useQuery<ProfissionalRelatorio[]>({
    queryKey: ['rel-profissionais', empresaId, periodo, refKey],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const data = await buscarTodasPaginas<any>((from, to) =>
        supabase
          .from('agendamentos')
          .select('profissional_id, valor, profissional:users(nome, foto_url), servico:servicos(categoria)')
          .eq('empresa_id', empresaId!)
          .eq('status', 'concluido')
          .gte('data_hora_inicio', iniISO)
          .lte('data_hora_inicio', fimISO)
          .range(from, to)
      );

      const map: Record<string, {
        nome: string; foto_url?: string;
        cats: Set<string>; atend: number; fat: number;
      }> = {};

      data.forEach((a: any) => {
        const id = a.profissional_id;
        const nome = a.profissional?.nome ?? 'Profissional';
        if (!map[id]) map[id] = { nome, foto_url: a.profissional?.foto_url, cats: new Set(), atend: 0, fat: 0 };
        map[id].atend += 1;
        map[id].fat   += Number(a.valor);
        if (a.servico?.categoria) map[id].cats.add(a.servico.categoria);
      });

      return Object.entries(map)
        .map(([id, p]) => ({
          profissional_id: id,
          nome: p.nome,
          foto_url: p.foto_url,
          especialidades: [...p.cats].slice(0, 2).join(' · ') || 'Geral',
          atendimentos: p.atend,
          faturamento: p.fat,
        }))
        .sort((a, b) => b.faturamento - a.faturamento);
    },
  });

  const isLoading = resumo.isLoading || clientes.isLoading || servicos.isLoading || profissionais.isLoading;

  function refetch() {
    resumo.refetch();
    clientes.refetch();
    servicos.refetch();
    profissionais.refetch();
  }

  return {
    resumo:       resumo.data,
    clientes:     clientes.data,
    servicos:     servicos.data ?? [],
    profissionais: profissionais.data ?? [],
    isLoading,
    refetch,
  };
}
