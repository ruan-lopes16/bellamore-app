import { useQuery } from '@tanstack/react-query';
import { startOfDay, endOfDay, format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import type { Agendamento } from '@/types';

// ── Tipos ────────────────────────────────────────────────────

export type CategoriaServico =
  | 'cilios'
  | 'sobrancelhas'
  | 'depilacao'
  | 'unhas'
  | 'pele'
  | 'dermaplaning'
  | 'maquiagem'
  | 'outros';

export interface AgendamentoCompleto extends Agendamento {
  cliente:      { id: string; nome: string; telefone?: string; foto_url?: string };
  profissional: { id: string; nome: string; foto_url?: string };
  servico:      { id: string; nome: string; duracao_minutos: number; categoria?: string };
  categoria:    CategoriaServico;
}

export interface ProfissionalAgenda {
  id: string;
  nome: string;
  foto_url?: string;
}

export interface ResumoDia {
  total: number;
  receita: number;
  profissionais: number;
  pendentes: number;
}

// ── Mapeamento de categoria ──────────────────────────────────

export function resolverCategoria(categoria?: string): CategoriaServico {
  if (!categoria) return 'outros';
  const c = categoria.toLowerCase();
  if (c.includes('cílio') || c.includes('cilio') || c.includes('lash')) return 'cilios';
  if (c.includes('sobrancelha') || c.includes('henna') || c.includes('brow')) return 'sobrancelhas';
  if (c.includes('depila') || c.includes('cava') || c.includes('axila') || c.includes('buço')) return 'depilacao';
  if (c.includes('unha') || c.includes('manicure') || c.includes('pedicure') || c.includes('gel')) return 'unhas';
  if (c.includes('dermaplaning') || c.includes('derma')) return 'dermaplaning';
  if (c.includes('pele') || c.includes('facial') || c.includes('estética') || c.includes('limpeza')) return 'pele';
  if (c.includes('maquiagem') || c.includes('make')) return 'maquiagem';
  return 'outros';
}

// ── Config visual por categoria ──────────────────────────────

export const CATEGORIA_CONFIG: Record<CategoriaServico, {
  label: string; bg: string; border: string; accent: string; icon: string;
}> = {
  cilios:       { label: 'Cílios',        bg: '#EEF2FF', border: '#4F46E5', accent: '#4F46E5', icon: 'eye-outline' },
  sobrancelhas: { label: 'Sobrancelhas',  bg: '#F3EFFE', border: '#7C3AED', accent: '#7C3AED', icon: 'eye-plus-outline' },
  depilacao:    { label: 'Depilação',     bg: '#FDF0F5', border: '#D4608A', accent: '#D4608A', icon: 'water-outline' },
  unhas:        { label: 'Unhas',         bg: '#FEF3E2', border: '#B45309', accent: '#B45309', icon: 'hand-back-right-outline' },
  pele:         { label: 'Pele / Facial', bg: '#EAFAF5', border: '#0D7E5F', accent: '#0D7E5F', icon: 'face-woman-shimmer-outline' },
  dermaplaning: { label: 'Dermaplaning',  bg: '#ECFEFF', border: '#0891B2', accent: '#0891B2', icon: 'flash-outline' },
  maquiagem:    { label: 'Maquiagem',     bg: '#FDF4FF', border: '#C026D3', accent: '#C026D3', icon: 'brush-outline' },
  outros:       { label: 'Outros',        bg: '#F9FAFB', border: '#6B7280', accent: '#6B7280', icon: 'scissors-cutting' },
};

// ── Hook: agendamentos do dia ────────────────────────────────

export function useAgendamentoDia(dia: Date, profissionalFiltro?: string) {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  const chave = format(dia, 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['agenda-dia', empresaId, chave, profissionalFiltro],
    enabled: !!empresaId,
    staleTime: 1000 * 30, // 30s — agenda muda com frequência
    queryFn: async () => {
      let query = supabase
        .from('agendamentos')
        .select(`
          *,
          cliente:users!agendamentos_cliente_id_fkey(id, nome, telefone, foto_url),
          profissional:users!agendamentos_profissional_id_fkey(id, nome, foto_url),
          servico:servicos(id, nome, duracao_minutos, categoria)
        `)
        .eq('empresa_id', empresaId!)
        .gte('data_hora_inicio', startOfDay(dia).toISOString())
        .lte('data_hora_inicio', endOfDay(dia).toISOString())
        .neq('status', 'cancelado')
        .order('data_hora_inicio', { ascending: true });

      if (profissionalFiltro) {
        query = query.eq('profissional_id', profissionalFiltro);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data ?? []).map((ag: any) => ({
        ...ag,
        categoria: resolverCategoria(ag.servico?.categoria),
      })) as AgendamentoCompleto[];
    },
  });
}

// ── Hook: resumo do dia ──────────────────────────────────────

export function useResumoDia(agendamentos: AgendamentoCompleto[]): ResumoDia {
  const total        = agendamentos.length;
  const receita      = agendamentos.reduce((s, a) => s + Number(a.valor), 0);
  const pendentes    = agendamentos.filter((a) => a.status === 'agendado').length;
  const profIds      = new Set(agendamentos.map((a) => a.profissional_id));

  return { total, receita, profissionais: profIds.size, pendentes };
}

// ── Hook: profissionais da empresa ───────────────────────────

export function useProfissionais() {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  return useQuery({
    queryKey: ['profissionais', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('empresa_membros')
        .select('user:users(id, nome, foto_url)')
        .eq('empresa_id', empresaId!)
        .eq('role', 'profissional')
        .eq('ativo', true);

      if (error) throw error;
      return (data ?? []).map((m: any) => m.user as ProfissionalAgenda);
    },
  });
}

// ── Hook: dias com agendamentos no mês (para dots) ───────────

export function useDiasComAgendamento(mes: Date) {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  const chave = format(mes, 'yyyy-MM');

  return useQuery({
    queryKey: ['dias-agendados', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const inicio = new Date(mes.getFullYear(), mes.getMonth(), 1).toISOString();
      const fim    = new Date(mes.getFullYear(), mes.getMonth() + 1, 0, 23, 59).toISOString();

      const { data } = await supabase
        .from('agendamentos')
        .select('data_hora_inicio')
        .eq('empresa_id', empresaId!)
        .neq('status', 'cancelado')
        .gte('data_hora_inicio', inicio)
        .lte('data_hora_inicio', fim);

      const dias = new Set(
        (data ?? []).map((a) => format(new Date(a.data_hora_inicio), 'yyyy-MM-dd'))
      );
      return dias;
    },
  });
}
