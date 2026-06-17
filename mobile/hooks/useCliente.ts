import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { CATEGORIA_CONFIG } from '@/hooks/useAgenda';
import type { Servico } from '@/types';

// ── Stats da cliente na empresa ──────────────────────────────

export interface ClienteHomeStats {
  totalVisitas: number;
  totalGasto: number;
  ultimaVisita: string | null;
  membroDesde: string | null;
}

export function useClienteHomeStats() {
  const { user, empresaAtiva } = useAuthStore();
  const userId    = user?.id;
  const empresaId = empresaAtiva?.id;

  return useQuery({
    queryKey: ['cliente-home-stats', userId, empresaId],
    enabled: !!userId && !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const [agRes, membroRes] = await Promise.all([
        supabase
          .from('agendamentos')
          .select('valor, data_hora_inicio, status')
          .eq('empresa_id', empresaId!)
          .eq('cliente_id', userId!)
          .eq('status', 'concluido')
          .order('data_hora_inicio', { ascending: false }),
        supabase
          .from('empresa_membros')
          .select('created_at')
          .eq('empresa_id', empresaId!)
          .eq('user_id', userId!)
          .single(),
      ]);

      const ags = agRes.data ?? [];
      const totalVisitas = ags.length;
      const totalGasto   = ags.reduce((s, a) => s + Number(a.valor), 0);
      const ultimaVisita = ags[0]?.data_hora_inicio ?? null;
      const membroDesde  = membroRes.data?.created_at ?? null;

      return { totalVisitas, totalGasto, ultimaVisita, membroDesde } as ClienteHomeStats;
    },
  });
}

// ── Histórico de atendimentos da cliente ─────────────────────

export interface HistoricoItem {
  id: string;
  data_hora_inicio: string;
  valor: number;
  status: string;
  servico: { nome: string; categoria?: string };
  profissional: { nome: string };
  categoriaCor: string;
}

export interface HistoricoMes {
  mesLabel: string;
  itens: HistoricoItem[];
}

export interface HistoricoResumo {
  totalGasto: number;
  totalVisitas: number;
  ticketMedio: number;
  ultimaVisita: string | null;
  membroDesde: string | null;
  meses: HistoricoMes[];
}

export function useHistoricoCliente() {
  const { user, empresaAtiva } = useAuthStore();
  const userId    = user?.id;
  const empresaId = empresaAtiva?.id;

  return useQuery({
    queryKey: ['cliente-historico', userId, empresaId],
    enabled: !!userId && !!empresaId,
    staleTime: 1000 * 60 * 3,
    queryFn: async () => {
      const [agRes, membroRes] = await Promise.all([
        supabase
          .from('agendamentos')
          .select(`
            id, data_hora_inicio, valor, status,
            servico:servicos(nome, categoria),
            profissional:users!agendamentos_profissional_id_fkey(nome)
          `)
          .eq('empresa_id', empresaId!)
          .eq('cliente_id', userId!)
          .eq('status', 'concluido')
          .order('data_hora_inicio', { ascending: false }),
        supabase
          .from('empresa_membros')
          .select('created_at')
          .eq('empresa_id', empresaId!)
          .eq('user_id', userId!)
          .single(),
      ]);

      const ags = (agRes.data ?? []) as any[];
      const totalVisitas = ags.length;
      const totalGasto   = ags.reduce((s, a) => s + Number(a.valor), 0);
      const ticketMedio  = totalVisitas > 0 ? Math.round(totalGasto / totalVisitas) : 0;
      const ultimaVisita = ags[0]?.data_hora_inicio ?? null;
      const membroDesde  = membroRes.data?.created_at ?? null;

      // Agrupa por mês
      const porMes: Record<string, HistoricoItem[]> = {};
      ags.forEach((a) => {
        const chave = format(new Date(a.data_hora_inicio), 'yyyy-MM');
        if (!porMes[chave]) porMes[chave] = [];
        porMes[chave].push({
          id: a.id,
          data_hora_inicio: a.data_hora_inicio,
          valor: Number(a.valor),
          status: a.status,
          servico: a.servico ?? { nome: 'Serviço' },
          profissional: a.profissional ?? { nome: 'Profissional' },
          categoriaCor: CATEGORIA_CONFIG[a.servico?.categoria as keyof typeof CATEGORIA_CONFIG]?.border ?? '#9B6FE8',
        });
      });

      const meses: HistoricoMes[] = Object.entries(porMes).map(([chave, itens]) => ({
        mesLabel: format(new Date(chave + '-01'), "MMMM yyyy", { locale: ptBR })
          .replace(/^\w/, (c) => c.toUpperCase()),
        itens,
      }));

      return { totalGasto, totalVisitas, ticketMedio, ultimaVisita, membroDesde, meses } as HistoricoResumo;
    },
  });
}

// ── Anamnese do próprio cliente ──────────────────────────────

export function useAnamneseCliente() {
  const { user, empresaAtiva } = useAuthStore();
  const userId    = user?.id;
  const empresaId = empresaAtiva?.id;

  return useQuery({
    queryKey: ['cliente-anamnese', userId, empresaId],
    enabled: !!userId && !!empresaId,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const { data } = await supabase
        .from('anamnese_fichas')
        .select('*')
        .eq('empresa_id', empresaId!)
        .eq('cliente_id', userId!)
        .single();
      return data ?? null;
    },
  });
}

// ── Serviços da empresa (visão cliente) ──────────────────────

export interface ServicoCliente extends Servico {
  categoriaCor: string;
}

export function useServicosEmpresa() {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  return useQuery({
    queryKey: ['servicos-empresa', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('servicos')
        .select('*')
        .eq('empresa_id', empresaId!)
        .eq('ativo', true)
        .order('categoria')
        .order('nome');

      if (error) throw error;

      return (data ?? []).map((s) => ({
        ...s,
        categoriaCor: CATEGORIA_CONFIG[s.categoria as keyof typeof CATEGORIA_CONFIG]?.border ?? '#9B6FE8',
      })) as ServicoCliente[];
    },
  });
}
