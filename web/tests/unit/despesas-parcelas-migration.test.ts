import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

function readAllMigrations(): string {
  const migrationsDir = join(process.cwd(), '..', 'supabase', 'migrations');
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8').toLowerCase())
    .join('\n---\n');
}

describe('Migration: despesas.parcela_atual / despesas.total_parcelas', () => {
  const migrations = readAllMigrations();

  it('adiciona as colunas parcela_atual e total_parcelas na tabela despesas', () => {
    expect(migrations).toMatch(/alter table public\.despesas\s+add column parcela_atual integer,\s+add column total_parcelas integer/);
  });
});
