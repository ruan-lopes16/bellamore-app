/**
 * Regra única de venda avulsa (PDV do web e, depois, do app): carrinho com limite de estoque e
 * gravação com cada etapa conferida. O pagamento segue a mesma regra da comanda
 * (shared/comanda-fechamento.ts): total coberto, troco permitido, total zero = cortesia, cartão
 * com maquininha/bandeira/parcelas/taxa da configuração (shared/taxas-cartao.ts).
 */
import { montarPagamentos, resumoComanda, type SplitPagamento } from './comanda-fechamento';
import { mensagemErroBanco } from './erros';
import type { ClienteDb } from './kpis-financeiros-consultas';
import type { ConfigCartoes } from './taxas-cartao';
import { novoUuid } from './uuid';

/** Cliente do banco para a venda: tabelas (caminho antigo) e `rpc` (função da 087). Estrutural. */
export type ClienteDbVenda = ClienteDb & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any;
};

/**
 * Função ainda não criada no banco (a 087 não foi rodada): PostgREST devolve PGRST202. Só esse código:
 * `42883` vem do Postgres quando a função EXISTE mas algo dentro dela falta, e não deve cair no caminho antigo.
 */
const funcaoInexistente = (e: { code?: string | null } | null | undefined) => e?.code === 'PGRST202';

/** Produto de venda como vem do catálogo (`produtos` com `tipo = 'venda'`). */
export type ProdutoVenda = { id: string; nome: string; preco_venda: number; estoque_atual: number; unidade: string };

/** Item do carrinho. `estoqueAtual` = saldo do produto quando entrou no carrinho (limite da quantidade). */
export type ItemVenda = { produtoId: string; nome: string; precoUnitario: number; quantidade: number; estoqueAtual: number; unidade: string };

const centavos = (v: number) => Math.round(v * 100) / 100;

/**
 * Adiciona 1 unidade do produto. Sem estoque → devolve o mesmo array (nada muda); já no carrinho
 * → soma 1 até o estoque (no limite, o mesmo array).
 */
export function adicionarAoCarrinho(itens: ItemVenda[], p: ProdutoVenda): ItemVenda[] {
  if (p.estoque_atual <= 0) return itens;
  const existente = itens.find(i => i.produtoId === p.id);
  if (existente) {
    if (existente.quantidade >= p.estoque_atual) return itens;
    return itens.map(i => i.produtoId === p.id ? { ...i, quantidade: i.quantidade + 1, estoqueAtual: p.estoque_atual } : i);
  }
  return [...itens, {
    produtoId: p.id, nome: p.nome, precoUnitario: p.preco_venda, quantidade: 1,
    estoqueAtual: p.estoque_atual, unidade: p.unidade,
  }];
}

/** Define a quantidade do item: menor que 1 remove; acima do estoque limita ao estoque. */
export function alterarQuantidade(itens: ItemVenda[], produtoId: string, quantidade: number): ItemVenda[] {
  const q = Math.floor(quantidade);
  if (!Number.isFinite(q) || q < 1) return itens.filter(i => i.produtoId !== produtoId);
  return itens.map(i => i.produtoId === produtoId ? { ...i, quantidade: Math.min(q, i.estoqueAtual) } : i);
}

/** Soma dos itens em reais, arredondada a centavos (sem ruído de ponto flutuante). */
export function subtotalVenda(itens: ItemVenda[]): number {
  const emCentavos = itens.reduce((s, i) => s + Math.round(i.precoUnitario * 100) * i.quantidade, 0);
  return emCentavos / 100;
}

/**
 * Tudo que a gravação precisa. `desconto` já em reais (calcularDesconto); `splits` com valores
 * numéricos (parseValorBR). O total NÃO vem da tela: gravarVenda o recalcula (resumoComanda) e usa
 * esse mesmo número para validar e para a cortesia automática de R$ 0.
 */
export type DadosVenda = {
  empresaId: string; clienteId: string | null; itens: ItemVenda[]; desconto: number;
  splits: SplitPagamento[]; config: ConfigCartoes;
  /**
   * Chave da venda (`p_venda_id` da v2, migration 090): a tela gera UMA vez por carrinho (novoUuid)
   * e reaproveita na nova tentativa — se a 1ª chegou a gravar, o banco devolve a mesma venda em vez
   * de registrar outra. Ausente = um id novo por chamada (sem essa proteção).
   */
  vendaId?: string;
};

/** Venda gravada. `avisoEstoque` preenchido = venda e pagamentos ok, mas a baixa do estoque falhou. */
export type ResultadoVenda = { vendaId: string; avisoEstoque: string | null };

/** Etapa da gravação em que o erro aconteceu. */
export type EtapaVenda = 'venda' | 'itens' | 'pagamentos';

/**
 * Erro da gravação: `message` = '<etapa>: <mensagem>'. `vendaId` preenchido = a linha de
 * `vendas` FICOU gravada (a tela deve bloquear uma nova venda para não registrar duas vezes e
 * mandar conferir no Financeiro); null = nada ficou gravado, pode tentar de novo.
 */
export class ErroVenda extends Error {
  constructor(readonly etapa: EtapaVenda, mensagem: string, readonly vendaId: string | null) {
    super(`${etapa}: ${mensagem}`);
    this.name = 'ErroVenda';
  }
}

/**
 * Grava a venda. Caminho principal: a função `registrar_venda_avulsa_v2` (migration 090) grava venda,
 * itens, saída de estoque e pagamentos numa transação só, travando o estoque — qualquer erro desfaz
 * tudo (`ErroVenda` com `vendaId` null: pode tentar de novo) — e usa `d.vendaId` como chave contra
 * repetição. Sem a 090 (`PGRST202`) chama a `registrar_venda_avulsa` (087, mesma regra sem a
 * chave). Só `PGRST202` desce para a próxima. Sem a 087 também, usa o caminho
 * antigo: `vendas` → `venda_itens` → `estoque_movimentos` (saída; o trigger trg_atualizar_estoque
 * baixa o saldo) → `pagamentos` (`venda_id`, via montarPagamentos), com cada etapa conferida — falha
 * nos itens tenta desfazer a venda, falha no estoque vira `avisoEstoque`, falha nos pagamentos lança
 * com `vendaId`. Confere o total antes de gravar qualquer coisa. Lança sempre `ErroVenda`.
 */
export async function gravarVenda(db: ClienteDbVenda, d: DadosVenda): Promise<ResultadoVenda> {
  if (d.itens.length === 0) throw new ErroVenda('venda', 'Carrinho vazio.', null);
  const subtotal = subtotalVenda(d.itens);
  const desconto = centavos(d.desconto);
  if (desconto > subtotal + 0.001) throw new ErroVenda('venda', 'O desconto não pode ser maior que o subtotal', null);
  const resumo = resumoComanda({ subtotal, desconto, descontoReserva: 0, splits: d.splits });
  if (!resumo.podeFechar) throw new ErroVenda('venda', resumo.motivo ?? 'Pagamento não cobre o total.', null);

  // 0. Tudo ou nada pela função do banco. O total é o recalculado aqui (e de novo na função).
  const pagamentosRpc = montarPagamentos(d.splits, { empresaId: d.empresaId, config: d.config, total: resumo.total })
    .map(({ empresa_id: _e, comanda_id: _c, venda_id: _v, ...resto }) => resto);
  const argsRpc = {
    p_empresa: d.empresaId,
    p_cliente: d.clienteId || null,
    p_desconto: desconto,
    p_itens: d.itens.map(i => ({ produto_id: i.produtoId, quantidade: i.quantidade, preco_unitario: i.precoUnitario })),
    p_pagamentos: pagamentosRpc,
  };
  // 0a. v2 (090): mesma função da 087 com a chave `p_venda_id` — a nova tentativa com o MESMO id
  //     devolve a venda já gravada em vez de registrar outra. 0b. sem a 090: v1 (087).
  const tentativas: [string, Record<string, unknown>][] = [
    ['registrar_venda_avulsa_v2', { p_venda_id: d.vendaId || novoUuid(), ...argsRpc }],
    ['registrar_venda_avulsa', argsRpc],
  ];
  for (const [fn, args] of tentativas) {
    const { data: idRpc, error: eRpc } = await db.rpc(fn, args);
    if (funcaoInexistente(eRpc)) continue;
    // Erro SEM código = a chamada nem chegou a uma resposta do Postgres/PostgREST (rede caiu): o
    // servidor pode ter gravado a venda. Não libera "tentar de novo" às cegas: manda conferir no Histórico.
    if (eRpc && !eRpc.code) {
      throw new ErroVenda('venda', 'Sem resposta do servidor: a venda pode ter sido registrada. Confira no Histórico antes de tentar de novo.', null);
    }
    if (eRpc || typeof idRpc !== 'string' || !idRpc) {
      throw new ErroVenda('venda', mensagemErroBanco(eRpc, 'registrar a venda'), null);
    }
    return { vendaId: idRpc, avisoEstoque: null };
  }

  // Sem a 087 nem a 090: caminho antigo em 4 passos.
  // 1. Venda (valor_final é coluna gerada: valor_total − desconto)
  const { data: venda, error: eVenda } = await db.from('vendas').insert({
    empresa_id: d.empresaId,
    cliente_id: d.clienteId || null,
    valor_total: subtotal,
    desconto,
  }).select('id').single();
  if (eVenda || !venda?.id) throw new ErroVenda('venda', mensagemErroBanco(eVenda, 'registrar a venda'), null);
  const vendaId = venda.id as string;

  // 2. Itens
  const { error: eItens } = await db.from('venda_itens').insert(d.itens.map(i => ({
    empresa_id: d.empresaId,
    venda_id: vendaId,
    produto_id: i.produtoId,
    quantidade: i.quantidade,
    preco_unitario: i.precoUnitario,
  })));
  if (eItens) {
    const msg = mensagemErroBanco(eItens, 'registrar os itens da venda');
    // Venda sem itens contaria como receita: tenta apagá-la (venda_itens cai junto por cascata).
    const { data: apagadas, error: eDesfaz } = await db.from('vendas').delete().eq('id', vendaId).select('id');
    if (!eDesfaz && (apagadas?.length ?? 0) > 0) throw new ErroVenda('itens', `${msg} — nada foi registrado; tente de novo.`, null);
    throw new ErroVenda('itens', `${msg} — a venda foi registrada sem os itens; confira em Financeiro antes de lançar de novo.`, vendaId);
  }

  // 3. Baixa do estoque — falha não desfaz a venda (o dinheiro entrou); a tela avisa.
  let avisoEstoque: string | null = null;
  const { error: eEstoque } = await db.from('estoque_movimentos').insert(d.itens.map(i => ({
    empresa_id: d.empresaId,
    produto_id: i.produtoId,
    tipo: 'saida',
    quantidade: i.quantidade,
    motivo: 'Venda avulsa',
  })));
  if (eEstoque) {
    avisoEstoque = `Venda registrada, mas a baixa do estoque falhou: ${mensagemErroBanco(eEstoque, 'baixar o estoque')} — ajuste o saldo em Estoque.`;
  }

  // 4. Pagamentos (cortesia R$ 0 automática quando o total é zero e não há pagamento). O total é o
  //    recalculado aqui (o mesmo que validou), nunca um número vindo da tela.
  const linhas = montarPagamentos(d.splits, { empresaId: d.empresaId, vendaId, config: d.config, total: resumo.total });
  const { error: ePag } = await db.from('pagamentos').insert(linhas);
  if (ePag) {
    throw new ErroVenda('pagamentos',
      `${mensagemErroBanco(ePag, 'registrar os pagamentos')} — a venda foi registrada sem pagamento; confira em Financeiro antes de lançar de novo.`,
      vendaId);
  }
  return { vendaId, avisoEstoque };
}
