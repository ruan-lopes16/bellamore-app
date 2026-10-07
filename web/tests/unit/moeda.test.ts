import { describe, expect, it } from 'vitest';
import { formatarMoeda } from '@shared/moeda';
import { formatBRL } from '@shared/dominio';

describe('formatarMoeda', () => {
  it.each([
    [0, 'R$ 0,00'],
    [5, 'R$ 5,00'],
    [9.5, 'R$ 9,50'],
    [1000, 'R$ 1.000,00'],
    [9503.77, 'R$ 9.503,77'],
    [1234567.8, 'R$ 1.234.567,80'],
    [-10, '-R$ 10,00'],
    [-1234.5, '-R$ 1.234,50'],
    [0.005, 'R$ 0,01'],
    [2.675, 'R$ 2,68'],
    [-0.001, 'R$ 0,00'],
  ])('%s → %s', (v, esperado) => {
    expect(formatarMoeda(v)).toBe(esperado);
  });

  it('não finito vira R$ 0,00', () => {
    expect(formatarMoeda(NaN)).toBe('R$ 0,00');
    expect(formatarMoeda(Infinity)).toBe('R$ 0,00');
  });

  it('formatBRL de shared/dominio delega', () => {
    expect(formatBRL(9503.77)).toBe('R$ 9.503,77');
  });
});
