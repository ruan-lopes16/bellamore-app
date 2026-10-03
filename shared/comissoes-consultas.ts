/**
 * @file comissoes-consultas.ts
 * Consultas ÚNICAS de comissões (web e mobile). Lançam erro na leitura; o
 * pagamento devolve o que o banco confirmou (RLS pode aceitar 0 linhas).
 */
import { buscarTodasOuLancar, type ClienteDb } from './kpis-financeiros-consultas';
import type { Limites } from './periodos';
import type { ComissaoDetalheRow } from './comissoes';

export const COLUNAS_COMISSAO_DETALHE = `id, profissional_id, agendamento_id, valor_servico, percentual, valor_comissao, status, created_at,
  profissional:users!comissoes_profissional_id_fkey(nome),
  agendamento:agendamentos(data_hora_inicio, valor,
    servico:servicos(nome, categoria, categoria_id),
    cliente:clientes!agendamentos_cliente_id_fkey(nome))`;

/** Comissões geradas no período (created_at), mais recentes primeiro. `profissionalId` = tela da profissional. */
export async function carregarComissoesDoPeriodo(
  db: ClienteDb, empresaId: string, l: Limites, opcoes: { profissionalId?: string } = {},
): Promise<ComissaoDetalheRow[]> {
  return buscarTodasOuLancar<ComissaoDetalheRow>((de, ate) => {
    let q = db.from('comissoes').select(COLUNAS_COMISSAO_DETALHE)
      .eq('empresa_id', empresaId)
      .gte('created_at', l.startIso).lte('created_at', l.endIso);
    if (opcoes.profissionalId) q = q.eq('profissional_id', opcoes.profissionalId);
    return q.order('created_at', { ascending: false }).order('id').range(de, ate);
  });
}

export type ResultadoPagamento = { confirmados: string[]; naoConfirmados: string[]; erro: string | null };

const LOTE_PAGAMENTO = 150;

/**
 * Marca como pagas as comissões `ids` (as pendentes do período exibido).
 * Só toca pendentes da empresa e confere as linhas devolvidas. Para no
 * primeiro erro; o que não foi confirmado volta em `naoConfirmados`.
 */
export async function pagarComissoes(db: ClienteDb, empresaId: string, ids: string[]): Promise<ResultadoPagamento> {
  const unicos = [...new Set(ids)];
  const confirmados: string[] = [];
  let erro: string | null = null;
  for (let i = 0; i < unicos.length && !erro; i += LOTE_PAGAMENTO) {
    const lote = unicos.slice(i, i + LOTE_PAGAMENTO);
    try {
      const { data, error } = await db.from('comissoes')
        .update({ status: 'pago' })
        .in('id', lote)
        .eq('empresa_id', empresaId)
        .eq('status', 'pendente')
        .select('id');
      if (error) { erro = error.message; break; }
      for (const r of (data ?? []) as { id: string }[]) confirmados.push(r.id);
    } catch (e) {
      erro = (e as Error).message || 'erro desconhecido';
    }
  }
  const ok = new Set(confirmados);
  return { confirmados, naoConfirmados: unicos.filter(id => !ok.has(id)), erro };
}
