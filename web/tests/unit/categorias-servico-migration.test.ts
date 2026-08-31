import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readAllMigrations(): string {
  const dir = join(process.cwd(), '..', 'supabase', 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(dir, f), 'utf8').toLowerCase())
    .join('\n');
}

describe('Migration 063: categorias_servico', () => {
  const sql = readAllMigrations();

  it('cria a tabela com RLS habilitado', () => {
    expect(sql).toContain('create table public.categorias_servico');
    expect(sql).toMatch(/alter table public\.categorias_servico\s+enable row level security/);
  });

  it('tem colunas nome, cor e icone not null', () => {
    expect(sql).toMatch(/create table public\.categorias_servico[\s\S]{0,400}nome\s+text not null/);
    expect(sql).toMatch(/create table public\.categorias_servico[\s\S]{0,400}cor\s+text not null/);
    expect(sql).toMatch(/create table public\.categorias_servico[\s\S]{0,400}icone\s+text not null/);
  });

  it('impede nome duplicado por empresa (case-insensitive)', () => {
    expect(sql).toMatch(/unique index[\s\S]{0,120}categorias_servico\s*\(empresa_id,\s*lower\(nome\)\)/);
  });

  it('libera select para membro e escrita so para gestor/owner', () => {
    expect(sql).toMatch(/categorias_servico[\s\S]{0,400}for select[\s\S]{0,160}minha_empresas/);
    expect(sql).toMatch(/categorias_servico[\s\S]{0,400}for insert[\s\S]{0,160}is_gestor_ou_owner/);
    expect(sql).toMatch(/categorias_servico[\s\S]{0,400}for update[\s\S]{0,160}is_gestor_ou_owner/);
    expect(sql).toMatch(/categorias_servico[\s\S]{0,400}for delete[\s\S]{0,160}is_gestor_ou_owner/);
  });

  it('adiciona servicos.categoria_id com on delete set null', () => {
    expect(sql).toMatch(/alter table public\.servicos\s+add column categoria_id uuid references public\.categorias_servico\(id\) on delete set null/);
  });

  it('impede categoria e categoria_id preenchidos juntos', () => {
    expect(sql).toMatch(/servicos_categoria_xor[\s\S]{0,120}check \(categoria is null or categoria_id is null\)/);
  });
});
