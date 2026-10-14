/** Regras de estoque compartilhadas entre web e app (rótulos e status). */

import { parseValorBR } from './comanda-fechamento';

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

const arredondar3 = (n: number) => Math.round(Number((n * 1000).toPrecision(12))) / 1000;

/**
 * Quantidade digitada → número, arredondado a 3 casas ("0,5", "0.5", "1.234,56").
 * Mesma leitura do dinheiro (`parseValorBR`): "1.234" é milhar (1234), não 1,234 — para preencher
 * o campo na edição use `formatarQuantidadeBR`, que nunca gera ponto. "0.250" (zero antes do ponto)
 * é decimal: 0,25. Vazio, inválido ou negativo → 0.
 */
export function parseQuantidadeBR(texto: string): number {
  const t = texto.trim();
  // "0.250" é decimal (um grupo inicial "0" nunca é milhar); "1.234" segue sendo 1234.
  if (/^0\.\d+$/.test(t)) return arredondar3(Number(t));
  return arredondar3(parseValorBR(t));
}

/**
 * Saldo digitado → número, como `parseQuantidadeBR` mas aceitando "-" no início (saldo negativo
 * pode ser corrigido). "-" sozinho ou vazio → 0.
 */
export function parseSaldoBR(texto: string): number {
  const t = texto.trim();
  if (!t.startsWith('-')) return parseQuantidadeBR(t);
  const n = parseQuantidadeBR(t.slice(1));
  return n === 0 ? 0 : -n;
}

/**
 * Número → texto para preencher campos de quantidade: vírgula decimal, até 3 casas sem zeros à
 * direita, sem separador de milhar, negativo com "-" (1.234 → "1,234"; 1500 → "1500").
 * `parseSaldoBR(formatarQuantidadeBR(n)) === n` para até 3 casas.
 */
export function formatarQuantidadeBR(n: number): string {
  const v = arredondar3(n);
  if (v === 0) return '0';
  return v.toFixed(3).replace(/\.?0+$/, '').replace('.', ',');
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
  /** Omitido na edição quando o saldo não foi mexido (não sobrescreve o que as comandas baixaram). */
  estoque_atual?: number; estoque_minimo: number; preco_custo: number; preco_venda: number; ativo?: boolean;
};

/** Arredonda reais a centavos sem erro de float (1,005 → 1,01). */
const arredondarReais = (v: number) => Math.round(Number((v * 100).toPrecision(12))) / 100;

const MAX_QUANTIDADE = 9999999.999; // numeric(10,3)
const MAX_DINHEIRO = 99999999.99; // numeric(10,2)

/** Valores originais do produto editado (para nunca perder dado de quem só mudou outro campo). */
export type OriginalProduto = {
  estoque_atual: number; estoque_minimo: number; qtd_por_unidade: number; categoria: string; preco_venda: number;
};

/**
 * Valida o formulário e monta a linha de `produtos` (mesma regra no web e no app).
 * Nome, categoria do catálogo e unidade obrigatórios; preço de venda só (e obrigatório) para venda;
 * `qtd_por_unidade` só para pacote/caixa (≥ 1, até 3 casas; demais unidades = 1); saldo aceita negativo.
 *
 * Na edição (`ctx.original`): campo de quantidade cujo texto é igual ao original formatado mantém o
 * número original sem reler; categoria igual à original é aceita mesmo fora do catálogo; material
 * mantém o `preco_venda` original. No cadastro a categoria precisa ser do catálogo e material grava 0.
 * Edição com o texto do saldo igual ao original formatado: `estoque_atual` NÃO vai no payload.
 * Quantidade > 9999999,999 e dinheiro > 99999999,99 → erro em português (não gravam).
 */
export function montarProduto(
  form: FormProduto,
  ctx: { empresaId: string; editando: boolean; original?: OriginalProduto },
): { payload: PayloadProduto } | { erro: string } {
  const nome = form.nome.trim();
  if (!nome) return { erro: 'Informe o nome do produto.' };
  const orig = ctx.editando ? ctx.original : undefined;
  const categoriaLegadaOk = !!orig && !!form.categoria && form.categoria === orig.categoria;
  if (!categoriaLegadaOk && !Object.prototype.hasOwnProperty.call(ROTULOS_CATEGORIA_PRODUTO, form.categoria)) return { erro: 'Escolha uma categoria.' };
  if (!form.unidade) return { erro: 'Escolha a unidade de medida.' };

  const quantidade = (texto: string, original: number | undefined, ler: (t: string) => number) =>
    original !== undefined && texto.trim() === formatarQuantidadeBR(original) ? original : ler(texto);

  let precoVenda = 0;
  if (form.tipo === 'venda') {
    precoVenda = arredondarReais(parseValorBR(form.precoVenda));
    if (precoVenda <= 0) return { erro: 'Informe o preço de venda.' };
  } else if (orig) {
    precoVenda = orig.preco_venda;
  }

  let qtdDentro = 1;
  if (unidadePedeQtdPorUnidade(form.unidade)) {
    qtdDentro = quantidade(form.qtdPorUnidade, orig?.qtd_por_unidade, parseQuantidadeBR);
    if (qtdDentro < 1) qtdDentro = 1;
  }
  const estoqueAtual = quantidade(form.estoqueAtual, orig?.estoque_atual, parseSaldoBR);
  const estoqueMinimo = quantidade(form.estoqueMinimo, orig?.estoque_minimo, parseQuantidadeBR);
  const precoCusto = arredondarReais(parseValorBR(form.precoCusto));

  if ([qtdDentro, estoqueAtual, estoqueMinimo].some(q => Math.abs(q) > MAX_QUANTIDADE)) return { erro: 'Quantidade grande demais.' };
  if (precoCusto > MAX_DINHEIRO || precoVenda > MAX_DINHEIRO) return { erro: 'Valor grande demais.' };

  const payload: PayloadProduto = {
    empresa_id: ctx.empresaId,
    nome,
    tipo: form.tipo,
    categoria: form.categoria,
    unidade: form.unidade,
    qtd_por_unidade: qtdDentro,
    estoque_minimo: estoqueMinimo,
    preco_custo: precoCusto,
    preco_venda: precoVenda,
  };
  // Edição com o saldo intocado: não manda `estoque_atual` (o UPDATE não regrava um saldo velho).
  const saldoIntocado = !!orig && form.estoqueAtual.trim() === formatarQuantidadeBR(orig.estoque_atual);
  if (!saldoIntocado) payload.estoque_atual = estoqueAtual;
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
