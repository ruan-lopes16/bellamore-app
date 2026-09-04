import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'app', '(app)', 'agenda', 'page.tsx'), 'utf8',
);

describe('agenda: excluir agendamento', () => {
  it('usa os helpers de @shared/agendamentos', () => {
    expect(src).toMatch(/from '@shared\/agendamentos'/);
    expect(src).toContain('podeExcluirAgendamento');
  });
  it('faz DELETE em agendamentos com .select() para detectar RLS', () => {
    expect(src).toMatch(/from\('agendamentos'\)\s*\.delete\(\)\s*\.eq\('id',[^)]*\)\s*\.select\('id'\)/);
  });
  it('usa ConfirmDialog para confirmar a exclusao', () => {
    expect(src).toContain('ConfirmDialog');
  });
});
