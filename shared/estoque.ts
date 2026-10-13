/** Regras de estoque compartilhadas entre web e app (rótulos e status). */

import { parseValorBR } from "./comanda-fechamento";

/** Categorias de produto: chave -> rótulo (ordem alfabética pt-BR). */
export const ROTULOS_CATEGORIA_PRODUTO: Record<string, string> = {
  cilios: 'Cílios',
  depilacao: 'Depilação',
  ferramentas: 'Ferramentas',
  higiene: 'Higiene',
  materiais: 'Materiais',
  outros: 'Outros',
  pele: 'Pele',
  sobrancelhas: 'Sobrancelhas',
  unhas: 'Unhas',
};

/** Rótulo da categoria; devolve a própria chave se desconhecida. */
export function rotuloCategoriaProduto(chave: string): string {
  return ROTULOS_CATEGORIA_PRODUTO[chave] ?? chave;
}

export type StatusEstoque = 'ok' | 'baixo' | 'critico';

/** Zerado/negativo = crítico; com mínimo > 0 e atual <= mínimo = baixo; senão ok. */
export function statusEstoque(atual: number, minimo: number): StatusEstoque {
  if (atual <= 0) return 'critico';
  if (minimo > 0 && atual <= minimo) return 'baixo';
  return 'ok';
}

const ROTULOS_STATUS: Record<StatusEstoque, string> = { ok: 'OK', baixo: 'Baixo', critico: 'Zerado' };

/** Rótulo do status de estoque (igual nas telas e na exportação). */
export function rotuloStatusEstoque(status: StatusEstoque): string {
  return ROTULOS_STATUS[status];
}

// ── Categorias e unidades (catálogo único web e app) ─────────────

/** Categorias de produto na ordem de exibição (chave gravada no banco + rótulo). */
export const CATEGORIAS_PRODUTO: { key: string; label: string }[] =
  Object.entries(ROTULOS_CATEGORIA_PRODUTO).map(([key, label]) => ({ key, label }));

export type GrupoUnidade = 'contagem' | 'embalagem' | 'volume' | 'peso' | 'comprimento' | 'outras';

/** Grupos de unidade na ordem de exibição (agrupam os chips do ajuste de unidades). */
export const GRUPOS_UNIDADE: { key: GrupoUnidade; label: string }[] = [
  { key: 'contagem', label: 'Contagem' },
  { key: 'embalagem', label: 'Embalagens' },
  { key: 'volume', label: 'Volume' },
  { key: 'peso', label: 'Peso' },
  { key: 'comprimento', label: 'Comprimento' },
  { key: 'outras', label: 'Outras' },
];

/** Catálogo completo de unidades de medida (chave gravada em `produtos.unidade`), na ordem de exibição. */
export const UNIDADES_PRODUTO: { key: string; label: string; grupo: GrupoUnidade }[] = [
  { key: 'un', label: 'Unidade', grupo: 'contagem' },
  { key: 'pç', label: 'Peça', grupo: 'contagem' },
  { key: 'par', label: 'Par', grupo: 'contagem' },
  { key: 'kit', label: 'Kit', grupo: 'contagem' },
  { key: 'pct', label: 'Pacote', grupo: 'embalagem' },
  { key: 'cx', label: 'Caixa', grupo: 'embalagem' },
  { key: 'fr', label: 'Frasco', grupo: 'embalagem' },
  { key: 'tb', label: 'Tubo', grupo: 'embalagem' },
  { key: 'pote', label: 'Pote', grupo: 'embalagem' },
  { key: 'amp', label: 'Ampola', grupo: 'embalagem' },
  { key: 'sachê', label: 'Sachê', grupo: 'embalagem' },
  { key: 'rolo', label: 'Rolo', grupo: 'embalagem' },
  { key: 'folha', label: 'Folha', grupo: 'embalagem' },
  { key: 'ml', label: 'Mililitro', grupo: 'volume' },
  { key: 'L', label: 'Litro', grupo: 'volume' },
  { key: 'mg', label: 'Miligrama', grupo: 'peso' },
  { key: 'g', label: 'Grama', grupo: 'peso' },
  { key: 'kg', label: 'Quilo', grupo: 'peso' },
  { key: 'cm', label: 'Centímetro', grupo: 'comprimento' },
  { key: 'm', label: 'Metro', grupo: 'comprimento' },
  { key: 'dose', label: 'Dose', grupo: 'outras' },
];

/** Unidades visíveis quando a empresa nunca ajustou (lista antiga do web + frasco). */
export const UNIDADES_PADRAO = ['un', 'pct', 'ml', 'g', 'kg', 'L', 'cx', 'pç', 'par', 'fr'];

/** Só pacote e caixa perguntam quantas unidades vêm dentro (`qtd_por_unidade`). Decisão do dono. */
export function unidadePedeQtdPorUnidade(u: string): boolean {
  return u === 'pct' || u === 'cx';
}

/** Rótulo da unidade no catálogo; desconhecida devolve a própria chave. */
export function rotuloUnidade(u: string): string {
  return UNIDADES_PRODUTO.find(x => x.key === u)?.label ?? u;
}

/** Lista de unidades → só chaves do catálogo, sem repetição, na ordem do catálogo (o que se grava). */
export function normalizarUnidadesVisiveis(lista: string[]): string[] {
  const set = new Set(lista);
  return UNIDADES_PRODUTO.filter(u => set.has(u.key)).map(u => u.key);
}

/**
 * Opções do seletor de unidade: as visíveis da empresa (`null` = padrão), na ordem do catálogo,
 * mais a unidade atual do produto editado se ela não estiver lá — dado já gravado nunca some.
 */
export function unidadesParaSeletor(visiveis: string[] | null, atual?: string | null): string[] {
  const base = normalizarUnidadesVisiveis(visiveis ?? UNIDADES_PADRAO);
  return atual && !base.includes(atual) ? [...base, atual] : base;
}

/** Quantidade digitada → número ("0,5", "0.5", "1.234,56"); vazio, inválido ou negativo → 0. */
export function parseQuantidadeBR(texto: string): number {
  return parseValorBR(texto);
}

// ── Cadastro de produto ──────────────────────────────────────────

export type TipoProduto = 'material' | 'venda';

/** Campos do formulário de produto como a tela os tem (texto digitado). */
export type FormProduto = {
  nome: string; tipo: TipoProduto; categoria: string; unidade: string; qtdPorUnidade: string;
  estoqueAtual: string; estoqueMinimo: string; precoCusto: string; precoVenda: string;
};

/** Linha de `produtos` para INSERT/UPDATE. `ativo` só no cadastro. */
export type PayloadProduto = {
  empresa_id: string; nome: string; tipo: TipoProduto; categoria: string; unidade: string; qtd_por_unidade: number;
  estoque_atual: number; estoque_minimo: number; preco_custo: number; preco_venda: number; ativo?: boolean;
};

const centavosEstoque = (v: number) => Math.round(v * 100) / 100;

/**
 * Valida o formulário e monta a linha de `produtos` (mesma regra no web e no app).
 * Nome, categoria do catálogo e unidade obrigatórios; preço de venda só (e obrigatório) para venda;
 * `qtd_por_unidade` só para pacote/caixa (inteiro ≥ 1); saldo editável no cadastro e na edição.
 */
export function montarProduto(form: FormProduto, ctx: { empresaId: string; editando: boolean }): { payload: PayloadProduto } | { erro: string } {
  const nome = form.nome.trim();
  if (!nome) return { erro: 'Informe o nome do produto.' };
  if (!Object.prototype.hasOwnProperty.call(ROTULOS_CATEGORIA_PRODUTO, form.categoria)) return { erro: 'Escolha uma categoria.' };
  if (!form.unidade) return { erro: 'Escolha a unidade de medida.' };
  const precoVenda = form.tipo === 'venda' ? centavosEstoque(parseValorBR(form.precoVenda)) : 0;
  if (form.tipo === 'venda' && precoVenda <= 0) return { erro: 'Informe o preço de venda.' };
  const qtdDentro = unidadePedeQtdPorUnidade(form.unidade) ? Math.round(parseQuantidadeBR(form.qtdPorUnidade)) : 1;
  const payload: PayloadProduto = {
    empresa_id: ctx.empresaId,
    nome,
    tipo: form.tipo,
    categoria: form.categoria,
    unidade: form.unidade,
    qtd_por_unidade: qtdDentro >= 1 ? qtdDentro : 1,
    estoque_atual: parseQuantidadeBR(form.estoqueAtual),
    estoque_minimo: parseQuantidadeBR(form.estoqueMinimo),
    preco_custo: centavosEstoque(parseValorBR(form.precoCusto)),
    preco_venda: precoVenda,
  };
  if (!ctx.editando) payload.ativo = true;
  return { payload };
}

// ── Resumos (cartões das telas) ─────────────────────────────────

/** Cartões do Estoque: materiais, para venda, precisam de reposição (baixo ou zerado) e valor (saldo × custo). */
export function resumoProdutos(ps: { tipo: string; estoque_atual: number; estoque_minimo: number; preco_custo: number }[]) {
  let centavos = 0;
  let alertas = 0;
  for (const p of ps) {
    const saldo = Number(p.estoque_atual);
    if (statusEstoque(saldo, Number(p.estoque_minimo)) !== 'ok') alertas++;
    centavos += Math.round(Math.max(saldo, 0) * Number(p.preco_custo) * 100);
  }
  return {
    materiais: ps.filter(p => p.tipo === 'material').length,
    venda: ps.filter(p => p.tipo === 'venda').length,
    alertas,
    valorTotal: centavos / 100,
  };
}

/** Cartões do mês em Movimentações: quantos registros e quanto entrou/saiu. */
export function resumoMovimentos(ms: { tipo: string; quantidade: number }[]) {
  const ent = ms.filter(m => m.tipo === 'entrada');
  const sai = ms.filter(m => m.tipo === 'saida');
  const soma = (xs: { quantidade: number }[]) => Math.round(xs.reduce((s, m) => s + Number(m.quantidade), 0) * 1000) / 1000;
  return { entradas: ent.length, saidas: sai.length, total: ms.length, qtdEntradas: soma(ent), qtdSaidas: soma(sai) };
}

/** Margem de revenda em % inteiro ((venda / custo − 1) × 100); sem custo ou sem venda → null. */
export function margemVenda(custo: number, venda: number): number | null {
  if (!(custo > 0) || !(venda > 0)) return null;
  return Math.round((venda / custo - 1) * 100);
}
