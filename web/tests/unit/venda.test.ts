import { describe, expect, it } from 'vitest';
import {
  adicionarAoCarrinho, alterarQuantidade, subtotalVenda, gravarVenda, ErroVenda,
  type ItemVenda, type ProdutoVenda, type DadosVenda,
} from '@shared/venda';
import { configLegada, type ConfigCartoes } from '@shared/taxas-cartao';
import { fakeDb, opsDe } from './fixtures/fake-db';

const creme: ProdutoVenda = { id: 'p1', nome: 'Creme', preco_venda: 10.1, estoque_atual: 2, unidade: 'un' };
const oleo: ProdutoVenda = { id: 'p2', nome: 'Óleo', preco_venda: 5.05, estoque_atual: 5, unidade: 'ml' };
const semEstoque: ProdutoVenda = { id: 'p3', nome: 'Esgotado', preco_venda: 7, estoque_atual: 0, unidade: 'un' };

describe('carrinho da venda', () => {
  it('adiciona o produto com quantidade 1 e os dados do catálogo', () => {
    expect(adicionarAoCarrinho([], creme)).toEqual([
      { produtoId: 'p1', nome: 'Creme', precoUnitario: 10.1, quantidade: 1, estoqueAtual: 2, unidade: 'un' },
    ]);
  });
  it('produto já no carrinho soma 1 até o estoque', () => {
    let itens = adicionarAoCarrinho([], creme);
    itens = adicionarAoCarrinho(itens, creme);
    expect(itens).toHaveLength(1);
    expect(itens[0].quantidade).toBe(2);
    const limite = adicionarAoCarrinho(itens, creme);
    expect(limite).toBe(itens);
  });
  it('produto sem estoque não entra (mesmo array)', () => {
    const itens: ItemVenda[] = [];
    expect(adicionarAoCarrinho(itens, semEstoque)).toBe(itens);
  });
  it('alterarQuantidade: menor que 1 remove; acima do estoque limita', () => {
    const itens = adicionarAoCarrinho(adicionarAoCarrinho([], creme), oleo);
    expect(alterarQuantidade(itens, 'p1', 0).map(i => i.produtoId)).toEqual(['p2']);
    expect(alterarQuantidade(itens, 'p2', 99).find(i => i.produtoId === 'p2')!.quantidade).toBe(5);
    expect(alterarQuantidade(itens, 'p2', 3).find(i => i.produtoId === 'p2')!.quantidade).toBe(3);
  });
  it('subtotal com centavos exatos', () => {
    let itens = adicionarAoCarrinho(adicionarAoCarrinho([], creme), creme);
    itens = alterarQuantidade(adicionarAoCarrinho(itens, oleo), 'p2', 3);
    // 2 × 10,10 + 3 × 5,05 = 35,35 (sem ruído de ponto flutuante)
    expect(subtotalVenda(itens)).toBe(35.35);
    expect(subtotalVenda([])).toBe(0);
  });
});

describe('gravarVenda', () => {
  const config: ConfigCartoes = { ...configLegada(null), legado: false,
    maquininhas: configLegada(null).maquininhas.map(m => ({ ...m, id: 'maq1' })) };
  const itens = alterarQuantidade(adicionarAoCarrinho([], oleo), 'p2', 2); // 10,10
  const dados = (extra: Partial<DadosVenda> = {}): DadosVenda => ({
    empresaId: 'e1', clienteId: 'c1', itens, desconto: 0.1, config, total: 10,
    splits: [{ metodo: 'credito', valor: 10, bandeira: 'visa', parcelas: 2 }], ...extra,
  });
  const linhas = { vendas: [{ id: 'v1' }] };

  it('grava vendas → venda_itens → estoque_movimentos → pagamentos com as colunas de hoje', async () => {
    const { db, chamadas } = fakeDb({ awaitavel: true, linhas });
    const r = await gravarVenda(db, dados());
    expect(r).toEqual({ vendaId: 'v1', avisoEstoque: null });
    expect(chamadas.map(c => c.tabela)).toEqual(['vendas', 'venda_itens', 'estoque_movimentos', 'pagamentos']);

    const [venda] = opsDe(chamadas, 'vendas');
    expect(venda[0]).toEqual(['insert', [{ empresa_id: 'e1', cliente_id: 'c1', valor_total: 10.1, desconto: 0.1 }]]);
    expect(venda.map(([m]) => m)).toEqual(['insert', 'select', 'single']);
    expect(venda[1]).toEqual(['select', ['id']]);

    expect(opsDe(chamadas, 'venda_itens')[0][0]).toEqual(['insert', [[
      { empresa_id: 'e1', venda_id: 'v1', produto_id: 'p2', quantidade: 2, preco_unitario: 5.05 },
    ]]]);
    expect(opsDe(chamadas, 'estoque_movimentos')[0][0]).toEqual(['insert', [[
      { empresa_id: 'e1', produto_id: 'p2', tipo: 'saida', quantidade: 2, motivo: 'Venda avulsa' },
    ]]]);
    const [pag] = opsDe(chamadas, 'pagamentos')[0][0][1] as [Record<string, unknown>[]];
    expect(pag).toHaveLength(1);
    expect(pag[0]).toMatchObject({ empresa_id: 'e1', venda_id: 'v1', metodo: 'credito', bandeira: 'visa', parcelas: 2, maquininha_id: 'maq1', valor: 10, status: 'pago' });
    expect(pag[0]).not.toHaveProperty('comanda_id');
  });

  it('cliente opcional vira null; legado não manda maquininha_id', async () => {
    const { db, chamadas } = fakeDb({ awaitavel: true, linhas });
    await gravarVenda(db, dados({ clienteId: null, config: configLegada(null) }));
    expect((opsDe(chamadas, 'vendas')[0][0][1] as Record<string, unknown>[])[0].cliente_id).toBeNull();
    const [pag] = opsDe(chamadas, 'pagamentos')[0][0][1] as [Record<string, unknown>[]];
    expect(pag[0]).not.toHaveProperty('maquininha_id');
  });

  it('total zero sem pagamento grava Cortesia R$ 0', async () => {
    const { db, chamadas } = fakeDb({ awaitavel: true, linhas });
    await gravarVenda(db, dados({ desconto: 10.1, total: 0, splits: [] }));
    const [pag] = opsDe(chamadas, 'pagamentos')[0][0][1] as [Record<string, unknown>[]];
    expect(pag).toEqual([expect.objectContaining({ metodo: 'cortesia', valor: 0, venda_id: 'v1' })]);
  });

  it('total não coberto: lança antes de gravar qualquer coisa', async () => {
    const { db, chamadas } = fakeDb({ awaitavel: true, linhas });
    await expect(gravarVenda(db, dados({ splits: [{ metodo: 'pix', valor: 5 }] }))).rejects.toThrow('venda: Ainda faltam R$ 5,00 para cobrir o total');
    expect(chamadas).toHaveLength(0);
  });

  it('carrinho vazio lança sem gravar', async () => {
    const { db, chamadas } = fakeDb({ awaitavel: true, linhas });
    await expect(gravarVenda(db, dados({ itens: [] }))).rejects.toThrow(/^venda: /);
    expect(chamadas).toHaveLength(0);
  });

  it('erro em vendas lança com a etapa e não chama as seguintes', async () => {
    const { db, chamadas } = fakeDb({ awaitavel: true, linhas, erroTabelas: { vendas: 'boom' } });
    const e = await gravarVenda(db, dados()).catch(x => x);
    expect(e).toBeInstanceOf(ErroVenda);
    expect(e.message).toBe('venda: boom');
    expect(e.etapa).toBe('venda');
    expect(e.vendaId).toBeNull();
    expect(chamadas.map(c => c.tabela)).toEqual(['vendas']);
  });

  it('erro de permissão vira mensagem em português', async () => {
    const { db } = fakeDb({ awaitavel: true, linhas, erroTabelas: { vendas: 'new row violates row-level security policy' } });
    await expect(gravarVenda(db, dados())).rejects.toThrow('venda: Você não tem permissão para registrar a venda. Fale com a dona ou a gestora.');
  });

  it('erro em venda_itens desfaz a venda (vendaId null = pode tentar de novo)', async () => {
    const { db, chamadas } = fakeDb({ awaitavel: true, linhas, erroTabelas: { venda_itens: 'x' } });
    const e = await gravarVenda(db, dados()).catch(x => x);
    expect(e.etapa).toBe('itens');
    expect(e.vendaId).toBeNull();
    expect(chamadas.map(c => c.tabela)).toEqual(['vendas', 'venda_itens', 'vendas']);
    const desfaz = opsDe(chamadas, 'vendas')[1];
    expect(desfaz.map(([m]) => m)).toEqual(['delete', 'eq', 'select']);
    expect(desfaz[1]).toEqual(['eq', ['id', 'v1']]);
  });

  it('erro em venda_itens sem conseguir desfazer devolve o vendaId (a tela bloqueia outra venda)', async () => {
    const { db } = fakeDb({ awaitavel: true, linhas, erroTabelas: { venda_itens: 'x' },
      respostaUpdate: () => ({ data: [], error: null }) });
    const e = await gravarVenda(db, dados()).catch(x => x);
    expect(e.etapa).toBe('itens');
    expect(e.vendaId).toBe('v1');
    expect(e.message).toMatch(/^itens: x/);
    expect(e.message).toContain('Financeiro');
  });

  it('erro em estoque_movimentos não lança: devolve avisoEstoque e grava os pagamentos', async () => {
    const { db, chamadas } = fakeDb({ awaitavel: true, linhas, erroTabelas: { estoque_movimentos: 'sem permissão' } });
    const r = await gravarVenda(db, dados());
    expect(r.vendaId).toBe('v1');
    expect(r.avisoEstoque).toContain('sem permissão');
    expect(chamadas.map(c => c.tabela)).toEqual(['vendas', 'venda_itens', 'estoque_movimentos', 'pagamentos']);
  });

  it('erro em pagamentos lança com a etapa "pagamentos" e o vendaId criado', async () => {
    const { db } = fakeDb({ awaitavel: true, linhas, erroTabelas: { pagamentos: 'falhou' } });
    const e = await gravarVenda(db, dados()).catch(x => x);
    expect(e).toBeInstanceOf(ErroVenda);
    expect(e.etapa).toBe('pagamentos');
    expect(e.vendaId).toBe('v1');
    expect(e.message).toMatch(/^pagamentos: falhou/);
    expect(e.message).toContain('registrada sem pagamento');
    expect(e.message).toContain('Financeiro');
  });
});
