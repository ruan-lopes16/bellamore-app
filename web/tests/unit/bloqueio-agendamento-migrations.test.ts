import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

function readAllMigrations(): string {
  const dir = join(process.cwd(), '..', 'supabase', 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(dir, f), 'utf8').toLowerCase())
    .join('\n---\n');
}

describe('Migrations 066–069: bloqueio + excluir agendamento', () => {
  const sql = readAllMigrations();

  // ── 066 ──
  it('066: cria policy de DELETE de agendamentos restrita a gestor/owner e barra concluido', () => {
    expect(sql).toMatch(/create policy "agendamentos: gestor ou owner exclui"\s+on public\.agendamentos\s+for delete\s+using \(is_gestor_ou_owner\(empresa_id\) and status <> 'concluido'\)/);
  });

  // ── 067 ──
  it('067: adiciona empresa_membros.tipo_contrato nullable com check pj/clt', () => {
    expect(sql).toMatch(/alter table public\.empresa_membros\s+add column if not exists tipo_contrato text\s+check \(tipo_contrato in \('pj', 'clt'\)\)/);
  });

  // ── 068 ──
  it('068: adiciona as colunas de tipo/motivo/aprovacao em agenda_bloqueios', () => {
    expect(sql).toMatch(/add column if not exists escopo\s+text not null default 'profissional'\s+check \(escopo in \('profissional', 'geral'\)\)/);
    expect(sql).toMatch(/add column if not exists motivo\s+text\s+check \(motivo in \('folga', 'feriado', 'almoco', 'reuniao', 'manutencao', 'outro'\)\)/);
    expect(sql).toMatch(/add column if not exists situacao\s+text not null default 'aprovado'\s+check \(situacao in \('aprovado', 'pendente'\)\)/);
    expect(sql).toContain('add column if not exists criado_por');
    expect(sql).toContain('add column if not exists revisado_por');
    expect(sql).toContain('add column if not exists revisado_em');
  });

  it('068: backfill de escopo geral para linhas antigas sem profissional', () => {
    expect(sql).toMatch(/update public\.agenda_bloqueios set escopo = 'geral' where profissional_id is null/);
  });

  it('068: reescreve as 4 policies usando IN (SELECT minha_empresas()), nunca = ANY', () => {
    // Ler SÓ o arquivo 068 (a migration 033 ainda contém a forma antiga
    // `= any(...)` no seu próprio texto e não deve ser tocada).
    const m068 = readFileSync(
      join(process.cwd(), '..', 'supabase', 'migrations', '068_agenda_bloqueios_tipos_motivo_aprovacao.sql'),
      'utf8',
    ).toLowerCase();
    expect(m068).not.toContain('= any(minha_empresas())');
    expect(m068).toContain('in (select minha_empresas())');
    for (const p of ['"bloqueios: ver"', '"bloqueios: criar"', '"bloqueios: aprovar"', '"bloqueios: excluir"']) {
      expect(m068).toContain(p);
    }
    expect(m068).toMatch(/for insert with check \([\s\S]*?escopo\s*=\s*'profissional'[\s\S]*?profissional_id\s*=\s*auth\.uid\(\)[\s\S]*?criado_por\s*=\s*auth\.uid\(\)[\s\S]*?situacao\s*=\s*'pendente'[\s\S]*?motivo is not null/);
  });

  it('068: dropa as 4 policies novas (nome atual) antes de recriar — idempotente', () => {
    const m068 = readFileSync(
      join(process.cwd(), '..', 'supabase', 'migrations', '068_agenda_bloqueios_tipos_motivo_aprovacao.sql'),
      'utf8',
    ).toLowerCase();
    for (const nome of ['bloqueios: ver', 'bloqueios: criar', 'bloqueios: aprovar', 'bloqueios: excluir']) {
      const drop = m068.indexOf(`drop policy if exists "${nome}"`);
      const create = m068.indexOf(`create policy "${nome}" on public.agenda_bloqueios`);
      expect(drop).toBeGreaterThanOrEqual(0);
      expect(create).toBeGreaterThan(drop);
      expect(m068).toMatch(new RegExp(`drop policy if exists "${nome}"\\s+on public\\.agenda_bloqueios`));
    }
    // os drops antigos (nomes da 033) continuam presentes
    for (const antigo of ['bloqueios_select', 'bloqueios_insert', 'bloqueios_update', 'bloqueios_delete']) {
      expect(m068).toContain(`drop policy if exists "${antigo}" on public.agenda_bloqueios`);
    }
  });

  it('068: check XOR escopo/profissional_id, guardado contra re-run (42710)', () => {
    const m068 = readFileSync(
      join(process.cwd(), '..', 'supabase', 'migrations', '068_agenda_bloqueios_tipos_motivo_aprovacao.sql'),
      'utf8',
    ).toLowerCase();
    expect(m068).toMatch(/if not exists \(\s*select 1 from pg_constraint where conname = 'agenda_bloqueios_escopo_prof_xor'/);
    expect(m068).toMatch(/add constraint agenda_bloqueios_escopo_prof_xor\s+check \(\(escopo = 'geral'\) = \(profissional_id is null\)\)/);
  });

  it('068: index de pendentes', () => {
    expect(sql).toMatch(/create index if not exists idx_bloqueios_pendentes\s+on public\.agenda_bloqueios \(empresa_id, situacao, data_inicio\)/);
  });

  // ── 069 ──
  it('069: funcao notificar_bloqueio security definer + trigger after ins/upd/del', () => {
    expect(sql).toMatch(/create or replace function public\.notificar_bloqueio\(\)[\s\S]*?security definer/);
    expect(sql).toMatch(/create trigger trg_notificar_bloqueio\s+after insert or update or delete on public\.agenda_bloqueios/);
  });

  it('069: gera bloqueio_pendente para gestor + owner (dedupe, sem o autor)', () => {
    expect(sql).toContain("'bloqueio_pendente'");
    expect(sql).toMatch(/role = 'gestor'/);
    expect(sql).toMatch(/select e\.owner_id/);
    expect(sql).toMatch(/u\.uid <> new\.criado_por/);
  });

  it('069: bloqueio_aprovado no update pendente->aprovado e bloqueio_recusado so por terceiro', () => {
    expect(sql).toMatch(/old\.situacao = 'pendente' and new\.situacao = 'aprovado'/);
    expect(sql).toContain("'bloqueio_aprovado'");
    expect(sql).toMatch(/old\.situacao = 'pendente'[\s\S]*?old\.criado_por <> auth\.uid\(\)/);
    expect(sql).toContain("'bloqueio_recusado'");
  });

  it('069: formata data no fuso America/Sao_Paulo', () => {
    expect(sql).toContain("at time zone 'america/sao_paulo'");
  });

  it('069: traduz o motivo para rotulo pt-BR na mensagem de bloqueio_pendente', () => {
    expect(sql).toMatch(/case new\.motivo[\s\S]*?when 'folga'\s+then 'folga'[\s\S]*?when 'almoco'\s+then 'almoço'[\s\S]*?when 'manutencao'\s+then 'manutenção'[\s\S]*?else coalesce\(new\.motivo, 'sem motivo'\)[\s\S]*?end/);
  });
});
