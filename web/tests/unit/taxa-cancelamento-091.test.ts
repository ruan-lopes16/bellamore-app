import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Migration 091 lida como texto: taxa de cancelamento dispensável por atendimento. */
const ler = (nome: string) =>
  readFileSync(join(process.cwd(), '..', 'supabase', 'migrations', nome), 'utf8').toLowerCase().replace(/\r\n/g, '\n');

const sql = ler('091_taxa_cancelamento_por_atendimento.sql');
const corpo = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const sem = (s: string) => s.replace(/\s+/g, ' ');
const c = sem(corpo);

const ini = c.indexOf('create or replace function public.gerar_taxa_cancelamento()');
const fn = c.slice(ini, c.indexOf('$$ language plpgsql', ini) + 80);

describe('migration 091 — coluna', () => {
  it('cobrar_taxa_cancelamento boolean not null default true, idempotente', () => {
    expect(c).toMatch(/alter table public\.agendamentos add column if not exists cobrar_taxa_cancelamento boolean not null default true/);
  });
});

describe('migration 091 — função', () => {
  it('recria gerar_taxa_cancelamento com security definer e search_path', () => {
    expect(ini).toBeGreaterThanOrEqual(0);
    expect(fn).toContain('security definer set search_path = public');
  });

  it('reage a mudança de status OU de cobrar_taxa_cancelamento', () => {
    expect(fn).toContain('old.status is distinct from new.status');
    expect(fn).toContain('old.cobrar_taxa_cancelamento is distinct from new.cobrar_taxa_cancelamento');
    expect(fn).not.toMatch(/if old\.status = new\.status then return new;/);
  });

  it('preserva o ramo de reversão (cancelado/faltou → outro status anula a pendente)', () => {
    expect(fn).toMatch(/old\.status in \('cancelado', 'faltou'\) and new\.status not in \('cancelado', 'faltou'\)/);
  });

  it('desligado: não cria e marca a pendente deste atendimento como cancelada', () => {
    const i = fn.indexOf('if not new.cobrar_taxa_cancelamento then');
    expect(i).toBeGreaterThan(0);
    const bloco = fn.slice(i, fn.indexOf('end if;', i));
    expect(bloco).toMatch(/update public\.taxas_cancelamento set status = 'cancelada' where agendamento_id = new\.id and status = 'pendente'/);
    expect(bloco).toContain('return new;');
    // A dispensa vem antes do INSERT.
    expect(i).toBeLessThan(fn.indexOf('insert into public.taxas_cancelamento'));
  });

  it('preserva a guarda de cliente nulo, a configuração da empresa e a conta do valor', () => {
    expect(fn).toContain('if new.cliente_id is null then return new;');
    expect(fn).toContain('taxa_cancelamento_aplica_cancelado');
    expect(fn).toContain('taxa_cancelamento_aplica_faltou');
    expect(fn).toContain("round(coalesce(new.valor, 0) * v_empresa.taxa_cancelamento_valor / 100, 2)");
  });

  it('religar reativa pelo mesmo on conflict da 052 (nunca sobrescreve pendente/paga)', () => {
    expect(fn).toMatch(/on conflict \(agendamento_id\) do update set status = 'pendente', valor = excluded\.valor, created_at = now\(\), paga_em = null where taxas_cancelamento\.status = 'cancelada'/);
  });
});

describe('migration 091 — trigger e fim', () => {
  it('trigger dispara em update (cobre status e cobrar_taxa_cancelamento)', () => {
    expect(c).toContain('drop trigger if exists trg_gerar_taxa_cancelamento on public.agendamentos');
    expect(c).toMatch(/create trigger trg_gerar_taxa_cancelamento after update(?: of status, cobrar_taxa_cancelamento)? on public\.agendamentos for each row execute function public\.gerar_taxa_cancelamento\(\)/);
  });
  it('tem rollback no cabeçalho e termina com notify', () => {
    expect(sql).toContain('rollback');
    expect(sql).toContain('drop column if exists cobrar_taxa_cancelamento');
    expect(corpo.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});
