import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(__dirname, '../../../supabase/migrations/034_fix_pacote_servicos_rls.sql');

describe('pacote_servicos RLS migration', () => {
  it('recria politicas completas para membros da empresa gerenciarem servicos do pacote', () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('drop policy if exists "pacote_servicos: gestor pode inserir"');
    expect(sql).toContain('drop policy if exists "pacote_servicos: membro gerencia insert"');
    expect(sql).toContain('create policy "pacote_servicos: membro ve"');
    expect(sql).toContain('for select');
    expect(sql).toContain('create policy "pacote_servicos: membro insere"');
    expect(sql).toContain('for insert');
    expect(sql).toContain('create policy "pacote_servicos: membro atualiza"');
    expect(sql).toContain('for update');
    expect(sql).toContain('create policy "pacote_servicos: membro remove"');
    expect(sql).toContain('for delete');
    expect(sql).toMatch(/p\.id\s*=\s*pacote_servicos\.pacote_id/);
    expect(sql).toContain('p.empresa_id in (select minha_empresas())');
  });
});
