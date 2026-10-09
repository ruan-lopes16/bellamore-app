import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CATALOGO_PERMISSOES } from '@shared/permissoes';
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

describe('migration 084', () => {
  const sql = ler('supabase/migrations/084_taxas_cartao_empresa.sql');
  it('3 colunas taxa_cartao_* com padrão atual e limite', () => {
    expect(sql).toMatch(/add column if not exists taxa_cartao_debito\s+numeric\(6,4\) not null default 0\.0239/);
    expect(sql).toMatch(/add column if not exists taxa_cartao_credito_avista\s+numeric\(6,4\) not null default 0\.0499/);
    expect(sql).toMatch(/add column if not exists taxa_cartao_credito_parcelado\s+numeric\(6,4\) not null default 0\.0559/);
    expect(sql).toMatch(/between 0 and 0\.2/);
    expect(sql.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});

describe('Configurações: taxas da maquininha', () => {
  it('permissão config.taxas cita a maquininha', () => {
    const c = CATALOGO_PERMISSOES.find(p => p.chave === 'config.taxas')!;
    expect(c.rotulo).toBe('Editar taxas de reserva, cancelamento e maquininha');
  });
  for (const arq of ['mobile/app/(empresa)/configuracoes.tsx']) {
    it(`${arq} edita as 3 taxas`, () => {
      const src = ler(arq);
      expect(src).toContain('Taxas da maquininha');
      for (const col of ['taxa_cartao_debito', 'taxa_cartao_credito_avista', 'taxa_cartao_credito_parcelado']) expect(src).toContain(col);
      expect(src).toContain("pode('config.taxas')");
    });
  }
});

import { taxasParaGrade, gradeParaTaxas, descartarExcecoesRedundantes, bandeirasComExcecao, type TaxaLinha } from '@shared/taxas-cartao';

describe('grade editável de taxas', () => {
  const base: TaxaLinha[] = [
    { bandeiraId: null, modalidade: 'debito', parcelas: 1, taxa: 0.0239 },
    { bandeiraId: null, modalidade: 'credito', parcelas: 1, taxa: 0.0499 },
    { bandeiraId: null, modalidade: 'credito', parcelas: 2, taxa: 0.0559 },
  ];
  it('taxasParaGrade e gradeParaTaxas fazem ida e volta', () => {
    const g = taxasParaGrade(base, null, 2);
    expect(g).toEqual({ debito: '2,39', credito: ['4,99', '5,59'] });
    expect(gradeParaTaxas(g, null, 2, true)).toEqual(base);
  });
  it('padrão incompleta → null; exceção incompleta ignora vazios', () => {
    expect(gradeParaTaxas({ debito: '', credito: ['4,99'] }, null, 1, true)).toBeNull();
    expect(gradeParaTaxas({ debito: '', credito: ['4,99', ''] }, 'b1', 2, false))
      .toEqual([{ bandeiraId: 'b1', modalidade: 'credito', parcelas: 1, taxa: 0.0499 }]);
  });
  it('ida e volta de uma grade de exceção e bandeirasComExcecao sem repetir', () => {
    const exc: TaxaLinha[] = [
      { bandeiraId: 'b1', modalidade: 'debito', parcelas: 1, taxa: 0.03 },
      { bandeiraId: 'b1', modalidade: 'credito', parcelas: 2, taxa: 0.07 },
    ];
    const g = taxasParaGrade(exc, 'b1', 2);
    expect(g).toEqual({ debito: '3,00', credito: ['', '7,00'] });
    expect(gradeParaTaxas(g, 'b1', 2, false)).toEqual(exc);
    expect(bandeirasComExcecao([...exc, ...exc])).toEqual(['b1']);
  });
  it('descarta exceções iguais à padrão e lista bandeiras com exceção', () => {
    const t: TaxaLinha[] = [...base,
      { bandeiraId: 'b1', modalidade: 'debito', parcelas: 1, taxa: 0.0239 },
      { bandeiraId: 'b1', modalidade: 'credito', parcelas: 1, taxa: 0.06 }];
    const r = descartarExcecoesRedundantes(t);
    expect(r).toHaveLength(4);
    expect(r.some(x => x.bandeiraId === 'b1' && x.modalidade === 'debito')).toBe(false);
    expect(bandeirasComExcecao(t)).toEqual(['b1']);
  });
});
