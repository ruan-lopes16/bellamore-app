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

describe('Migration: taxa de reserva — schema', () => {
  const migrations = readAllMigrations();

  it('adiciona as colunas de configuracao em empresas', () => {
    expect(migrations).toContain('taxa_reserva_ativa');
    expect(migrations).toContain('taxa_reserva_modo');
    expect(migrations).toContain('taxa_reserva_valor');
  });

  it('cria a tabela taxas_reserva com RLS habilitado', () => {
    expect(migrations).toContain('create table public.taxas_reserva');
    expect(migrations).toMatch(/alter table public\.taxas_reserva\s+enable row level security/);
  });

  it('restringe select/update a gestor ou owner, e insert a membro da empresa', () => {
    expect(migrations).toMatch(/taxas_reserva[\s\S]{0,400}is_gestor_ou_owner/);
    expect(migrations).toMatch(/taxas_reserva[\s\S]{0,600}for insert[\s\S]{0,200}minha_empresas/);
  });

  it('impede duas taxas de reserva para o mesmo agendamento', () => {
    expect(migrations).toMatch(/create table public\.taxas_reserva[\s\S]{0,900}unique\s*\(agendamento_id\)/);
  });

  it('aceita apenas os status pendente, pago ou retida', () => {
    expect(migrations).toMatch(/taxas_reserva[\s\S]{0,400}status in \('pendente', 'pago', 'retida'\)/);
  });

  it('cria o trigger que retem a taxa de reserva ao cancelar/faltar', () => {
    expect(migrations).toContain('function public.reter_taxa_reserva');
    expect(migrations).toContain('trg_reter_taxa_reserva');
    expect(migrations).toMatch(/after update on public\.agendamentos[\s\S]{0,200}execute function public\.reter_taxa_reserva/);
    expect(migrations).toMatch(/reter_taxa_reserva[\s\S]{0,600}status = 'retida'/);
  });
});
