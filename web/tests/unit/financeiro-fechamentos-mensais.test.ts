import { describe, expect, it } from 'vitest';
import {
  getFechamentoForMonth,
  resolveFinanceiroKpis,
  somarPeriodoComFechamentos,
} from '../../lib/financeiro/fechamentos-mensais';

describe('fechamentos financeiros mensais', () => {
  it('usa exatamente os quatro valores do fechamento historico', () => {
    const fechamento = getFechamentoForMonth([
      {
        mes: '2026-01-01',
        receita_bruta: 6491.08,
        comissao_paga: 2920.99,
      },
    ], '2026-01');

    expect(resolveFinanceiroKpis({
      receita: 999,
      comissoes: 888,
      gastos: 2448.19,
      taxasCartao: 666,
    }, fechamento)).toEqual({
      receita: 6491.08,
      comissoes: 2920.99,
      gastos: 2448.19,
      taxasCartao: 0,
      lucroReal: 1121.90,
    });
  });

  it('mantem o calculo normal quando o mes nao tem fechamento historico', () => {
    const kpis = resolveFinanceiroKpis({
      receita: 1000,
      comissoes: 200,
      gastos: 300,
      taxasCartao: 50,
    }, null);

    expect(kpis).toEqual({
      receita: 1000,
      comissoes: 200,
      gastos: 300,
      taxasCartao: 50,
      lucroReal: 450,
    });
  });
});

describe('somarPeriodoComFechamentos (Relatorios / Dashboard)', () => {
  it('soma so os valores ao vivo quando nenhum mes do periodo tem fechamento', () => {
    const resultado = somarPeriodoComFechamentos(
      {
        receita:     { '2026-06': 1000, '2026-07': 2000 },
        comissoes:   { '2026-06': 400,  '2026-07': 800  },
        taxasCartao: { '2026-06': 30,   '2026-07': 50   },
      },
      [],
      ['2026-06', '2026-07'],
    );

    expect(resultado).toEqual({ bruto: 3000, comTot: 1200, taxasCartao: 80 });
  });

  it('usa o fechamento importado no mes historico e o calculo ao vivo nos demais', () => {
    const resultado = somarPeriodoComFechamentos(
      {
        // Maio/2026 tem dado ao vivo residual, mas o mes e coberto por importacao.
        receita:     { '2026-05': 0,   '2026-06': 5000 },
        comissoes:   { '2026-05': 0,   '2026-06': 2000 },
        taxasCartao: { '2026-05': 0,   '2026-06': 120  },
      },
      [{ mes: '2026-05-01', receita_bruta: 8170.08, comissao_paga: 3676.54 }],
      ['2026-05', '2026-06'],
    );

    // Maio: 8170.08 receita + 3676.54 comissao + 0 taxa de cartao (fechamento zera).
    // Junho: valores ao vivo.
    expect(resultado).toEqual({
      bruto: 13170.08,
      comTot: 5676.54,
      taxasCartao: 120,
    });
  });

  it('fechamento substitui o mes inteiro, nao soma ao valor ao vivo do mesmo mes', () => {
    const resultado = somarPeriodoComFechamentos(
      {
        receita:     { '2026-05': 999999 },
        comissoes:   { '2026-05': 999999 },
        taxasCartao: { '2026-05': 999999 },
      },
      [{ mes: '2026-05-01', receita_bruta: 8170.08, comissao_paga: 3676.54 }],
      ['2026-05'],
    );

    expect(resultado).toEqual({ bruto: 8170.08, comTot: 3676.54, taxasCartao: 0 });
  });

  it('periodo sem meses retorna zeros', () => {
    expect(
      somarPeriodoComFechamentos(
        { receita: {}, comissoes: {}, taxasCartao: {} },
        [],
        [],
      ),
    ).toEqual({ bruto: 0, comTot: 0, taxasCartao: 0 });
  });

  it('nao acumula erro de ponto flutuante ao somar varios meses', () => {
    const resultado = somarPeriodoComFechamentos(
      {
        receita:     { '2026-01': 0.1, '2026-02': 0.2 },
        comissoes:   {},
        taxasCartao: {},
      },
      [],
      ['2026-01', '2026-02'],
    );

    expect(resultado.bruto).toBe(0.3);
  });
});
