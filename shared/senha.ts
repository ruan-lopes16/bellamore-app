/**
 * @file senha.ts
 * Regra única de senha nova (web e app): troca logada, aceitar convite e redefinir senha.
 * O Supabase não exige a senha atual: pede-se a nova e, onde há o campo, a confirmação.
 */

/** Tamanho mínimo da senha nova. */
export const SENHA_MINIMA = 8;

const MSG_CURTA = `A senha deve ter pelo menos ${SENHA_MINIMA} caracteres.`;

/** Mensagem de erro em português, ou `null` quando a senha pode ser gravada. */
export function validarNovaSenha(nova: string, confirmacao: string): string | null {
  if (nova.length < SENHA_MINIMA) return MSG_CURTA;
  if (nova !== confirmacao) return 'As senhas não coincidem.';
  return null;
}

/**
 * Campo opcional ("deixe em branco para manter", Configurações do app): vazio = não trocar (`null`);
 * preenchido e curto = erro (nunca ignorado em silêncio).
 */
export function validarSenhaOpcional(nova: string): string | null {
  if (nova.length === 0) return null;
  return nova.length < SENHA_MINIMA ? MSG_CURTA : null;
}
