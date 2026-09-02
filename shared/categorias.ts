export type CategoriaServico =
  | 'cilios' | 'sobrancelhas' | 'depilacao' | 'unhas'
  | 'pele' | 'dermaplaning' | 'maquiagem' | 'outros';

export const CATEGORIA_COR: Record<CategoriaServico, string> = {
  cilios:       '#4F46E5',
  sobrancelhas: '#7C3AED',
  depilacao:    '#D4608A',
  unhas:        '#B45309',
  pele:         '#0D7E5F',
  dermaplaning: '#0891B2',
  maquiagem:    '#C026D3',
  outros:       '#6B7280',
};

export const CATEGORIA_BG: Record<CategoriaServico, string> = {
  cilios:       '#EEF2FF',
  sobrancelhas: '#F3EFFE',
  depilacao:    '#FDF0F5',
  unhas:        '#FEF3E2',
  pele:         '#EAFAF5',
  dermaplaning: '#ECFEFF',
  maquiagem:    '#FDF4FF',
  outros:       '#F3F4F6',
};

export const CATEGORIA_LABEL: Record<CategoriaServico, string> = {
  cilios:       'Cílios',
  sobrancelhas: 'Sobrancelhas',
  depilacao:    'Depilação',
  unhas:        'Unhas',
  pele:         'Pele',
  dermaplaning: 'Dermaplaning',
  maquiagem:    'Maquiagem',
  outros:       'Outros',
};

export const ALL_CATEGORIAS: CategoriaServico[] = [
  'cilios', 'sobrancelhas', 'depilacao', 'unhas',
  'pele', 'dermaplaning', 'maquiagem', 'outros',
];

export type SvgElement =
  | { type: 'path'; d: string }
  | { type: 'rect'; x: string; y: string; width: string; height: string; rx?: string }
  | { type: 'group'; transform: string; children: SvgElement[] };

export const CATEGORIA_SVG: Record<CategoriaServico, SvgElement[]> = {
  cilios: [
    { type: 'path', d: 'M3.5 9.5C6 13.2 9 15 12 15s6-1.8 8.5-5.5' },
    { type: 'path', d: 'M5.6 12.8L4 14.6' },
    { type: 'path', d: 'M8.6 14.7l-1 2.2' },
    { type: 'path', d: 'M12 15.2v2.4' },
    { type: 'path', d: 'M15.4 14.7l1 2.2' },
    { type: 'path', d: 'M18.4 12.8l1.6 1.8' },
  ],
  sobrancelhas: [
    { type: 'path', d: 'M4 10.8C5.8 6.9 9.6 5.4 13 6.1c2.6.5 5 2.1 7 4.6' },
    { type: 'path', d: 'M7.5 15c1.4 1.7 2.9 2.5 4.5 2.5s3.1-.8 4.5-2.5' },
  ],
  depilacao: [
    { type: 'path', d: 'M12 3.5c3.2 4.2 5.2 7 5.2 9.7a5.2 5.2 0 1 1-10.4 0C6.8 10.5 8.8 7.7 12 3.5z' },
    { type: 'path', d: 'M9.6 13.4a2.7 2.7 0 0 0 1.9 2.5' },
  ],
  unhas: [
    { type: 'rect', x: '9.8', y: '2.6', width: '4.4', height: '3.4', rx: '1.1' },
    { type: 'path', d: 'M10.6 6v2.5M13.4 6v2.5' },
    { type: 'path', d: 'M8.2 12.4a3.8 3.8 0 0 1 7.6 0v4.2a3.4 3.4 0 0 1-3.4 3.4h-.8a3.4 3.4 0 0 1-3.4-3.4z' },
    { type: 'path', d: 'M8.2 14.8h7.6' },
  ],
  pele: [
    { type: 'path', d: 'M12 4.8c1.6 2 2.4 3.9 2.4 5.5 0 1.9-1 3.2-2.4 3.2s-2.4-1.3-2.4-3.2c0-1.6.8-3.5 2.4-5.5z' },
    { type: 'path', d: 'M4.8 9.2c2.6.5 4.4 1.9 5.3 4' },
    { type: 'path', d: 'M19.2 9.2c-2.6.5-4.4 1.9-5.3 4' },
    { type: 'path', d: 'M4.2 14.4c1.6 3.1 4.3 4.7 7.8 4.7s6.2-1.6 7.8-4.7' },
  ],
  dermaplaning: [
    { type: 'group', transform: 'rotate(-30 11.5 13)', children: [
      { type: 'rect', x: '4', y: '9.2', width: '15', height: '7.6', rx: '2.2' },
      { type: 'path', d: 'M10 13h3' },
    ]},
    { type: 'path', d: 'M18.6 3.6l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z' },
  ],
  maquiagem: [
    { type: 'path', d: 'M9.8 9.3V6.6c0-1.7.9-3 2.2-3.6 1.3.6 2.2 1.9 2.2 3.6v2.7' },
    { type: 'rect', x: '8.6', y: '9.3', width: '6.8', height: '3.2', rx: '0.9' },
    { type: 'path', d: 'M9.8 12.5h4.4v7.6a.9.9 0 0 1-.9.9h-2.6a.9.9 0 0 1-.9-.9z' },
  ],
  outros: [
    { type: 'path', d: 'M12 3.4l1.8 5.2 5.2 1.8-5.2 1.8-1.8 5.2-1.8-5.2-5.2-1.8 5.2-1.8z' },
    { type: 'path', d: 'M18.8 17l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z' },
  ],
};

// ── Categorias personalizadas (por empresa) ──────────────────

export type CategoriaCustom = {
  id: string;
  empresa_id: string;
  nome: string;
  cor: string;
  icone: string;
};

/** Paleta curada — cor = traço/texto; bg = fundo suave do chip. Ordem fixa. */
export const CATEGORIA_PALETA: { cor: string; bg: string }[] = [
  { cor: '#4F46E5', bg: '#EEF2FF' },
  { cor: '#7C3AED', bg: '#F3EFFE' },
  { cor: '#D4608A', bg: '#FDF0F5' },
  { cor: '#B45309', bg: '#FEF3E2' },
  { cor: '#0D7E5F', bg: '#EAFAF5' },
  { cor: '#0891B2', bg: '#ECFEFF' },
  { cor: '#C026D3', bg: '#FDF4FF' },
  { cor: '#DC2626', bg: '#FEF2F2' },
  { cor: '#2563EB', bg: '#EFF6FF' },
  { cor: '#6B7280', bg: '#F3F4F6' },
];

/** Nomes de ícones lucide (existem em lucide-react e lucide-react-native). */
export const CATEGORIA_ICONES = [
  'Sparkles', 'Scissors', 'Heart', 'Star', 'Gem', 'Flower',
  'Wand', 'Droplet', 'Sun', 'Hand', 'Smile', 'Leaf',
] as const;

/** bg correspondente a uma cor da paleta; cinza se a cor não estiver na paleta. */
export function bgDaCor(cor: string): string {
  return CATEGORIA_PALETA.find((p) => p.cor === cor)?.bg ?? '#F3F4F6';
}

export type CategoriaResolvida = {
  chave: string;                    // chave built-in, id da custom, ou 'outros'
  label: string;
  cor: string;
  bg: string;
  tipo: 'builtin' | 'custom' | 'nenhuma';
  iconeBuiltin?: CategoriaServico;  // renderizar via CategoriaIcon / CATEGORIA_SVG
  iconeCustom?: string;             // nome lucide
};

const _CHAVES_BUILTIN = new Set<string>(ALL_CATEGORIAS);

/**
 * Resolve a aparência da categoria de um serviço.
 * Prioridade: categoria_id (personalizada) → categoria (built-in) → Outros.
 * Um categoria_id que não bate com nenhuma custom da lista (categoria apagada)
 * cai em Outros.
 */
export function resolverCategoriaServico(
  categoria: string | null | undefined,
  categoriaId: string | null | undefined,
  customs: CategoriaCustom[],
): CategoriaResolvida {
  if (categoriaId) {
    const c = customs.find((x) => x.id === categoriaId);
    if (c) {
      return {
        chave: c.id,
        label: c.nome,
        cor: c.cor,
        bg: bgDaCor(c.cor),
        tipo: 'custom',
        iconeCustom: c.icone,
      };
    }
  }
  if (categoria && _CHAVES_BUILTIN.has(categoria)) {
    const k = categoria as CategoriaServico;
    return {
      chave: k,
      label: CATEGORIA_LABEL[k],
      cor: CATEGORIA_COR[k],
      bg: CATEGORIA_BG[k],
      tipo: 'builtin',
      iconeBuiltin: k,
    };
  }
  return {
    chave: 'outros',
    label: CATEGORIA_LABEL.outros,
    cor: CATEGORIA_COR.outros,
    bg: CATEGORIA_BG.outros,
    tipo: 'nenhuma',
    iconeBuiltin: 'outros',
  };
}
