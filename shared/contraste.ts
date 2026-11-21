/**
 * @file contraste.ts
 * Razão de contraste do WCAG 2.x entre duas cores hex (`#RRGGBB`).
 */

function canal(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Luminância relativa (0 = preto, 1 = branco). */
export function luminancia(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** Razão de contraste entre duas cores (de 1 a 21). */
export function razaoContraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [claro, escuro] = la >= lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (escuro + 0.05);
}
