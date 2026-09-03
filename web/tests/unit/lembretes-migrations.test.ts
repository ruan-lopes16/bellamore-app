import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const dir = join(process.cwd(), '..', 'supabase', 'migrations');
const all = readdirSync(dir).filter(f => f.endsWith('.sql'))
  .map(f => readFileSync(join(dir, f), 'utf8').toLowerCase()).join('\n---\n');

describe('Migration 066 — colunas de lembrete em agendamentos', () => {
  it('adiciona lembrete_vespera_em e lembrete_30min_em', () => {
    expect(all).toMatch(/alter table public\.agendamentos\s+add column if not exists lembrete_vespera_em timestamptz/);
    expect(all).toMatch(/add column if not exists lembrete_30min_em\s+timestamptz/);
  });
});

describe('Migration 067 — agendador pg_cron', () => {
  it('cria as extensões e agenda o job a cada 5 min', () => {
    expect(all).toContain('create extension if not exists pg_cron');
    expect(all).toContain('create extension if not exists pg_net');
    expect(all).toMatch(/cron\.schedule\(\s*'lembretes-atendimento',\s*'\*\/5 \* \* \* \*'/);
    expect(all).toContain('/api/cron/lembretes');
  });
});

describe('Migration 068 — prune de notificações de agendamento', () => {
  it('agenda delete diário só para tipo agendamento', () => {
    expect(all).toMatch(/cron\.schedule\(\s*'prune-notificacoes-agendamento',\s*'0 5 \* \* \*'/);
    expect(all).toMatch(/delete from public\.notificacoes\s+where tipo = 'agendamento'/);
    expect(all).toContain("date_trunc('day', now())");
  });
});
