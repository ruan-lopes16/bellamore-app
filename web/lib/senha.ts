/**
 * @file senha.ts
 * Regra da troca de senha logada (Configurações → Meu perfil). O Supabase não exige a senha
 * atual: pede-se a nova e a confirmação.
 */

/** Tamanho mínimo da senha nova. */
export const SENHA_MINIMA = 8;

/** Mensagem de erro em português, ou `null` quando a senha pode ser gravada. */
export function validarNovaSenha(nova: string, confirmacao: string): string | null {
  if (nova.length < SENHA_MINIMA) return `A senha deve ter pelo menos ${SENHA_MINIMA} caracteres.`;
  if (nova !== confirmacao) return 'As senhas não coincidem.';
  return null;
}
