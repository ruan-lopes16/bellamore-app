/** Erro mínimo devolvido pelo Supabase/PostgREST (`PostgrestError` é compatível). */
type ErroBanco = { code?: string | null; message?: string | null } | null | undefined;

/**
 * Códigos com mensagem própria do projeto: as funções e triggers das migrations levantam a regra
 * já em português (`raise exception` = P0001; `errcode = '22023'` nas validações) — vai para a tela
 * como veio. Os demais conhecidos têm tradução fixa.
 */
const CODIGOS_EM_PORTUGUES = new Set(['P0001', '22023']);

/**
 * Texto técnico do Postgres/PostgREST (inglês): nunca vai para a tela. As mensagens próprias das
 * funções (087, 088, 090, 091, 092) são sempre em português e não casam com isto.
 */
const TEXTO_TECNICO = /row-level security|permission denied|violates|violation|duplicate key|constraint|does not exist|syntax error|invalid input|null value|must be owner|policy|column|relation|function|table/i;

/** Palavras que denunciam texto próprio em português (as funções sempre as usam nas recusas 42501). */
const EM_PORTUGUES = /(você|não|sem permissão|permissão para|sessão)/i;

/** Erros do Postgres/PostgREST que chegam em inglês: tradução fixa (o texto técnico fica no console). */
export const MENSAGENS_CODIGO_BANCO: Record<string, string> = {
  PGRST301: 'Sua sessão expirou. Entre de novo.',
  '22P02': 'Dado inválido enviado ao banco.',
  '23505': 'Registro duplicado.',
  '23503': 'Este registro está ligado a outro que não existe mais (ou não pode ser removido).',
  '23514': 'Algum valor está fora do permitido.',
  '57014': 'O banco demorou demais para responder. Confira antes de repetir.',
};

/**
 * Converte um erro do banco em mensagem para a tela.
 * - Recusas de permissão (RLS ou trigger com `errcode 42501`) chegam do Postgres em inglês técnico
 *   ("new row violates row-level security policy...") — viram um aviso em português dizendo o que a
 *   pessoa tentou fazer.
 * - Mensagens de regra das funções (P0001, 22023) e recusas 42501 com texto próprio mantêm o texto
 *   original, já em português; texto técnico em inglês (mesmo nesses códigos) nunca aparece.
 * - Códigos conhecidos (`MENSAGENS_CODIGO_BANCO`, ex.: PGRST301 = sessão expirada) têm tradução fixa.
 * - Qualquer outro código vira uma mensagem genérica; o texto técnico vai só para o console.
 * - Sem código (erro montado na tela ou falha de rede): mantém a mensagem.
 *
 * @param erro  erro retornado pelo Supabase (ou null)
 * @param acao  o que a pessoa tentou, no infinitivo — ex.: "cadastrar cliente"
 */
export function mensagemErroBanco(erro: ErroBanco, acao: string): string {
  if (!erro) return `Não foi possível ${acao}.`;
  const msg = erro.message ?? '';
  const propria = msg.trim() !== '' && !TEXTO_TECNICO.test(msg);
  // Recusa de permissão: a função que levantou 42501 com texto próprio (ex.: "Você não tem permissão
  // para registrar vendas avulsas.") fala por si; RLS/permission denied cru vira o aviso genérico.
  if (erro.code === '42501' && propria && EM_PORTUGUES.test(msg)) return msg.trim();
  if (erro.code === '42501' || /row-level security/i.test(msg)) {
    return `Você não tem permissão para ${acao}. Fale com a dona ou a gestora.`;
  }
  const code = erro.code ?? '';
  if (!code) return msg || `Não foi possível ${acao}.`;
  if (CODIGOS_EM_PORTUGUES.has(code) && propria) return msg;
  const traduzida = MENSAGENS_CODIGO_BANCO[code];
  if (traduzida) return traduzida;
  console.error(`Erro do banco ao ${acao} (${code}):`, msg);
  return `Não foi possível ${acao}. Tente de novo; se continuar, fale com o suporte.`;
}
