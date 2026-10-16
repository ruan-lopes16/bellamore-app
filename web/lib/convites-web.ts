/** Textos das telas do web para convite com aceite (Entrega 3). */

/** Resposta `convite_pendente` da API: a conta já existe e precisa aceitar. */
export const MENSAGEM_CONVITE_PENDENTE =
  'Convite enviado. A pessoa já tem conta e precisa aceitar o convite ao entrar no app.';

/**
 * Mensagem de sucesso depois de cadastrar/convidar na Equipe, conforme o `status` da API.
 * `undefined` = sem toast (conta nova com senha mostra as credenciais).
 */
export function mensagemCadastroEquipe(status: string | undefined, nome: string): string | undefined {
  if (status === 'convite_pendente') return MENSAGEM_CONVITE_PENDENTE;
  if (status === 'convite_enviado') return `Convite enviado! ${nome} vai receber um e-mail para criar a senha.`;
  if (status === 'adicionado') return `${nome} já tinha conta e foi adicionada à equipe.`;
  return undefined;
}
