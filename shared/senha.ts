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
 * Senha de acesso sem confirmação no mesmo passo: cadastro (a confirmação é conferida à parte),
 * senha definida pela dona na Equipe e `POST /api/profissionais` (servidor). Mesmo mínimo.
 */
export function validarSenhaMinima(senha: string): string | null {
  return senha.length < SENHA_MINIMA ? MSG_CURTA : null;
}

/**
 * Campo opcional ("deixe em branco para manter", Configurações do app): vazio = não trocar (`null`);
 * preenchido e curto = erro (nunca ignorado em silêncio).
 */
export function validarSenhaOpcional(nova: string): string | null {
  if (nova.length === 0) return null;
  return nova.length < SENHA_MINIMA ? MSG_CURTA : null;
}

/**
 * Campo opcional com confirmação (Configurações do app): os dois vazios = não trocar (`null`);
 * qualquer um preenchido segue a regra da senha nova (mínimo e confirmação iguais), como no web.
 */
export function validarSenhaOpcionalComConfirmacao(nova: string, confirmacao: string): string | null {
  if (nova.length === 0 && confirmacao.length === 0) return null;
  return validarNovaSenha(nova, confirmacao);
}
