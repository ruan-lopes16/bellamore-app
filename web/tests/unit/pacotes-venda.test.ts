import { describe, expect, it } from 'vitest';
import {
  argumentosVendaPacote, ErroPacote, excluirPacoteCliente, excluirServico, SemMigration096, venderPacote,
  type EntradaVendaPacote,
} from '@shared/pacotes-venda';
import {
  calcularRelatorioUtilizacao, carregarCandidatosVinculo, carregarCatalogoPacotes, carregarPacotesVendidos,
  carregarPendentesCliente, carregarRelatorioUtilizacao, type PacoteVendido,
} from '@shared/pacotes-consultas';
import { fakeDb } from './fixtures/fake-db';

const entrada = (extra: Partial<EntradaVendaPacote> = {}): EntradaVendaPacote => ({
  vendaId: 'k1', empresaId: 'e1', clienteId: 'c1', pacoteId: 'p1', quantidade: 2, valorUnit: 100.005,
  desconto: 10, cobranca: 'agora',
  pagamentos: [{ valor: 190, metodo: 'credito', bandeira: 'visa', parcelas: 3, taxa_perc: 0.05, maquininha_id: 'm1' }],
  ...extra,
});

async function falha(fn: () => Promise<unknown>): Promise<unknown> {
  try { await fn(); } catch (e) { return e; }
  return null;
}

describe('venderPacote', () => {
  it('chama vender_pacote com o JSON do contrato', async () => {
    const f = fakeDb({ rpc: () => ({ data: null, error: null }) });
    await venderPacote(f.db, entrada());
    expect(f.rpcs).toEqual([{ fn: 'vender_pacote', args: { p: {
      venda_id: 'k1', empresa_id: 'e1', cliente_id: 'c1', pacote_id: 'p1', quantidade: 2, valor_unit: 100.01,
      desconto: 10, cobranca: 'agora',
      pagamentos: [{ valor: 190, metodo: 'credito', bandeira: 'visa', parcelas: 3, taxa_perc: 0.05, maquininha_id: 'm1' }],
    } } }]);
  });

  it('cobrar na comanda manda pagamentos vazios', () => {
    expect(argumentosVendaPacote(entrada({ cobranca: 'comanda' })).pagamentos).toEqual([]);
  });

  it('linha de montarPagamentos serve como pagamento (chaves extras descartadas)', () => {
    const linha = { empresa_id: 'e1', venda_id: 'x', valor: 50, metodo: 'pix', bandeira: null, parcelas: 1,
      taxa_perc: null, valor_liquido: null, status: 'pago' as const };
    expect(argumentosVendaPacote(entrada({ pagamentos: [linha] })).pagamentos)
      .toEqual([{ valor: 50, metodo: 'pix', bandeira: null, parcelas: 1, taxa_perc: null, maquininha_id: null }]);
  });

  it('agora sem pagamento: recusa antes de chamar o banco', async () => {
    const f = fakeDb({ rpc: () => ({ data: null, error: null }) });
    const e = await falha(() => venderPacote(f.db, entrada({ pagamentos: [] })));
    expect(e).toBeInstanceOf(ErroPacote);
    expect((e as Error).message).toBe('Pagamento não informado.');
    expect(f.rpcs).toEqual([]);
  });

  it('sem a 096 (PGRST202) lança SemMigration096', async () => {
    expect(await falha(() => venderPacote(fakeDb().db, entrada()))).toBeInstanceOf(SemMigration096);
  });

  it('mensagem da função vai como veio; erro sem código = sem resposta', async () => {
    const msg = 'O pagamento não cobre o total da venda.';
    const e1 = await falha(() => venderPacote(fakeDb({ rpc: () => ({ data: null, error: { code: 'P0001', message: msg } }) }).db, entrada()));
    expect((e1 as Error).message).toBe(msg);
    expect((e1 as ErroPacote).semResposta).toBe(false);
    const e2 = await falha(() => venderPacote(fakeDb({ rpc: () => ({ data: null, error: { message: 'Failed to fetch' } }) }).db, entrada()));
    expect((e2 as ErroPacote).semResposta).toBe(true);
    const e3 = await falha(() => venderPacote(fakeDb({ rpc: () => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }) }).db, entrada()));
    expect((e3 as Error).message).toBe('Você não tem permissão para vender o pacote. Fale com a dona ou a gestora.');
  });
});

describe('excluirPacoteCliente / excluirServico', () => {
  it('chamam as funções com empresa e id', async () => {
    const f = fakeDb({ rpc: () => ({ data: null, error: null }) });
    await excluirPacoteCliente(f.db, 'e1', 'pc1');
    await excluirServico(f.db, 'e1', 's1');
    expect(f.rpcs).toEqual([
      { fn: 'excluir_pacote_cliente', args: { p_empresa: 'e1', p_id: 'pc1' } },
      { fn: 'excluir_servico', args: { p_empresa: 'e1', p_id: 's1' } },
    ]);
  });
  it('mensagens exatas da spec chegam à tela; sem a 096 → SemMigration096', async () => {
    for (const [fn, msg] of [
      [excluirPacoteCliente, 'Este pacote já tem sessões usadas. Para cancelar, fale com a dona.'],
      [excluirServico, 'Este serviço já foi usado. Desative em vez de excluir.'],
    ] as const) {
      const e = await falha(() => fn(fakeDb({ rpc: () => ({ data: null, error: { code: 'P0001', message: msg } }) }).db, 'e1', 'x'));
      expect((e as Error).message).toBe(msg);
      expect(await falha(() => fn(fakeDb().db, 'e1', 'x'))).toBeInstanceOf(SemMigration096);
    }
  });
});

const vendidoRaw = (id: string, extra: Record<string, unknown> = {}) => ({
  id, data_inicio: '2026-10-01', data_validade: null, valor_pago: '150.00', status: 'ativo', observacao: null,
  pacote: { id: 'p1', nome: 'Limpeza x3', preco: '200', validade_dias: null, controla_sessoes: true,
    servicos: [{ servico_id: 's1', quantidade: 3, servico: { nome: 'Limpeza' } }] },
  cliente: { id: 'c1', nome: 'Ana' },
  usos: [{ id: 'u1', servico_id: 's1', agendamento_id: null, created_at: '2026-10-02T12:00:00Z' }],
  cobranca: 'paga', venda_id: 'v1', ...extra,
});

describe('cargas de Pacotes', () => {
  it('catálogo paginado, ordenado por nome e id', async () => {
    const f = fakeDb({ linhas: { pacotes: [{ id: 'p1', nome: 'A', preco: '10', validade_dias: null, ativo: true,
      controla_sessoes: false, servicos: [{ servico_id: 's1', quantidade: null, servico: { nome: 'S' } }] }] } });
    expect(await carregarCatalogoPacotes(f.db, 'e1')).toEqual([{ id: 'p1', nome: 'A', preco: 10, validade_dias: null,
      ativo: true, controla_sessoes: false, servicos: [{ servico_id: 's1', nome: 'S', quantidade: null }] }]);
    const ops = f.chamadas[0].ops.map(([m, a]) => `${m}:${String(a[0])}`);
    expect(ops).toEqual(expect.arrayContaining(['eq:empresa_id', 'order:nome', 'order:id', 'range:0']));
  });

  it('vendidos com usos e cobrança; sem a 096 refaz sem as colunas novas', async () => {
    const f = fakeDb({ linhas: { pacote_clientes: [vendidoRaw('pc1', { cobranca: 'pendente', venda_id: null })] } });
    const [v] = await carregarPacotesVendidos(f.db, 'e1');
    expect(v.cobranca).toBe('pendente');
    expect(v.valor_pago).toBe(150);
    expect(v.usos).toHaveLength(1);
    const fs = fakeDb({ linhas: { pacote_clientes: [vendidoRaw('pc1', { cobranca: undefined, venda_id: undefined })] },
      erroQuandoSelectContem: { pacote_clientes: 'cobranca' } });
    const [v2] = await carregarPacotesVendidos(fs.db, 'e1');
    expect(v2.cobranca).toBe('paga');
    expect(fs.chamadas).toHaveLength(2);
  });

  it('erro de carga é lançado (nunca lista vazia)', async () => {
    await expect(carregarPacotesVendidos(fakeDb({ erroEm: 'pacote_clientes' }).db, 'e1')).rejects.toThrow('falha em pacote_clientes');
    await expect(carregarCatalogoPacotes(fakeDb({ erroEm: 'pacotes' }).db, 'e1')).rejects.toThrow();
    await expect(carregarPendentesCliente(fakeDb({ erroEm: 'pacote_clientes' }).db, 'e1', 'c1')).rejects.toThrow();
    await expect(carregarCandidatosVinculo(fakeDb({ erroEm: 'pacote_clientes' }).db, 'e1', 'c1')).rejects.toThrow();
  });

  it('pendentes da cliente: filtro de cobrança; sem a 096 → []', async () => {
    const f = fakeDb({ linhas: { pacote_clientes: [{ id: 'pc1', pacote_id: 'p1', valor_pago: '180', pacote: { nome: 'X' } }] } });
    expect(await carregarPendentesCliente(f.db, 'e1', 'c1')).toEqual([{ id: 'pc1', pacote_id: 'p1', nome: 'X', valor_pago: 180 }]);
    const ops = f.chamadas[0].ops.map(([m, a]) => `${m}:${String(a[0])}=${String(a[1])}`);
    expect(ops).toEqual(expect.arrayContaining(['eq:cliente_id=c1', 'eq:cobranca=pendente', 'neq:status=cancelado']));
    const fs = fakeDb({ erroQuandoSelectContem: { pacote_clientes: 'cobranca' } });
    expect(await carregarPendentesCliente(fs.db, 'e1', 'c1')).toEqual([]);
  });

  it('candidatos a vínculo: só ativos da cliente', async () => {
    const f = fakeDb({ linhas: { pacote_clientes: [] } });
    await carregarCandidatosVinculo(f.db, 'e1', 'c1');
    const ops = f.chamadas[0].ops.map(([m, a]) => `${m}:${String(a[0])}=${String(a[1])}`);
    expect(ops).toEqual(expect.arrayContaining(['eq:cliente_id=c1', 'eq:status=ativo', 'eq:empresa_id=e1']));
  });
});

describe('relatório de utilização', () => {
  const v = (extra: Partial<PacoteVendido>): PacoteVendido => ({
    id: 'x', pacote: { id: 'p1', nome: 'Limpeza', preco: 200, validade_dias: null, controla_sessoes: true,
      servicos: [{ servico_id: 's1', nome: 'L', quantidade: 3 }] },
    cliente: { id: 'c', nome: 'Ana' }, data_inicio: null, data_validade: null, valor_pago: 100.1, status: 'ativo',
    observacao: null, cobranca: 'paga', venda_id: 'v', usos: [{ id: 'u', servico_id: 's1', agendamento_id: null, created_at: '' }],
    ...extra,
  });

  it('receita só dos pagos; combo e ilimitado não somam sessões', () => {
    const r = calcularRelatorioUtilizacao([
      v({}),
      v({ id: 'y', valor_pago: 0.2 }),
      v({ id: 'z', cobranca: 'pendente', valor_pago: 300, usos: [] }),
      v({ id: 'w', valor_pago: null, pacote: { id: 'p2', nome: 'Combo', preco: 0, validade_dias: null, controla_sessoes: false,
        servicos: [{ servico_id: 's1', nome: 'L', quantidade: 3 }] } }),
      v({ id: 'q', valor_pago: 50, pacote: { id: 'p3', nome: 'Livre', preco: 0, validade_dias: null, controla_sessoes: true,
        servicos: [{ servico_id: 's1', nome: 'L', quantidade: null }] } }),
    ]);
    expect(r.receitaTotal).toBe(150.3);
    expect(r.totalSessoes).toBe(9);
    expect(r.sessoesUsadas).toBe(4);
    expect(r.aproveitamento).toBe(44);
    expect(r.vendas).toBe(5);
    expect(r.aCobrar).toBe(1);
    expect(r.porPacote.map(p => [p.nome, p.vendas, p.aCobrar, p.receita])).toEqual([
      ['Limpeza', 3, 1, 100.3], ['Livre', 1, 0, 50], ['Combo', 1, 0, 0],
    ]);
  });

  it('carregarRelatorioUtilizacao usa os vendidos do banco', async () => {
    const f = fakeDb({ linhas: { pacote_clientes: [vendidoRaw('pc1')] } });
    const r = await carregarRelatorioUtilizacao(f.db, 'e1');
    expect(r.receitaTotal).toBe(150);
    expect(r.totalSessoes).toBe(3);
  });
});
