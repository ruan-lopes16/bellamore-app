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

describe('Migration: despesas.recorrencia_ate', () => {
  const migrations = readAllMigrations();

  it('adiciona a coluna recorrencia_ate na tabela despesas', () => {
    expect(migrations).toMatch(/alter table public\.despesas\s+add column recorrencia_ate date/);
  });
});
