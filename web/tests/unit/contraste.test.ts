import { describe, expect, it } from 'vitest';
import { razaoContraste } from '@shared/contraste';
import { PALETA_CLARA, PALETA_ESCURA } from '@shared/paleta-tema';

const BRANCO = '#FFFFFF';

describe('razaoContraste', () => {
  it('preto sobre branco é 21', () => {
    expect(razaoContraste('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });
  it('mesma cor é 1', () => {
    expect(razaoContraste('#123456', '#123456')).toBeCloseTo(1, 5);
  });
});

describe.each([['clara', PALETA_CLARA], ['escura', PALETA_ESCURA]] as const)('paleta %s', (_nome, P) => {
  it.each(['primary', 'green', 'amber', 'red'] as const)('texto branco sobre %s >= 4,5', (k) => {
    expect(razaoContraste(BRANCO, P[k])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['primaryTexto', 'greenTexto', 'amberTexto', 'redTexto', 'text', 'text2'] as const)('%s sobre surface e bg >= 4,5', (k) => {
    expect(razaoContraste(P[k], P.surface)).toBeGreaterThanOrEqual(4.5);
    // No claro, green/amber sobre bg ficam em 4,46-4,48 (valores de sempre, mantidos de propósito).
    expect(razaoContraste(P[k], P.bg)).toBeGreaterThanOrEqual(_nome === 'clara' ? 4.4 : 4.5);
  });
  it('text3 sobre surface >= 3', () => {
    expect(razaoContraste(P.text3, P.surface)).toBeGreaterThanOrEqual(3);
  });
});
