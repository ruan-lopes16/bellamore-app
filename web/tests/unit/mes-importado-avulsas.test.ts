// web/tests/unit/mes-importado-avulsas.test.ts
// Item 4 (Entrega 4): mês com fechamento importado inteiro no período — extras, vendas e taxas
// avulsas desse mês não aparecem como linha própria; ficam "incluídos no fechamento importado".
import { describe, expect, it } from 'vitest';
import { limitesDias, limitesMes } from '@shared/periodos';
import {
  calcularKpisFinanceiros, cartoesReceitasAvulsas, notaAvulsasNoFechamento, KPIS_ZERADOS,
  type DadosFinanceiros, type ServicoExtraFinRow,
} from '@shared/kpis-financeiros';
import { cartoesKpiRelatorio, linhasResumoFinanceiro, linhasAtendimentosRelatorio, STATUS_SERVICO_EXTRA } from '@shared/relatorios';
import { recortarDados } from '@shared/kpis-financeiros';
import { formatarMoeda } from '@shared/moeda';
import { fixtureSetembro } from './fixtures/kpis-setembro-2026';

const SET = limitesMes('2026-09');
const EXTRA: ServicoExtraFinRow = {
  id: 'e1', valor_unit: 40, quantidade: 2, profissional_id: 'p1', servico_id: 's1', fechada_at: '2026-09-10T15:00:00Z',
  cliente_id: 'c1', servico: { nome: 'Limpeza de pele' }, profissional: { nome: 'Ana' }, cliente: { nome: 'Carla' },
};
const EXTRA_OUT: ServicoExtraFinRow = { ...EXTRA, id: 'e2', fechada_at: '2026-10-10T15:00:00Z' };

function dados(importado: boolean): DadosFinanceiros {
  return {
    ...fixtureSetembro(),
    servicosExtras: [EXTRA, EXTRA_OUT],
    fechamentos: importado ? [{ mes: '2026-09-01', receita_bruta: 1000, comissao_paga: 300 }] : [],
  };
}
const opts = { periodo: 'mes' as const, isOwner: false, retiradasPeriodo: 0, fmt: formatarMoeda };

describe('sem fechamento importado: nada muda', () => {
  const k = calcularKpisFinanceiros(dados(false), SET);
  it('avulsas exibidas = receitas ao vivo', () => {
    expect(k.avulsasForaDoFechamento).toEqual({ servicosExtras: 80, vendas: 130, taxasCancelamento: 50, taxasReserva: 30 });
    expect(notaAvulsasNoFechamento(k)).toBeNull();
  });
  it('Financeiro mostra os cartões de extras e taxas', () => {
    expect(cartoesReceitasAvulsas(k).map(c => [c.id, c.valor])).toEqual([
      ['servicosExtras', 80], ['taxasCancelamento', 50], ['taxasReserva', 30],
    ]);
  });
  it('Relatórios mostra as linhas de extras, vendas e taxas', () => {
    const ids = linhasResumoFinanceiro(k, { isOwner: false, retiradasPeriodo: 0 }).map(l => l.id);
    expect(ids).toEqual(expect.arrayContaining(['servicosExtras', 'vendas', 'taxas']));
    expect(cartoesKpiRelatorio(k, KPIS_ZERADOS, opts).map(c => c.id)).toContain('taxas');
  });
});

describe('mês importado inteiro: avulsas incluídas no fechamento', () => {
  const k = calcularKpisFinanceiros(dados(true), SET);
  it('bruto é o importado e as avulsas exibidas zeram', () => {
    expect(k.bruto).toBe(1000);
    expect(k.avulsasForaDoFechamento).toEqual({ servicosExtras: 0, vendas: 0, taxasCancelamento: 0, taxasReserva: 0 });
  });
  it('nota única diz que estão incluídas no fechamento importado', () => {
    expect(notaAvulsasNoFechamento(k)).toBe('Serviços extras, vendas e taxas de Setembro 2026 estão incluídos no fechamento importado.');
  });
  it('Financeiro (web e app) sem cartões de extras/taxas', () => {
    expect(cartoesReceitasAvulsas(k)).toEqual([]);
  });
  it('Relatórios: resumo sem linhas avulsas, cartão sem "taxas" e sem "inc." no bruto', () => {
    const ids = linhasResumoFinanceiro(k, { isOwner: false, retiradasPeriodo: 0 }).map(l => l.id);
    expect(ids).not.toContain('servicosExtras');
    expect(ids).not.toContain('vendas');
    expect(ids).not.toContain('taxas');
    const cartoes = cartoesKpiRelatorio(k, KPIS_ZERADOS, opts);
    expect(cartoes.map(c => c.id)).not.toContain('taxas');
    expect(cartoes.find(c => c.id === 'bruto')?.sub).toBeNull();
  });
  it('exportação da aba Financeiro sem linhas de serviço extra do mês importado', () => {
    const linhas = linhasAtendimentosRelatorio(recortarDados(dados(true), SET), k.mesesComFechamento);
    expect(linhas.some(l => l.status === STATUS_SERVICO_EXTRA)).toBe(false);
    // sem fechamento, a linha do extra continua
    const ao = linhasAtendimentosRelatorio(recortarDados(dados(false), SET), []);
    expect(ao.filter(l => l.status === STATUS_SERVICO_EXTRA)).toHaveLength(1);
  });
});

describe('período misto: só o mês importado some', () => {
  const l = limitesDias('2026-09-01', '2026-10-31');
  const k = calcularKpisFinanceiros(dados(true), l);
  it('extras/vendas/taxas de outubro (ao vivo) continuam como linha própria', () => {
    expect(k.mesesComFechamento).toEqual(['2026-09']);
    expect(k.avulsasForaDoFechamento.servicosExtras).toBe(80);
    expect(linhasResumoFinanceiro(k, { isOwner: false, retiradasPeriodo: 0 }).find(x => x.id === 'servicosExtras')?.valor).toBe(80);
  });
  it('exportação mantém só o extra de outubro', () => {
    const linhas = linhasAtendimentosRelatorio(recortarDados(dados(true), l), k.mesesComFechamento);
    expect(linhas.filter(x => x.status === STATUS_SERVICO_EXTRA).map(x => x.inicio)).toEqual(['2026-10-10T15:00:00Z']);
  });
});

describe('semana parcial dentro do mês importado: cálculo ao vivo', () => {
  it('avulsas aparecem (o fechamento não se aplica)', () => {
    const k = calcularKpisFinanceiros(dados(true), limitesDias('2026-09-10', '2026-09-10'));
    expect(k.mesesComFechamento).toEqual([]);
    expect(k.avulsasForaDoFechamento.servicosExtras).toBe(80);
  });
});
