import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CHAVES_FINANCEIRO } from '@shared/invalidacao-financeira';
const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');
const hook = ler('mobile/hooks/useDashboard.ts');
const tela = ler('mobile/app/(empresa)/dashboard.tsx');
const spark = ler('mobile/components/SparkLinha.tsx');

describe('app Dashboard = web Dashboard', () => {
  it('hook com as mesmas consultas e regras', () => {
    for (const t of ['navegacaoMesDashboard(', 'carregarUltimasVisitas(', 'clientesParaReconquistar(', 'carregarAniversariantes(',
      'aniversariantesProximos(', 'carregarDespesasVencendo(', 'carregarComandasNaoFechadas(', 'resumoComandasNaoFechadas(',
      'progressoMetaEmpresa(', 'receitaAcumuladaPorDia(', 'carregarRetiradas(', "'despesas-vencendo'", "from('empresas')",
      'if (error) throw error']) expect(hook).toContain(t);
    expect(hook).not.toContain('.limit(500)');
  });
  it('tela: navegação de mês, KPIs, meta, reconquista, aniversariantes, despesas e sparkline', () => {
    for (const t of ['setMesSolicitado', 'rotuloMesAno(', 'cartoesKpiDashboard(', 'rotuloProgressoMeta(', 'Reconquistar',
      'Aniversariantes', 'despesasVencendo', '<SparkLinha', 'horaBRT(', "hojePronto ? formatBRL(receitaHoje) : '—'",
      'Mês com fechamento importado']) expect(tela).toContain(t);
  });
  it('sparkline com a geometria única; despesas vencendo invalidadas ao mexer em dinheiro', () => {
    expect(spark).toContain('geometriaSparkline(');
    expect(CHAVES_FINANCEIRO).toContain('despesas-vencendo');
  });
});
