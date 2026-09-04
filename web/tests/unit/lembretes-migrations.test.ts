import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const dir = join(process.cwd(), '..', 'supabase', 'migrations');
const all = readdirSync(dir).filter(f => f.endsWith('.sql'))
  .map(f => readFileSync(join(dir, f), 'utf8').toLowerCase()).join('\n---\n');

describe('Migration 066 — colunas de lembrete em agendamentos', () => {
  it('cria lembrete_1h_em e lembrete_15min_em (e dropa as antigas)', () => {
    expect(all).toContain('add  column if not exists lembrete_1h_em');
    expect(all).toContain('add  column if not exists lembrete_15min_em');
    expect(all).toContain('drop column if exists lembrete_vespera_em');
    expect(all).toContain('drop column if exists lembrete_30min_em');
  });
});

describe('Migration 067 — agendadores pg_cron', () => {
  it('cria as extensões', () => {
    expect(all).toContain('create extension if not exists pg_cron');
    expect(all).toContain('create extension if not exists pg_net');
  });
  it('agenda o motor de atendimento a cada 5 min', () => {
    expect(all).toMatch(/cron\.schedule\(\s*'lembretes-atendimento',\s*'\*\/5 \* \* \* \*'/);
    expect(all).toContain('/api/cron/lembretes');
  });
  it('agenda o resumo diário 1x ao dia', () => {
    expect(all).toMatch(/cron\.schedule\(\s*'resumo-diario',\s*'0 10 \* \* \*'/);
    expect(all).toContain('/api/cron/resumo-diario');
  });
});

describe('Migration 068 — limpeza diária de notificações', () => {
  it('agenda delete diário de TODAS as notificações antigas', () => {
    expect(all).toMatch(/cron\.schedule\(\s*'limpeza-notificacoes',\s*'0 4 \* \* \*'/);
    expect(all).toMatch(/delete from public\.notificacoes\s+where created_at </);
    expect(all).not.toMatch(/delete from public\.notificacoes\s+where tipo = 'agendamento'/); // não filtra por tipo
  });
});
