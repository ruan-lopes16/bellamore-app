import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(process.cwd(), 'app', '(app)', 'agenda', 'page.tsx'), 'utf8');

describe('agenda: bloqueio com tipos + aprovacao', () => {
  it('importa os helpers compartilhados de bloqueio', () => {
    expect(src).toMatch(/from '@shared\/bloqueios'/);
    expect(src).toContain('montarInsertBloqueio');
    expect(src).toContain('podeSelecionarEscopoGeral');
  });
  it('carrega pendentes filtrando situacao pendente', () => {
    expect(src).toMatch(/\.eq\('situacao', 'pendente'\)/);
  });
  it('faz polling de 30s de pendentes', () => {
    expect(src).toContain('30_000');
  });
  it('fetchDia traz escopo/motivo/situacao/criado_por', () => {
    expect(src).toMatch(/agenda_bloqueios'\)\s*\.select\('id, profissional_id, titulo, data_inicio, data_fim, escopo, motivo, situacao, criado_por'\)/);
  });
});
