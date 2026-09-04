import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { startOfDay, endOfDay, startOfMonth, endOfMonth, format, differenceInDays } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { resolverCategoria, type AgendamentoCompleto, type BloqueioAgenda } from '@/hooks/useAgenda';
import { montarInsertBloqueio, type MontarInsertBloqueioInput } from '@shared/bloqueios';

// ── Tipos ────────────────────────────────────────────────────

export type ComissaoStatus = 'pendente' | 'pago';

export interface ComissaoItem {
  id: string;
  agendamento_id: string;
  valor_servico: number;
  percentual: number;
  valor_comissao: number;
  status: ComissaoStatus;
  created_at: string;
  cliente_nome: string;
  servico_nome: string;
  data_hora: string;
}

export interface ResumoComissoes {
  total: number;
  pago: number;
  pendente: number;
  atendimentos: number;
  ticketMedio: number;
}

// ── Agenda da profissional (dia) ─────────────────────────────

export function useAgendaProfissional(dia: Date) {
  const { user } = useAuthStore();
  const userId = user?.id;
  const chave = format(dia, 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['prof-agenda', userId, chave],
    enabled: !!userId,
    staleTime: 1000 * 30,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agendamentos')
        .select(`
          *,
          cliente:users!agendamentos_cliente_id_fkey(id, nome, telefone, foto_url),
          profissional:users!agendamentos_profissional_id_fkey(id, nome, foto_url),
          servico:servicos(id, nome, duracao_minutos, categoria)
        `)
        .eq('profissional_id', userId!)
        .gte('data_hora_inicio', startOfDay(dia).toISOString())
        .lte('data_hora_inicio', endOfDay(dia).toISOString())
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
      // Percentual de comissão da profissional nessa empresa
      const { data: membro } = await supabase
        .from('empresa_membros')
        .select('percentual_comissao')
        .eq('user_id', userId!)
        .eq('empresa_id', empresaId!)
        .single();

      const percentual = membro?.percentual_comissao ?? 0;

      // Agendamentos do dia
      const { data: ags } = await supabase
        .from('agendamentos')
        .select('valor, status')
        .eq('profissional_id', userId!)
        .gte('data_hora_inicio', startOfDay(dia).toISOString())
        .lte('data_hora_inicio', endOfDay(dia).toISOString())
        .neq('status', 'cancelado');

      const total = ags?.length ?? 0;
      const receitaDia = (ags ?? []).reduce((s, a) => s + Number(a.valor), 0);
      const comissaoDia = receitaDia * (percentual / 100);

      // Comissões pendentes totais
      const { data: pendentes } = await supabase
        .from('comissoes')
        .select('valor_comissao')
        .eq('profissional_id', userId!)
        .eq('empresa_id', empresaId!)
        .eq('status', 'pendente');

      const totalPendente = (pendentes ?? []).reduce((s, c) => s + Number(c.valor_comissao), 0);

      // Tempo total do dia
      const tempoTotal = (ags ?? []).reduce((s, _) => s + 0, 0); // calculado separado se necessário

      return { total, comissaoDia, totalPendente, percentual, receitaDia };
    },
  });
}

// ── Comissões da profissional (mês) ─────────────────────────

export function useComissoesProfissional(mesRef: Date, filtro: 'todas' | 'pendente' | 'pago' = 'todas') {
  const { user, empresaAtiva } = useAuthStore();
  const userId    = user?.id;
  const empresaId = empresaAtiva?.id;
  const chave     = format(mesRef, 'yyyy-MM');

  return useQuery({
    queryKey: ['prof-comissoes', userId, empresaId, chave, filtro],
    enabled: !!userId && !!empresaId,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => {
      let query = supabase
        .from('comissoes')
        .select(`
          *,
          agendamento:agendamentos(
            data_hora_inicio, valor,
            cliente:users!agendamentos_cliente_id_fkey(nome),
            servico:servicos(nome)
          )
        `)
        .eq('profissional_id', userId!)
        .eq('empresa_id', empresaId!)
        .gte('created_at', startOfMonth(mesRef).toISOString())
        .lte('created_at', endOfMonth(mesRef).toISOString())
        .order('created_at', { ascending: false });

      if (filtro !== 'todas') {
        query = query.eq('status', filtro);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data ?? []).map((c: any) => ({
        id: c.id,
        agendamento_id: c.agendamento_id,
        valor_servico:  Number(c.valor_servico),
        percentual:     Number(c.percentual),
        valor_comissao: Number(c.valor_comissao),
        status:         c.status as ComissaoStatus,
        created_at:     c.created_at,
        cliente_nome:   c.agendamento?.cliente?.nome ?? '—',
        servico_nome:   c.agendamento?.servico?.nome ?? '—',
        data_hora:      c.agendamento?.data_hora_inicio ?? c.created_at,
      })) as ComissaoItem[];
    },
  });
}

// ── Resumo de comissões do mês ───────────────────────────────

export function useResumoComissoes(mesRef: Date): { data: ResumoComissoes | null; isLoading: boolean } {
  const { user, empresaAtiva } = useAuthStore();
  const userId    = user?.id;
  const empresaId = empresaAtiva?.id;
  const chave     = format(mesRef, 'yyyy-MM');

  const query = useQuery({
    queryKey: ['prof-resumo-comissoes', userId, empresaId, chave],
    enabled: !!userId && !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data } = await supabase
        .from('comissoes')
        .select('valor_comissao, status')
        .eq('profissional_id', userId!)
        .eq('empresa_id', empresaId!)
        .gte('created_at', startOfMonth(mesRef).toISOString())
        .lte('created_at', endOfMonth(mesRef).toISOString());

      const items = data ?? [];
      const total      = items.reduce((s, c) => s + Number(c.valor_comissao), 0);
      const pago       = items.filter((c) => c.status === 'pago').reduce((s, c) => s + Number(c.valor_comissao), 0);
      const pendente   = items.filter((c) => c.status === 'pendente').reduce((s, c) => s + Number(c.valor_comissao), 0);
      const atendimentos = items.length;
      const ticketMedio = atendimentos > 0 ? Math.round(total / atendimentos) : 0;

      return { total, pago, pendente, atendimentos, ticketMedio } as ResumoComissoes;
    },
  });

  return { data: query.data ?? null, isLoading: query.isLoading };
}

// ── Dias com agendamentos da profissional (dots) ─────────────

export function useDiasProfissional(mes: Date) {
  const { user } = useAuthStore();
  const userId = user?.id;
  const chave  = format(mes, 'yyyy-MM');

  return useQuery({
    queryKey: ['prof-dias', userId, chave],
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data } = await supabase
        .from('agendamentos')
        .select('data_hora_inicio')
        .eq('profissional_id', userId!)
        .neq('status', 'cancelado')
        .gte('data_hora_inicio', new Date(mes.getFullYear(), mes.getMonth(), 1).toISOString())
        .lte('data_hora_inicio', new Date(mes.getFullYear(), mes.getMonth() + 1, 0, 23, 59).toISOString());

      return new Set((data ?? []).map((a) => format(new Date(a.data_hora_inicio), 'yyyy-MM-dd')));
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
      const { data, error } = await supabase
        .from('agenda_bloqueios')
        .select(BLOQUEIO_PROF_COLS)
        .eq('empresa_id', empresaId)
        .or(`profissional_id.eq.${user!.id},escopo.eq.geral`)
        .lte('data_inicio', endOfDay(dia).toISOString())
        .gte('data_fim', startOfDay(dia).toISOString());
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
      input: Omit<MontarInsertBloqueioInput, 'role' | 'meuUserId' | 'empresaId'>,
    ) => {
      const insert = montarInsertBloqueio({
        ...input,
        role: 'profissional',
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
