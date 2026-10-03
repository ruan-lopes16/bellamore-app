import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { limitesMes } from '@shared/periodos';
import { calcularKpisFinanceiros } from '@shared/kpis-financeiros';
import { cartoesKpiRelatorio } from '@shared/relatorios';
import { cartoesKpiDashboard } from '@shared/dashboard';
import { fixtureSetembro } from './fixtures/kpis-setembro-2026';

const raiz = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8');
function arquivos(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(join(raiz, dir))) {
    if (n === 'node_modules' || n === '.next') continue;
    const p = join(dir, n);
    if (statSync(join(raiz, p)).isDirectory()) arquivos(p, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

const PARES: Record<string, { web: string[]; mobile: string[]; exigidos: string[] }> = {
  'Comissões': {
    web: ['web/app/(app)/comissoes/ComissoesGestorView.tsx', 'web/app/(app)/comissoes/ComissoesProfissionalView.tsx'],
    mobile: ['mobile/hooks/useComissoesGestor.ts', 'mobile/app/(empresa)/comissoes.tsx', 'mobile/app/(profissional)/comissoes.tsx', 'mobile/hooks/useProfissional.ts'],
    exigidos: ['carregarComissoesDoPeriodo(', 'PERIODOS_COMISSAO', 'normalizarComissoes'],
  },
  'Financeiro (recorrentes)': {
    web: ['web/app/(app)/financeiro/page.tsx'], mobile: ['mobile/hooks/useFinanceiro.ts'],
    exigidos: ['carregarHistoricoRecorrentesMensais(', 'recorrentesParaLancarNoMes(', 'montarLancamentosRecorrentes('],
  },
  'Calendário do mês': {
    web: ['web/components/FinanceMonthCalendar.tsx'], mobile: ['mobile/components/CalendarioMesFinanceiro.tsx'],
    exigidos: ['gradeCalendarioMes(', 'rotuloIntervaloMes('],
  },
  'Dashboard': {
    web: ['web/app/(app)/dashboard/page.tsx'], mobile: ['mobile/hooks/useDashboard.ts'],
    exigidos: ['navegacaoMesDashboard(', 'clientesParaReconquistar(', 'aniversariantesProximos(', 'carregarDespesasVencendo(',
      'carregarComandasNaoFechadas(', 'progressoMetaEmpresa(', 'receitaAcumuladaPorDia('],
  },
  'Relatórios': {
    web: ['web/app/(app)/relatorios/page.tsx'], mobile: ['mobile/hooks/useRelatorios.ts', 'mobile/app/(empresa)/relatorios.tsx'],
    exigidos: ['rankingDespesasPorCategoria(', 'comissaoPorProfissional(', 'resumoInsumos(', 'resumoAvaliacoes(',
      'carregarComissoesDoPeriodo(', 'clientesSumidas(', 'carregarUltimasVisitas(', 'cartoesKpiRelatorio(', 'linhasResumoFinanceiro(', 'ABAS_RELATORIO'],
  },
};

describe('as duas plataformas usam as mesmas funções', () => {
  for (const [nome, { web, mobile, exigidos }] of Object.entries(PARES)) {
    it(nome, () => {
      const w = web.map(ler).join('\n');
      const m = mobile.map(ler).join('\n');
      for (const e of exigidos) {
        expect(w, `web/${nome} deveria usar ${e}`).toContain(e);
        expect(m, `mobile/${nome} deveria usar ${e}`).toContain(e);
      }
    });
  }
});

describe('ninguém fora de shared paga comissão nem conta pendentes à mão', () => {
  const telas = [...arquivos('web/app'), ...arquivos('web/components'), ...arquivos('mobile/app'), ...arquivos('mobile/hooks')];
  it('nenhum update direto em comissoes', () => {
    const ofensores = telas.filter(f => /from\('comissoes'\)[\s\S]{0,200}\.update\(/.test(ler(f)));
    expect(ofensores).toEqual([]);
  });
  it('nenhum .limit(3000) / .limit(5000) silencioso nas telas financeiras', () => {
    for (const f of ['web/app/(app)/dashboard/page.tsx', 'web/app/(app)/financeiro/page.tsx', 'mobile/hooks/useDashboard.ts', 'mobile/hooks/useFinanceiro.ts'])
      expect(ler(f)).not.toMatch(/\.limit\((3000|5000)\)/);
  });
  it('as telas de comissão não usam limites no fuso do aparelho', () => {
    for (const f of PARES['Comissões'].web.concat(PARES['Comissões'].mobile))
      expect(ler(f), f).not.toMatch(/(startOfMonth|endOfMonth|startOfDay|endOfDay)\([^)]*\)\.toISOString\(\)/);
  });
});

describe('mesma entrada → mesmos cartões nas duas plataformas', () => {
  it('Relatórios e Dashboard montam as listas por shared (determinísticas)', () => {
    const fx = fixtureSetembro();
    const k = calcularKpisFinanceiros(fx, limitesMes('2026-09'));
    const kAnt = calcularKpisFinanceiros(fx, limitesMes('2026-08'));
    const fmt = (v: number) => String(v);
    expect(cartoesKpiRelatorio(k, kAnt, { periodo: 'mes', isOwner: false, retiradasPeriodo: 0, fmt }))
      .toEqual(cartoesKpiRelatorio(k, kAnt, { periodo: 'mes', isOwner: false, retiradasPeriodo: 0, fmt }));
    expect(cartoesKpiDashboard(k, kAnt, { isOwner: false, retiradasMes: 0, emprestimosAbertos: 0, fmt }).find(c => c.id === 'lucro')?.valor)
      .toBe(String(k.lucro));
  });
});
