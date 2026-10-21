/**
 * Acesso ao banco da Agenda compartilhado por web e app: preferência de abertura da agenda e
 * avaliação do atendimento (migration 094). `ClienteDb` é estrutural para shared/ não depender do
 * pacote @supabase/*. Toda função LANÇA `Error` com a mensagem em português para a tela.
 */
import type { ClienteDb } from './kpis-financeiros-consultas';
import { mensagemErroBanco } from './erros';

/** Client com `rpc` (web: @supabase/ssr; mobile: @supabase/supabase-js). */
export type ClienteDbAgenda = ClienteDb & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any;
};

/** Onde a agenda abre: só na própria pessoa ou em "Todas as profissionais". */
export type PreferenciaAgenda = 'propria' | 'todas';

type ErroDb = { code?: string | null; message?: string | null } | null | undefined;

/** Coluna `agenda_abre_em` ainda não criada (sem a 094): Postgres 42703 ou PostgREST PGRST204. */
const colunaInexistente = (e: ErroDb) => e?.code === '42703' || e?.code === 'PGRST204';

/** Mensagem quando a função da 094 ainda não existe no banco. */
export const MENSAGEM_SEM_094 = 'Atualização do banco pendente: peça para rodar a migration 094.';

/**
 * Preferência de abertura da agenda da pessoa na empresa (`empresa_membros.agenda_abre_em`).
 * Sem linha ou valor desconhecido, devolve `'propria'`. Sem a 094 (coluna inexistente) devolve `null`
 * (as telas escondem o campo e abrem na própria pessoa). Outros erros lançam.
 *
 * @param db        client do Supabase
 * @param empresaId empresa ativa
 * @param userId    `auth.uid()` da pessoa logada
 */
export async function carregarPreferenciaAgenda(db: ClienteDb, empresaId: string, userId: string): Promise<PreferenciaAgenda | null> {
  const { data, error } = await db.from('empresa_membros')
    .select('agenda_abre_em')
    .eq('empresa_id', empresaId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    if (colunaInexistente(error)) return null;
    throw new Error(mensagemErroBanco(error, 'carregar a preferência da agenda'));
  }
  return (data as { agenda_abre_em?: unknown } | null)?.agenda_abre_em === 'todas' ? 'todas' : 'propria';
}

/**
 * Grava a preferência pela função `salvar_preferencia_agenda` (094): só a linha da própria pessoa,
 * e `'todas'` só com `agenda.ver_equipe` (conferido no banco). Sem a 094 (`PGRST202`) lança
 * `MENSAGEM_SEM_094`.
 */
export async function salvarPreferenciaAgenda(db: ClienteDbAgenda, empresaId: string, valor: PreferenciaAgenda): Promise<void> {
  const { error } = await db.rpc('salvar_preferencia_agenda', { p_empresa: empresaId, p_valor: valor });
  if (!error) return;
  if (error.code === 'PGRST202') throw new Error(MENSAGEM_SEM_094);
  throw new Error(mensagemErroBanco(error, 'salvar a preferência da agenda'));
}

/**
 * Cria ou edita a avaliação (1 a 5) de um atendimento — uma por atendimento (`agendamento_id` é
 * único). Nunca manda `profissional_id`: o trigger da 094 preenche com o vínculo da profissional do
 * atendimento e confere empresa e cliente. Confere o erro e as linhas (0 linhas = RLS recusou).
 */
export async function salvarAvaliacao(
  db: ClienteDb,
  d: { empresaId: string; agendamentoId: string; clienteId: string; nota: number; comentario?: string | null },
): Promise<void> {
  if (!Number.isInteger(d.nota) || d.nota < 1 || d.nota > 5) throw new Error('Escolha uma nota de 1 a 5.');
  const comentario = (d.comentario ?? '').trim();
  const { data, error } = await db.from('avaliacoes')
    .upsert({
      empresa_id:     d.empresaId,
      agendamento_id: d.agendamentoId,
      cliente_id:     d.clienteId,
      nota:           d.nota,
      comentario:     comentario || null,
    }, { onConflict: 'agendamento_id' })
    .select('id');
  if (error) throw new Error(mensagemErroBanco(error, 'salvar a avaliação'));
  if (!data || (data as unknown[]).length === 0) throw new Error(mensagemErroBanco({ code: '42501' }, 'salvar a avaliação'));
}
