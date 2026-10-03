import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', '..', 'app', '(app)', 'dashboard', 'page.tsx'), 'utf8');

describe('web Dashboard usa os números únicos de shared', () => {
  it('limites em Brasília por @shared/periodos (nada de fuso do servidor)', () => {
    expect(src).toContain("from '@shared/periodos'");
    expect(src).toContain('hojeBRT()');
    expect(src).not.toMatch(/(startOfMonth|endOfMonth)\([^)]*\)\.toISOString\(\)/);
    expect(src).not.toContain('Date.now() - 3 * 60 * 60 * 1000');
  });
  it('KPIs, sparkline e comissões pendentes pelas funções únicas', () => {
    for (const t of [
      'carregarDadosFinanceiros(', 'calcularKpisFinanceiros(', 'receitaAcumuladaPorDia(',
      'carregarComissoesPendentes(', 'resumoComissoesPendentes(', 'variacaoPercentual(',
    ]) expect(src).toContain(t);
    expect(src).not.toContain('percentual_comissao');
    expect(src).not.toContain('somarPeriodoComFechamentos');
    expect(src).not.toContain('async function buscarTodasPaginas');
  });
  it('lucro do mês compara com o lucro do mês anterior (não com bruto − gastos)', () => {
    expect(src).toContain('cartoesKpiDashboard(kpis, kpisAnt');
  });
  it('card "Líquido após taxas" no lugar do antigo "Fat. Líquido" (bruto − comissões)', () => {
    expect(readFileSync(join(__dirname, '..', '..', '..', 'shared', 'dashboard.ts'), 'utf8')).toContain("rotulo: 'Líquido após taxas'");
    expect(src).not.toContain("label: 'Fat. Líquido'");
  });
  it('erros de consulta viram estado de erro visível (nada de zeros silenciosos)', () => {
    expect(src).toContain('Não foi possível carregar o Dashboard');
    expect(src).toContain('if (r.error) throw');
  });
  it('gráfico diário avisa quando o mês tem fechamento importado', () => {
    expect(src).toContain('Mês com fechamento importado — o gráfico diário mostra só os lançamentos ao vivo.');
    expect(src).toContain('kpis.mesesComFechamento');
  });
});
