import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { buscarTodasPaginas } from '@shared/paginacao';
import { valorCobradoAtendimento } from '@shared/kpis-financeiros';
import { carregarBaseClientes } from '@shared/clientes-consultas';
import { agregarClientes, type Agregado, type ClienteBase } from '@shared/clientes-segmentos';
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

/** Base da lista: clientes (ativas e arquivadas) e o agregado de cada uma (atendimentos, gasto, última visita). */
export interface BaseListaClientes {
  clientes: ClienteBase[];
  agregados: Map<string, Agregado>;
}

/**
 * Carrega a base de clientes UMA vez (mesma consulta do web, `carregarBaseClientes`). Busca e filtros
 * rodam no cliente com `filtrarClientes`/`contarSegmentos`, sem refazer consulta a cada tecla.
 */
export function useClientes() {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  return useQuery<BaseListaClientes>({
    queryKey: ['clientes', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 3,
    queryFn: async () => {
      const base = await carregarBaseClientes(supabase as any, empresaId!);
      return { clientes: base.clientes, agregados: agregarClientes(base.atendimentos, base.extras, base.vendas) };
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
            .order('id')
            .range(from, to) as any
        ),
        // Servicos lancados direto na comanda (cliente sem hora marcada) — o web
        // ja contava como visita; sem isso os totais divergem entre plataformas.
        buscarTodasPaginas<any>((from, to) =>
          supabase
            .from('comanda_itens')
            .select(`*,
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
      // Valor cobrado (com a parte do desconto da comanda, 090), igual ao Financeiro.
      const totalGasto = linhasDeVisita.reduce((acc: number, a: any) => acc + valorCobradoAtendimento(a), 0);
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
