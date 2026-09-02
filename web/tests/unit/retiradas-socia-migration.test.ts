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

describe('Migration 064: retiradas_socia', () => {
  const migrations = readAllMigrations();

  it('cria o enum retirada_socia_tipo com emprestimo e retirada', () => {
    expect(migrations).toMatch(/create type retirada_socia_tipo as enum \('emprestimo', 'retirada'\)/);
  });

  it('cria a tabela retiradas_socia com as colunas do contrato', () => {
    expect(migrations).toMatch(/create table public\.retiradas_socia/);
    for (const col of [
      'tipo', 'valor', 'data', 'descricao', 'metodo', 'parcelado',
      'total_parcelas', 'valor_parcela', 'primeira_parcela_em', 'convertido_em',
      'criado_por',
    ]) {
      expect(migrations).toContain(col);
    }
  });

  it('cria a tabela retiradas_socia_devolucoes ligada por retirada_id com cascade', () => {
    expect(migrations).toMatch(/create table public\.retiradas_socia_devolucoes/);
    expect(migrations).toMatch(/retirada_id\s+uuid not null references public\.retiradas_socia\(id\) on delete cascade/);
  });

  it('habilita RLS e cria policy owner-only nas duas tabelas', () => {
    expect(migrations).toMatch(/alter table public\.retiradas_socia enable row level security/);
    expect(migrations).toMatch(/alter table public\.retiradas_socia_devolucoes enable row level security/);
    const ownerCheck = /owner_id = auth\.uid\(\)/g;
    const matches = migrations.match(ownerCheck) ?? [];
    // pelo menos 4: using + with check, nas 2 tabelas
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });
});
