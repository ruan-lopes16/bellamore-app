import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(__dirname, '../../../supabase/migrations/035_pacotes_excluir_validade_opcional.sql');

describe('pacotes: excluir e validade opcional', () => {
  it('adiciona policy de DELETE em pacotes e torna data_validade opcional', () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('create policy "pacotes: membro exclui"');
    expect(sql).toContain('on public.pacotes');
    expect(sql).toContain('for delete');
    expect(sql).toContain('using (empresa_id in (select minha_empresas()))');
    expect(sql).toContain('alter table public.pacote_clientes');
    expect(sql).toContain('alter column data_validade drop not null');
  });
});
