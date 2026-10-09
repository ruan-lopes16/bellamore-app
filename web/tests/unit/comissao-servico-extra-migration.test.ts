import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(join(process.cwd(), '..', 'supabase', 'migrations', '085_comissao_servico_extra.sql'), 'utf8').toLowerCase();

describe('Migration 085: comissão de serviço extra', () => {
  it('coluna comanda_item_id, agendamento_id nullable e CHECK de origem', () => {
    expect(sql).toMatch(/add column if not exists comanda_item_id uuid references public\.comanda_itens\(id\)/);
    expect(sql).toMatch(/alter column agendamento_id drop not null/);
    expect(sql).toMatch(/constraint comissoes_origem check \(agendamento_id is not null or comanda_item_id is not null\)/);
  });
  it('três funções security definer com search_path', () => {
    for (const f of ['gerar_comissao_item', 'sincronizar_comissao_item', 'apagar_comissao_item']) {
      expect(sql).toMatch(new RegExp(String.raw`create or replace function public\.${f}\(\)`));
    }
    expect(sql.match(/security definer set search_path = public/g)?.length).toBe(3);
  });
  it('triggers em comanda_itens: after insert, after update, before delete', () => {
    expect(sql).toMatch(/create trigger trg_gerar_comissao_item\s+after insert on public\.comanda_itens/);
    expect(sql).toMatch(/create trigger trg_sincronizar_comissao_item\s+after update on public\.comanda_itens/);
    expect(sql).toMatch(/create trigger trg_apagar_comissao_item\s+before delete on public\.comanda_itens/);
  });
  it('só serviço com profissional e percentual > 0; comissão paga bloqueia', () => {
    expect(sql).toContain("new.tipo = 'servico'");
    expect(sql).toContain('percentual_comissao');
    expect(sql).toContain('comissão deste serviço já foi paga');
  });
  it('índice único parcial por item e UPDATE que cria/remove/atualiza', () => {
    expect(sql).toMatch(/create unique index if not exists \w+ on public\.comissoes\(comanda_item_id\) where comanda_item_id is not null/);
    expect(sql).toMatch(/drop index if exists idx_comissoes_comanda_item/);
    const upd = sql.slice(sql.indexOf('function public.sincronizar_comissao_item'), sql.indexOf('function public.apagar_comissao_item'));
    expect(upd).toContain('insert into public.comissoes');
    expect(upd).toMatch(/elsif v_mudou_dono or v_mudou_valor then\s+(--[^\n]*\n\s*)*insert into public\.comissoes/);
    expect(upd).toContain('delete from public.comissoes');
    expect(upd).toContain('update public.comissoes');
    expect(upd).toContain('comissão deste serviço já foi paga');
  });
  it('idempotente e recarrega o schema', () => {
    expect(sql).toMatch(/drop trigger if exists trg_gerar_comissao_item/);
    expect(sql).toMatch(/drop constraint if exists comissoes_origem/);
    expect(sql.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});
