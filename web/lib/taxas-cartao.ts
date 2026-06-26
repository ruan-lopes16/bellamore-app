// Taxas da maquininha — recebimento na hora (InfinitePay)
// Débito: 2,39% | Crédito 1x: 4,99% | Crédito 2x-18x: 5,59%

export const OPCOES_PARCELAS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18];

const TAXAS = {
  debito:            0.0239,
  credito_avista:    0.0499,
  credito_parcelado: 0.0559,
} as const;

/** Retorna a taxa decimal (ex: 0.0499) conforme método e número de parcelas */
export function calcTaxa(metodo: string, parcelas = 1): number {
  if (metodo === 'debito') return TAXAS.debito;
  if (metodo === 'credito') {
    return parcelas === 1 ? TAXAS.credito_avista : TAXAS.credito_parcelado;
  }
  return 0;
}

/** Formata taxa como percentual (ex: "4,99%") */
export function fmtTaxa(taxa: number): string {
  return `${(taxa * 100).toFixed(2).replace('.', ',')}%`;
}

/** Valor líquido após dedução da taxa, arredondado em centavos */
export function valorLiquido(bruto: number, taxa: number): number {
  return Math.round(bruto * (1 - taxa) * 100) / 100;
}
