import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { carregarBaseClientes, carregarHistoricoCliente, type ItemHistorico } from '@shared/clientes-consultas';
import { agregarClientes, type Agregado, type ClienteBase } from '@shared/clientes-segmentos';
import { mensagemErroBanco } from '@shared/erros';
import type { Cliente, AnamneseFicha } from '@/types';

// ── Tipos ────────────────────────────────────────────────────

/**
 * Perfil da cliente no app. Histórico e KPIs vêm da fonte única `carregarHistoricoCliente`
 * (a mesma do web). Erro no histórico NÃO derruba o perfil: fica em `erroHistorico`, com
 * `agregado` nulo, para a tela mostrar "—" e um aviso em vez de zeros.
 */
export interface ClienteDetalhe extends Cliente {
  anamnese?: AnamneseFicha;
  /** Mensagem de erro se a ficha de anamnese falhou ao carregar (não permitir edição). */
  erroAnamnese?: string;
  /** Lista única por data: atendimentos, extras de comanda, vendas avulsas e taxas. */
  historico: ItemHistorico[];
  /** Atendimentos, total gasto, última visita e serviço favorito; null se o histórico falhou. */
  agregado: Agregado | null;
  /** Mensagem do erro de carga do histórico (a tela mostra "—", nunca zero). */
  erroHistorico?: string;
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

type ResultadoHistorico =
  | { ok: true; itens: ItemHistorico[]; agregado: Agregado }
  | { ok: false; erro: string };

/**
 * Cliente + ficha de anamnese + histórico único (`carregarHistoricoCliente`, mesma fonte do web).
 * A edição e a anamnese também usam este hook (só leem a cliente e a ficha).
 */
export function useClienteDetalhe(clienteId: string) {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  return useQuery<ClienteDetalhe | null>({
    queryKey: ['cliente-detalhe', empresaId, clienteId],
    enabled: !!empresaId && !!clienteId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const [clienteRes, anamneseRes, historicoRes] = await Promise.all([
        supabase.from('clientes').select('*').eq('id', clienteId).eq('empresa_id', empresaId!).maybeSingle(),
        supabase
          .from('anamnese_fichas')
          .select('*')
          .eq('empresa_id', empresaId!)
          .eq('cliente_id', clienteId)
          .maybeSingle(),
        carregarHistoricoCliente(supabase as any, empresaId!, clienteId)
          .then((h): ResultadoHistorico => ({ ok: true, ...h }))
          .catch((e: unknown): ResultadoHistorico => ({ ok: false, erro: e instanceof Error ? e.message : String(e) })),
      ]);

      // Falha ao ler a cliente não é "não encontrada": vira erro da consulta.
      if (clienteRes.error) throw new Error(mensagemErroBanco(clienteRes.error, 'carregar a cliente'));
      const cliente = clienteRes.data as Cliente | null;
      if (!cliente) return null;

      return {
        ...cliente,
        anamnese: (anamneseRes.data as AnamneseFicha | null) ?? undefined,
        erroAnamnese: anamneseRes.error?.message,
        historico: historicoRes.ok ? historicoRes.itens : [],
        agregado: historicoRes.ok ? historicoRes.agregado : null,
        erroHistorico: historicoRes.ok ? undefined : historicoRes.erro,
      };
    },
  });
}
