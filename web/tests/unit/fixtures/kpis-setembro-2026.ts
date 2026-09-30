import type { AgendamentoFinRow, DadosFinanceiros } from '@shared/kpis-financeiros';

const SERVICOS: Record<string, string> = { s1: 'Limpeza de pele', s2: 'Drenagem' };
const PROFISSIONAIS: Record<string, string> = { p1: 'Ana', p2: 'Bia' };
const CLIENTES: Record<string, string> = { c1: 'Carla', c2: 'Duda', c3: 'Eva', c4: 'Fabi' };

function ag(
  id: string, status: string, valor: number, data_hora_inicio: string,
  pacote_cliente_id: string | null, cliente_id: string, profissional_id: string, servico_id: string,
): AgendamentoFinRow {
  return {
    id, status, valor, data_hora_inicio, pacote_cliente_id, cliente_id, profissional_id, servico_id,
    servico: { nome: SERVICOS[servico_id], categoria: null },
    profissional: { nome: PROFISSIONAIS[profissional_id], foto_url: null },
    cliente: { nome: CLIENTES[cliente_id] },
  };
}

/**
 * Setembro/2026 com os casos de borda da Fase 2A. Totais esperados de setembro:
 * serviços 350 · vendas 130 · taxas canc. 50 · reserva 30 · bruto 560 ·
 * cartão 7,5 · comissões 140 (80 pendentes) · despesas 295,5 · lucro 117 ·
 * atendimentos 3 (2 faturáveis) · ticket 175 · 6 agendamentos, 2 perdidos.
 */
export function fixtureSetembro(): DadosFinanceiros {
  return {
    agendamentos: [
      ag('a1', 'concluido', 200, '2026-09-10T13:00:00Z', null, 'c1', 'p1', 's1'),
      ag('a2', 'concluido', 150, '2026-10-01T02:30:00Z', null, 'c2', 'p2', 's2'),  // 30/09 23:30 BRT → setembro
      ag('a3', 'concluido', 300, '2026-09-12T14:00:00Z', 'pc1', 'c1', 'p1', 's1'), // sessão de pacote: não é receita
      ag('a4', 'faltou',    100, '2026-09-15T14:00:00Z', null, 'c3', 'p1', 's1'),
      ag('a5', 'cancelado',  80, '2026-09-16T14:00:00Z', null, 'c3', 'p2', 's2'),
      ag('a6', 'concluido', 500, '2026-10-01T03:00:00Z', null, 'c2', 'p2', 's2'),  // 01/10 00:00 BRT → outubro
      ag('a7', 'agendado',  120, '2026-09-20T14:00:00Z', null, 'c4', 'p1', 's1'),
    ],
    vendas: [
      { id: 'v1', valor_final: 90, created_at: '2026-09-05T15:00:00Z' },
      { id: 'v2', valor_final: '40.00', created_at: '2026-10-01T02:00:00Z' },       // 30/09 23:00 BRT; valor em string
    ],
    taxasCancelamento: [{ id: 't1', valor: 50, paga_em: '2026-09-18T12:00:00Z' }],
    taxasReserva: [
      { id: 'r1', valor: 30, paga_em: '2026-09-02T12:00:00Z' },
      { id: 'r2', valor: 25, paga_em: '2026-08-31T23:00:00Z' },                     // 31/08 20:00 BRT → agosto
    ],
    pagamentos: [
      { id: 'g1', metodo: 'credito', valor: 200, valor_liquido: 194,  created_at: '2026-09-10T13:30:00Z' },
      { id: 'g2', metodo: 'pix',     valor: 150, valor_liquido: null, created_at: '2026-10-01T02:40:00Z' },
      { id: 'g3', metodo: 'debito',  valor: 90,  valor_liquido: 88.5, created_at: '2026-09-05T15:05:00Z' },
    ],
    comissoes: [
      { id: 'k1', profissional_id: 'p1', valor_comissao: 80, status: 'pendente', created_at: '2026-09-10T13:30:00Z' },
      { id: 'k2', profissional_id: 'p2', valor_comissao: 60, status: 'pago',     created_at: '2026-10-01T02:45:00Z' },
    ],
    despesas: [
      { id: 'd1', valor: 250,  categoria: 'Aluguel', status: 'pago',     data_pagamento: '2026-09-05' },
      { id: 'd2', valor: 45.5, categoria: 'Energia', status: 'pago',     data_pagamento: '2026-09-30' },
      { id: 'd3', valor: 999,  categoria: 'Outros',  status: 'pago',     data_pagamento: '2026-10-01' },
      { id: 'd4', valor: 300,  categoria: 'Outros',  status: 'pendente', data_pagamento: null },
      { id: 'd5', valor: 77,   categoria: 'Outros',  status: 'pendente', data_pagamento: '2026-09-20' },
    ],
    fechamentos: [],
  };
}
