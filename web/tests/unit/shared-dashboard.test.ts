// web/tests/unit/shared-dashboard.test.ts
import { describe, expect, it } from 'vitest';
import { limitesMes } from '@shared/periodos';
import { calcularKpisFinanceiros } from '@shared/kpis-financeiros';
import {
  clientesParaReconquistar, datasDasUltimasVisitas, aniversariantesProximos, janelaDespesasVencendo,
  progressoMetaEmpresa, rotuloProgressoMeta, resumoComandasNaoFechadas, navegacaoMesDashboard,
  geometriaSparkline, cartoesKpiDashboard, type UltimaVisita,
} from '@shared/dashboard';
import { fixtureSetembro } from './fixtures/kpis-setembro-2026';

const HOJE = '2026-09-30';

describe('reconquista: mais de 45 dias sem visita', () => {
  const ultimas = new Map<string, UltimaVisita>([
    ['a', { nome: 'Ana', ultimaVisita: '2026-08-15T15:00:00Z' }],   // 46 dias
    ['b', { nome: 'Bia', ultimaVisita: '2026-08-16T15:00:00Z' }],   // 45: não entra
    ['c', { nome: 'Cris', ultimaVisita: '2026-05-01T15:00:00Z' }],  // 152
    ['d', { nome: 'Duda', ultimaVisita: '2026-09-29T15:00:00Z' }],
    ['e', { nome: 'Eva', ultimaVisita: '2026-08-16T02:00:00Z' }],   // 15/08 23:00 BRT → 46
  ]);
  it('mais antigas primeiro, empate por nome', () => {
    expect(clientesParaReconquistar(ultimas, HOJE).map(c => [c.clienteId, c.diasSemVisita])).toEqual([['c', 152], ['a', 46], ['e', 46]]);
  });
  it('limite e dias configuráveis', () => {
    expect(clientesParaReconquistar(ultimas, HOJE, { dias: 0, limite: 2 })).toHaveLength(2);
  });
  it('datas para clientesSumidas', () => {
    expect(datasDasUltimasVisitas(ultimas).get('c')).toBe('2026-05-01T15:00:00Z');
  });
});

describe('reconquista: limite padrão', () => {
  it('7 candidatas → as 5 mais antigas', () => {
    const m = new Map<string, UltimaVisita>();
    for (let i = 1; i <= 7; i++) m.set(`c${i}`, { nome: `C${i}`, ultimaVisita: `2026-0${i}-01T15:00:00Z` });
    expect(clientesParaReconquistar(m, HOJE).map(c => c.clienteId)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });
});

describe('aniversariantes: validação, bissexto e limite', () => {
  it('datas malformadas são ignoradas sem erro', () => {
    const cs = ['1904-00-10', '1904-13-10', '1904-10-00', '1904-10-32', 'lixo', ''].map((d, i) => ({ id: String(i), nome: 'X', data_nascimento: d }));
    expect(aniversariantesProximos(cs, '2026-10-01')).toEqual([]);
  });
  it('29/02 em ano bissexto continua 29/02', () => {
    expect(aniversariantesProximos([{ id: 'z', nome: 'Z', data_nascimento: '1904-02-29' }], '2028-02-25')[0])
      .toMatchObject({ diasAte: 4, dataAniversario: '2028-02-29' });
  });
  it('limite padrão de 8', () => {
    const cs = Array.from({ length: 10 }, (_, i) => ({ id: String(i), nome: `N${i}`, data_nascimento: '1904-10-01' }));
    expect(aniversariantesProximos(cs, '2026-10-01')).toHaveLength(8);
  });
});

describe('aniversariantes nos próximos 7 dias', () => {
  it('hoje, amanhã, 7 dias; ontem e sem data ficam fora', () => {
    const cs = [
      { id: '1', nome: 'Hoje', data_nascimento: '1904-09-30' }, { id: '2', nome: 'Amanhã', data_nascimento: '1990-10-01' },
      { id: '3', nome: 'Sete', data_nascimento: '1904-10-07' }, { id: '4', nome: 'Oito', data_nascimento: '1904-10-08' },
      { id: '5', nome: 'Ontem', data_nascimento: '1904-09-29' }, { id: '6', nome: 'Sem', data_nascimento: null },
    ];
    expect(aniversariantesProximos(cs, HOJE).map(c => [c.id, c.diasAte, c.rotulo]))
      .toEqual([['1', 0, '🎂 Hoje!'], ['2', 1, 'Amanhã'], ['3', 7, 'Em 7 dias']]);
  });
  it('virada de ano e 29/02 em ano não bissexto', () => {
    expect(aniversariantesProximos([{ id: 'x', nome: 'X', data_nascimento: '1904-01-02' }], '2026-12-28')[0])
      .toMatchObject({ diasAte: 5, dataAniversario: '2027-01-02' });
    expect(aniversariantesProximos([{ id: 'y', nome: 'Y', data_nascimento: '1904-02-29' }], '2027-02-25')[0])
      .toMatchObject({ diasAte: 3, dataAniversario: '2027-02-28' });
  });
});

describe('despesas vencendo, meta, comandas e navegação', () => {
  it('janela de 7 dias', () => {
    expect(janelaDespesasVencendo(HOJE)).toEqual({ de: '2026-09-30', ate: '2026-10-07' });
  });
  it('meta mensal', () => {
    expect(progressoMetaEmpresa(5000, 10000)).toEqual({ temMeta: true, percentual: 50, atingida: false, faltam: 5000, acima: 0 });
    expect(progressoMetaEmpresa(12000, '10000')).toEqual({ temMeta: true, percentual: 100, atingida: true, faltam: 0, acima: 2000 });
    expect(progressoMetaEmpresa(100, 0).temMeta).toBe(false);
    expect(progressoMetaEmpresa(100, null).temMeta).toBe(false);
    const fmt = (v: number) => `R$ ${v}`;
    expect(rotuloProgressoMeta(progressoMetaEmpresa(5000, 10000), fmt)).toBe('50% concluído · faltam R$ 5000');
    expect(rotuloProgressoMeta(progressoMetaEmpresa(12000, 10000), fmt)).toBe('Meta atingida! +R$ 2000 acima');
  });
  it('comandas não fechadas', () => {
    expect(resumoComandasNaoFechadas([])).toEqual({ quantidade: 0, maisAntiga: null });
    expect(resumoComandasNaoFechadas([{ id: 'a', data_hora_inicio: 'x' }, { id: 'b', data_hora_inicio: 'y' }]))
      .toEqual({ quantidade: 2, maisAntiga: { id: 'a', data_hora_inicio: 'x' } });
  });
  it('navegação de mês (nunca o futuro)', () => {
    expect(navegacaoMesDashboard(undefined, HOJE)).toEqual({ chave: '2026-09', isMesAtual: true, anterior: '2026-08', seguinte: null });
    expect(navegacaoMesDashboard('2026-03', HOJE)).toEqual({ chave: '2026-03', isMesAtual: false, anterior: '2026-02', seguinte: '2026-04' });
    for (const x of ['2026-10', '2026-13', 'abc']) expect(navegacaoMesDashboard(x, HOJE).chave).toBe('2026-09');
    expect(navegacaoMesDashboard('2025-12', HOJE).seguinte).toBe('2026-01');
  });
});

describe('sparkline (mesma geometria no web e no app)', () => {
  it('linha, área e último ponto', () => {
    const g = geometriaSparkline([10, 20]);
    expect(g.linha).toBe('M8.0,74.0 L99.0,43.0 L190.0,12.0');
    expect(g.area).toBe('M8.0,74.0 L99.0,43.0 L190.0,12.0 L190.0,74 L8,74 Z');
    expect(g.ultimo).toEqual({ x: 190, y: 12 });
    expect(g.vazio).toBe(false);
    expect(geometriaSparkline([10, 20], 200, 80, 0).linha).toBe('M8.0,74.0 L99.0,74.0 L190.0,74.0');
    expect(geometriaSparkline([]).linha).toBe('M8.0,74.0 L190.0,74.0');
    expect(geometriaSparkline([0, 0]).vazio).toBe(true);
  });
});

describe('cartões de KPI do mês (mesma lista nas duas plataformas)', () => {
  const k = calcularKpisFinanceiros(fixtureSetembro(), limitesMes('2026-09'));
  const kAnt = calcularKpisFinanceiros(fixtureSetembro(), limitesMes('2026-08'));
  const fmt = (v: number) => `R$${v}`;
  it('não dona', () => {
    const c = cartoesKpiDashboard(k, kAnt, { isOwner: false, retiradasMes: 0, emprestimosAbertos: 0, fmt });
    expect(c.map(x => x.id)).toEqual(['liquido', 'lucro', 'comissoes', 'cancelamento']);
    expect(c[0]).toMatchObject({ rotulo: 'Líquido após taxas', valor: 'R$552.5' });
    expect(c[1]).toMatchObject({ rotulo: 'Lucro do mês', valor: 'R$117', delta: 368, sub: null });
    expect(c[2]).toMatchObject({ sub: 'R$80 de R$140 pendente', subDestaque: true });
    expect(c[3]).toMatchObject({ valor: '33.3%', sub: '2 perdido(s)' });
  });
  it('dona com retiradas e empréstimos', () => {
    const c = cartoesKpiDashboard(k, kAnt, { isOwner: true, retiradasMes: 17, emprestimosAbertos: 50, fmt });
    expect(c[1].sub).toBe('Após retiradas R$100');
    expect(c.map(x => x.id)).toEqual(['liquido', 'lucro', 'comissoes', 'cancelamento', 'donaDeve']);
  });
});
