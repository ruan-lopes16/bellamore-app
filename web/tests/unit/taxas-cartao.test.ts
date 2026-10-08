import { describe, expect, it } from 'vitest';
import { TAXAS_PADRAO, taxasDaEmpresa, calcTaxa, valorLiquido, fmtTaxa, OPCOES_PARCELAS } from '@shared/taxas-cartao';

describe('taxas da maquininha', () => {
  it('padrão = InfinitePay atual', () => {
    expect(TAXAS_PADRAO).toEqual({ debito: 0.0239, creditoAvista: 0.0499, creditoParcelado: 0.0559 });
    expect(OPCOES_PARCELAS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18]);
  });
  it('taxasDaEmpresa lê as colunas e cai no padrão quando ausente/inválido', () => {
    expect(taxasDaEmpresa({ taxa_cartao_debito: 0.02, taxa_cartao_credito_avista: '0.045', taxa_cartao_credito_parcelado: null }))
      .toEqual({ debito: 0.02, creditoAvista: 0.045, creditoParcelado: 0.0559 });
    expect(taxasDaEmpresa(null)).toEqual(TAXAS_PADRAO);
    expect(taxasDaEmpresa({ taxa_cartao_debito: 5 })).toEqual(TAXAS_PADRAO);
  });
  it('calcTaxa por método e parcelas', () => {
    const t = { debito: 0.02, creditoAvista: 0.04, creditoParcelado: 0.05 };
    expect(calcTaxa('debito', 1, t)).toBe(0.02);
    expect(calcTaxa('credito', 1, t)).toBe(0.04);
    expect(calcTaxa('credito', 3, t)).toBe(0.05);
    expect(calcTaxa('pix', 1, t)).toBe(0);
    expect(calcTaxa('credito', 1)).toBe(0.0499);
  });
  it('valorLiquido e fmtTaxa', () => {
    expect(valorLiquido(100, 0.0499)).toBe(95.01);
    expect(fmtTaxa(0.0499)).toBe('4,99%');
  });
});
