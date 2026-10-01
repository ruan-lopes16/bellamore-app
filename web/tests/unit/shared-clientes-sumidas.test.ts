import { describe, expect, it } from 'vitest';
import { clientesSumidas } from '@shared/kpis-financeiros';

// Fim do período: 30/09/2026 23:59:59 em Brasília.
const FIM = '2026-10-01T02:59:59.999Z';

describe('clientesSumidas', () => {
  it('mapa vazio = 0', () => {
    expect(clientesSumidas(new Map(), FIM)).toBe(0);
  });
  it('voltou dentro do período (última visita recente) não conta', () => {
    expect(clientesSumidas(new Map([['a', '2026-09-20T15:00:00.000Z']]), FIM)).toBe(0);
  });
  it('última visita a 61 dias do fim conta; a 59 dias não', () => {
    // 30/09 - 61d = 31/07 ; 30/09 - 59d = 02/08
    const m = new Map([['a', '2026-07-31T15:00:00.000Z'], ['b', '2026-08-02T15:00:00.000Z']]);
    expect(clientesSumidas(m, FIM)).toBe(1);
  });
  it('exatamente 60 dias não conta', () => {
    expect(clientesSumidas(new Map([['a', '2026-08-01T15:00:00.000Z']]), FIM)).toBe(0);
  });
  it('não depende de hoje: período passado, aceita Record e dias custom', () => {
    const fim = '2024-03-01T02:59:59.999Z'; // fim de 29/02/2024
    expect(clientesSumidas({ a: '2023-12-01T15:00:00.000Z', b: '2024-02-20T15:00:00.000Z' }, fim)).toBe(1);
    expect(clientesSumidas({ b: '2024-02-20T15:00:00.000Z' }, fim, 5)).toBe(1);
  });
});
