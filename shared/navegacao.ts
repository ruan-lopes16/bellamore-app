/**
 * @file navegacao.ts
 * Validação do `?next=` do login e do `/auth/callback` (web e app): só caminhos internos,
 * para o link nunca levar a pessoa para outro site depois de entrar (open redirect).
 */

/**
 * `true` só para caminho interno: começa com `/`, sem `//` nem `/\` no início (o navegador lê
 * os dois como outro domínio), sem espaço/controle e sem barra codificada logo no começo.
 */
export function ehCaminhoInterno(valor: unknown): valor is string {
  if (typeof valor !== 'string' || valor.length === 0) return false;
  if (valor[0] !== '/') return false;
  if (valor[1] === '/' || valor[1] === '\\') return false;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(valor)) return false;
  // '/%2f%2f…', '/%5c…' e quebras de linha codificadas.
  if (/^\/(%2f|%5c)/i.test(valor) || /%0[ad]/i.test(valor)) return false;
  return true;
}

/** O `next` quando é caminho interno; senão `padrao` (`/dashboard`). */
export function nextSeguro(valor: string | null | undefined, padrao = '/dashboard'): string {
  return ehCaminhoInterno(valor) ? valor : padrao;
}
