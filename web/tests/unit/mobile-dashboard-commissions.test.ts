import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const hookPath = resolve(__dirname, '../../../mobile/hooks/useDashboard.ts');

describe('mobile dashboard — comissões pendentes (todas, de qualquer mês — regra do web)', () => {
  it('usa carregarComissoesPendentes, sem filtro de mês', () => {
    const source = readFileSync(hookPath, 'utf8');
    expect(source).toContain('carregarComissoesPendentes(');
    expect(source).toContain("queryKey: ['comissoes-pendentes', empresaId]");
    expect(source).not.toMatch(/from\('comissoes'\)[\s\S]{0,300}gte\('created_at'/);
  });
});
