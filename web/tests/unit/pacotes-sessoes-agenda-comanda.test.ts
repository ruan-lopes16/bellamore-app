import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(__dirname, '../../../supabase/migrations/036_pacotes_sessoes_ilimitadas_agenda_comanda.sql');

describe('pacotes: sessões ilimitadas + integração agenda/comanda', () => {
  it('adiciona pacote_cliente_id em agendamentos e pacote_id em comanda_itens', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('alter table public.agendamentos');
    expect(sql).toContain('add column if not exists pacote_cliente_id uuid references public.pacote_clientes(id)');
    expect(sql).toContain('alter table public.comanda_itens');
    expect(sql).toContain('add column if not exists pacote_id uuid references public.pacotes(id)');
    expect(sql).toContain("check (tipo in ('servico', 'produto', 'pacote'))");
  });

  it('corrige o trigger para validade nula, sessões ilimitadas e vínculo explícito', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION fn_registrar_uso_pacote()');
    expect(sql).toContain('NEW.pacote_cliente_id IS NOT NULL');
    expect(sql).toContain('pc.data_validade IS NULL OR pc.data_validade >= CURRENT_DATE');
    expect(sql).toContain('ps.quantidade IS NULL');
    expect(sql).toContain('ps2.quantidade IS NOT NULL');
  });
});
