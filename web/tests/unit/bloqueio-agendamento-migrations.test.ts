import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

function readAllMigrations(): string {
  const dir = join(process.cwd(), '..', 'supabase', 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(dir, f), 'utf8').toLowerCase())
    .join('\n---\n');
}

describe('Migrations 066–069: bloqueio + excluir agendamento', () => {
  const sql = readAllMigrations();

  // ── 066 ──
  it('066: cria policy de DELETE de agendamentos restrita a gestor/owner', () => {
    expect(sql).toMatch(/create policy "agendamentos: gestor ou owner exclui"\s+on public\.agendamentos\s+for delete\s+using \(is_gestor_ou_owner\(empresa_id\)\)/);
  });

  // ── 067 ──
  it('067: adiciona empresa_membros.tipo_contrato nullable com check pj/clt', () => {
    expect(sql).toMatch(/alter table public\.empresa_membros\s+add column if not exists tipo_contrato text\s+check \(tipo_contrato in \('pj', 'clt'\)\)/);
  });
});
