import { describe, expect, it } from 'vitest';
import { resumoMaquininha, type BandeiraCartao, type Maquininha } from '@shared/taxas-cartao';

const bandeiras: BandeiraCartao[] = [
  { id: 'b-visa', chave: 'visa', nome: 'Visa', ativa: true, ordem: 1 },
  { id: 'b-diners', chave: 'diners-club', nome: 'Diners Club', ativa: true, ordem: 2 },
  { id: 'b-off', chave: 'amex', nome: 'Amex', ativa: false, ordem: 3 },
];

const padrao = (max: number) => [
  { bandeiraId: null, modalidade: 'debito' as const, parcelas: 1, taxa: 0.0239 },
  ...Array.from({ length: max }, (_, i) => ({ bandeiraId: null, modalidade: 'credito' as const, parcelas: i + 1, taxa: i === 0 ? 0.0499 : 0.0559 })),
];

describe('resumoMaquininha', () => {
  it('só tabela padrão: todas as bandeiras ativas usam a padrão', () => {
    const m: Maquininha = { id: 'm', nome: 'M', maxParcelas: 18, ativa: true, padrao: true, ordem: 1, taxas: padrao(18) };
    const r = resumoMaquininha(m, bandeiras);
    expect(r.padrao).toEqual({ debito: '2,39%', creditoAvista: '4,99%', creditoParcelado: '5,59%' });
    expect(r.faixaParcelado).toBe('2x a 18x');
    expect(r.excecoes).toEqual([]);
    expect(r.usamPadrao.map(b => b.nome)).toEqual(['Visa', 'Diners Club']);
  });

  it('bandeira com exceção só no crédito herda o débito da padrão', () => {
    const taxas = [
      ...padrao(3),
      { bandeiraId: 'b-diners', modalidade: 'credito' as const, parcelas: 1, taxa: 0.0319 },
      { bandeiraId: 'b-diners', modalidade: 'credito' as const, parcelas: 2, taxa: 0.0379 },
      { bandeiraId: 'b-diners', modalidade: 'credito' as const, parcelas: 3, taxa: 0.0379 },
    ];
    const r = resumoMaquininha({ id: 'm', nome: 'M', maxParcelas: 3, ativa: true, padrao: true, ordem: 1, taxas }, bandeiras);
    expect(r.excecoes).toHaveLength(1);
    expect(r.excecoes[0].bandeira.nome).toBe('Diners Club');
    expect(r.excecoes[0].taxas).toEqual({ debito: '2,39%', creditoAvista: '3,19%', creditoParcelado: '3,79%' });
    expect(r.usamPadrao.map(b => b.nome)).toEqual(['Visa']);
  });

  it('parcelado com valores diferentes vira faixa; sem taxa cadastrada vira "—"', () => {
    const taxas = [
      { bandeiraId: null, modalidade: 'credito' as const, parcelas: 2, taxa: 0.05 },
      { bandeiraId: null, modalidade: 'credito' as const, parcelas: 3, taxa: 0.06 },
    ];
    const r = resumoMaquininha({ id: 'm', nome: 'M', maxParcelas: 3, ativa: true, padrao: true, ordem: 1, taxas }, bandeiras);
    expect(r.padrao).toEqual({ debito: '—', creditoAvista: '—', creditoParcelado: '5,00% a 6,00%' });
  });

  it('maquininha só à vista não tem faixa parcelada', () => {
    const r = resumoMaquininha({ id: 'm', nome: 'M', maxParcelas: 1, ativa: true, padrao: true, ordem: 1, taxas: padrao(1) }, bandeiras);
    expect(r.faixaParcelado).toBeNull();
    expect(r.padrao.creditoParcelado).toBe('—');
  });
});
