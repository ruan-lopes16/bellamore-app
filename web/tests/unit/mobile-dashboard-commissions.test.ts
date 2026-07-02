import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const hookPath = resolve(__dirname, '../../../mobile/hooks/useDashboard.ts');

describe('mobile dashboard commissions', () => {
  it('filtra comissoes pendentes pelo mes atual para bater com a tela de comissoes', () => {
    const source = readFileSync(hookPath, 'utf8');
    const section = source.slice(
      source.indexOf("queryKey: ['comissoes-pendentes'"),
      source.indexOf('// Produtos com estoque baixo'),
    );

    expect(section).toContain(".gte('created_at', inicioMes)");
    expect(section).toContain(".lte('created_at', fimMes)");
    expect(section).toContain("queryKey: ['comissoes-pendentes', empresaId, format(hoje, 'yyyy-MM')]");
  });
});
