import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, differenceInDays } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { resolverCategoria, type AgendamentoCompleto, type BloqueioAgenda } from '@/hooks/useAgenda';
import { limitesDias, limitesMes, chaveDoMesExibido, chaveDiaBRT, type Limites } from '@shared/periodos';
import { normalizarComissoes } from '@shared/comissoes';
import { carregarComissoesDoPeriodo } from '@shared/comissoes-consultas';
export type { ComissaoItem } from '@shared/comissoes';
import {
  resumoComissoesProfissional, faturamentoPrevistoDia, resumoComissoesPendentes,
} from '@shared/kpis-financeiros';
import { montarInsertBloqueio, type MontarInsertBloqueioInput } from '@shared/bloqueios';
import { classificarClientesReconquista, type VisitaClienteProfissional } from '@shared/dashboard-profissional';

// ── Tipos ────────────────────────────────────────────────────

export interface ResumoComissoes {
  total: number;
  pago: number;
  pendente: number;
  atendimentos: number;
  ticketMedio: number;
  /** Soma de valor_servico (preço do serviço, não a comissão) do período. */
  faturamentoBruto: number;
}

// ── Agenda da profissional (dia) ─────────────────────────────

export function useAgendaProfissional(dia: Date) {
  const { user, empresaAtiva } = useAuthStore();
  const userId = user?.id;
  const empresaId = empresaAtiva?.id;
  const chave = format(dia, 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['prof-agenda', userId, empresaId, chave],
    enabled: !!userId && !!empresaId,
    staleTime: 1000 * 30,
    queryFn: async () => {
      // Dia exibido (calendário local) → limites em Brasília, igual ao web.
      const lim = limitesDias(chave, chave);
      const { data, error } = await supabase
        .from('agendamentos')
        .select(`
          *,
          cliente:clientes!agendamentos_cliente_id_fkey(id, nome, telefone),
          profissional:users!agendamentos_profissional_id_fkey(id, nome, foto_url),
          servico:servicos(id, nome, duracao_minutos, categoria)
        `)
        .eq('empresa_id', empresaId!)
        .eq('profissional_id', userId!)
        .gte('data_hora_inicio', lim.startIso)
        .lte('data_hora_inicio', lim.endIso)
        .neq('status', 'cancelado')
        .order('data_hora_inicio', { ascending: true });

      if (error) throw error;

      return (data ?? []).map((ag: any) => ({
        ...ag,
        categoria: resolverCategoria(ag.servico?.categoria),
      })) as AgendamentoCompleto[];
    },
  });
}

// ── KPIs do dia da profissional ──────────────────────────────

export function useKpisDiaProfissional(dia: Date) {
  const { user, empresaAtiva } = useAuthStore();
  const userId    = user?.id;
  const empresaId = empresaAtiva?.id;
  const chave     = format(dia, 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['prof-kpis-dia', userId, empresaId, chave],
    enabled: !!userId && !!empresaId,
    staleTime: 1000 * 60,
    queryFn: async () => {
      // Dia exibido (calendário local) → limites em Brasília.
      const lim = limitesDias(chave, chave);
      const [agsRes, comDiaRes, pendRes] = await Promise.all([
        supabase.from('agendamentos')
          .select('valor, status, pacote_cliente_id')
          .eq('empresa_id', empresaId!)
          .eq('profissional_id', userId!)
          .gte('data_hora_inicio', lim.startIso)
          .lte('data_hora_inicio', lim.endIso)
          .neq('status', 'cancelado'),
        // Comissão do dia = comissões GERADAS hoje (tabela comissoes), nunca percentual × valor.
        supabase.from('comissoes')
          .select('valor_servico, valor_comissao, status')
          .eq('empresa_id', empresaId!)
          .eq('profissional_id', userId!)
          .gte('created_at', lim.startIso)
          .lte('created_at', lim.endIso),
        supabase.from('comissoes')
          .select('valor_comissao')
          .eq('empresa_id', empresaId!)
          .eq('profissional_id', userId!)
          .eq('status', 'pendente'),
      ]);
      if (agsRes.error) throw agsRes.error;
      if (comDiaRes.error) throw comDiaRes.error;
      if (pendRes.error) throw pendRes.error;

      const ags = agsRes.data ?? [];
      return {
        total: ags.length,
        receitaDia: faturamentoPrevistoDia(ags),
        comissaoDia: resumoComissoesProfissional(comDiaRes.data ?? []).comissaoTotal,
        totalPendente: resumoComissoesPendentes(pendRes.data ?? []).total,
      };
    },
  });
}

// ── Comissões da profissional (período) ──────────────────────
// Uma consulta só (mesma chave); cada hook transforma com `select`.
function consultaComissoesProfissional(userId: string | undefined, empresaId: string | undefined, l: Limites) {
  return {
    queryKey: ['prof-comissoes', userId, empresaId, l.startIso, l.endIso] as const,
    enabled: !!userId && !!empresaId,
    staleTime: 1000 * 60 * 2,
    queryFn: () => carregarComissoesDoPeriodo(supabase, empresaId!, l, { profissionalId: userId! }),
  };
}

export function useComissoesProfissional(l: Limites) {
  const { user, empresaAtiva } = useAuthStore();
  return useQuery({ ...consultaComissoesProfissional(user?.id, empresaAtiva?.id, l), select: normalizarComissoes });
}

export function useResumoComissoes(l: Limites): { data: ResumoComissoes | null; isLoading: boolean; isError: boolean; error: Error | null; refetch: () => void } {
  const { user, empresaAtiva } = useAuthStore();
  const query = useQuery({
    ...consultaComissoesProfissional(user?.id, empresaAtiva?.id, l),
    select: (rows): ResumoComissoes => {
      const r = resumoComissoesProfissional(rows);
      return {
        total: r.comissaoTotal, pago: r.comissaoPaga, pendente: r.comissaoPendente,
        atendimentos: r.atendimentos, ticketMedio: r.comissaoMedia, faturamentoBruto: r.faturamentoBruto,
      };
    },
  });
  return { data: query.data ?? null, isLoading: query.isLoading, isError: query.isError, error: query.error as Error | null, refetch: query.refetch };
}

// ── Dias com agendamentos da profissional (dots) ─────────────

export function useDiasProfissional(mes: Date) {
  const { user, empresaAtiva } = useAuthStore();
  const userId = user?.id;
  const empresaId = empresaAtiva?.id;
  const chave = chaveDoMesExibido(mes);
  return useQuery({
    queryKey: ['prof-dias', userId, empresaId, chave],
    enabled: !!userId && !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const l = limitesMes(chave);   // mês em Brasília
      const { data, error } = await supabase.from('agendamentos')
        .select('data_hora_inicio')
        .eq('empresa_id', empresaId!)
        .eq('profissional_id', userId!)
        .neq('status', 'cancelado')
        .gte('data_hora_inicio', l.startIso)
        .lte('data_hora_inicio', l.endIso);
      if (error) throw error;
      return new Set((data ?? []).map(a => chaveDiaBRT(a.data_hora_inicio)));
    },
  });
}

// ── Bloqueios da própria agenda (profissional) ──────────────

/** Colunas de `agenda_bloqueios` que a timeline da profissional precisa. */
const BLOQUEIO_PROF_COLS =
  'id, profissional_id, titulo, motivo, escopo, situacao, criado_por, data_inicio, data_fim';

/**
 * Bloqueios que tocam o dia selecionado na agenda da profissional.
 * A RLS de SELECT (`"bloqueios: ver"`, migration 068) recorta por
 * empresa + situação (`aprovado`, ou criado por mim, ou gestão) —
 * NUNCA por profissional. Sem o `.or(profissional_id / escopo geral)`
 * abaixo, a profissional veria na própria timeline todo bloqueio
 * `aprovado` das colegas. O filtro deixa passar só os dela e os de
 * escopo `geral` (que valem para a agenda inteira).
 */
export function useBloqueiosProfissionalDia(dia: Date) {
  const { user, empresaAtiva } = useAuthStore();
  const userId = user?.id;
  const empresaId = empresaAtiva?.id;
  return useQuery({
    queryKey: ['bloqueios-prof-dia', empresaId, userId, format(dia, 'yyyy-MM-dd')],
    enabled: !!empresaId && !!userId,
    staleTime: 1000 * 30,
    queryFn: async (): Promise<BloqueioAgenda[]> => {
      // Limites do dia em Brasília (não no fuso do aparelho).
      const lim = limitesDias(format(dia, 'yyyy-MM-dd'), format(dia, 'yyyy-MM-dd'));
      const { data, error } = await supabase
        .from('agenda_bloqueios')
        .select(BLOQUEIO_PROF_COLS)
        .eq('empresa_id', empresaId)
        .or(`profissional_id.eq.${user!.id},escopo.eq.geral`)
        .lte('data_inicio', lim.endIso)
        .gte('data_fim', lim.startIso);
      if (error) throw error;
      return (data ?? []) as BloqueioAgenda[];
    },
  });
}

/**
 * Pede um bloqueio para a própria agenda. O papel é sempre forçado a
 * `'profissional'` (via `montarInsertBloqueio`), então nasce `pendente`
 * e no próprio escopo, independentemente do que a tela mandar. Lança em
 * erro e quando o insert não devolve linha (RLS barrou) para a tela
 * avisar em vez de fingir sucesso.
 */
export function useCriarBloqueioProfissional() {
  const { empresaAtiva, user } = useAuthStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Omit<MontarInsertBloqueioInput, 'podeAprovarBloqueios' | 'meuUserId' | 'empresaId'>,
    ) => {
      const insert = montarInsertBloqueio({
        ...input,
        podeAprovarBloqueios: false,
        meuUserId: user!.id,
        empresaId: empresaAtiva!.id,
      });
      const { data, error } = await supabase
        .from('agenda_bloqueios')
        .insert(insert)
        .select('id, situacao')
        .single();
      if (error) throw error;
      if (!data) throw new Error('Não foi possível pedir o bloqueio.');
      return data as { id: string; situacao: 'aprovado' | 'pendente' };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bloqueios-prof-dia'] }),
  });
}

// ── Meta mensal pessoal ──────────────────────────────────────

/** Busca a meta pessoal (distinta da meta_mensal da empresa). null = sem meta. */
export function useMetaPessoal() {
  const { user, empresaAtiva } = useAuthStore();
  const userId    = user?.id;
  const empresaId = empresaAtiva?.id;

  return useQuery({
    queryKey: ['prof-meta-pessoal', userId, empresaId],
    enabled: !!userId && !!empresaId,
    staleTime: 1000 * 60,
    queryFn: async () => {
      const { data } = await supabase
        .from('empresa_membros').select('meta_mensal_pessoal')
        .eq('user_id', userId!).eq('empresa_id', empresaId!).single();
      return data?.meta_mensal_pessoal != null ? Number(data.meta_mensal_pessoal) : null;
    },
  });
}

/** Define/limpa (valor null) a meta pessoal via RPC restrita à própria linha
 * e à empresa ativa (uma profissional pode estar em 2+ empresas — sem o
 * filtro de empresa, definir a meta numa sobrescreveria a meta em todas). */
export function useDefinirMetaPessoal() {
  const { empresaAtiva } = useAuthStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (valor: number | null) => {
      const { error } = await supabase.rpc('definir_minha_meta_mensal', { p_valor: valor, p_empresa_id: empresaAtiva?.id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prof-meta-pessoal'] }),
  });
}

// ── Clientes para reconquistar ───────────────────────────────

/**
 * Clientes que a profissional já atendeu, classificados em "em risco"
 * (2+ visitas, 45+ dias sem voltar) e "não retornou" (1 visita só, 30+
 * dias). Mesma regra pura de `shared/dashboard-profissional.ts` usada no
 * dashboard web.
 */
export function useClientesReconquistaProfissional() {
  const { user, empresaAtiva } = useAuthStore();
  const userId    = user?.id;
  const empresaId = empresaAtiva?.id;

  return useQuery({
    queryKey: ['prof-reconquista', userId, empresaId],
    enabled: !!userId && !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agendamentos')
        .select('cliente_id, data_hora_inicio, cliente:clientes!agendamentos_cliente_id_fkey(id, nome)')
        .eq('empresa_id', empresaId!).eq('profissional_id', userId!).eq('status', 'concluido')
        .order('data_hora_inicio', { ascending: false })
        .limit(2000);

      if (error) throw error;

      // Ordenado do mais recente pro mais antigo — a 1a ocorrência de cada
      // cliente_id já é a última visita.
      const visitasPorCliente = new Map<string, VisitaClienteProfissional>();
      for (const ag of (data ?? []) as any[]) {
        if (!ag.cliente_id) continue;
        const existente = visitasPorCliente.get(ag.cliente_id);
        if (existente) {
          existente.totalVisitas++;
        } else {
          visitasPorCliente.set(ag.cliente_id, {
            clienteId: ag.cliente_id,
            nome: ag.cliente?.nome ?? 'Cliente',
            ultimaVisita: ag.data_hora_inicio,
            totalVisitas: 1,
          });
        }
      }
      return classificarClientesReconquista(Array.from(visitasPorCliente.values()));
    },
  });
}
