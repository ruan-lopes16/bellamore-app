// Receita depois da 090 (decisões do dono, 2026-10-15): desconto rateado sai da receita e a taxa
// de reserva conta pela paga_em só na parte que a comanda NÃO descontou (comandas.desconto_reserva).
import { describe, expect, it } from 'vitest';
import { limitesMes } from '@shared/periodos';
import {
  calcularKpisFinanceiros, rankingAtendimentos, receitaExtrasPorProfissional, valorServicoExtra,
  parteReservaNaoDescontada, valorCobradoAtendimento, type TaxaReservaComandaRow,
  DADOS_VAZIOS, type DadosFinanceiros, type AgendamentoFinRow, type ServicoExtraFinRow,
} from '@shared/kpis-financeiros';
import { linhasAtendimentosRelatorio } from '@shared/relatorios';
import { estatisticasDoMes } from '@shared/equipe';
import {
  carregarDadosFinanceiros, carregarServicosExtras, carregarTaxasReservaReceita, COLUNAS_AGENDAMENTO_FIN, COLUNAS_SERVICO_EXTRA_FIN,
} from '@shared/kpis-financeiros-consultas';
import { carregarEquipe } from '@shared/equipe-consultas';
import { fakeDb, opsDe } from './fixtures/fake-db';

const OUT = limitesMes('2026-10');

const ag = (id: string, valor: number, desconto_rateado: number | string | undefined, extra: Partial<AgendamentoFinRow> = {}): AgendamentoFinRow => ({
  id, valor, status: 'concluido', data_hora_inicio: '2026-10-10T13:00:00Z', pacote_cliente_id: null,
  cliente_id: 'c1', profissional_id: 'p1', servico_id: 's1', desconto_rateado, ...extra,
});
const extra = (id: string, valor_unit: number, quantidade: number, desconto_rateado: number | undefined): ServicoExtraFinRow => ({
  id, valor_unit, quantidade, desconto_rateado, profissional_id: 'p2', servico_id: 's2', fechada_at: '2026-10-10T15:00:00Z', cliente_id: 'c1',
});
const dados = (d: Partial<DadosFinanceiros>): DadosFinanceiros => ({ ...DADOS_VAZIOS, ...d });

describe('desconto rateado sai da receita', () => {
  it('serviço = valor − desconto_rateado (multi-serviço: o atendimento já guarda a soma das cotas)', () => {
    const k = calcularKpisFinanceiros(dados({ agendamentos: [ag('a1', 120, 12), ag('a2', 80, '8.00')] }), OUT);
    expect(k.receitaServicos).toBe(180);
    expect(k.bruto).toBe(180);
    expect(k.ticketMedio).toBe(90);
  });
  it('extra = valor_unit × quantidade − desconto_rateado', () => {
    const x = extra('x1', 40, 2, 5);
    expect(valorServicoExtra(x)).toBe(75);
    const k = calcularKpisFinanceiros(dados({ servicosExtras: [x] }), OUT);
    expect(k.receitaServicosExtras).toBe(75);
    expect(k.bruto).toBe(75);
  });
  it('coluna ausente (antes da 090) ou nula vale 0', () => {
    const k = calcularKpisFinanceiros(dados({
      agendamentos: [ag('a1', 120, undefined), ag('a2', 50, null as unknown as number)],
      servicosExtras: [extra('x1', 40, 1, undefined)],
    }), OUT);
    expect(k.receitaServicos).toBe(170);
    expect(k.receitaServicosExtras).toBe(40);
  });
  it('sessão de pacote continua fora (mesmo com desconto 0)', () => {
    const k = calcularKpisFinanceiros(dados({ agendamentos: [ag('a1', 0, 0, { pacote_cliente_id: 'pc' })] }), OUT);
    expect(k.receitaServicos).toBe(0);
    expect(k.atendimentos).toBe(1);
    expect(k.atendimentosFaturaveis).toBe(0);
  });
  it('rankings, faturado por profissional e exportação usam o valor com desconto', () => {
    const ags = [ag('a1', 120, 20)];
    const xs = [extra('x1', 40, 1, 10)];
    expect(rankingAtendimentos(ags, 'servico', xs).map(i => i.receita)).toEqual([100, 30]);
    expect(receitaExtrasPorProfissional(xs)).toEqual({ p2: 30 });
    expect(linhasAtendimentosRelatorio({ agendamentos: ags, servicosExtras: xs }).map(l => l.valor)).toEqual([100, 30]);
    expect(estatisticasDoMes([{ profissional_id: 'p1', valor: 120, desconto_rateado: 20, pacote_cliente_id: null }], {}))
      .toEqual({ p1: { total: 100, atendimentos: 1 } });
  });
});

describe('taxa de reserva: só a parte não descontada na comanda', () => {
  const tx = (id: string, valor: number, comanda_id: string | null, paga_em = '2026-10-02T12:00:00Z'): TaxaReservaComandaRow =>
    ({ id, valor, paga_em, comanda_id });
  const parte = (taxas: TaxaReservaComandaRow[], comandas: { id: string; desconto_reserva: number | string }[]) =>
    Object.fromEntries(parteReservaNaoDescontada(taxas, comandas));

  it('caso normal: taxa de R$ 10 descontada inteira na comanda → R$ 0 da taxa', () => {
    expect(parte([tx('r1', 10, 'C1')], [{ id: 'C1', desconto_reserva: 10 }])).toEqual({ r1: 0 });
  });
  it('sessão de pacote (desconto aplicado 0) → a taxa conta inteira', () => {
    expect(parte([tx('r1', 30, 'C1')], [{ id: 'C1', desconto_reserva: 0 }])).toEqual({ r1: 30 });
  });
  it('excesso sobre o total: só o resto conta', () => {
    // Atendimento de 120, desconto 100: a comanda só aplicou 20 dos 30 da reserva.
    expect(parte([tx('r1', 30, 'C1')], [{ id: 'C1', desconto_reserva: '20.00' }])).toEqual({ r1: 10 });
  });
  it('comanda de antes de 13/08 (desconto_reserva 0): conta inteira (a cliente pagou as duas coisas)', () => {
    expect(parte([tx('r1', 25, 'C1')], [{ id: 'C1', desconto_reserva: 0 }])).toEqual({ r1: 25 });
  });
  it('taxa sem comanda (retida, ou atendimento não fechado) conta inteira; comanda desconhecida também', () => {
    expect(parte([tx('r1', 30, null), tx('r2', 15, 'C9')], [])).toEqual({ r1: 30, r2: 15 });
  });
  it('várias taxas na mesma comanda: distribui em ordem (paga_em, id), cada uma até o próprio valor', () => {
    const r = parte([
      tx('rB', 20, 'C1', '2026-10-02T12:00:00Z'),
      tx('rA', 20, 'C1', '2026-09-28T12:00:00Z'), // paga antes (fora do período): recebe o desconto primeiro
      tx('rC', 5, 'C1', '2026-10-02T12:00:00Z'),
    ], [{ id: 'C1', desconto_reserva: 30 }]);
    expect(r).toEqual({ rA: 0, rB: 10, rC: 5 });
  });
  it('mesmo paga_em: desempate por id; centavos exatos', () => {
    expect(parte([tx('r2', 0.1, 'C1'), tx('r1', 0.2, 'C1')], [{ id: 'C1', desconto_reserva: 0.25 }]))
      .toEqual({ r1: 0, r2: 0.05 });
  });

  it('KPI: atendimento de 60 + taxa de 10 descontada → bruto 60 (a taxa não conta)', () => {
    const k = calcularKpisFinanceiros(dados({
      agendamentos: [ag('a1', 60, 0)],
      taxasReserva: [{ id: 'r1', valor: 10, paga_em: '2026-10-02T12:00:00Z', status: 'pago', valor_receita: 0 }],
    }), OUT);
    expect(k.receitaTaxasReserva).toBe(0);
    expect(k.bruto).toBe(60);
  });
  it('KPI: parte não descontada conta pela paga_em; sem valor_receita, a taxa inteira', () => {
    const k = calcularKpisFinanceiros(dados({
      taxasReserva: [
        { id: 'r1', valor: 30, paga_em: '2026-10-02T12:00:00Z', status: 'pago', valor_receita: 10 },
        { id: 'r2', valor: 30, paga_em: '2026-10-03T12:00:00Z', status: 'retida' },
        { id: 'r3', valor: 25, paga_em: '2026-09-30T12:00:00Z', status: 'retida' }, // setembro
      ],
    }), OUT);
    expect(k.receitaTaxasReserva).toBe(40);
    expect(k.bruto).toBe(40);
  });
  it('KPI: sem paga_em (nunca paga) e cancelada não contam', () => {
    const k = calcularKpisFinanceiros(dados({
      taxasReserva: [
        { id: 'r1', valor: 30, paga_em: null, status: 'retida' },
        { id: 'r2', valor: 30, paga_em: '2026-10-02T12:00:00Z', status: 'cancelada' },
      ],
    }), OUT);
    expect(k.receitaTaxasReserva).toBe(0);
  });
});

describe('valorCobradoAtendimento', () => {
  it('valor − desconto_rateado; coluna ausente ou nula vale 0; nunca negativo', () => {
    expect(valorCobradoAtendimento({ valor: 120, desconto_rateado: '20.00' })).toBe(100);
    expect(valorCobradoAtendimento({ valor: 120 })).toBe(120);
    expect(valorCobradoAtendimento({ valor: '80', desconto_rateado: null })).toBe(80);
    expect(valorCobradoAtendimento({ valor: 10, desconto_rateado: 15 })).toBe(0);
  });
});
describe('consultas: desconto_rateado com volta para antes da 090', () => {
  it('agendamentos e extras pedem desconto_rateado; reserva paga (paga_em) com agendamento_id, sem cancelada', async () => {
    expect(COLUNAS_AGENDAMENTO_FIN).toContain('desconto_rateado');
    expect(COLUNAS_SERVICO_EXTRA_FIN).toContain('desconto_rateado');
    const { db, chamadas } = fakeDb();
    await carregarDadosFinanceiros(db, 'emp', OUT);
    const [reserva] = opsDe(chamadas, 'taxas_reserva');
    expect(reserva).toContainEqual(['neq', ['status', 'cancelada']]);
    expect(reserva).toContainEqual(['not', ['paga_em', 'is', null]]);
    expect(reserva.some(([m, a]) => m === 'eq' && a[0] === 'status')).toBe(false);
    expect(reserva.find(([m]) => m === 'select')?.[1][0]).toContain('agendamento_id');
    // Sem taxa no período, nada mais é consultado para a reserva.
    expect(opsDe(chamadas, 'comandas')).toHaveLength(0);
  });

  it('reserva: busca comanda e desconto_reserva em lotes e calcula a parte não descontada', async () => {
    const { db, chamadas } = fakeDb({
      linhas: {
        taxas_reserva: [
          { id: 't1', valor: 10, paga_em: '2026-10-02T12:00:00Z', status: 'pago', agendamento_id: 'a1' },
          { id: 't2', valor: 30, paga_em: '2026-10-03T12:00:00Z', status: 'pago', agendamento_id: 'a2' },
          { id: 't3', valor: 20, paga_em: '2026-10-04T12:00:00Z', status: 'retida', agendamento_id: 'a3' },
        ],
        agendamentos: [{ id: 'a1', comanda_id: 'C1' }, { id: 'a2', comanda_id: 'C2' }, { id: 'a3', comanda_id: null }],
        comandas: [{ id: 'C1', desconto_reserva: '10.00' }, { id: 'C2', desconto_reserva: 20 }],
      },
    });
    const taxas = await carregarTaxasReservaReceita(db, 'emp', OUT);
    expect(taxas.map(t => [t.id, t.valor_receita])).toEqual([['t1', 0], ['t2', 10], ['t3', 20]]);
    const [agPorId, agPorComanda] = opsDe(chamadas, 'agendamentos');
    expect(agPorId).toContainEqual(['in', ['id', ['a1', 'a2', 'a3']]]);
    expect(agPorComanda).toContainEqual(['in', ['comanda_id', ['C1', 'C2']]]);
    const [comandas] = opsDe(chamadas, 'comandas');
    expect(comandas.find(([m]) => m === 'select')?.[1][0]).toContain('desconto_reserva');
    expect(comandas).toContainEqual(['eq', ['empresa_id', 'emp']]);
    const [, taxasDasComandas] = opsDe(chamadas, 'taxas_reserva');
    expect(taxasDasComandas).toContainEqual(['in', ['agendamento_id', ['a1', 'a2']]]);
    expect(calcularKpisFinanceiros(dados({ taxasReserva: taxas }), OUT).receitaTaxasReserva).toBe(30);
  });

  it('reserva: ids em lotes de 150 (.in), sem N+1', async () => {
    const n = 200;
    const { db, chamadas } = fakeDb({
      linhas: {
        taxas_reserva: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, valor: 10, paga_em: '2026-10-02T12:00:00Z', status: 'pago', agendamento_id: `a${i}` })),
        agendamentos: [],
      },
    });
    const taxas = await carregarTaxasReservaReceita(db, 'emp', OUT);
    expect(opsDe(chamadas, 'agendamentos')).toHaveLength(2);
    expect(opsDe(chamadas, 'comandas')).toHaveLength(0);
    expect(taxas.every(t => t.valor_receita == null)).toBe(true);
  });

  it('reserva: erro em comandas não é engolido', async () => {
    const { db } = fakeDb({
      linhas: {
        taxas_reserva: [{ id: 't1', valor: 10, paga_em: '2026-10-02T12:00:00Z', status: 'pago', agendamento_id: 'a1' }],
        agendamentos: [{ id: 'a1', comanda_id: 'C1' }],
      },
      erroEm: 'comandas',
    });
    await expect(carregarTaxasReservaReceita(db, 'emp', OUT)).rejects.toThrow('falha em comandas');
  });
  it('sem a coluna (42703) refaz agendamentos e extras sem ela e não quebra', async () => {
    const { db, chamadas } = fakeDb({
      linhas: {
        agendamentos: [{ id: 'a1', valor: 120, status: 'concluido', data_hora_inicio: '2026-10-10T13:00:00Z', pacote_cliente_id: null }],
        comanda_itens: [{ id: 'x1', valor_unit: 40, quantidade: 1, comanda: { fechada_at: '2026-10-10T15:00:00Z', clientes_id: null } }],
      },
      erroQuandoSelectContem: { agendamentos: 'desconto_rateado', comanda_itens: 'desconto_rateado' },
    });
    const d = await carregarDadosFinanceiros(db, 'emp', OUT);
    expect(d.agendamentos.map(a => a.id)).toEqual(['a1']);
    expect(d.servicosExtras.map(x => x.id)).toEqual(['x1']);
    expect(opsDe(chamadas, 'agendamentos')).toHaveLength(2);
    expect(opsDe(chamadas, 'agendamentos')[1].find(([m]) => m === 'select')?.[1][0]).not.toContain('desconto_rateado');
    expect(calcularKpisFinanceiros(d, OUT).bruto).toBe(160);
  });

  it('outro erro não é engolido', async () => {
    const { db } = fakeDb({ erroEm: 'agendamentos' });
    await expect(carregarDadosFinanceiros(db, 'emp', OUT)).rejects.toThrow('falha em agendamentos');
    const { db: db2 } = fakeDb({ erroEm: 'comanda_itens' });
    await expect(carregarServicosExtras(db2, 'emp', OUT)).rejects.toThrow('falha em comanda_itens');
  });

  it('Equipe: faturado pede desconto_rateado e funciona sem a coluna', async () => {
    const linhas = {
      empresa_membros: [{ id: 'm1', user_id: 'p1', role: 'profissional', percentual_comissao: 40, ativo: true }],
      agendamentos: [{ id: 'a1', profissional_id: 'p1', valor: 120, pacote_cliente_id: null }],
    };
    const { db, chamadas } = fakeDb({ awaitavel: true, linhas });
    await carregarEquipe(db, 'emp', '2026-10');
    expect(opsDe(chamadas, 'agendamentos')[0].find(([m]) => m === 'select')?.[1][0]).toContain('desconto_rateado');
    const sem = fakeDb({ awaitavel: true, linhas, erroQuandoSelectContem: { agendamentos: 'desconto_rateado' } });
    const r = await carregarEquipe(sem.db, 'emp', '2026-10');
    expect(r[0].total_mes).toBe(120);
  });
});
