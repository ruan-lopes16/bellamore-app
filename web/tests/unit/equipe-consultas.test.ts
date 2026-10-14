import { describe, expect, it } from 'vitest';
import { carregarEquipe, alterarAtivo, alterarPapel } from '@shared/equipe-consultas';
import { fakeDb, opsDe } from './fixtures/fake-db';

const membros = [
  { id: 'm1', user_id: 'u1', role: 'owner', percentual_comissao: '45', tipo_contrato: null, ativo: true, created_at: '2026-01-01', user: { id: 'u1', nome: 'Ana', telefone: null, email: 'a@x.com', foto_url: null } },
  { id: 'm2', user_id: 'u2', role: 'profissional', percentual_comissao: 70, tipo_contrato: 'pj', ativo: true, created_at: '2026-02-01', user: { id: 'u2', nome: 'Thalia', telefone: null, email: 't@x.com', foto_url: null } },
];

describe('carregarEquipe', () => {
  it('inclui a dona, mês em Brasília, faturado sem pacote e pendentes do mês', async () => {
    const { db, chamadas } = fakeDb({ awaitavel: true, linhas: {
      empresa_membros: membros,
      agendamentos: [
        { id: 'a1', profissional_id: 'u2', valor: 100, pacote_cliente_id: null },
        { id: 'a2', profissional_id: 'u2', valor: 0, pacote_cliente_id: 'p1' },
      ],
      comanda_itens: [],
      comissoes: [
        { id: 'c1', profissional_id: 'u2', valor_comissao: 70, created_at: '2026-10-05T12:00:00Z' },
        { id: 'c2', profissional_id: 'u2', valor_comissao: 30, created_at: '2026-09-20T12:00:00Z' },
      ],
    } });
    const r = await carregarEquipe(db, 'e1', '2026-10');
    expect(r.map(m => m.role)).toEqual(['owner', 'profissional']);
    const t = r.find(m => m.user_id === 'u2')!;
    expect(t).toMatchObject({ total_mes: 100, atendimentos_mes: 2, comissao_pendente: 70, comissao_pendente_anterior: 30, ids_pendentes_mes: ['c1'] });
    expect(r[0].percentual_comissao).toBe(45);
    const opsMem = opsDe(chamadas, 'empresa_membros')[0];
    expect(opsMem).toContainEqual(['in', ['role', ['owner', 'gestor', 'profissional']]]);
    const opsAg = opsDe(chamadas, 'agendamentos')[0];
    expect(opsAg).toContainEqual(['gte', ['data_hora_inicio', '2026-10-01T03:00:00.000Z']]);
    expect(opsAg).toContainEqual(['eq', ['status', 'concluido']]);
    expect(opsAg).toContainEqual(['order', ['id']]);
  });
  it('empresa em todas as consultas, extra soma no faturado', async () => {
    const { db, chamadas } = fakeDb({ awaitavel: true, linhas: {
      empresa_membros: membros,
      agendamentos: [{ id: 'a1', profissional_id: 'u2', valor: 100, pacote_cliente_id: null }],
      comanda_itens: [{ id: 'i1', valor_unit: 40, quantidade: 2, profissional_id: 'u2', servico_id: null, descricao: 'x', comanda: { fechada_at: '2026-10-05T12:00:00Z', status: 'fechada', clientes_id: null } }],
      comissoes: [],
    } });
    const r = await carregarEquipe(db, 'e1', '2026-10');
    expect(r.find(m => m.user_id === 'u2')!.total_mes).toBe(180);
    for (const tab of ['empresa_membros', 'agendamentos', 'comissoes']) {
      expect(opsDe(chamadas, tab)[0]).toContainEqual(['eq', ['empresa_id', 'e1']]);
    }
  });
  it('erro de membros ou de comissões lança', async () => {
    for (const tab of ['empresa_membros', 'comissoes']) {
      const { db } = fakeDb({ awaitavel: true, linhas: { empresa_membros: membros }, erroTabelas: { [tab]: 'boom' } });
      await expect(carregarEquipe(db, 'e1', '2026-10')).rejects.toThrow('boom');
    }
  });
  it('erro de permissão sai em português', async () => {
    const { db } = fakeDb({ awaitavel: true, linhas: { empresa_membros: membros }, erroTabelasCodigo: { comissoes: { code: '42501', message: 'row-level security' } } });
    await expect(carregarEquipe(db, 'e1', '2026-10')).rejects.toThrow('Você não tem permissão para carregar a equipe');
  });
  it('erro em qualquer consulta lança (nunca lista vazia)', async () => {
    const { db } = fakeDb({ awaitavel: true, linhas: { empresa_membros: membros }, erroTabelas: { agendamentos: 'boom' } });
    await expect(carregarEquipe(db, 'e1', '2026-10')).rejects.toThrow('boom');
  });
});

describe('alterarAtivo / alterarPapel', () => {
  it('grava com empresa e confere linhas', async () => {
    const { db, chamadas } = fakeDb({});
    await alterarAtivo(db, 'e1', 'm2', false);
    const ops = opsDe(chamadas, 'empresa_membros')[0];
    expect(ops[0]).toEqual(['update', [{ ativo: false }]]);
    expect(ops).toContainEqual(['eq', ['id', 'm2']]);
    expect(ops).toContainEqual(['eq', ['empresa_id', 'e1']]);
  });
  it('0 linhas = sem permissão, em português', async () => {
    const { db } = fakeDb({ respostaUpdate: () => ({ data: [], error: null }) });
    await expect(alterarAtivo(db, 'e1', 'm2', true)).rejects.toThrow('Você não tem permissão para reativar esta pessoa. Fale com a dona ou a gestora.');
    await expect(alterarPapel(db, 'e1', 'm2', 'gestor')).rejects.toThrow('Você não tem permissão para trocar o papel desta pessoa. Fale com a dona ou a gestora.');
  });
});
