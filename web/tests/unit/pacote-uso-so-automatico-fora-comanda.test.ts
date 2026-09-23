import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(process.cwd(), '..', 'supabase', 'migrations', '078_pacote_uso_so_automatico_fora_comanda.sql'),
  'utf8',
).toLowerCase();

describe('Migration 078 — busca automática de pacote só fora da Comanda', () => {
  it('redefine fn_registrar_uso_pacote (mesma function das migrations 011/036/037)', () => {
    expect(sql).toContain('create or replace function fn_registrar_uso_pacote()');
    expect(sql).toContain('security definer');
  });

  it('mantém o vínculo explícito (pacote_cliente_id preenchido) tratado primeiro', () => {
    expect(sql).toContain('if new.pacote_cliente_id is not null then');
  });

  it('só cai na busca automática quando NÃO veio de uma comanda (comanda_id nulo)', () => {
    expect(sql).toMatch(/elsif\s+new\.comanda_id\s+is\s+null\s+then/);
  });

  it('não altera a query de busca automática em si (mesmos filtros da 037)', () => {
    expect(sql).toContain("pc.status        = 'ativo'");
    expect(sql).toContain('pc.data_validade is null or pc.data_validade >= current_date');
    expect(sql).toContain('ps.quantidade is null');
  });

  it('não faz backfill — decisão de não reescrever pacote_uso já gravado (mesma politica da migration 065)', () => {
    expect(sql).not.toMatch(/delete\s+from\s+public\.pacote_uso/);
    expect(sql).not.toMatch(/update\s+public\.pacote_uso/);
  });

  it('mantém o mesmo trigger trg_uso_pacote (não cria um novo)', () => {
    expect(sql).toContain('drop trigger if exists trg_uso_pacote on public.agendamentos');
    expect(sql).toContain('create trigger trg_uso_pacote');
    expect(sql).toContain('after update on public.agendamentos');
  });
});
