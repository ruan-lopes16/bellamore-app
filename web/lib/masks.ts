/**
 * @file masks.ts
 * Reexporta as máscaras puras de `@shared/mascaras` (fonte única web + mobile)
 * e mantém aqui só o que depende do DOM.
 */
import { digits } from '@shared/mascaras';

export {
  digits, maskPhone, maskCNPJ, maskCPF, maskCEP, maskMoeda, parseMoeda,
  formatMoeda, validaCNPJ, toWhatsApp,
} from '@shared/mascaras';

/**
 * Aplica uma máscara de dígitos num <input> controlado SEM perder a posição do
 * cursor. Só funciona client-side; use no onChange:
 *   onChange={e => maskComCursor(e.target, maskPhone, setTelefone)}
 */
export function maskComCursor(
  input: HTMLInputElement,
  maskFn: (v: string) => string,
  setValue: (masked: string) => void,
): void {
  const cursorPos = input.selectionStart ?? input.value.length;
  const digitsBeforeCursor = digits(input.value.slice(0, cursorPos)).length;
  const masked = maskFn(input.value);
  setValue(masked);

  requestAnimationFrame(() => {
    if (digitsBeforeCursor === 0) { input.setSelectionRange(0, 0); return; }
    let count = 0;
    for (let i = 0; i < masked.length; i++) {
      if (/\d/.test(masked[i])) {
        count++;
        if (count === digitsBeforeCursor) { input.setSelectionRange(i + 1, i + 1); return; }
      }
    }
    input.setSelectionRange(masked.length, masked.length);
  });
}
