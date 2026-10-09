import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { limitesMes, limitesDoPeriodo, getMonthQueryBounds, uniaoLimites, somarMeses } from '@shared/periodos';
import { calcularKpisFinanceiros } from '@shared/kpis-financeiros';
import { carregarDadosFinanceiros, type ClienteDb } from '@shared/kpis-financeiros-consultas';
import { fixtureSetembro } from './fixtures/kpis-setembro-2026';

const raiz = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8');

/**
 * Banco falso que devolve TODAS as linhas da fixture, ignorando filtros — cada
 * tela busca uma janela diferente, e o número tem de sair igual mesmo assim.
 */
function dbDaFixture(): ClienteDb {
  const fx = fixtureSetembro();
  const porTabela: Record<string, unknown[]> = {
    agendamentos: fx.agendamentos, vendas: fx.vendas, taxas_cancelamento: fx.taxasCancelamento,
    taxas_reserva: fx.taxasReserva, pagamentos: fx.pagamentos, comissoes: fx.comissoes,
    despesas: fx.despesas.filter(d => d.status === 'pago'), financeiro_ajustes_mensais: fx.fechamentos,
  };
  return {
    from(tabela: string) {
      const builder: Record<string, unknown> = new Proxy({}, {
        get(_a, prop) {
          if (prop === 'then') return undefined;
          return (...args: unknown[]) => {
            if (prop === 'range') {
              const [de, ate] = args as [number, number];
              return Promise.resolve({ data: (porTabela[tabela] ?? []).slice(de, ate + 1), error: null });
            }
            return builder;
          };
        },
      });
      return builder;
    },
  } as unknown as ClienteDb;
}

describe('mesma entrada → mesmos números em todas as telas', () => {
  const SET = limitesMes('2026-09');
  const relMes = limitesDoPeriodo('mes', '2026-09-30');
  // Janelas que cada tela busca (Tasks 5–10)
  const janelas: Record<string, ReturnType<typeof limitesMes>> = {
    'Financeiro web e mobile (6 meses)': uniaoLimites(limitesMes(somarMeses('2026-09', -5)), SET),
    'Dashboard web e mobile (mês + anterior)': uniaoLimites(limitesMes('2026-08'), SET),
    'Relatórios web e mobile (Mês + anterior)': uniaoLimites(relMes.anterior, relMes.atual),
  };

  it('o período "Mês" dos Relatórios é o mesmo mês do Financeiro e do Dashboard', () => {
    expect(relMes.atual).toEqual(SET);
    expect(getMonthQueryBounds(new Date(2026, 8, 1))).toEqual(SET);
  });

  it('bruto, cartão, comissões, despesas, lucro e ticket idênticos em todas as janelas', async () => {
    const resultados = await Promise.all(Object.values(janelas).map(async j =>
      calcularKpisFinanceiros(await carregarDadosFinanceiros(dbDaFixture(), 'emp', j), SET)));
    for (const r of resultados) expect(r).toEqual(resultados[0]);
    expect(resultados[0]).toMatchObject({ bruto: 560, taxasCartao: 7.5, comissoes: 140, despesas: 295.5, lucro: 117, ticketMedio: 175 });
  });
});

describe('todas as telas usam as funções únicas e nenhum cálculo antigo sobrou', () => {
  const TELAS: Record<string, string[]> = {
    'web/app/(app)/financeiro/page.tsx':  ['carregarDadosFinanceiros(', 'calcularKpisFinanceiros('],
    'web/app/(app)/dashboard/page.tsx':   ['carregarDadosFinanceiros(', 'calcularKpisFinanceiros('],
    'web/app/(app)/relatorios/page.tsx':  ['carregarDadosFinanceiros(', 'calcularKpisFinanceiros('],
    'web/app/(app)/dashboard/DashboardProfissionalView.tsx': ['resumoComissoesProfissional(', 'faturamentoPrevistoDia('],
    'mobile/hooks/useFinanceiro.ts':      ['carregarDadosFinanceiros(', 'calcularKpisFinanceiros('],
    'mobile/hooks/useDashboard.ts':       ['carregarDadosFinanceiros(', 'calcularKpisFinanceiros('],
    'mobile/hooks/useRelatorios.ts':      ['carregarDadosFinanceiros(', 'calcularKpisFinanceiros('],
    'mobile/hooks/useProfissional.ts':    ['resumoComissoesProfissional(', 'faturamentoPrevistoDia('],
  };
  const PROIBIDOS_TODOS: [RegExp, string][] = [
    [/percentual_comissao/, 'comissão recalculada pelo percentual atual'],
    [/from\('pagamentos'\)\s*\.select\('valor'/, 'receita somando pagamentos'],
    [/async function buscarTodasPaginas/, 'paginação duplicada (usar @shared/paginacao)'],
    [/\+12% vs mês anterior/, 'delta fixo no código'],
    [/code:\s*'pt-BR'/, 'locale inválido do date-fns'],
    [/somarPeriodoComFechamentos|resolveFinanceiroKpis/, 'fechamento aplicado fora de calcularKpisFinanceiros'],
  ];
  // useProfissional ainda tem limites de AGENDA (fase Agenda); as regras de data valem para o resto.
  const PROIBIDOS_DATA: [RegExp, string][] = [
    [/(startOfMonth|endOfMonth|startOfDay|endOfDay)\([^)]*\)\.toISOString\(\)/, 'limite no fuso do aparelho/servidor'],
    [/toISOString\(\)\.slice\(0,\s*10\)/, 'data de fim de mês em UTC'],
    [/weekStartsOn:\s*1/, 'semana começando na segunda'],
  ];

  for (const [arquivo, exigidos] of Object.entries(TELAS)) {
    it(arquivo, () => {
      const src = ler(arquivo);
      for (const e of exigidos) expect(src, `${arquivo} deveria usar ${e}`).toContain(e);
      const proibidos = arquivo.endsWith('useProfissional.ts') ? PROIBIDOS_TODOS : [...PROIBIDOS_TODOS, ...PROIBIDOS_DATA];
      for (const [re, motivo] of proibidos) expect(re.test(src), `${arquivo}: ${motivo}`).toBe(false);
    });
  }

  it('telas mobile de Relatórios e Dashboard sem semana na segunda nem delta fixo', () => {
    expect(ler('mobile/app/(empresa)/relatorios.tsx')).not.toMatch(/weekStartsOn:\s*1/);
    expect(ler('mobile/app/(empresa)/dashboard.tsx')).not.toContain('+12% vs mês anterior');
  });
});

describe('serviços extras da comanda no faturamento (decisão do dono, 2026-10-08)', () => {
  /** Banco da fixture + um extra cru (com a comanda aninhada) em 15/09. */
  function dbComExtra(): ClienteDb {
    const base = dbDaFixture();
    const extra = {
      id: 'e1', valor_unit: '40.00', quantidade: '2.000', profissional_id: 'p1', servico_id: 's1', descricao: 'Extra',
      servico: { nome: 'Limpeza de pele' }, profissional: { nome: 'Ana' },
      comanda: { fechada_at: '2026-09-15T15:00:00Z', status: 'fechada', clientes_id: 'c1', cliente: { nome: 'Carla' } },
    };
    return {
      from(tabela: string) {
        if (tabela !== 'comanda_itens') return base.from(tabela);
        const b: Record<string, unknown> = new Proxy({}, {
          get(_a, prop) {
            if (prop === 'then') return undefined;
            return (...args: unknown[]) => (prop === 'range'
              ? Promise.resolve({ data: (args[0] as number) === 0 ? [extra] : [], error: null })
              : b);
          },
        });
        return b;
      },
    } as unknown as ClienteDb;
  }

  it('o extra entra igual no bruto, lucro e ticket de todas as janelas (Financeiro, Dashboard, Relatórios)', async () => {
    const SET = limitesMes('2026-09');
    const relMes = limitesDoPeriodo('mes', '2026-09-30');
    const janelas = [
      uniaoLimites(limitesMes(somarMeses('2026-09', -5)), SET),
      uniaoLimites(limitesMes('2026-08'), SET),
      uniaoLimites(relMes.anterior, relMes.atual),
    ];
    const resultados = await Promise.all(janelas.map(async j =>
      calcularKpisFinanceiros(await carregarDadosFinanceiros(dbComExtra(), 'emp', j), SET)));
    for (const r of resultados) expect(r).toEqual(resultados[0]);
    expect(resultados[0]).toMatchObject({ receitaServicosExtras: 80, bruto: 640, lucro: 197, ticketMedio: 215 });
  });

  it('as duas plataformas passam os extras aos rankings e à exportação da aba Financeiro', () => {
    const TELAS: Record<string, string[]> = {
      'web/app/(app)/relatorios/page.tsx': ['dadosPeriodo.servicosExtras', 'linhasAtendimentosRelatorio('],
      'mobile/hooks/useRelatorios.ts': ['doPeriodo.servicosExtras', 'linhasAtendimentosRelatorio('],
      'web/app/(app)/financeiro/page.tsx': ['doMes.servicosExtras', 'receitaServicosExtras'],
      'mobile/hooks/useFinanceiro.ts': ['doMes.servicosExtras', 'receitaServicosExtras'],
      'web/app/(app)/equipe/page.tsx': ['carregarServicosExtras(', 'receitaExtrasPorProfissional('],
      'mobile/app/(empresa)/equipe.tsx': ['carregarServicosExtras(', 'receitaExtrasPorProfissional('],
    };
    for (const [arquivo, exigidos] of Object.entries(TELAS)) {
      const src = ler(arquivo);
      for (const e of exigidos) expect(src, `${arquivo} deveria usar ${e}`).toContain(e);
    }
    // rankingAtendimentos sem os extras deixaria receita de fora
    for (const arquivo of ['web/app/(app)/relatorios/page.tsx', 'mobile/hooks/useRelatorios.ts', 'web/app/(app)/financeiro/page.tsx', 'mobile/hooks/useFinanceiro.ts']) {
      expect(ler(arquivo), arquivo).not.toMatch(/rankingAtendimentos\([^,()]+,\s*'[a-z]+'\)/);
    }
  });
});
