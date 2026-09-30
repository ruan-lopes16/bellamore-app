import { useQuery } from '@tanstack/react-query';
import { subDays, startOfDay } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { buscarTodasPaginas } from '@shared/paginacao';
import type { Cliente, AnamneseFicha, Agendamento, TaxaCancelamento, TaxaReserva } from '@/types';

// ── Tipos ────────────────────────────────────────────────────

export type ClienteTag = 'vip' | 'nova' | 'recorrente' | 'sumida';

export interface ClienteResumo extends Cliente {
  total_gasto: number;
  total_visitas: number;
  ultima_visita: string | null;
  tags: ClienteTag[];
}

export interface ClienteDetalhe extends ClienteResumo {
  anamnese?: AnamneseFicha;
  /** Mensagem de erro se a ficha de anamnese falhou ao carregar (não permitir edição). */
  erroAnamnese?: string;
  historico?: (Agendamento & {
    servico: { nome: string };
    profissional: { nome: string };
  })[];
  taxasCancelamento?: TaxaCancelamento[];
  taxasReserva?: TaxaReserva[];
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
      const { data: base, error } = await supabase
        .from('clientes')
        .select('*')
        .eq('empresa_id', empresaId!)
        .eq('ativo', true)
        .order('nome');
      if (error) throw error;
      if (!base?.length) return [];

      const clienteIds = base.map((c) => c.id);

      // Agregados de atendimentos concluídos, paginados (PostgREST corta em 1000).
      const agendamentos = await buscarTodasPaginas<{ cliente_id: string; valor: number; data_hora_inicio: string }>(
        (from, to) => supabase
          .from('agendamentos')
          .select('cliente_id, valor, data_hora_inicio')
          .eq('empresa_id', empresaId!)
          .eq('status', 'concluido')
          .not('cliente_id', 'is', null)
          .order('data_hora_inicio')
          .range(from, to) as any,
      );

      // Agrega por cliente
      const agregado: Record<string, { total: number; visitas: number; ultima: string | null }> = {};

      const idsValidos = new Set(clienteIds);
      agendamentos.forEach((a) => {
        if (!idsValidos.has(a.cliente_id)) return;
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
      let clientes: ClienteResumo[] = base.map((u) => {
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
          (c) => c.nome.toLowerCase().includes(b) || (c.telefone ?? '').includes(b) || (c.email ?? '').toLowerCase().includes(b),
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
      const { data: base } = await supabase
        .from('clientes')
        .select('id, created_at')
        .eq('empresa_id', empresaId!)
        .eq('ativo', true);

      if (!base?.length) return { total: 0, novasMes: 0, sumidas: 0 };
      const clienteIds = base.map((c) => c.id);
      const inicioMes = startOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1)).toISOString();
      const novasMes = base.filter((c) => c.created_at >= inicioMes).length;

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

      return { total: base.length, novasMes, sumidas };
    },
  });
}

// ── Detalhe de um cliente ────────────────────────────────────

export function useClienteDetalhe(clienteId: string) {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  return useQuery<ClienteDetalhe | null>({
    queryKey: ['cliente-detalhe', empresaId, clienteId],
    enabled: !!empresaId && !!clienteId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const [userRes, agLinhas, comandaItens, anamneseRes, taxasRes, reservaRes] = await Promise.all([
        supabase.from('clientes').select('*').eq('id', clienteId).eq('empresa_id', empresaId!).maybeSingle(),
        buscarTodasPaginas<any>((from, to) =>
          supabase
            .from('agendamentos')
            .select(`*, comanda_id,
              servico:servicos(nome),
              agendamento_servicos(ordem, servico:servicos(nome)),
              profissional:users!agendamentos_profissional_id_fkey(nome)`)
            .eq('empresa_id', empresaId!)
            .eq('cliente_id', clienteId)
            .order('data_hora_inicio', { ascending: false })
            .range(from, to) as any
        ),
        // Servicos lancados direto na comanda (cliente sem hora marcada) — o web
        // ja contava como visita; sem isso os totais divergem entre plataformas.
        buscarTodasPaginas<any>((from, to) =>
          supabase
            .from('comanda_itens')
            .select(`id, comanda_id, descricao, valor_unit, quantidade, created_at,
              servico:servicos(nome),
              profissional:users(nome),
              comanda:comandas!inner(fechada_at, clientes_id)`)
            .eq('tipo', 'servico')
            .eq('comanda.clientes_id', clienteId)
            .order('created_at', { ascending: false })
            .range(from, to) as any
        ),
        supabase
          .from('anamnese_fichas')
          .select('*')
          .eq('empresa_id', empresaId!)
          .eq('cliente_id', clienteId)
          .maybeSingle(),
        supabase
          .from('taxas_cancelamento')
          .select('*')
          .eq('empresa_id', empresaId!)
          .eq('cliente_id', clienteId)
          .neq('status', 'cancelada')
          .order('created_at', { ascending: false }),
        supabase
          .from('taxas_reserva')
          .select('*')
          .eq('empresa_id', empresaId!)
          .eq('cliente_id', clienteId)
          .neq('status', 'cancelada')   // encerradas ao concluir o atendimento (migration 061)
          .order('created_at', { ascending: false }),
      ]);

      const user = userRes.data;
      if (!user) return null;
      const agendamentos = agLinhas;
      const anamnese = anamneseRes.data ?? undefined;
      const erroAnamnese = anamneseRes.error?.message;

      // Extras de comanda (servico lancado sem hora marcada) tambem sao visita —
      // e a lista nao e mais truncada, entao os totais batem com os do web.
      const extrasDeComanda = comandaItens.map((cs: any) => ({
        ...cs,
        status: 'concluido',
        valor: Number(cs.valor_unit) * Number(cs.quantidade),
        data_hora_inicio: cs.comanda?.fechada_at ?? cs.created_at,
        eExtraDeComanda: true,
      }));

      const historicoCompleto = [...agendamentos, ...extrasDeComanda]
        .sort((a: any, b: any) => String(b.data_hora_inicio).localeCompare(String(a.data_hora_inicio)));

      const linhasDeVisita = historicoCompleto.filter((a: any) => a.status === 'concluido');
      const totalGasto = linhasDeVisita.reduce((acc: number, a: any) => acc + Number(a.valor ?? 0), 0);
      const ultimaVisita = linhasDeVisita[0]?.data_hora_inicio ?? null;

      return {
        ...user,
        total_gasto: totalGasto,
        total_visitas: linhasDeVisita.length,
        ultima_visita: ultimaVisita,
        tags: calcularTags(linhasDeVisita.length, totalGasto, ultimaVisita),
        historico: historicoCompleto,
        anamnese,
        erroAnamnese,
        taxasCancelamento: (taxasRes.data ?? []) as TaxaCancelamento[],
        taxasReserva: (reservaRes.data ?? []) as TaxaReserva[],
      } as ClienteDetalhe;
    },
  });
}
