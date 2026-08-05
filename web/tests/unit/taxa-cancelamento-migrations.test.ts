import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readAllMigrations(): string {
  const migrationsDir = join(process.cwd(), '..', 'supabase', 'migrations');
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8').toLowerCase())
    .join('\n');
}

describe('Migration: taxa de cancelamento — schema', () => {
  const migrations = readAllMigrations();

  it('adiciona as colunas de configuracao em empresas', () => {
    expect(migrations).toContain('taxa_cancelamento_ativa');
    expect(migrations).toContain('taxa_cancelamento_modo');
    expect(migrations).toContain('taxa_cancelamento_valor');
    expect(migrations).toContain('taxa_cancelamento_aplica_cancelado');
    expect(migrations).toContain('taxa_cancelamento_aplica_faltou');
  });

  it('cria a tabela taxas_cancelamento com RLS habilitado', () => {
    expect(migrations).toContain('create table public.taxas_cancelamento');
    expect(migrations).toMatch(/alter table public\.taxas_cancelamento\s+enable row level security/);
  });

  it('restringe select/update a gestor ou owner', () => {
    expect(migrations).toMatch(/taxas_cancelamento[\s\S]{0,400}is_gestor_ou_owner/);
  });

  it('impede duas taxas para o mesmo agendamento', () => {
    expect(migrations).toMatch(/unique\s*\(agendamento_id\)/);
  });

  it('cria o trigger que gera a taxa ao cancelar/faltar', () => {
    expect(migrations).toContain('function public.gerar_taxa_cancelamento');
    expect(migrations).toContain('trg_gerar_taxa_cancelamento');
    expect(migrations).toMatch(/after update on public\.agendamentos/);
    expect(migrations).toContain('security definer');
  });

  it('reverte a taxa pendente quando o agendamento sai de cancelado/faltou', () => {
    expect(migrations).toMatch(/status\s*=\s*'cancelada'/);
  });

  it('permite gestor atualizar empresas (necessario para salvar a taxa de cancelamento)', () => {
    expect(migrations).toMatch(/on public\.empresas for update[\s\S]{0,200}is_gestor_ou_owner/);
  });
});
