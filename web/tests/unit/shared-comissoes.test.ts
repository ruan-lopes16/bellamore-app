import { describe, expect, it } from 'vitest';
import { limitesMes } from '@shared/periodos';
import {
  normalizarComissoes, resumoComissoes, filtrarComissoes, comissoesPorProfissional, agruparComissoesPorData,
  pendentesPorProfissional, rotuloPercentualComissao, textoConfirmarPagamento, FILTROS_COMISSAO,
  type ComissaoDetalheRow,
} from '@shared/comissoes';

const ROWS: ComissaoDetalheRow[] = [
  { id: 'k1', profissional_id: 'p1', agendamento_id: 'a1', valor_servico: '200.00', percentual: '40', valor_comissao: '80.00',
    status: 'pendente', created_at: '2026-09-10T13:30:00Z', profissional: { nome: 'Ana' },
    agendamento: { data_hora_inicio: '2026-09-10T13:00:00Z', valor: '200', servico: { nome: 'Limpeza', categoria: 'facial', categoria_id: null }, cliente: { nome: 'Carla' } } },
  { id: 'k2', profissional_id: 'p1', agendamento_id: 'a2', valor_servico: 100, percentual: 30, valor_comissao: 30,
    status: 'pago', created_at: '2026-10-01T02:45:00Z', profissional: { nome: 'Ana' },
    agendamento: { data_hora_inicio: '2026-10-01T02:00:00Z', valor: 100, servico: { nome: 'Drenagem' }, cliente: { nome: 'Duda' } } },
  { id: 'k3', profissional_id: 'p2', agendamento_id: null, valor_servico: 150, percentual: 40, valor_comissao: 60,
    status: 'pendente', created_at: '2026-08-31T23:00:00Z', profissional: null, agendamento: null },
];
const itens = normalizarComissoes(ROWS);

describe('normalização (strings do numeric, nomes ausentes)', () => {
  it('converte e preenche', () => {
    expect(itens[0]).toMatchObject({ valorServico: 200, percentual: 40, valorComissao: 80, status: 'pendente',
      profissionalNome: 'Ana', servicoNome: 'Limpeza', clienteNome: 'Carla', valorAtendimento: 200 });
    expect(itens[2]).toMatchObject({ profissionalNome: 'Profissional', servicoNome: 'Serviço', clienteNome: '—',
      dataAtendimento: null, valorAtendimento: null });
  });
});

describe('resumo, filtros e cards por profissional', () => {
  it('resumo', () => {
    expect(resumoComissoes(itens)).toEqual({ total: 170, pendente: 140, pago: 30, quantidade: 3 });
  });
  it('filtros', () => {
    expect(FILTROS_COMISSAO.map(f => f.key)).toEqual(['todas', 'pendentes', 'pagas']);
    expect(filtrarComissoes(itens, 'pendentes').map(c => c.id)).toEqual(['k1', 'k3']);
    expect(filtrarComissoes(itens, 'pagas').map(c => c.id)).toEqual(['k2']);
  });
  it('por profissional: inclui inativa, percentual único ou null, ids pendentes', () => {
    const p = comissoesPorProfissional(itens);
    expect(p.map(x => [x.profissionalId, x.total, x.pendente, x.pago, x.atendimentos])).toEqual([
      ['p1', 110, 80, 30, 2], ['p2', 60, 60, 0, 1],
    ]);
    expect(p[0].percentual).toBeNull();
    expect(p[1].percentual).toBe(40);
    expect(p[0].idsPendentes).toEqual(['k1']);
  });
  it('soma dos cards = resumo geral', () => {
    const p = comissoesPorProfissional(itens);
    expect(p.reduce((s, x) => s + x.pendente, 0)).toBe(resumoComissoes(itens).pendente);
  });
});

describe('agrupamento por data em Brasília', () => {
  it('por dia (dia/semana/mês) — data do atendimento, senão created_at', () => {
    expect(agruparComissoesPorData(itens, 'mes').map(g => [g.chave, g.rotulo])).toEqual([
      ['2026-09-30', 'Qua, 30 de set'], ['2026-09-10', 'Qui, 10 de set'], ['2026-08-31', 'Seg, 31 de ago'],
    ]);
  });
  it('por mês (trimestre/semestre/ano)', () => {
    expect(agruparComissoesPorData(itens, 'trimestre').map(g => [g.chave, g.rotulo, g.itens.length])).toEqual([
      ['2026-09', 'Setembro 2026', 2], ['2026-08', 'Agosto 2026', 1],
    ]);
  });
});

describe('pendentes por profissional (Equipe: Pagar = período)', () => {
  it('separa o período do que é anterior', () => {
    const r = pendentesPorProfissional([
      { id: 'k1', profissional_id: 'p1', valor_comissao: '80.00', created_at: '2026-09-10T13:30:00Z' },
      { id: 'k3', profissional_id: 'p2', valor_comissao: 60, created_at: '2026-08-31T23:00:00Z' },
    ], limitesMes('2026-09'));
    expect(r.p1).toEqual({ idsDoPeriodo: ['k1'], valorDoPeriodo: 80, valorAnterior: 0 });
    expect(r.p2).toEqual({ idsDoPeriodo: [], valorDoPeriodo: 0, valorAnterior: 60 });
  });
});

describe('textos iguais nas duas plataformas', () => {
  it('percentual e confirmação', () => {
    expect(rotuloPercentualComissao(40)).toBe('40%');
    expect(rotuloPercentualComissao(37.5)).toBe('37,5%');
    expect(rotuloPercentualComissao(null)).toBe('vários %');
    expect(textoConfirmarPagamento('Ana', 'R$ 80', 'Setembro 2026'))
      .toBe('Marcar como pagas as comissões pendentes de Ana em Setembro 2026 (R$ 80)?');
  });
});

describe('normalizarComissao — serviço extra da comanda', () => {
  it('data e cliente da comanda, descrição com (extra)', () => {
    const c = normalizarComissoes([{
      id: 'x', profissional_id: 'p', agendamento_id: null, comanda_item_id: 'i1',
      valor_servico: '40.00', percentual: '50', valor_comissao: '20.00', status: 'pendente', created_at: '2026-10-08T15:00:00Z',
      profissional: { nome: 'Lu' }, agendamento: null,
      item: { descricao: 'Esmaltação', comanda: { fechada_at: '2026-10-08T14:59:00Z', cliente: { nome: 'Ana' } } },
    }])[0];
    expect(c).toMatchObject({
      agendamentoId: null, dataAtendimento: '2026-10-08T14:59:00Z', valorAtendimento: 40,
      servicoNome: 'Esmaltação (extra)', clienteNome: 'Ana', servicoCategoria: null, valorComissao: 20,
    });
  });
});
