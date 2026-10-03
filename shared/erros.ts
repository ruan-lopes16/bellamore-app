/** Erro mínimo devolvido pelo Supabase/PostgREST (`PostgrestError` é compatível). */
type ErroBanco = { code?: string | null; message?: string | null } | null | undefined;

/**
 * Converte um erro do banco em mensagem para a tela.
 * Recusas de permissão (RLS ou trigger com `errcode 42501`) chegam do Postgres
 * em inglês técnico ("new row violates row-level security policy...") —
 * aqui viram um aviso em português dizendo o que a pessoa tentou fazer.
 * Qualquer outro erro mantém a mensagem original.
 *
 * @param erro  erro retornado pelo Supabase (ou null)
 * @param acao  o que a pessoa tentou, no infinitivo — ex.: "cadastrar cliente"
 */
export function mensagemErroBanco(erro: ErroBanco, acao: string): string {
  if (!erro) return `Não foi possível ${acao}.`;
  const msg = erro.message ?? '';
  if (erro.code === '42501' || /row-level security/i.test(msg)) {
    return `Você não tem permissão para ${acao}. Fale com a dona ou a gestora.`;
  }
  return msg || `Não foi possível ${acao}.`;
}
