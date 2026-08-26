/**
 * @file categorias-produto.ts
 * Taxonomia de categorias de `produtos.categoria`, compartilhada entre
 * Estoque (cadastro/filtro) e Vendas (agrupamento do PDV e do histórico).
 * Fonte única — evita a lista de categorias e cores divergir entre páginas.
 */

export const CATS = [
  { key: 'cilios',       label: 'Cílios',       cor: '#4F46E5', bg: '#EEF2FF' },
  { key: 'depilacao',    label: 'Depilação',     cor: '#D4608A', bg: '#FDF0F5' },
  { key: 'ferramentas',  label: 'Ferramentas',   cor: '#0891B2', bg: '#ECFEFF' },
  { key: 'higiene',      label: 'Higiene',       cor: '#059669', bg: '#ECFDF5' },
  { key: 'materiais',    label: 'Materiais',     cor: '#92400E', bg: '#FEF3E2' },
  { key: 'outros',       label: 'Outros',        cor: '#6B7280', bg: '#F3F4F6' },
  { key: 'pele',         label: 'Pele',          cor: '#0D7E5F', bg: '#EAFAF5' },
  { key: 'sobrancelhas', label: 'Sobrancelhas',  cor: '#7C3AED', bg: '#F3EFFE' },
  { key: 'unhas',        label: 'Unhas',         cor: '#B45309', bg: '#FEF3E2' },
] as const;

export type CatKey = typeof CATS[number]['key'];
export const CAT_MAP = Object.fromEntries(CATS.map(c => [c.key, c])) as Record<string, typeof CATS[number]>;

/** Categoria de exibição para um valor possivelmente null/desconhecido. */
export function catInfo(categoria: string | null | undefined) {
  return CAT_MAP[categoria ?? ''] ?? CAT_MAP['outros'];
}
