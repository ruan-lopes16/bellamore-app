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
    empresaId: 'e1', clienteId: 'c1', itens, desconto: 0.1, config,
    splits: [{ metodo: 'credito', valor: 10, bandeira: 'visa', parcelas: 2 }], ...extra,
  });
  const linhas = { vendas: [{ id: 'v1' }] };

  const PGRST202 = (fn: string) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn}` } });
  /** Banco com a 087 e sem a 090: a v2 não existe (PGRST202); as demais respostas vêm de `rpc`. */
  const fakeV1 = (o: Parameters<typeof fakeDb>[0] = {}) => {
    const rpc = o.rpc;
    return fakeDb({ ...o, rpc: (fn, args) => (fn === 'registrar_venda_avulsa_v2' || !rpc ? PGRST202(fn) : rpc(fn, args)) });
  };

  describe('pela função registrar_venda_avulsa_v2 (090), com chave contra repetição', () => {
    const v2 = (r: () => { data: unknown; error: { code?: string; message: string } | null }) =>
      (fn: string) => (fn === 'registrar_venda_avulsa_v2' ? r() : { data: 'v1-nao-devia', error: null });

    it('manda o vendaId da tela e os mesmos itens/pagamentos da 087; não chama a v1 nem tabela', async () => {
      const { db, chamadas, rpcs } = fakeDb({ awaitavel: true, linhas, rpc: v2(() => ({ data: 'V1', error: null })) });
      const r = await gravarVenda(db, { ...dados(), vendaId: 'V1' });
      expect(r).toEqual({ vendaId: 'V1', avisoEstoque: null });
      expect(chamadas).toHaveLength(0);
      expect(rpcs.map(x => x.fn)).toEqual(['registrar_venda_avulsa_v2']);
      const a = rpcs[0].args;
      expect(a.p_venda_id).toBe('V1');
      expect(a.p_empresa).toBe('e1');
      expect(a.p_cliente).toBe('c1');
      expect(a.p_desconto).toBe(0.1);
      expect(a.p_itens).toEqual([{ produto_id: 'p2', quantidade: 2, preco_unitario: 5.05 }]);
      expect((a.p_pagamentos as unknown[])[0]).toMatchObject({ metodo: 'credito', bandeira: 'visa', parcelas: 2, maquininha_id: 'maq1', valor: 10 });
    });

    it('nova tentativa depois de "sem resposta" reenvia o MESMO vendaId (o banco devolve a venda já gravada)', async () => {
      let n = 0;
      const { db, rpcs } = fakeDb({ awaitavel: true, linhas, rpc: v2(() => (++n === 1
        ? { data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }
        : { data: 'V1', error: null })) });
      const e = await gravarVenda(db, { ...dados(), vendaId: 'V1' }).catch(x => x);
      expect(e).toBeInstanceOf(ErroVenda);
      expect(e.message).toMatch(/^venda: Sem resposta do servidor/);
      const r = await gravarVenda(db, { ...dados(), vendaId: 'V1' });
      expect(r.vendaId).toBe('V1');
      expect(rpcs.map(x => [x.fn, x.args.p_venda_id])).toEqual([
        ['registrar_venda_avulsa_v2', 'V1'], ['registrar_venda_avulsa_v2', 'V1'],
      ]);
    });

    it('erro da v2 vira ErroVenda e não cai na v1 nem no caminho antigo', async () => {
      const { db, chamadas, rpcs } = fakeDb({ awaitavel: true, linhas,
        rpc: v2(() => ({ data: null, error: { code: 'P0001', message: 'Estoque insuficiente: Óleo (restam 1)' } })) });
      const e = await gravarVenda(db, { ...dados(), vendaId: 'V1' }).catch(x => x);
      expect(e.message).toBe('venda: Estoque insuficiente: Óleo (restam 1)');
      expect(rpcs).toHaveLength(1);
      expect(chamadas).toHaveLength(0);
    });

    it('sem vendaId da tela, gera um uuid (sem idempotência entre tentativas)', async () => {
      const { db, rpcs } = fakeDb({ awaitavel: true, linhas, rpc: v2(() => ({ data: 'gerado', error: null })) });
      await gravarVenda(db, dados());
      expect(rpcs[0].args.p_venda_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('sem a 090 cai na v1 (087) e, sem a 087, no caminho antigo', async () => {
      const { db, rpcs, chamadas } = fakeDb({ awaitavel: true, linhas });
      const r = await gravarVenda(db, { ...dados(), vendaId: 'V1' });
      expect(rpcs.map(x => x.fn)).toEqual(['registrar_venda_avulsa_v2', 'registrar_venda_avulsa']);
      expect(rpcs[1].args).not.toHaveProperty('p_venda_id');
      expect(r.vendaId).toBe('v1');
      expect(chamadas.map(c => c.tabela)).toEqual(['vendas', 'venda_itens', 'estoque_movimentos', 'pagamentos']);
    });
  });

  describe('pela função registrar_venda_avulsa (087), sem a 090', () => {
    const ok = () => ({ data: 'v9', error: null });

    it('chama a função uma vez, com itens, desconto e pagamentos, e não grava tabela nenhuma direto', async () => {
      const { db, chamadas, rpcs } = fakeV1({ awaitavel: true, linhas, rpc: ok });
      const r = await gravarVenda(db, dados());
      expect(r).toEqual({ vendaId: 'v9', avisoEstoque: null });
      expect(chamadas).toHaveLength(0);
      expect(rpcs).toHaveLength(2);
      expect(rpcs[1].fn).toBe('registrar_venda_avulsa');
      const a = rpcs[1].args;
      expect(a.p_empresa).toBe('e1');
      expect(a.p_cliente).toBe('c1');
      expect(a.p_desconto).toBe(0.1);
      expect(a.p_itens).toEqual([{ produto_id: 'p2', quantidade: 2, preco_unitario: 5.05 }]);
      const pags = a.p_pagamentos as Record<string, unknown>[];
      expect(pags).toHaveLength(1);
      expect(pags[0]).toMatchObject({ metodo: 'credito', bandeira: 'visa', parcelas: 2, maquininha_id: 'maq1', valor: 10, status: 'pago' });
      expect(pags[0]).not.toHaveProperty('venda_id');
      expect(pags[0]).not.toHaveProperty('empresa_id');
      expect(pags[0]).not.toHaveProperty('comanda_id');
    });

    it('cliente opcional vira null; total zero sem pagamento manda a Cortesia R$ 0', async () => {
      const { db, rpcs } = fakeV1({ awaitavel: true, linhas, rpc: ok });
      await gravarVenda(db, dados({ clienteId: null, desconto: 10.1, splits: [] }));
      expect(rpcs[1].args.p_cliente).toBeNull();
      expect(rpcs[1].args.p_pagamentos).toEqual([expect.objectContaining({ metodo: 'cortesia', valor: 0 })]);
    });

    it('erro sem code (rede caiu): não libera nova tentativa e manda conferir no Histórico', async () => {
      const { db, chamadas } = fakeV1({ awaitavel: true, linhas,
        rpc: () => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }) });
      const e = await gravarVenda(db, dados()).catch(x => x);
      expect(e).toBeInstanceOf(ErroVenda);
      expect(e.etapa).toBe('venda');
      expect(e.vendaId).toBeNull();
      expect(e.message).toBe('venda: Sem resposta do servidor: a venda pode ter sido registrada. Confira no Histórico antes de tentar de novo.');
      expect(chamadas).toHaveLength(0);
    });

    it('erro da função (ex.: estoque insuficiente) vira ErroVenda sem vendaId e não tenta o caminho antigo', async () => {
      const { db, chamadas } = fakeV1({ awaitavel: true, linhas,
        rpc: () => ({ data: null, error: { code: 'P0001', message: 'Estoque insuficiente: Óleo (restam 1)' } }) });
      const e = await gravarVenda(db, dados()).catch(x => x);
      expect(e).toBeInstanceOf(ErroVenda);
      expect(e.etapa).toBe('venda');
      expect(e.vendaId).toBeNull();
      expect(e.message).toBe('venda: Estoque insuficiente: Óleo (restam 1)');
      expect(chamadas).toHaveLength(0);
    });

    it('permissão negada pela função vira mensagem em português', async () => {
      const { db } = fakeV1({ awaitavel: true, linhas,
        rpc: () => ({ data: null, error: { code: '42501', message: 'Você não tem permissão para registrar vendas avulsas.' } }) });
      await expect(gravarVenda(db, dados())).rejects.toThrow('venda: Você não tem permissão para registrar a venda. Fale com a dona ou a gestora.');
    });

    it('função sem devolver id é erro (nunca sucesso sem venda)', async () => {
      const { db } = fakeV1({ awaitavel: true, linhas, rpc: () => ({ data: null, error: null }) });
      const e = await gravarVenda(db, dados()).catch(x => x);
      expect(e).toBeInstanceOf(ErroVenda);
      expect(e.vendaId).toBeNull();
    });

    it('42883 (algo dentro da função falta) é erro, não cai no caminho antigo', async () => {
      const { db, chamadas } = fakeV1({ awaitavel: true, linhas,
        rpc: () => ({ data: null, error: { code: '42883', message: 'function trim_scale(numeric) does not exist' } }) });
      const e = await gravarVenda(db, dados()).catch(x => x);
      expect(e).toBeInstanceOf(ErroVenda);
      expect(e.vendaId).toBeNull();
      expect(chamadas).toHaveLength(0);
    });

    it('sem a 087 (PGRST202) usa o caminho antigo em 4 passos', async () => {
      const { db, chamadas, rpcs } = fakeV1({ awaitavel: true, linhas }); // sem `rpc` = PGRST202
      const r = await gravarVenda(db, dados());
      expect(rpcs).toHaveLength(2);
      expect(r).toEqual({ vendaId: 'v1', avisoEstoque: null });
      expect(chamadas.map(c => c.tabela)).toEqual(['vendas', 'venda_itens', 'estoque_movimentos', 'pagamentos']);
    });

    it('validação local continua antes da função (total não coberto não chama nada)', async () => {
      const { db, chamadas, rpcs } = fakeV1({ awaitavel: true, linhas, rpc: ok });
      await expect(gravarVenda(db, dados({ splits: [{ metodo: 'pix', valor: 5 }] }))).rejects.toThrow('venda: Ainda faltam R$ 5,00 para cobrir o total');
      expect(rpcs).toHaveLength(0);
      expect(chamadas).toHaveLength(0);
    });
  });

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
    await gravarVenda(db, dados({ desconto: 10.1, splits: [] }));
    const [pag] = opsDe(chamadas, 'pagamentos')[0][0][1] as [Record<string, unknown>[]];
    expect(pag).toEqual([expect.objectContaining({ metodo: 'cortesia', valor: 0, venda_id: 'v1' })]);
  });

  it('cortesia decidida pelo total recalculado, nunca por um total vindo da tela (I2)', async () => {
    // Uma tela com total desatualizado em 0 não vira cortesia: o total real (10,00) foi pago com troco.
    const { db, chamadas } = fakeDb({ awaitavel: true, linhas });
    const comTotalVelho = { ...dados({ splits: [{ metodo: 'dinheiro', valor: 20 }] }), total: 0 } as DadosVenda;
    await gravarVenda(db, comTotalVelho);
    const [pag] = opsDe(chamadas, 'pagamentos')[0][0][1] as [Record<string, unknown>[]];
    expect(pag).toEqual([expect.objectContaining({ metodo: 'dinheiro', valor: 20 })]);
    expect(pag.some(l => l.metodo === 'cortesia')).toBe(false);
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
