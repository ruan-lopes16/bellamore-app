import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const raiz = join(__dirname, '..', '..', '..');
const hook = readFileSync(join(raiz, 'mobile/hooks/useFinanceiro.ts'), 'utf8');
const tela = readFileSync(join(raiz, 'mobile/app/(empresa)/financeiro.tsx'), 'utf8');

describe('mobile Financeiro = web Financeiro', () => {
  it('receita não vem mais de pagamentos', () => {
    expect(hook).not.toMatch(/from\('pagamentos'\)/);
    expect(hook).toContain('carregarDadosFinanceiros(');
    expect(hook).toContain('calcularKpisFinanceiros(');
  });
  it('evolução, top serviços e formas de pagamento pelas funções únicas', () => {
    for (const t of ['evolucaoMensal(', 'rankingAtendimentos(', 'resumoMetodosPagamento(']) expect(hook).toContain(t);
  });
  it('limites do mês em Brasília (nada de endOfMonth(...).toISOString())', () => {
    expect(hook).toContain("from '@shared/periodos'");
    expect(hook).not.toMatch(/(startOfMonth|endOfMonth)\([^)]*\)\.toISOString\(\)/);
    expect(hook).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
    expect(hook).not.toContain("code: 'pt-BR'");
  });
  it('"A dona deve" sobre todas as retiradas; lista e total do mês recortados', () => {
    expect(hook).toContain('carregarRetiradas(');
    expect(hook).toContain('listarRetiradasDoPeriodo(');
    expect(hook).toContain('retiradasDoPeriodo(');
  });
  it('tela mostra taxa de cartão, líquido e comissões; lucro já os desconta', () => {
    expect(tela).toContain("label: 'Taxas de cartão'");
    expect(tela).toContain("label: 'Líquido após taxas'");
    expect(tela).toContain("label: 'Comissões'");
    expect(tela).toContain('variacaoPercentual(');
    expect(tela).not.toMatch(/function deltaPercent\(/);
    expect(tela).toContain('resumo?.aposRetiradas');
  });
  it('erros das consultas viram estado de erro visível, sem zeros', () => {
    expect(hook).toContain('isError');
    expect(tela).toContain('erroKpis');
  });
  it('salvar/pagar invalida as chaves que alimentam KPIs e gráfico', () => {
    expect(tela).not.toContain("'fin-evolucao'");
    const apos = tela.slice(tela.indexOf('function aposMarcarPago'));
    expect(apos.slice(0, 400)).toContain('invalidarFinanceiro(qc)');
    const tc = tela.slice(tela.indexOf('async function marcarTaxaPaga'), tela.indexOf('async function marcarReservaPaga'));
    expect(tc).toContain('invalidarFinanceiro(qc)');
    const tr = tela.slice(tela.indexOf('async function marcarReservaPaga'), tela.indexOf('const [fontsLoaded]'));
    expect(tr).toContain('invalidarFinanceiro(qc)');
  });
});
