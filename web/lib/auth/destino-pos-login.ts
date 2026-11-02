/**
 * @file destino-pos-login.ts
 * Para onde a pessoa vai depois de entrar pelo link do e-mail (`/auth/callback`) e o link que
 * o cadastro/verificar-email mandam. Só caminhos internos (`nextSeguro` de shared).
 */
import { ehCaminhoInterno, nextSeguro } from '@shared/navegacao';

/**
 * Destino do `/auth/callback`: o `next` quando é caminho interno; sem ele, `/dashboard` para quem
 * já tem empresa e `/criar-empresa` para quem não tem.
 */
export function destinoCallback(next: string | null | undefined, temEmpresa: boolean): string {
  if (ehCaminhoInterno(next)) return next;
  return temEmpresa ? '/dashboard' : '/criar-empresa';
}

/** Link de confirmação do e-mail, com `next` explícito (inválido → `/criar-empresa`). */
export function urlCallback(origin: string, next: string | null | undefined): string {
  return `${origin}/auth/callback?next=${encodeURIComponent(nextSeguro(next, '/criar-empresa'))}`;
}
