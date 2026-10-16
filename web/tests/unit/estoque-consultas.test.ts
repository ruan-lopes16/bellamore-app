import { describe, expect, it } from 'vitest';
import {
  carregarProdutosEstoque, carregarMovimentosMes, movimentarEstoque, carregarUnidadesVisiveis, salvarUnidadesVisiveis,
} from '@shared/estoque-consultas';
import { fakeDb, opsDe } from './fixtures/fake-db';

const produto = { id: 'p1', estoque_atual: 5, nome: 'Creme', unidade: 'un' };

describe('carregarProdutosEstoque', () => {
  it('só ativos da empresa, ordem categoria/nome/id, paginado', async () => {
    const { db, chamadas } = fakeDb({ linhas: { produtos: [{ id: 'p1', estoque_atual: '2', estoque_minimo: '1', preco_custo: '3', preco_venda: '0', qtd_por_unidade: null }] } });
    const r = await carregarProdutosEstoque(db, 'e1');
    const ops = opsDe(chamadas, 'produtos')[0];
    expect(ops).toContainEqual(['eq', ['empresa_id', 'e1']]);
    expect(ops).toContainEqual(['eq', ['ativo', true]]);
    expect(ops.filter(([m]) => m === 'order').map(([, a]) => a[0])).toEqual(['categoria', 'nome', 'id']);
    expect(ops.some(([m]) => m === 'range')).toBe(true);
    // números vêm como texto do PostgREST (numeric) e viram number; qtd nula vira 1
    expect(r[0]).toMatchObject({ estoque_atual: 2, estoque_minimo: 1, preco_custo: 3, preco_venda: 0, qtd_por_unidade: 1 });
  });
  it('erro lança (nunca lista vazia)', async () => {
    const { db } = fakeDb({ erroTabelas: { produtos: 'boom' } });
    await expect(carregarProdutosEstoque(db, 'e1')).rejects.toThrow('boom');
  });
});

describe('carregarMovimentosMes', () => {
  it('limites do mês em Brasília, com produto_id, ordem desc + id', async () => {
    const { db, chamadas } = fakeDb({ linhas: { estoque_movimentos: [] } });
    await carregarMovimentosMes(db, 'e1', '2026-10');
    const ops = opsDe(chamadas, 'estoque_movimentos')[0];
    const sel = ops.find(([m]) => m === 'select')![1][0] as string;
    expect(sel).toContain('produto_id');
    expect(sel).toContain('produto:produtos(nome, unidade)');
    expect(ops).toContainEqual(['gte', ['created_at', '2026-10-01T03:00:00.000Z']]);
    expect(ops).toContainEqual(['lte', ['created_at', '2026-11-01T02:59:59.999Z']]);
    expect(ops).toContainEqual(['order', ['created_at', { ascending: false }]]);
    expect(ops).toContainEqual(['order', ['id']]);
  });
});

describe('movimentarEstoque', () => {
  const dados = { empresaId: 'e1', produto, tipo: 'saida' as const, quantidade: 2, motivo: ' uso ' };

  it('pela função: argumentos e saldo devolvido pelo banco', async () => {
    const { db, chamadas, rpcs } = fakeDb({ rpc: () => ({ data: 3, error: null }) });
    expect(await movimentarEstoque(db, dados)).toEqual({ novoSaldo: 3 });
    expect(rpcs).toEqual([{ fn: 'movimentar_estoque', args: { p_produto: 'p1', p_tipo: 'saida', p_quantidade: 2, p_motivo: 'uso' } }]);
    expect(chamadas).toHaveLength(0);
  });
  it('saldo como texto (numeric) vira number', async () => {
    const { db } = fakeDb({ rpc: () => ({ data: '3.500', error: null }) });
    expect(await movimentarEstoque(db, dados)).toEqual({ novoSaldo: 3.5 });
  });
  it('erro da função vira mensagem e não tenta o caminho antigo', async () => {
    const { db, chamadas } = fakeDb({ rpc: () => ({ data: null, error: { code: 'P0001', message: 'Estoque insuficiente: Creme (restam 1 un)' } }) });
    await expect(movimentarEstoque(db, dados)).rejects.toThrow('Estoque insuficiente: Creme (restam 1 un)');
    expect(chamadas).toHaveLength(0);
  });
  it('permissão negada em português', async () => {
    const { db } = fakeDb({ rpc: () => ({ data: null, error: { code: '42501', message: 'x' } }) });
    await expect(movimentarEstoque(db, dados)).rejects.toThrow('Você não tem permissão para movimentar o estoque. Fale com a dona ou a gestora.');
  });
  it('sem resposta (erro sem code) avisa para conferir antes de repetir', async () => {
    const { db } = fakeDb({ rpc: () => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }) });
    await expect(movimentarEstoque(db, dados)).rejects.toThrow('Sem resposta do servidor: a movimentação pode ter sido registrada. Confira em Movimentações antes de repetir.');
  });
  it('quantidade inválida não chama nada', async () => {
    const { db, chamadas, rpcs } = fakeDb({ rpc: () => ({ data: 1, error: null }) });
    await expect(movimentarEstoque(db, { ...dados, quantidade: 0 })).rejects.toThrow('Informe uma quantidade maior que zero.');
    expect(rpcs).toHaveLength(0);
    expect(chamadas).toHaveLength(0);
  });
  it('rpc sem data e sem erro avisa para conferir antes de repetir', async () => {
    const { db } = fakeDb({ rpc: () => ({ data: null, error: null }) });
    await expect(movimentarEstoque(db, dados)).rejects.toThrow('Sem resposta do servidor: a movimentação pode ter sido registrada.');
  });
  it('rpc com saldo não numérico lança aviso (nunca sucesso falso)', async () => {
    const { db } = fakeDb({ rpc: () => ({ data: 'abc', error: null }) });
    await expect(movimentarEstoque(db, dados)).rejects.toThrow('Sem resposta do servidor');
  });
  describe('sem a 088 (PGRST202): caminho antigo', () => {
    it('insert com erro sem code (rede) avisa para conferir antes de repetir', async () => {
      const { db } = fakeDb({ awaitavel: true, erroTabelasCodigo: { estoque_movimentos: { code: '', message: 'TypeError: Failed to fetch' } } });
      await expect(movimentarEstoque(db, dados)).rejects.toThrow('Sem resposta do servidor: a movimentação pode ter sido registrada. Confira em Movimentações antes de repetir.');
    });
    it('saída maior que o saldo da tela é recusada sem gravar', async () => {
      const { db, chamadas } = fakeDb({ awaitavel: true });
      await expect(movimentarEstoque(db, { ...dados, quantidade: 9 })).rejects.toThrow('Estoque insuficiente: Creme (restam 5 un)');
      expect(chamadas).toHaveLength(0);
    });
    it('grava o movimento e devolve saldo da tela ± quantidade', async () => {
      const { db, chamadas } = fakeDb({ awaitavel: true });
      expect(await movimentarEstoque(db, dados)).toEqual({ novoSaldo: 3 });
      expect(opsDe(chamadas, 'estoque_movimentos')[0][0]).toEqual(['insert', [{
        produto_id: 'p1', empresa_id: 'e1', tipo: 'saida', quantidade: 2, motivo: 'uso',
      }]]);
      expect(await movimentarEstoque(db, { ...dados, tipo: 'entrada', motivo: '' })).toEqual({ novoSaldo: 7 });
    });
    it('erro do insert lança (nunca sucesso falso)', async () => {
      const { db } = fakeDb({ awaitavel: true, erroTabelasCodigo: { estoque_movimentos: { code: '42501', message: 'new row violates row-level security policy' } } });
      await expect(movimentarEstoque(db, dados)).rejects.toThrow('Você não tem permissão para movimentar o estoque.');
    });
  });
});

describe('unidades visíveis', () => {
  it('sem linha: null e disponível', async () => {
    const { db } = fakeDb({ awaitavel: true, linhas: { estoque_unidades_empresa: [] } });
    expect(await carregarUnidadesVisiveis(db, 'e1')).toEqual({ unidades: null, disponivel: true });
  });
  it('com linha: lista normalizada', async () => {
    const { db } = fakeDb({ awaitavel: true, linhas: { estoque_unidades_empresa: [{ unidades: ['kg', 'un', 'zz'] }] } });
    expect(await carregarUnidadesVisiveis(db, 'e1')).toEqual({ unidades: ['un', 'kg'], disponivel: true });
  });
  it('tabela inexistente (sem a 088): null e indisponível', async () => {
    const { db } = fakeDb({ awaitavel: true, erroTabelas: { estoque_unidades_empresa: "Could not find the table 'public.estoque_unidades_empresa' in the schema cache" } });
    expect(await carregarUnidadesVisiveis(db, 'e1')).toEqual({ unidades: null, disponivel: false });
  });
  it('outro erro lança', async () => {
    const { db } = fakeDb({ awaitavel: true, erroTabelas: { estoque_unidades_empresa: 'boom' } });
    await expect(carregarUnidadesVisiveis(db, 'e1')).rejects.toThrow('boom');
  });
  it('coluna ausente (42703) lança e não esconde o ajuste', async () => {
    const { db } = fakeDb({ awaitavel: true, erroTabelasCodigo: { estoque_unidades_empresa: { code: '42703', message: 'column unidades does not exist' } } });
    // Lança (não trata como "tabela ausente"); o texto técnico em inglês fica só no console (M8).
    await expect(carregarUnidadesVisiveis(db, 'e1')).rejects.toThrow('Não foi possível carregar as unidades de medida.');
  });
  it('tabela ausente detectada só pelo code PGRST205, com mensagem qualquer', async () => {
    const { db } = fakeDb({ awaitavel: true, erroTabelasCodigo: { estoque_unidades_empresa: { code: 'PGRST205', message: 'qualquer coisa' } } });
    expect(await carregarUnidadesVisiveis(db, 'e1')).toEqual({ unidades: null, disponivel: false });
  });
  it('salvar: upsert normalizado; lista vazia é recusada', async () => {
    const { db, chamadas } = fakeDb({ awaitavel: true, linhas: { estoque_unidades_empresa: [{ empresa_id: 'e1' }] } });
    expect(await salvarUnidadesVisiveis(db, 'e1', ['kg', 'un', 'zz'])).toEqual(['un', 'kg']);
    const ops = opsDe(chamadas, 'estoque_unidades_empresa')[0];
    expect(ops[0][0]).toBe('upsert');
    expect((ops[0][1][0] as Record<string, unknown>)).toMatchObject({ empresa_id: 'e1', unidades: ['un', 'kg'] });
    expect(ops).toContainEqual(['select', ['empresa_id']]);
    await expect(salvarUnidadesVisiveis(db, 'e1', ['zz'])).rejects.toThrow('Deixe pelo menos uma unidade ligada.');
  });
  it('salvar com 42501 do banco vira mensagem de permissão em português', async () => {
    const { db } = fakeDb({ awaitavel: true, erroTabelasCodigo: { estoque_unidades_empresa: { code: '42501', message: 'new row violates row-level security policy' } } });
    await expect(salvarUnidadesVisiveis(db, 'e1', ['un'])).rejects.toThrow('Você não tem permissão para ajustar as unidades. Fale com a dona ou a gestora.');
  });
  it('salvar sem linha devolvida = sem permissão', async () => {
    const { db } = fakeDb({ awaitavel: true, linhas: { estoque_unidades_empresa: [] } });
    await expect(salvarUnidadesVisiveis(db, 'e1', ['un'])).rejects.toThrow('Você não tem permissão para ajustar as unidades.');
  });
});
