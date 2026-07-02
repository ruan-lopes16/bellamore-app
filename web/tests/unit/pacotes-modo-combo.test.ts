import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(__dirname, '../../../supabase/migrations/037_pacotes_modo_combo.sql');

describe('pacotes: modo combo (sem controle de sessões)', () => {
  it('adiciona controla_sessoes em pacotes e ignora combos no trigger', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('alter table public.pacotes');
    expect(sql).toContain('add column if not exists controla_sessoes boolean not null default true');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION fn_registrar_uso_pacote()');
    expect(sql).toContain('p.controla_sessoes = true');
  });
});
