import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('migration 060_despesas_valor_total_compra', () => {
  it('adiciona valor_total_compra como coluna numerica nullable, sem default', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../../supabase/migrations/060_despesas_valor_total_compra.sql'),
      'utf8',
    );

    expect(sql).toMatch(/alter table public\.despesas/);
    expect(sql).toMatch(/add column valor_total_compra numeric\(10,\s*2\)/);
    expect(sql).not.toMatch(/not null/i);
    expect(sql).not.toMatch(/default/i);
  });
});
