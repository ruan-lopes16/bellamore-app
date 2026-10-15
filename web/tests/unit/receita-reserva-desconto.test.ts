// Receita depois da 090 (decisões do dono, 2026-10-15): desconto rateado sai da receita e a taxa
// de reserva só conta sozinha quando o atendimento não aconteceu (status 'retida', por paga_em).
import { describe, expect, it } from 'vitest';
import { limitesMes } from '@shared/periodos';
import {
  calcularKpisFinanceiros, rankingAtendimentos, receitaExtrasPorProfissional, valorServicoExtra,
  DADOS_VAZIOS, type DadosFinanceiros, type AgendamentoFinRow, type ServicoExtraFinRow,
} from '@shared/kpis-financeiros';
import { linhasAtendimentosRelatorio } from '@shared/relatorios';
import { estatisticasDoMes } from '@shared/equipe';
import {
  carregarDadosFinanceiros, carregarServicosExtras, COLUNAS_AGENDAMENTO_FIN, COLUNAS_SERVICO_EXTRA_FIN,
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

describe('taxa de reserva não conta em dobro', () => {
  it('reserva paga + atendimento concluído: conta uma vez (o atendimento inteiro, pela data do serviço)', () => {
    // Serviço de R$ 120 com R$ 30 de reserva paga: a comanda cobrou 90; a receita é 120, não 150.
    const k = calcularKpisFinanceiros(dados({
      agendamentos: [ag('a1', 120, 0)],
      taxasReserva: [{ id: 'r1', valor: 30, paga_em: '2026-10-02T12:00:00Z', status: 'pago' }],
    }), OUT);
    expect(k.receitaTaxasReserva).toBe(0);
    expect(k.bruto).toBe(120);
  });
  it('reserva retida (cancelou/faltou depois de pagar) conta sozinha, por paga_em', () => {
    const k = calcularKpisFinanceiros(dados({
      agendamentos: [ag('a1', 120, 0, { status: 'cancelado' })],
      taxasReserva: [
        { id: 'r1', valor: 30, paga_em: '2026-10-02T12:00:00Z', status: 'retida' },
        { id: 'r2', valor: 25, paga_em: '2026-09-30T12:00:00Z', status: 'retida' }, // setembro
      ],
    }), OUT);
    expect(k.receitaTaxasReserva).toBe(30);
    expect(k.bruto).toBe(30);
  });
  it('retida sem paga_em (nunca foi paga) e cancelada não contam', () => {
    const k = calcularKpisFinanceiros(dados({
      taxasReserva: [
        { id: 'r1', valor: 30, paga_em: null, status: 'retida' },
        { id: 'r2', valor: 30, paga_em: '2026-10-02T12:00:00Z', status: 'cancelada' },
      ],
    }), OUT);
    expect(k.receitaTaxasReserva).toBe(0);
  });
});

describe('consultas: desconto_rateado com volta para antes da 090', () => {
  it('agendamentos e extras pedem desconto_rateado; reserva só retida com paga_em', async () => {
    expect(COLUNAS_AGENDAMENTO_FIN).toContain('desconto_rateado');
    expect(COLUNAS_SERVICO_EXTRA_FIN).toContain('desconto_rateado');
    const { db, chamadas } = fakeDb();
    await carregarDadosFinanceiros(db, 'emp', OUT);
    const [reserva] = opsDe(chamadas, 'taxas_reserva');
    expect(reserva).toContainEqual(['eq', ['status', 'retida']]);
    expect(reserva).toContainEqual(['not', ['paga_em', 'is', null]]);
    expect(reserva.find(([m]) => m === 'select')?.[1][0]).toContain('status');
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
