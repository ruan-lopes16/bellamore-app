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

describe('Migration: comandas.desconto_reserva', () => {
  const migrations = readAllMigrations();

  it('adiciona a coluna desconto_reserva na tabela comandas', () => {
    expect(migrations).toMatch(/alter table public\.comandas\s+add column desconto_reserva numeric\(10,\s*2\)\s+not null default 0/);
  });
});
