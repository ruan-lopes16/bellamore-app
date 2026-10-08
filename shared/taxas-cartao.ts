/**
 * Taxas da maquininha (web e app). Configuráveis por empresa (migration 084:
 * empresas.taxa_cartao_debito / _credito_avista / _credito_parcelado); sem as colunas
 * (migration não aplicada) ou com valor inválido, vale o padrão InfinitePay.
 */
export type TaxasCartao = { debito: number; creditoAvista: number; creditoParcelado: number };

export const TAXAS_PADRAO: TaxasCartao = { debito: 0.0239, creditoAvista: 0.0499, creditoParcelado: 0.0559 };

export const OPCOES_PARCELAS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18];

function taxaValida(v: unknown, padrao: number): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 0.2 ? n : padrao;
}

/** Taxas da empresa a partir da linha de `empresas` (qualquer coluna ausente → padrão). */
export function taxasDaEmpresa(empresa: Record<string, unknown> | null | undefined): TaxasCartao {
  return {
    debito:           taxaValida(empresa?.taxa_cartao_debito, TAXAS_PADRAO.debito),
    creditoAvista:    taxaValida(empresa?.taxa_cartao_credito_avista, TAXAS_PADRAO.creditoAvista),
    creditoParcelado: taxaValida(empresa?.taxa_cartao_credito_parcelado, TAXAS_PADRAO.creditoParcelado),
  };
}

/** Taxa decimal (ex.: 0.0499) conforme método e parcelas. Pix/dinheiro/cortesia → 0. */
export function calcTaxa(metodo: string, parcelas = 1, taxas: TaxasCartao = TAXAS_PADRAO): number {
  if (metodo === 'debito') return taxas.debito;
  if (metodo === 'credito') return parcelas === 1 ? taxas.creditoAvista : taxas.creditoParcelado;
  return 0;
}

/** "4,99%". */
export function fmtTaxa(taxa: number): string {
  return `${(taxa * 100).toFixed(2).replace('.', ',')}%`;
}

/** Valor líquido após a taxa, arredondado em centavos. */
export function valorLiquido(bruto: number, taxa: number): number {
  return Math.round(bruto * (1 - taxa) * 100) / 100;
}
