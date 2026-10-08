/** Regras de estoque compartilhadas entre web e app (rótulos e status). */

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
