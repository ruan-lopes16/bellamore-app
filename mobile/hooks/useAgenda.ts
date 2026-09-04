import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { startOfDay, endOfDay, format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import type { Agendamento } from '@/types';
import { resolverCategoriaServico, type CategoriaCustom } from '@shared/categorias';
import { montarInsertBloqueio, type MontarInsertBloqueioInput } from '@shared/bloqueios';

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
  servico:      { id: string; nome: string; duracao_minutos: number; categoria?: string; categoria_id?: string | null };
  categoria:    CategoriaServico;
  /** Aparência resolvida da categoria (built-in ou personalizada). */
  categoriaResolvida?: { label: string; cor: string; bg: string; iconeCustom?: string; iconeBuiltin?: CategoriaServico };
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

/**
 * Bloqueio de agenda como consumido pelas telas mobile de `(empresa)`.
 * Contrato compartilhado — as telas de bloqueio (lista do dia, pendentes
 * e modal de pedido) importam este tipo daqui.
 */
export interface BloqueioAgenda {
  id: string;
  profissional_id: string | null;
  titulo: string;
  motivo: string | null;
  escopo: 'profissional' | 'geral';
  situacao: 'aprovado' | 'pendente';
  criado_por: string | null;
  data_inicio: string;
  data_fim: string;
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
          servico:servicos(id, nome, duracao_minutos, categoria, categoria_id)
        `)
        .eq('empresa_id', empresaId!)
        .gte('data_hora_inicio', startOfDay(dia).toISOString())
        .lte('data_hora_inicio', endOfDay(dia).toISOString())
        .neq('status', 'cancelado')
        .order('data_hora_inicio', { ascending: true });

      if (profissionalFiltro) {
        query = query.eq('profissional_id', profissionalFiltro);
      }

      const [{ data, error }, { data: cats }] = await Promise.all([
        query,
        supabase.from('categorias_servico').select('*').eq('empresa_id', empresaId!).order('nome'),
      ]);
      if (error) throw error;
      const customs = (cats ?? []) as CategoriaCustom[];

      return (data ?? []).map((ag: any) => {
        const r = resolverCategoriaServico(ag.servico?.categoria, ag.servico?.categoria_id, customs);
        return {
          ...ag,
          categoria: resolverCategoria(ag.servico?.categoria),
          categoriaResolvida: { label: r.label, cor: r.cor, bg: r.bg, iconeCustom: r.iconeCustom, iconeBuiltin: r.iconeBuiltin },
        };
      }) as AgendamentoCompleto[];
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

// ── Bloqueios de agenda ──────────────────────────────────────

/** Colunas de `agenda_bloqueios` que as telas mobile precisam. */
const BLOQUEIO_COLS =
  'id, profissional_id, titulo, motivo, escopo, situacao, criado_por, data_inicio, data_fim';

/**
 * Bloqueios que tocam um dia específico (qualquer situação): o intervalo
 * do bloqueio precisa cruzar o dia inteiro selecionado. Serve para a
 * timeline desenhar as faixas bloqueadas.
 */
export function useBloqueiosDia(dia: Date) {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  const chave = format(dia, 'yyyy-MM-dd');
  return useQuery({
    queryKey: ['bloqueios-dia', empresaId, chave],
    enabled: !!empresaId,
    staleTime: 1000 * 30,
    queryFn: async (): Promise<BloqueioAgenda[]> => {
      const ini = startOfDay(dia).toISOString();
      const fim = endOfDay(dia).toISOString();
      const { data, error } = await supabase
        .from('agenda_bloqueios')
        .select(BLOQUEIO_COLS)
        .eq('empresa_id', empresaId)
        .lte('data_inicio', fim)
        .gte('data_fim', ini);
      if (error) throw error;
      return (data ?? []) as BloqueioAgenda[];
    },
  });
}

/**
 * Bloqueios pendentes de aprovação da empresa ativa, com o nome de quem
 * pediu. Só roda para dona/gestora — quem aprova ou recusa. O nome do
 * autor vem do join de FK; se o PostgREST recusar o alias, cai em
 * "Profissional".
 */
export function useBloqueiosPendentes() {
  const { empresaAtiva, roleAtivo, isOwner } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  const ehGestao = isOwner || roleAtivo === 'gestor';
  return useQuery({
    queryKey: ['bloqueios-pendentes', empresaId],
    enabled: !!empresaId && ehGestao,
    staleTime: 1000 * 30,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agenda_bloqueios')
        .select(`${BLOQUEIO_COLS}, autor:users!agenda_bloqueios_criado_por_fkey(nome)`)
        .eq('empresa_id', empresaId)
        .eq('situacao', 'pendente')
        .order('data_inicio');
      if (error) throw error;
      return ((data ?? []) as any[]).map((b) => ({
        ...(b as BloqueioAgenda),
        autorNome: b.autor?.nome ?? 'Profissional',
      }));
    },
  });
}

/**
 * Cria um bloqueio já coerente com o papel de quem pede (via
 * `montarInsertBloqueio` do shared): dona/gestora nasce aprovado,
 * profissional nasce pendente e sempre no próprio escopo. Lança em erro
 * ou quando o insert não devolve linha (RLS barrou) para a tela avisar.
 */
export function useCriarBloqueio() {
  const { empresaAtiva, user, roleAtivo, isOwner } = useAuthStore();
  const qc = useQueryClient();
  const role = isOwner ? 'owner' : (roleAtivo ?? 'profissional');
  return useMutation({
    mutationFn: async (
      input: Omit<MontarInsertBloqueioInput, 'role' | 'meuUserId' | 'empresaId'>,
    ) => {
      const insert = montarInsertBloqueio({
        ...input,
        role,
        meuUserId: user!.id,
        empresaId: empresaAtiva!.id,
      });
      const { data, error } = await supabase
        .from('agenda_bloqueios')
        .insert(insert)
        .select('id, situacao')
        .single();
      if (error) throw error;
      if (!data) throw new Error('Não foi possível criar o bloqueio.');
      return data as { id: string; situacao: 'aprovado' | 'pendente' };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bloqueios-dia'] });
      qc.invalidateQueries({ queryKey: ['bloqueios-pendentes'] });
    },
  });
}

/**
 * Aprova um bloqueio pendente (dona/gestora). O `.select('id')` depois do
 * `.update()` confirma que a linha existia e a RLS deixou passar — zero
 * linhas vira erro de permissão em vez de sucesso silencioso.
 */
export function useAprovarBloqueio() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('agenda_bloqueios')
        .update({
          situacao: 'aprovado',
          revisado_por: user!.id,
          revisado_em: new Date().toISOString(),
        })
        .eq('id', id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Sem permissão para aprovar.');
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bloqueios-dia'] });
      qc.invalidateQueries({ queryKey: ['bloqueios-pendentes'] });
    },
  });
}

/**
 * Recusa um bloqueio pendente removendo a linha (dona/gestora). Mesmo
 * padrão do aprovar: `.select('id')` depois do `.delete()`, zero linhas
 * vira erro de permissão.
 */
export function useRecusarBloqueio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('agenda_bloqueios')
        .delete()
        .eq('id', id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Sem permissão para recusar.');
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bloqueios-dia'] });
      qc.invalidateQueries({ queryKey: ['bloqueios-pendentes'] });
    },
  });
}
