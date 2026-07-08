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
});
