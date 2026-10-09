import { describe, expect, it } from 'vitest';
import { limitesDias, limitesMes } from '@shared/periodos';
import {
  evolucaoMensal, serieFaturamento, receitaAcumuladaPorDia, rankingAtendimentos,
  resumoMetodosPagamento, clientesAtendidosNoPeriodo, metricasRetorno, recortarDados,
  resumoComissoesPendentes, resumoComissoesProfissional, faturamentoPrevistoDia,
} from '@shared/kpis-financeiros';
import { fixtureSetembro } from './fixtures/kpis-setembro-2026';

const SET = limitesMes('2026-09');
const doMes = () => recortarDados(fixtureSetembro(), SET);

describe('evolucaoMensal (gráfico de 6 meses do Financeiro, web e mobile)', () => {
  it('um ponto por mês, com rótulo pt-BR e as mesmas regras do KPI', () => {
    expect(evolucaoMensal(fixtureSetembro(), ['2026-08', '2026-09', '2026-10'])).toEqual([
      { chave: '2026-08', rotulo: 'ago', bruto: 25,  comissoes: 0,   despesas: 0,     taxasCartao: 0,   lucro: 25 },
      { chave: '2026-09', rotulo: 'set', bruto: 560, comissoes: 140, despesas: 295.5, taxasCartao: 7.5, lucro: 117 },
      { chave: '2026-10', rotulo: 'out', bruto: 500, comissoes: 0,   despesas: 999,   taxasCartao: 0,   lucro: -499 },
    ]);
  });
});

describe('serieFaturamento (gráfico dos Relatórios)', () => {
  it('mês → semanas começando no domingo, soma = bruto do período', () => {
    const serie = serieFaturamento(fixtureSetembro(), SET);
    expect(serie.map(p => p.chave)).toEqual(['2026-09-01', '2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']);
    expect(serie.map(p => p.rotulo)).toEqual(['01/09', '06/09', '13/09', '20/09', '27/09']);
    expect(serie.map(p => p.valor)).toEqual([120, 200, 50, 0, 190]);
  });
  it('um dia → um ponto diário', () => {
    expect(serieFaturamento(fixtureSetembro(), limitesDias('2026-09-30', '2026-09-30')))
      .toEqual([{ chave: '2026-09-30', rotulo: '30/09', valor: 190 }]);
  });
  it('ano → meses, com fechamento importado no mês inteiro', () => {
    const ano = limitesDias('2026-01-01', '2026-12-31');
    const serie = serieFaturamento(fixtureSetembro(), ano);
    expect(serie).toHaveLength(12);
    expect(serie[7]).toEqual({ chave: '2026-08', rotulo: 'ago', valor: 25 });
    expect(serie[8].valor).toBe(560);
    const comFech = { ...fixtureSetembro(), fechamentos: [{ mes: '2026-09-01', receita_bruta: 1000, comissao_paga: 300 }] };
    expect(serieFaturamento(comFech, ano)[8].valor).toBe(1000);
  });
});

describe('receitaAcumuladaPorDia (sparkline do Dashboard)', () => {
  it('acumula o bruto dia a dia até o dia pedido', () => {
    expect(receitaAcumuladaPorDia(fixtureSetembro(), SET, '2026-09-05')).toEqual([0, 30, 30, 30, 120]);
  });
});

describe('rankingAtendimentos', () => {
  it('por serviço: quantidade conta todos os concluídos, receita só os sem pacote', () => {
    expect(rankingAtendimentos(doMes().agendamentos, 'servico')).toEqual([
      { chave: 's1', nome: 'Limpeza de pele', quantidade: 2, receita: 200, percentual: 100 },
      { chave: 's2', nome: 'Drenagem',        quantidade: 1, receita: 150, percentual: 75 },
    ]);
  });
  it('por profissional e por cliente', () => {
    expect(rankingAtendimentos(doMes().agendamentos, 'profissional').map(r => [r.nome, r.quantidade, r.receita]))
      .toEqual([['Ana', 2, 200], ['Bia', 1, 150]]);
    expect(rankingAtendimentos(doMes().agendamentos, 'cliente').map(r => [r.nome, r.quantidade, r.receita]))
      .toEqual([['Carla', 2, 200], ['Duda', 1, 150]]);
  });
  it('sem atendimentos → lista vazia', () => {
    expect(rankingAtendimentos([], 'servico')).toEqual([]);
  });
});

describe('resumoMetodosPagamento', () => {
  it('agrupa por método, % sobre o total, maior primeiro', () => {
    expect(resumoMetodosPagamento(doMes().pagamentos)).toEqual([
      { metodo: 'credito', valor: 200, quantidade: 1, percentual: 45 },
      { metodo: 'pix',     valor: 150, quantidade: 1, percentual: 34 },
      { metodo: 'debito',  valor: 90,  quantidade: 1, percentual: 20 },
    ]);
  });
});

describe('clientes que retornaram (regra única: atendida no período E antes dele)', () => {
  it('clientes atendidas no período (concluídos, com ou sem pacote)', () => {
    expect(clientesAtendidosNoPeriodo(doMes().agendamentos)).toEqual(['c1', 'c2']);
  });
  it('retornaram = já tinham atendimento concluído antes do período', () => {
    expect(metricasRetorno(doMes().agendamentos, new Set(['c1', 'c9'])))
      .toEqual({ atendidas: 2, retornaram: 1, novas: 1, pctRetorno: 50 });
  });
  it('período vazio', () => {
    expect(metricasRetorno([], [])).toEqual({ atendidas: 0, retornaram: 0, novas: 0, pctRetorno: 0 });
  });
});

describe('comissões', () => {
  it('pendentes (alerta do Dashboard): quantidade e total', () => {
    expect(resumoComissoesPendentes([{ valor_comissao: 80 }, { valor_comissao: '20.5' }]))
      .toEqual({ quantidade: 2, total: 100.5 });
  });
  it('resumo da profissional (área da profissional, web e mobile)', () => {
    expect(resumoComissoesProfissional([
      { agendamento_id: 'a1', valor_servico: 200, valor_comissao: 80, status: 'pendente' },
      { agendamento_id: 'a2', valor_servico: 150, valor_comissao: 60, status: 'pago' },
    ])).toEqual({
      faturamentoBruto: 350, comissaoTotal: 140, comissaoPaga: 60, comissaoPendente: 80,
      atendimentos: 2, comissaoMedia: 70,
    });
  });
  it('comissão de serviço extra da comanda (085, sem agendamento) soma no total mas não é atendimento', () => {
    expect(resumoComissoesProfissional([
      { agendamento_id: 'a1', valor_servico: 200, valor_comissao: 80, status: 'pendente' },
      { agendamento_id: null, valor_servico: 50,  valor_comissao: 20, status: 'pago' },
    ])).toEqual({
      faturamentoBruto: 250, comissaoTotal: 100, comissaoPaga: 20, comissaoPendente: 80,
      atendimentos: 1, comissaoMedia: 100,
    });
  });
  it('só extras: nenhum atendimento, média zero', () => {
    const r = resumoComissoesProfissional([{ agendamento_id: null, valor_servico: 50, valor_comissao: 20, status: 'pendente' }]);
    expect(r.atendimentos).toBe(0);
    expect(r.comissaoMedia).toBe(0);
    expect(r.comissaoTotal).toBe(20);
  });
});

describe('faturamentoPrevistoDia (Fat. hoje da profissional)', () => {
  it('ignora cancelados, faltas e sessões de pacote', () => {
    expect(faturamentoPrevistoDia([
      { valor: 100, status: 'agendado',   pacote_cliente_id: null },
      { valor: 50,  status: 'concluido',  pacote_cliente_id: null },
      { valor: 70,  status: 'faltou',     pacote_cliente_id: null },
      { valor: 40,  status: 'cancelado',  pacote_cliente_id: null },
      { valor: 300, status: 'confirmado', pacote_cliente_id: 'pc' },
    ])).toBe(150);
  });
});
