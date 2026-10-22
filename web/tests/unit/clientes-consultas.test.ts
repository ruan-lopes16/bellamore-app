import { describe, expect, it } from 'vitest';
import {
  carregarBaseClientes, carregarHistoricoCliente, arquivarCliente, reativarCliente,
} from '@shared/clientes-consultas';
import { contatosCliente } from '@shared/clientes';
import { contatosCliente as contatosDaAgenda } from '@shared/agenda';
import { fakeDb, opsDe } from './fixtures/fake-db';

const cliente = (i: number) => ({
  id: `c${i}`, nome: `Cliente ${i}`, telefone: null, email: null, data_nascimento: null, ativo: true, created_at: '2026-01-01T12:00:00Z',
});

describe('carregarBaseClientes', () => {
  it('pagina acima de 1000 linhas (nunca corta) com desempate por id', async () => {
    const clientes = Array.from({ length: 1500 }, (_, i) => cliente(i));
    const { db, chamadas } = fakeDb({ linhas: { clientes } });
    const r = await carregarBaseClientes(db, 'e1');
    expect(r.clientes).toHaveLength(1500);
    const consultas = opsDe(chamadas, 'clientes');
    expect(consultas).toHaveLength(2);
    expect(consultas[0]).toContainEqual(['eq', ['empresa_id', 'e1']]);
    expect(consultas[0]).toContainEqual(['order', ['id']]);
    expect(consultas[1]).toContainEqual(['range', [1000, 1999]]);
    // ativas E arquivadas: nada de filtro por `ativo`
    expect(consultas[0].some(([m, a]) => m === 'eq' && a[0] === 'ativo')).toBe(false);
  });

  it('atendimentos concluídos, extras de comandas fechadas e vendas, todos com cliente e da empresa', async () => {
    const { db, chamadas } = fakeDb({
      linhas: {
        agendamentos: [{ id: 'a1', cliente_id: 'c1', data_hora_inicio: '2026-10-01T13:00:00Z', valor: '100.00', desconto_rateado: '10.00', pacote_cliente_id: null, servico_id: 's1', servico: { nome: 'Corte' } }],
        comanda_itens: [
          { id: 'x1', valor_unit: '30.00', quantidade: '2', desconto_rateado: null, comanda: { fechada_at: '2026-10-02T13:00:00Z', status: 'fechada', clientes_id: 'c1' } },
          { id: 'x2', valor_unit: '30.00', quantidade: '1', desconto_rateado: null, comanda: null },
        ],
        vendas: [{ id: 'v1', cliente_id: 'c1', valor_final: '50.5', created_at: '2026-10-03T13:00:00Z' }],
      },
    });
    const r = await carregarBaseClientes(db, 'e1');
    expect(r.atendimentos).toEqual([{ cliente_id: 'c1', data_hora_inicio: '2026-10-01T13:00:00Z', valor: 100, desconto_rateado: 10, pacote_cliente_id: null, servico_id: 's1', servico_nome: 'Corte' }]);
    expect(r.extras).toEqual([{ cliente_id: 'c1', valor_unit: 30, quantidade: 2, desconto_rateado: null, fechada_at: '2026-10-02T13:00:00Z' }]);
    expect(r.vendas).toEqual([{ cliente_id: 'c1', valor_final: 50.5, created_at: '2026-10-03T13:00:00Z' }]);

    const ag = opsDe(chamadas, 'agendamentos')[0];
    expect(ag).toContainEqual(['eq', ['empresa_id', 'e1']]);
    expect(ag).toContainEqual(['eq', ['status', 'concluido']]);
    expect(ag).toContainEqual(['not', ['cliente_id', 'is', null]]);
    expect(ag).toContainEqual(['order', ['id']]);
    const ex = opsDe(chamadas, 'comanda_itens')[0];
    expect(ex).toContainEqual(['eq', ['empresa_id', 'e1']]);
    expect(ex).toContainEqual(['eq', ['tipo', 'servico']]);
    expect(ex).toContainEqual(['eq', ['comanda.status', 'fechada']]);
    expect(ex).toContainEqual(['not', ['comanda.clientes_id', 'is', null]]);
    expect(ex).toContainEqual(['order', ['id']]);
    const vd = opsDe(chamadas, 'vendas')[0];
    expect(vd).toContainEqual(['eq', ['empresa_id', 'e1']]);
    expect(vd).toContainEqual(['not', ['cliente_id', 'is', null]]);
    expect(vd).toContainEqual(['order', ['id']]);
  });

  it('antes da 090 (sem desconto_rateado) refaz a consulta sem a coluna', async () => {
    const { db } = fakeDb({
      linhas: { agendamentos: [{ id: 'a1', cliente_id: 'c1', data_hora_inicio: '2026-10-01T13:00:00Z', valor: 80, pacote_cliente_id: null, servico_id: null, servico: null }] },
      erroQuandoSelectContem: { agendamentos: 'desconto_rateado', comanda_itens: 'desconto_rateado' },
    });
    const r = await carregarBaseClientes(db, 'e1');
    expect(r.atendimentos[0]).toMatchObject({ valor: 80, desconto_rateado: null });
  });

  it.each(['clientes', 'agendamentos', 'comanda_itens', 'vendas'])('erro em %s lança (nunca lista vazia)', async (tabela) => {
    const { db } = fakeDb({ erroTabelas: { [tabela]: 'boom' } });
    await expect(carregarBaseClientes(db, 'e1')).rejects.toThrow('boom');
  });
});

describe('carregarHistoricoCliente', () => {
  const linhas = {
    agendamentos: [
      { id: 'a1', cliente_id: 'c1', data_hora_inicio: '2026-09-01T13:00:00Z', valor: '100', desconto_rateado: '10', status: 'concluido', comanda_id: 'k1', pacote_cliente_id: null, servico_id: 's1',
        servico: { nome: 'Corte' }, agendamento_servicos: [{ ordem: 2, servico: { nome: 'Escova' } }, { ordem: 1, servico: { nome: 'Corte' } }], profissional: { nome: 'Ana' } },
      { id: 'a2', cliente_id: 'c1', data_hora_inicio: '2026-10-05T13:00:00Z', valor: '120', desconto_rateado: null, status: 'concluido', comanda_id: null, pacote_cliente_id: 'p1', servico_id: 's2',
        servico: { nome: 'Limpeza' }, agendamento_servicos: [], profissional: null },
      { id: 'a3', cliente_id: 'c1', data_hora_inicio: '2026-10-20T13:00:00Z', valor: '90', desconto_rateado: null, status: 'agendado', comanda_id: null, pacote_cliente_id: null, servico_id: 's1',
        servico: { nome: 'Corte' }, agendamento_servicos: null, profissional: { nome: 'Bia' } },
    ],
    comanda_itens: [
      { id: 'x1', comanda_id: 'k2', descricao: 'Sobrancelha', valor_unit: '25', quantidade: '2', desconto_rateado: '5', servico: null,
        comanda: { fechada_at: '2026-10-10T13:00:00Z', status: 'fechada', clientes_id: 'c1' } },
    ],
    vendas: [
      { id: 'v1', cliente_id: 'c1', valor_final: '40', created_at: '2026-10-12T13:00:00Z', venda_itens: [{ quantidade: '2', produto: { nome: 'Óleo' } }, { quantidade: 1, produto: null }] },
    ],
    taxas_reserva: [{ id: 'r1', valor: '30', status: 'pago', created_at: '2026-10-15T13:00:00Z', paga_em: '2026-10-15T14:00:00Z', metodo: 'pix' }],
    taxas_cancelamento: [{ id: 't1', valor: '50', status: 'pendente', created_at: '2026-08-01T13:00:00Z', paga_em: null, metodo: null }],
  };

  it('lista única por data, da mais recente para a mais antiga', async () => {
    const { db } = fakeDb({ linhas });
    const { itens } = await carregarHistoricoCliente(db, 'e1', 'c1');
    expect(itens.map(i => i.id)).toEqual(['a3', 'r1', 'v1', 'x1', 'a2', 'a1', 't1']);
  });

  it('monta cada tipo de item', async () => {
    const { db } = fakeDb({ linhas });
    const { itens } = await carregarHistoricoCliente(db, 'e1', 'c1');
    const porId = Object.fromEntries(itens.map(i => [i.id, i]));
    expect(porId.a1).toEqual({ tipo: 'atendimento', id: 'a1', data: '2026-09-01T13:00:00Z', servicos: 'Corte + Escova', profissional: 'Ana', valor: 90, status: 'concluido', comandaId: 'k1', pacote: false });
    expect(porId.a2).toMatchObject({ tipo: 'atendimento', servicos: 'Limpeza', profissional: null, valor: 0, pacote: true });
    expect(porId.x1).toEqual({ tipo: 'extra', id: 'x1', data: '2026-10-10T13:00:00Z', descricao: 'Sobrancelha', valor: 45, comandaId: 'k2' });
    expect(porId.v1).toEqual({ tipo: 'venda', id: 'v1', data: '2026-10-12T13:00:00Z', itens: [{ nome: 'Óleo', quantidade: 2 }, { nome: 'Produto', quantidade: 1 }], valor: 40 });
    expect(porId.r1).toEqual({ tipo: 'taxa_reserva', id: 'r1', data: '2026-10-15T13:00:00Z', valor: 30, status: 'pago', metodo: 'pix' });
    expect(porId.t1).toEqual({ tipo: 'taxa_cancelamento', id: 't1', data: '2026-08-01T13:00:00Z', valor: 50, status: 'pendente', metodo: null });
  });

  it('agregado só desta cliente, pela regra de agregarClientes (pacote conta visita, não gasto)', async () => {
    const { db } = fakeDb({ linhas });
    const { agregado } = await carregarHistoricoCliente(db, 'e1', 'c1');
    expect(agregado).toEqual({
      atendimentos: 2, totalGasto: 90 + 0 + 45 + 40, ultimaVisita: '2026-10-05T13:00:00Z', servicoFavorito: { id: 's2', nome: 'Limpeza' },
    });
  });

  it('cliente sem nada devolve agregado zerado', async () => {
    const { db } = fakeDb({});
    const r = await carregarHistoricoCliente(db, 'e1', 'c1');
    expect(r).toEqual({ itens: [], agregado: { atendimentos: 0, totalGasto: 0, ultimaVisita: null, servicoFavorito: null } });
  });

  it('filtra pela empresa e pela cliente, paginado, taxas encerradas fora', async () => {
    const { db, chamadas } = fakeDb({ linhas });
    await carregarHistoricoCliente(db, 'e1', 'c1');
    for (const t of ['agendamentos', 'vendas', 'taxas_reserva', 'taxas_cancelamento']) {
      const ops = opsDe(chamadas, t)[0];
      expect(ops).toContainEqual(['eq', ['empresa_id', 'e1']]);
      expect(ops).toContainEqual(['eq', ['cliente_id', 'c1']]);
      expect(ops).toContainEqual(['order', ['id']]);
      expect(ops.some(([m]) => m === 'range')).toBe(true);
    }
    for (const t of ['taxas_reserva', 'taxas_cancelamento']) {
      const ops = opsDe(chamadas, t)[0];
      expect(ops).toContainEqual(['neq', ['status', 'cancelada']]);
      expect(ops.find(([m]) => m === 'select')![1][0]).toContain('metodo');
    }
    const ex = opsDe(chamadas, 'comanda_itens')[0];
    expect(ex).toContainEqual(['eq', ['empresa_id', 'e1']]);
    expect(ex).toContainEqual(['eq', ['tipo', 'servico']]);
    expect(ex).toContainEqual(['eq', ['comanda.clientes_id', 'c1']]);
    expect(ex).toContainEqual(['eq', ['comanda.status', 'fechada']]);
    const ag = opsDe(chamadas, 'agendamentos')[0];
    const sel = ag.find(([m]) => m === 'select')![1][0] as string;
    expect(sel).toContain('agendamento_servicos(ordem, servico:servicos(nome))');
    expect(sel).toContain('profissional:users!agendamentos_profissional_id_fkey(nome)');
    expect(opsDe(chamadas, 'vendas')[0].find(([m]) => m === 'select')![1][0]).toContain('venda_itens(quantidade, produto:produtos(nome))');
  });

  it('pagina o histórico acima de 1000 linhas', async () => {
    const vendas = Array.from({ length: 1200 }, (_, i) => ({ id: `v${i}`, cliente_id: 'c1', valor_final: 1, created_at: '2026-10-01T13:00:00Z', venda_itens: [] }));
    const { db } = fakeDb({ linhas: { vendas } });
    const r = await carregarHistoricoCliente(db, 'e1', 'c1');
    expect(r.itens).toHaveLength(1200);
    expect(r.agregado.totalGasto).toBe(1200);
  });

  it.each(['agendamentos', 'comanda_itens', 'vendas', 'taxas_reserva', 'taxas_cancelamento'])('erro em %s lança', async (tabela) => {
    const { db } = fakeDb({ linhas, erroTabelas: { [tabela]: 'boom' } });
    await expect(carregarHistoricoCliente(db, 'e1', 'c1')).rejects.toThrow('boom');
  });
});

describe('arquivarCliente / reativarCliente', () => {
  it('arquivar grava ativo=false na empresa, com select(id)', async () => {
    const { db, chamadas } = fakeDb({});
    await arquivarCliente(db, 'e1', 'c1');
    const ops = opsDe(chamadas, 'clientes')[0];
    expect(ops).toContainEqual(['update', [{ ativo: false }]]);
    expect(ops).toContainEqual(['eq', ['id', 'c1']]);
    expect(ops).toContainEqual(['eq', ['empresa_id', 'e1']]);
    expect(ops).toContainEqual(['select', ['id']]);
  });

  it('reativar grava ativo=true', async () => {
    const { db, chamadas } = fakeDb({});
    await reativarCliente(db, 'e1', 'c1');
    expect(opsDe(chamadas, 'clientes')[0]).toContainEqual(['update', [{ ativo: true }]]);
  });

  it.each([arquivarCliente, reativarCliente])('0 linhas afetadas vira aviso de permissão', async (fn) => {
    const { db } = fakeDb({ respostaUpdate: () => ({ data: [], error: null }) });
    await expect(fn(db, 'e1', 'c1')).rejects.toThrow('Você não tem permissão para arquivar ou reativar esta cliente.');
  });

  it('erro do banco passa por mensagemErroBanco', async () => {
    const { db } = fakeDb({ respostaUpdate: () => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }) });
    await expect(arquivarCliente(db, 'e1', 'c1')).rejects.toThrow('Você não tem permissão para arquivar a cliente. Fale com a dona ou a gestora.');
    const r2 = fakeDb({ respostaUpdate: () => ({ data: null, error: { code: '42501', message: 'x' } }) });
    await expect(reativarCliente(r2.db, 'e1', 'c1')).rejects.toThrow('Você não tem permissão para reativar a cliente. Fale com a dona ou a gestora.');
  });
});

describe('contatosCliente (shared/clientes, reexportado pela agenda)', () => {
  it('tel: só com dígitos e WhatsApp com 55', () => {
    expect(contatosCliente('(34) 99178-0000')).toEqual({ ligar: 'tel:34991780000', whatsapp: 'https://wa.me/5534991780000' });
    expect(contatosCliente(null)).toBeNull();
  });
  it('a agenda usa a mesma função', () => {
    expect(contatosDaAgenda).toBe(contatosCliente);
  });
});
