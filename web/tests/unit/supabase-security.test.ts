import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Supabase security migrations', () => {
  it('mantem a view de estoque baixo como security_invoker', () => {
    const migrationsDir = join(process.cwd(), '..', 'supabase', 'migrations');
    const migrations = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => readFileSync(join(migrationsDir, file), 'utf8').toLowerCase())
      .join('\n');

    expect(migrations).toContain('v_produtos_estoque_baixo');
    expect(migrations).toMatch(
      /(?:with\s*\(\s*security_invoker\s*=\s*true\s*\)|alter\s+view\s+public\.v_produtos_estoque_baixo\s+set\s*\(\s*security_invoker\s*=\s*true\s*\))/,
    );
  });

  it('trava escrita de servicos/pacotes/pacote_servicos para gestor ou owner', () => {
    const migrationsDir = join(process.cwd(), '..', 'supabase', 'migrations');
    const migrations = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => readFileSync(join(migrationsDir, file), 'utf8').toLowerCase())
      .join('\n');

    expect(migrations).toContain('"servicos: gestor gerencia"');
    expect(migrations).toContain('"pacotes: gestor gerencia"');
    expect(migrations).toContain('"pacote_servicos: gestor gerencia"');
  });

  it('meta pessoal só é escrita via funcao security definer restrita ao proprio usuario', () => {
    const migrationsDir = join(process.cwd(), '..', 'supabase', 'migrations');
    const migrations = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => readFileSync(join(migrationsDir, file), 'utf8').toLowerCase())
      .join('\n');

    expect(migrations).toContain('meta_mensal_pessoal');
    expect(migrations).toContain('definir_minha_meta_mensal');
    expect(migrations).toMatch(/definir_minha_meta_mensal[\s\S]*?security definer/);
    // A função não pode abrir uma policy de UPDATE genérica em empresa_membros
    // — só o campo meta_mensal_pessoal, só da própria linha.
    expect(migrations).toMatch(/update public\.empresa_membros\s+set meta_mensal_pessoal/);
  });
});
