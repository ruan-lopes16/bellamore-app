import { useQuery } from '@tanstack/react-query';
import { subDays, startOfDay } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import type { User, AnamneseFicha, Agendamento } from '@/types';

// ── Tipos ────────────────────────────────────────────────────

export type ClienteTag = 'vip' | 'nova' | 'recorrente' | 'sumida';

export interface ClienteResumo extends User {
  telefone: string;
  data_nascimento?: string;
  total_gasto: number;
  total_visitas: number;
  ultima_visita: string | null;
  tags: ClienteTag[];
}

export interface ClienteDetalhe extends ClienteResumo {
  email?: string;
  endereco?: string;
  anamnese?: AnamneseFicha;
  historico?: (Agendamento & {
    servico: { nome: string };
    profissional: { nome: string };
  })[];
}

// ── Helpers ──────────────────────────────────────────────────

function calcularTags(
  totalVisitas: number,
  totalGasto: number,
  ultimaVisita: string | null
): ClienteTag[] {
  const tags: ClienteTag[] = [];
  const diasSemVisita = ultimaVisita
    ? Math.floor((Date.now() - new Date(ultimaVisita).getTime()) / 86400000)
    : 999;

  if (totalGasto >= 2000 || totalVisitas >= 20) tags.push('vip');
  if (totalVisitas === 1) tags.push('nova');
  else if (totalVisitas >= 5 && diasSemVisita <= 45) tags.push('recorrente');
  if (diasSemVisita > 60 && totalVisitas > 1) tags.push('sumida');

  return tags;
}

// ── Lista de clientes ────────────────────────────────────────

export type FiltroClientes = 'todas' | 'retornos' | 'sumidas' | 'aniversarios';

export function useClientes(filtro: FiltroClientes = 'todas', busca = '') {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  return useQuery({
    queryKey: ['clientes', empresaId, filtro, busca],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 3,
    queryFn: async () => {
      // Busca membros com role 'cliente' da empresa
      const { data: membros, error } = await supabase
        .from('empresa_membros')
        .select('user_id')
        .eq('empresa_id', empresaId!)
        .eq('role', 'cliente')
        .eq('ativo', true);

      if (error) throw error;
      if (!membros?.length) return [];

      const clienteIds = membros.map((m) => m.user_id);

      // Busca dados dos usuários
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('*')
        .in('id', clienteIds);

      if (usersError) throw usersError;

      // Busca agregados de agendamentos por cliente
      const { data: agendamentos } = await supabase
        .from('agendamentos')
        .select('cliente_id, valor, data_hora_inicio, status')
        .eq('empresa_id', empresaId!)
        .in('cliente_id', clienteIds)
        .eq('status', 'concluido');

      // Agrega por cliente
      const agregado: Record<string, { total: number; visitas: number; ultima: string | null }> = {};

      agendamentos?.forEach((a) => {
        if (!agregado[a.cliente_id]) {
          agregado[a.cliente_id] = { total: 0, visitas: 0, ultima: null };
        }
        agregado[a.cliente_id].total += Number(a.valor);
        agregado[a.cliente_id].visitas += 1;
        if (!agregado[a.cliente_id].ultima || a.data_hora_inicio > agregado[a.cliente_id].ultima!) {
          agregado[a.cliente_id].ultima = a.data_hora_inicio;
        }
      });

      // Monta lista final com tags
      let clientes: ClienteResumo[] = (users ?? []).map((u) => {
        const ag = agregado[u.id] ?? { total: 0, visitas: 0, ultima: null };
        return {
          ...u,
          total_gasto: ag.total,
          total_visitas: ag.visitas,
          ultima_visita: ag.ultima,
          tags: calcularTags(ag.visitas, ag.total, ag.ultima),
        };
      });

      // Filtros
      if (busca) {
        const b = busca.toLowerCase();
        clientes = clientes.filter(
          (c) => c.nome.toLowerCase().includes(b) || c.telefone?.includes(b)
        );
      }

      if (filtro === 'sumidas') {
        clientes = clientes.filter((c) => c.tags.includes('sumida'));
      } else if (filtro === 'retornos') {
        // Clientes que vieram nos últimos 30 dias
        const limite = subDays(new Date(), 30).toISOString();
        clientes = clientes.filter(
          (c) => c.ultima_visita && c.ultima_visita >= limite
        );
      } else if (filtro === 'aniversarios') {
        // Filtra por mês/dia de nascimento (simplificado)
        const hoje = new Date();
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        const dia = String(hoje.getDate()).padStart(2, '0');
        clientes = clientes.filter((c) => {
          if (!c.data_nascimento) return false;
          const [, m, d] = c.data_nascimento.split('-');
          return m === mes && d === dia;
        });
      }

      // Ordena: VIPs primeiro, depois por nome
      return clientes.sort((a, b) => {
        const aVip = a.tags.includes('vip') ? 0 : 1;
        const bVip = b.tags.includes('vip') ? 0 : 1;
        if (aVip !== bVip) return aVip - bVip;
        return a.nome.localeCompare(b.nome);
      });
    },
  });
}

// ── Stats de clientes ────────────────────────────────────────

export function useClientesStats() {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  return useQuery({
    queryKey: ['clientes-stats', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const { data: membros } = await supabase
        .from('empresa_membros')
        .select('user_id, created_at')
        .eq('empresa_id', empresaId!)
        .eq('role', 'cliente')
        .eq('ativo', true);

      if (!membros?.length) return { total: 0, novasMes: 0, sumidas: 0 };

      const clienteIds = membros.map((m) => m.user_id);
      const inicioMes = startOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1)).toISOString();

      const novasMes = membros.filter((m) => m.created_at >= inicioMes).length;

      // Sumidas: sem visita há mais de 60 dias
      const limite60 = subDays(new Date(), 60).toISOString();
      const { data: recentes } = await supabase
        .from('agendamentos')
        .select('cliente_id')
        .eq('empresa_id', empresaId!)
        .in('cliente_id', clienteIds)
        .gte('data_hora_inicio', limite60)
        .eq('status', 'concluido');

      const idsRecentes = new Set(recentes?.map((a) => a.cliente_id) ?? []);
      const sumidas = clienteIds.filter((id) => !idsRecentes.has(id)).length;

      return { total: membros.length, novasMes, sumidas };
    },
  });
}

// ── Detalhe de um cliente ────────────────────────────────────

export function useClienteDetalhe(clienteId: string) {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  return useQuery({
    queryKey: ['cliente-detalhe', empresaId, clienteId],
    enabled: !!empresaId && !!clienteId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const [userRes, agRes, anamneseRes] = await Promise.all([
        supabase.from('users').select('*').eq('id', clienteId).single(),
        supabase
          .from('agendamentos')
          .select(`*, servico:servicos(nome), profissional:users!agendamentos_profissional_id_fkey(nome)`)
          .eq('empresa_id', empresaId!)
          .eq('cliente_id', clienteId)
          .neq('status', 'cancelado')
          .order('data_hora_inicio', { ascending: false })
          .limit(20),
        supabase
          .from('anamnese_fichas')
          .select('*')
          .eq('empresa_id', empresaId!)
          .eq('cliente_id', clienteId)
          .single(),
      ]);

      const user = userRes.data;
      const agendamentos = agRes.data ?? [];
      const anamnese = anamneseRes.data;

      const concluidos = agendamentos.filter((a) => a.status === 'concluido');
      const totalGasto = concluidos.reduce((acc, a) => acc + Number(a.valor), 0);
      const ultimaVisita = concluidos[0]?.data_hora_inicio ?? null;

      return {
        ...user,
        total_gasto: totalGasto,
        total_visitas: concluidos.length,
        ultima_visita: ultimaVisita,
        tags: calcularTags(concluidos.length, totalGasto, ultimaVisita),
        historico: agendamentos,
        anamnese,
      } as ClienteDetalhe;
    },
  });
}
