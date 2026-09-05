import type React from 'react';

/**
 * Handler de `onKeyDown` para <form> de modal: Enter move o foco para o
 * próximo campo focável (input/select/textarea habilitado e não escondido
 * via `hidden`) em vez de enviar o formulário. No último campo, foca o
 * botão `type="submit"` — não envia; exige um Enter/clique explícito nele.
 * Tab continua nativo. Enter em <textarea> e em <button> mantém o
 * comportamento padrão (quebra de linha / clique).
 *
 * Uso: <form onKeyDown={avancarComEnter}>
 */
export function avancarComEnter(e: React.KeyboardEvent<HTMLFormElement>): void {
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
  // Enter que confirma composição de IME (acentuação, etc.) não é navegação.
  if ((e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) return;
  const alvo = e.target as HTMLElement;
  if (alvo.tagName === 'TEXTAREA' || alvo.tagName === 'BUTTON') return;
  e.preventDefault();

  const campos = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>('input, select, textarea'),
  ).filter((el) => {
    if (el.hasAttribute('disabled') || el.tabIndex < 0) return false;
    if ((el as HTMLElement).hidden || el.closest('[hidden]')) return false;
    return true;
  });

  const i = campos.indexOf(alvo);
  if (i < 0) return;
  const prox = campos[i + 1];
  if (prox) {
    prox.focus();
    (prox as HTMLInputElement).select?.();
  } else {
    e.currentTarget.querySelector<HTMLElement>('button[type="submit"]')?.focus();
  }
}
