import { describe, expect, it } from 'vitest';
import { getMonthQueryBounds } from '../../lib/financeiro/periodo-mensal';

describe('intervalo mensal do financeiro', () => {
  it('mantem janeiro limitado a 31/01 nas colunas do tipo date', () => {
    const bounds = getMonthQueryBounds(new Date(2026, 0, 15));

    expect(bounds.startDate).toBe('2026-01-01');
    expect(bounds.endDate).toBe('2026-01-31');
  });
});
