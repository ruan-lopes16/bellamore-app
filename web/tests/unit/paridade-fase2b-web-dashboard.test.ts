import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');
const page = ler('web/app/(app)/dashboard/page.tsx');
const sidebar = ler('web/components/Sidebar.tsx');
const spark = ler('web/components/SparkBars.tsx');

describe('web Dashboard com as regras únicas', () => {
  it('usa shared', () => {
    for (const t of ['navegacaoMesDashboard(', 'carregarUltimasVisitas(', 'clientesParaReconquistar(', 'carregarAniversariantes(',
      'aniversariantesProximos(', 'carregarDespesasVencendo(', 'carregarComandasNaoFechadas(', 'resumoComandasNaoFechadas(',
      'progressoMetaEmpresa(', 'rotuloProgressoMeta(', 'cartoesKpiDashboard(kpis, kpisAnt', 'horaBRT(']) expect(page).toContain(t);
    for (const t of ['.limit(3000)', 'differenceInDays', 'cutoff45', 'todayMidnight']) expect(page).not.toContain(t);
  });
  it('alerta de comandas não fechadas e link de comissões para /comissoes', () => {
    expect(page).toMatch(/comandas? não fechadas?/);
    expect(page).toContain('href="/comanda"');
    expect(page).toContain('href="/comissoes"');
  });
  it('Sidebar com os mesmos filtros e o dia de Brasília', () => {
    expect(sidebar).toContain('aplicarFiltroComandasNaoFechadas(');
    expect(sidebar).toContain('aplicarFiltroDespesasVencendo(');
    expect(sidebar).toContain('hojeBRT()');
    expect(sidebar).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
  });
  it('SparkBars usa a geometria única', () => {
    expect(spark).toContain('geometriaSparkline(');
  });
});
