import { describe, expect, it } from 'vitest';
import { limitesDias, limitesMes, uniaoLimites } from '@shared/periodos';
import {
  calcularKpisFinanceiros, recortarDados, variacaoPercentual, resultadoAposRetiradas,
  retiradasDoPeriodo, listarRetiradasDoPeriodo, ehAtendimentoFaturavel, DADOS_VAZIOS, KPIS_ZERADOS,
} from '@shared/kpis-financeiros';
import { fixtureSetembro } from './fixtures/kpis-setembro-2026';

const SET = limitesMes('2026-09');

describe('calcularKpisFinanceiros — setembro/2026', () => {
  const k = calcularKpisFinanceiros(fixtureSetembro(), SET);

  it('bruto = serviços concluídos sem pacote + vendas + taxas pagas (pagamentos não entram)', () => {
    expect(k.receitaServicos).toBe(350);
    expect(k.receitaVendas).toBe(130);
    expect(k.receitaTaxasCancelamento).toBe(50);
    expect(k.receitaTaxasReserva).toBe(30);
    expect(k.bruto).toBe(560);
  });
  it('taxa de cartão só onde há valor_liquido', () => {
    expect(k.taxasCartao).toBe(7.5);
    expect(k.liquidoAposTaxas).toBe(552.5);
  });
  it('comissões da tabela comissoes, por created_at em Brasília', () => {
    expect(k.comissoes).toBe(140);
    expect(k.comissoesPendentes).toBe(80);
  });
  it('despesas: só pagas, por data_pagamento (pendente fica fora mesmo com data)', () => {
    expect(k.despesas).toBe(295.5);
  });
  it('lucro = bruto − cartão − comissões − despesas', () => {
    expect(k.lucro).toBe(117);
  });
  it('ticket médio = serviços sem pacote ÷ atendimentos sem pacote', () => {
    expect(k.atendimentos).toBe(3);
    expect(k.atendimentosFaturaveis).toBe(2);
    expect(k.ticketMedio).toBe(175);
  });
  it('cancelamento e comparecimento', () => {
    expect(k.totalAgendamentos).toBe(6);
    expect(k.cancelados).toBe(1);
    expect(k.faltas).toBe(1);
    expect(k.perdidos).toBe(2);
    expect(k.pctCancelamento).toBeCloseTo(33.33, 2);
    expect(k.pctComparecimento).toBe(75);
    expect(k.mesesComFechamento).toEqual([]);
  });
});

describe('fronteira de Brasília no último dia do mês', () => {
  it('outubro só recebe o que começou a partir de 01/10 00:00 BRT', () => {
    const k = calcularKpisFinanceiros(fixtureSetembro(), limitesMes('2026-10'));
    expect(k.bruto).toBe(500);
    expect(k.taxasCartao).toBe(0);
    expect(k.comissoes).toBe(0);
    expect(k.despesas).toBe(999);
    expect(k.lucro).toBe(-499);
  });
  it('agosto recebe a reserva paga em 31/08 20:00 BRT (23:00 UTC)', () => {
    expect(calcularKpisFinanceiros(fixtureSetembro(), limitesMes('2026-08')).bruto).toBe(25);
  });
});

describe('fechamento mensal importado', () => {
  const comFechamento = (...linhas: { mes: string; receita_bruta: number; comissao_paga: number }[]) =>
    ({ ...fixtureSetembro(), fechamentos: linhas });

  it('substitui receita e comissão do mês inteiro e zera a taxa de cartão', () => {
    const k = calcularKpisFinanceiros(comFechamento({ mes: '2026-09-01', receita_bruta: 1000, comissao_paga: 300 }), SET);
    expect(k.bruto).toBe(1000);
    expect(k.comissoes).toBe(300);
    expect(k.taxasCartao).toBe(0);
    expect(k.despesas).toBe(295.5);
    expect(k.lucro).toBe(404.5);
    expect(k.mesesComFechamento).toEqual(['2026-09']);
    expect(k.receitaServicos).toBe(350); // detalhamento continua ao vivo
    expect(k.ticketMedio).toBe(175);
  });
  it('período parcial do mês importado usa o cálculo ao vivo', () => {
    const k = calcularKpisFinanceiros(
      comFechamento({ mes: '2026-09-01', receita_bruta: 1000, comissao_paga: 300 }),
      limitesDias('2026-09-01', '2026-09-15'),
    );
    expect(k.bruto).toBe(320);
    expect(k.lucro).toBe(-17.5);
    expect(k.mesesComFechamento).toEqual([]);
  });
  it('vários meses: importado onde há fechamento, ao vivo nos demais', () => {
    const k = calcularKpisFinanceiros(
      comFechamento({ mes: '2026-08-01', receita_bruta: 700, comissao_paga: 200 }),
      limitesDias('2026-08-01', '2026-09-30'),
    );
    expect(k.bruto).toBe(1260);
    expect(k.comissoes).toBe(340);
    expect(k.taxasCartao).toBe(7.5);
    expect(k.lucro).toBe(617);
    expect(k.mesesComFechamento).toEqual(['2026-08']);
  });
});

describe('recorte e casos vazios', () => {
  it('período vazio → tudo zero', () => {
    expect(calcularKpisFinanceiros(DADOS_VAZIOS, SET)).toEqual(KPIS_ZERADOS);
  });
  it('o resultado não depende do tamanho da janela buscada', () => {
    const superconjunto = fixtureSetembro();
    const recortado = recortarDados(superconjunto, uniaoLimites(limitesMes('2026-08'), SET));
    expect(calcularKpisFinanceiros(recortado, SET)).toEqual(calcularKpisFinanceiros(superconjunto, SET));
  });
  it('recortarDados tira o que está fora e as despesas pendentes', () => {
    const r = recortarDados(fixtureSetembro(), SET);
    expect(r.agendamentos.map(a => a.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a7']);
    expect(r.despesas.map(d => d.id)).toEqual(['d1', 'd2']);
    expect(r.taxasReserva.map(t => t.id)).toEqual(['r1']);
  });
  it('ehAtendimentoFaturavel', () => {
    expect(ehAtendimentoFaturavel({ status: 'concluido', pacote_cliente_id: null })).toBe(true);
    expect(ehAtendimentoFaturavel({ status: 'concluido', pacote_cliente_id: 'pc' })).toBe(false);
    expect(ehAtendimentoFaturavel({ status: 'faltou', pacote_cliente_id: null })).toBe(false);
  });
});

describe('variacaoPercentual (deltas vs período anterior)', () => {
  it('arredonda para inteiro', () => {
    expect(variacaoPercentual(110, 100)).toBe(10);
    expect(variacaoPercentual(90, 100)).toBe(-10);
  });
  it('base zero → null', () => {
    expect(variacaoPercentual(50, 0)).toBeNull();
    expect(variacaoPercentual(0, 0)).toBeNull();
  });
  it('base negativa (lucro) usa o módulo: melhorar é positivo', () => {
    expect(variacaoPercentual(-50, -100)).toBe(50);
    expect(variacaoPercentual(100, -100)).toBe(200);
  });
});

describe('retiradas da dona', () => {
  const rows = [
    { id: 'x', tipo: 'retirada' as const, valor: 50, data: '2026-09-10', convertido_em: null },
    { id: 'y', tipo: 'emprestimo' as const, valor: 200, data: '2026-08-01', convertido_em: '2026-09-20' },
    { id: 'z', tipo: 'retirada' as const, valor: 70, data: '2026-10-02', convertido_em: null },
  ];
  const devs = [{ retirada_id: 'y', valor: 80 }];
  it('retiradas do período = retiradas + empréstimos convertidos (saldo em aberto)', () => {
    expect(retiradasDoPeriodo(rows, devs, SET)).toBe(170);
  });
  it('após retiradas = lucro − retiradas', () => {
    expect(resultadoAposRetiradas(117, 170)).toBe(-53);
  });
  it('lista do período = data ou conversão no período, mais recente primeiro', () => {
    expect(listarRetiradasDoPeriodo(rows, SET).map(r => r.id)).toEqual(['x', 'y']);
  });
});
