import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const raiz = join(__dirname, '..', '..', '..');
const hook = readFileSync(join(raiz, 'mobile/hooks/useDashboard.ts'), 'utf8');
const tela = readFileSync(join(raiz, 'mobile/app/(empresa)/dashboard.tsx'), 'utf8');

describe('mobile Dashboard = web Dashboard', () => {
  it('receita do mês e de hoje pela regra única (não soma pagamentos)', () => {
    expect(hook).not.toMatch(/from\('pagamentos'\)/);
    expect(hook).toContain('carregarDadosFinanceiros(');
    expect(hook).toContain('calcularKpisFinanceiros(');
    expect(hook).toContain('variacaoPercentual(');
  });
  it('limites em Brasília', () => {
    expect(hook).toContain('hojeBRT()');
    expect(hook).not.toMatch(/(startOfMonth|endOfMonth|startOfDay|endOfDay)\([^)]*\)\.toISOString\(\)/);
  });
  it('sem "+12% vs mês anterior" fixo; delta real', () => {
    expect(tela).not.toContain('+12% vs mês anterior');
    expect(tela).toContain('variacaoReceitaMes');
  });
  it('erro de carga visível e cards financeiros atrás da permissão', () => {
    expect(hook).toContain('isError');
    expect(tela).toContain('isError');
    expect(tela).toContain('podeVerFinanceiro');
    expect(tela).toContain('Não foi possível carregar o painel');
  });
  it('mantém o alerta de comandas não fechadas', () => {
    expect(hook).toContain('comandasNaoFechadas');
    expect(tela).toContain('comandas não fechadas');
  });
});
