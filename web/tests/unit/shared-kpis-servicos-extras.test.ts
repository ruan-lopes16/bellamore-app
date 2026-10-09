// web/tests/unit/shared-kpis-servicos-extras.test.ts
// Serviços extras da comanda entram no faturamento (decisão do dono, 2026-10-08).
import { describe, expect, it } from 'vitest';
import { limitesDias, limitesMes } from '@shared/periodos';
import {
  calcularKpisFinanceiros, recortarDados, evolucaoMensal, serieFaturamento, receitaAcumuladaPorDia,
  rankingAtendimentos, receitaExtrasPorProfissional, valorServicoExtra, type DadosFinanceiros, type ServicoExtraFinRow,
} from '@shared/kpis-financeiros';
import { carregarDadosFinanceiros, carregarServicosExtras, COLUNAS_SERVICO_EXTRA_FIN } from '@shared/kpis-financeiros-consultas';
import {
  cartoesKpiRelatorio, linhasResumoFinanceiro, linhasAtendimentosRelatorio, STATUS_SERVICO_EXTRA,
} from '@shared/relatorios';
import { fixtureSetembro } from './fixtures/kpis-setembro-2026';
import { fakeDb, opsDe } from './fixtures/fake-db';

const SET = limitesMes('2026-09');
const OUT = limitesMes('2026-10');

const EXTRAS: ServicoExtraFinRow[] = [
  // 40 × 2 = 80, setembro, profissional p1, serviço s1, cliente c1
  { id: 'e1', valor_unit: 40, quantidade: 2, profissional_id: 'p1', servico_id: 's1', fechada_at: '2026-09-10T15:00:00Z',
    cliente_id: 'c1', servico: { nome: 'Limpeza de pele' }, profissional: { nome: 'Ana' }, cliente: { nome: 'Carla' } },
  // numeric como string; 30/09 23:59 BRT → setembro; sem profissional
  { id: 'e2', valor_unit: '25.50', quantidade: '1.000', profissional_id: null, servico_id: 's3', descricao: 'Design de sobrancelha',
    fechada_at: '2026-10-01T02:59:00Z', cliente_id: null, servico: { nome: 'Sobrancelha' }, profissional: null, cliente: null },
  // 01/10 00:00 BRT → outubro
  { id: 'e3', valor_unit: 30, quantidade: 1, profissional_id: 'p2', servico_id: 's2', fechada_at: '2026-10-01T03:00:00Z',
    cliente_id: 'c2', servico: { nome: 'Drenagem' }, profissional: { nome: 'Bia' }, cliente: { nome: 'Duda' } },
];

function comExtras(): DadosFinanceiros {
  return { ...fixtureSetembro(), servicosExtras: EXTRAS };
}

describe('calcularKpisFinanceiros com serviços extras', () => {
  const sem = calcularKpisFinanceiros(fixtureSetembro(), SET);
  const k = calcularKpisFinanceiros(comExtras(), SET);

  it('sem extras os números de setembro não mudam', () => {
    expect(sem).toMatchObject({ receitaServicosExtras: 0, bruto: 560, lucro: 117, ticketMedio: 175 });
  });
  it('receita dos extras = valor_unit × quantidade, recortada por fechada_at em Brasília', () => {
    expect(k.receitaServicosExtras).toBe(105.5);
    expect(k.receitaServicos).toBe(350);
    expect(calcularKpisFinanceiros(comExtras(), OUT).receitaServicosExtras).toBe(30);
  });
  it('bruto, líquido e lucro incluem os extras; comissões e despesas não mudam', () => {
    expect(k.bruto).toBe(665.5);
    expect(k.liquidoAposTaxas).toBe(658);
    expect(k.lucro).toBe(222.5);
    expect(k.comissoes).toBe(sem.comissoes);
    expect(k.despesas).toBe(sem.despesas);
  });
  it('ticket médio = (serviços + extras) ÷ atendimentos faturáveis; extra não é atendimento', () => {
    expect(k.atendimentos).toBe(sem.atendimentos);
    expect(k.atendimentosFaturaveis).toBe(2);
    expect(k.ticketMedio).toBe(227.75);
  });
  it('fechamento importado continua substituindo a receita do mês inteiro (extras inclusos)', () => {
    const dados = { ...comExtras(), fechamentos: [{ mes: '2026-09-01', receita_bruta: 1000, comissao_paga: 300 }] };
    expect(calcularKpisFinanceiros(dados, SET).bruto).toBe(1000);
    // semana parcial dentro do mês importado: cálculo ao vivo, com o extra do dia 10
    expect(calcularKpisFinanceiros(dados, limitesDias('2026-09-10', '2026-09-10')).bruto).toBe(280);
  });
  it('recortarDados recorta os extras pelos limites', () => {
    expect(recortarDados(comExtras(), SET).servicosExtras.map(x => x.id)).toEqual(['e1', 'e2']);
    expect(recortarDados(comExtras(), OUT).servicosExtras.map(x => x.id)).toEqual(['e3']);
  });
  it('valorServicoExtra aceita numeric em string', () => {
    expect(valorServicoExtra({ valor_unit: '12.5', quantidade: '2' })).toBe(25);
  });
});

describe('séries incluem os extras pelo dia/mês do fechamento', () => {
  it('evolucaoMensal', () => {
    const [set, out] = evolucaoMensal(comExtras(), ['2026-09', '2026-10']);
    const [setSem, outSem] = evolucaoMensal(fixtureSetembro(), ['2026-09', '2026-10']);
    expect(set.bruto - setSem.bruto).toBeCloseTo(105.5);
    expect(out.bruto - outSem.bruto).toBeCloseTo(30);
  });
  it('serieFaturamento por dia', () => {
    const serie = serieFaturamento(comExtras(), limitesDias('2026-09-29', '2026-09-30'));
    const sem = serieFaturamento(fixtureSetembro(), limitesDias('2026-09-29', '2026-09-30'));
    expect(serie[1].valor - sem[1].valor).toBeCloseTo(25.5);
    expect(serie[0].valor).toBe(sem[0].valor);
  });
  it('receitaAcumuladaPorDia', () => {
    const com = receitaAcumuladaPorDia(comExtras(), SET, '2026-09-10');
    const sem = receitaAcumuladaPorDia(fixtureSetembro(), SET, '2026-09-10');
    expect(com[8]).toBe(sem[8]);
    expect(com[9] - sem[9]).toBe(80);
  });
});

describe('rankings atribuem os extras sem contar atendimento', () => {
  const d = recortarDados(comExtras(), SET);
  it('por serviço: receita soma; extra de serviço sem atendimento aparece com quantidade 0', () => {
    const r = rankingAtendimentos(d.agendamentos, 'servico', d.servicosExtras);
    expect(r.map(x => [x.chave, x.nome, x.quantidade, x.receita])).toEqual([
      ['s1', 'Limpeza de pele', 2, 280],
      ['s2', 'Drenagem', 1, 150],
      ['s3', 'Sobrancelha', 0, 25.5],
    ]);
  });
  it('por profissional: extra sem profissional não é atribuído', () => {
    const r = rankingAtendimentos(d.agendamentos, 'profissional', d.servicosExtras);
    expect(r.map(x => [x.chave, x.quantidade, x.receita])).toEqual([['p1', 2, 280], ['p2', 1, 150]]);
  });
  it('por cliente (cliente da comanda)', () => {
    const r = rankingAtendimentos(d.agendamentos, 'cliente', d.servicosExtras);
    expect(r.find(x => x.chave === 'c1')).toMatchObject({ quantidade: 2, receita: 280 });
  });
  it('sem extras o ranking é o de antes', () => {
    expect(rankingAtendimentos(d.agendamentos, 'servico', [])).toEqual(rankingAtendimentos(d.agendamentos, 'servico'));
  });
  it('receita de extras por profissional (Equipe)', () => {
    expect(receitaExtrasPorProfissional(EXTRAS)).toEqual({ p1: 80, p2: 30 });
  });
});

describe('Relatórios: linhas que listam a receita', () => {
  const fmt = (v: number) => `R$${v}`;
  const k = calcularKpisFinanceiros(comExtras(), SET);
  it('resumo financeiro tem "Serviços extras" logo após "Serviços concluídos"', () => {
    const l = linhasResumoFinanceiro(k, { isOwner: false, retiradasPeriodo: 0 });
    expect(l.slice(0, 3).map(x => [x.id, x.rotulo, x.valor])).toEqual([
      ['servicos', 'Serviços concluídos', 350],
      ['servicosExtras', 'Serviços extras', 105.5],
      ['vendas', 'Vendas avulsas', 130],
    ]);
    const entradas = l.filter(x => x.tipo === 'entrada').reduce((s, x) => s + x.valor, 0);
    expect(entradas).toBeCloseTo(k.bruto);
  });
  it('sem extras a linha não aparece', () => {
    const l = linhasResumoFinanceiro(calcularKpisFinanceiros(fixtureSetembro(), SET), { isOwner: false, retiradasPeriodo: 0 });
    expect(l.some(x => x.id === 'servicosExtras')).toBe(false);
  });
  it('cartão do bruto cita os extras', () => {
    const c = cartoesKpiRelatorio(k, k, { periodo: 'mes', isOwner: false, retiradasPeriodo: 0, fmt });
    expect(c[0].sub).toBe('inc. R$130 em vendas + R$105.5 em serviços extras');
  });
  it('exportação da aba Financeiro: concluídos + extras em ordem cronológica', () => {
    const linhas = linhasAtendimentosRelatorio(recortarDados(comExtras(), SET));
    expect(linhas.map(x => [x.inicio, x.servico, x.valor, x.status])).toEqual([
      ['2026-09-10T13:00:00Z', 'Limpeza de pele', 200, 'concluido'],
      ['2026-09-10T15:00:00Z', 'Limpeza de pele', 80, STATUS_SERVICO_EXTRA],
      ['2026-09-12T14:00:00Z', 'Limpeza de pele', 300, 'concluido'],
      ['2026-10-01T02:30:00Z', 'Drenagem', 150, 'concluido'],
      ['2026-10-01T02:59:00Z', 'Sobrancelha', 25.5, STATUS_SERVICO_EXTRA],
    ]);
  });
});

describe('carregarServicosExtras (consulta única web + app)', () => {
  const bruto = {
    id: 'e1', valor_unit: '40.00', quantidade: '2.000', profissional_id: 'p1', servico_id: 's1', descricao: 'Limpeza',
    servico: { nome: 'Limpeza de pele' }, profissional: { nome: 'Ana' },
    comanda: { fechada_at: '2026-09-10T15:00:00Z', status: 'fechada', clientes_id: 'c1', cliente: { nome: 'Carla' } },
  };
  it('itens de serviço de comandas fechadas, fechada_at nos limites de Brasília, ordem estável', async () => {
    const { db, chamadas } = fakeDb({ linhas: { comanda_itens: [bruto] } });
    await carregarServicosExtras(db, 'emp', SET);
    const [ops] = opsDe(chamadas, 'comanda_itens');
    expect(ops).toContainEqual(['select', [COLUNAS_SERVICO_EXTRA_FIN]]);
    expect(COLUNAS_SERVICO_EXTRA_FIN).toContain('comanda:comandas!inner(');
    expect(ops).toContainEqual(['eq', ['empresa_id', 'emp']]);
    expect(ops).toContainEqual(['eq', ['tipo', 'servico']]);
    expect(ops).toContainEqual(['eq', ['comanda.status', 'fechada']]);
    expect(ops).toContainEqual(['gte', ['comanda.fechada_at', '2026-09-01T03:00:00.000Z']]);
    expect(ops).toContainEqual(['lte', ['comanda.fechada_at', '2026-10-01T02:59:59.999Z']]);
    expect(ops).toContainEqual(['order', ['id']]);
    expect(ops).toContainEqual(['range', [0, 999]]);
  });
  it('achata a comanda (fechada_at, cliente) na linha', async () => {
    const { db } = fakeDb({ linhas: { comanda_itens: [bruto, { ...bruto, id: 'oculta', comanda: null }] } });
    const r = await carregarServicosExtras(db, 'emp', SET);
    expect(r).toEqual([{
      id: 'e1', valor_unit: '40.00', quantidade: '2.000', profissional_id: 'p1', servico_id: 's1', descricao: 'Limpeza',
      servico: { nome: 'Limpeza de pele' }, profissional: { nome: 'Ana' },
      fechada_at: '2026-09-10T15:00:00Z', cliente_id: 'c1', cliente: { nome: 'Carla' },
    }]);
  });
  it('pagina além de 1000 linhas', async () => {
    const muitos = Array.from({ length: 1200 }, (_, i) => ({ ...bruto, id: `e${i}` }));
    const { db, chamadas } = fakeDb({ linhas: { comanda_itens: muitos } });
    expect(await carregarServicosExtras(db, 'emp', SET)).toHaveLength(1200);
    expect(opsDe(chamadas, 'comanda_itens')).toHaveLength(2);
  });
  it('carregarDadosFinanceiros traz os extras e lança o erro do banco', async () => {
    const { db } = fakeDb({ linhas: { comanda_itens: [bruto] } });
    const dados = await carregarDadosFinanceiros(db, 'emp', SET);
    expect(dados.servicosExtras.map(x => x.id)).toEqual(['e1']);
    expect(calcularKpisFinanceiros(dados, SET).receitaServicosExtras).toBe(80);
    await expect(carregarDadosFinanceiros(fakeDb({ erroEm: 'comanda_itens' }).db, 'emp', SET)).rejects.toThrow('falha em comanda_itens');
  });
});
