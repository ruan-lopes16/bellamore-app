// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Migration 095 (spec docs/superpowers/specs/2026-10-22-paridade-clientes-design.md, "Migration 095"):
 * só versiona `clientes.endereco`, que já existe em produção sem migration.
 */
const raiz = join(process.cwd(), '..');
const bruto = readFileSync(join(raiz, 'supabase', 'migrations', '095_clientes_endereco.sql'), 'utf8');
const sql = bruto.toLowerCase().replace(/\r\n/g, '\n');
const corpo = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').trim();

describe('migration 095 — clientes.endereco', () => {
  it('adiciona a coluna de forma idempotente', () => {
    expect(corpo).toContain('alter table public.clientes add column if not exists endereco text;');
  });

  it('cabeçalho explica que a coluna já existe em produção sem migration', () => {
    expect(sql).toMatch(/--.*já existe em produção/);
    expect(sql).toMatch(/--.*sem migration/);
  });

  it('rollback só como comentário, sem remover a coluna (é dado)', () => {
    expect(sql).toMatch(/--.*rollback/);
    expect(corpo).not.toContain('drop column');
  });

  it('sem RLS nova', () => {
    expect(corpo).not.toContain('policy');
  });

  it('termina com notify', () => {
    expect(corpo.endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});

describe('shared/clientes.ts — comentário do endereço', () => {
  const texto = readFileSync(join(raiz, 'shared', 'clientes.ts'), 'utf8');
  it('não diz mais que o endereço está em produção desde a 006 e cita a 095', () => {
    expect(texto).not.toMatch(/desde a migration 006/);
    expect(texto).toContain('095');
  });
});
