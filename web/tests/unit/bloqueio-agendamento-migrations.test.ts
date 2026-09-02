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
  it('066: cria policy de DELETE de agendamentos restrita a gestor/owner', () => {
    expect(sql).toMatch(/create policy "agendamentos: gestor ou owner exclui"\s+on public\.agendamentos\s+for delete\s+using \(is_gestor_ou_owner\(empresa_id\)\)/);
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

  it('068: index de pendentes', () => {
    expect(sql).toMatch(/create index if not exists idx_bloqueios_pendentes\s+on public\.agenda_bloqueios \(empresa_id, situacao, data_inicio\)/);
  });
});
