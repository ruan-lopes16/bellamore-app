/**
 * Consulta do detalhe financeiro de um atendimento (comanda, itens, pagamentos e os atendimentos
 * fechados na mesma comanda), usada pelo perfil da cliente e pela Agenda. A montagem fica em
 * `atendimento-detalhe.ts` (`montarDetalheAtendimento`). `ClienteDb` é estrutural para shared/ não
 * depender do pacote @supabase/*.
 */
import type { ClienteDb } from './kpis-financeiros-consultas';
import { mensagemErroBanco } from './erros';
import {
  montarDetalheAtendimento, type AgendamentoNaComanda, type ComandaCru, type DetalheAtendimento,
  type ItemComandaCru, type PagamentoCru,
} from './atendimento-detalhe';

type ErroDb = { code?: string; message?: string } | null | undefined;

/**
 * Busca e monta o detalhe de um atendimento. Sem `comandaId` (atendimento ainda não fechado) não
 * consulta nada e devolve `sem_comanda`. Comanda que não volta sem erro = filtrada pelo RLS
 * (`bloqueado_por_rls`). Erro de qualquer consulta LANÇA `Error` em português — nunca devolve
 * comanda vazia, que pareceria "fechada sem itens nem pagamentos".
 *
 * @param db            client do Supabase (web ou app)
 * @param agendamentoId atendimento aberto (null quando a linha é um extra de comanda)
 * @param comandaId     `agendamentos.comanda_id` (ou a comanda do extra)
 */
export async function carregarDetalheAtendimento(
  db: ClienteDb, agendamentoId: string | null, comandaId: string | null,
): Promise<DetalheAtendimento> {
  if (!comandaId) {
    return montarDetalheAtendimento({
      agendamentoId, comandaIdEsperado: null, comanda: null, itens: [], pagamentos: [], agendamentosDaComanda: [],
    });
  }

  const [rComanda, rItens, rPagamentos, rAgs] = await Promise.all([
    db.from('comandas')
      .select('id, valor_total, desconto, desconto_reserva, fechada_at, observacao')
      .eq('id', comandaId).maybeSingle(),
    db.from('comanda_itens')
      .select('id, tipo, descricao, quantidade, valor_unit, profissional:users(nome)')
      .eq('comanda_id', comandaId),
    db.from('pagamentos')
      .select('id, metodo, valor, bandeira, parcelas, taxa_perc, valor_liquido')
      .eq('comanda_id', comandaId),
    db.from('agendamentos')
      .select(`id, data_hora_inicio, valor,
        servico:servicos(nome),
        agendamento_servicos(ordem, servico:servicos(nome)),
        profissional:users!agendamentos_profissional_id_fkey(nome)`)
      .eq('comanda_id', comandaId)
      .order('data_hora_inicio'),
  ]);

  const erro = ([rComanda, rItens, rPagamentos, rAgs] as { error: ErroDb }[]).find((r) => r.error)?.error;
  if (erro) throw new Error(mensagemErroBanco(erro, 'carregar a comanda deste atendimento'));

  return montarDetalheAtendimento({
    agendamentoId,
    comandaIdEsperado: comandaId,
    comanda: (rComanda.data ?? null) as ComandaCru | null,
    itens: (rItens.data ?? []) as ItemComandaCru[],
    pagamentos: (rPagamentos.data ?? []) as PagamentoCru[],
    agendamentosDaComanda: (rAgs.data ?? []) as AgendamentoNaComanda[],
  });
}
