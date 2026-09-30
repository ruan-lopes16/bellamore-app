import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const raiz = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8');

describe('web Financeiro usa os números únicos de shared', () => {
  const src = ler('web/app/(app)/financeiro/page.tsx');
  it('busca e calcula pelas funções de shared', () => {
    for (const trecho of [
      "from '@shared/kpis-financeiros'", "from '@shared/kpis-financeiros-consultas'", "from '@shared/periodos'",
      'carregarDadosFinanceiros(', 'calcularKpisFinanceiros(', 'evolucaoMensal(',
      'rankingAtendimentos(', 'resumoMetodosPagamento(', 'variacaoPercentual(', 'filtroDespesasDoMes(',
    ]) expect(src).toContain(trecho);
  });
  it('não recalcula comissão pelo percentual atual nem monta KPI à mão', () => {
    expect(src).not.toContain('percentual_comissao');
    expect(src).not.toContain('calcCom(');
    expect(src).not.toContain('resolveFinanceiroKpis');
    expect(src).not.toMatch(/function delta\(/);
    expect(src).not.toContain("from '@/lib/financeiro/");
  });
  it('"Após retiradas" no card de Lucro Real; saldo da dona sobre todas as retiradas', () => {
    expect(src).toContain('Após retiradas');
    expect(src).toContain('carregarRetiradas(');
    expect(src).toContain('saldoDevedorTotal(retiradasTodas');
  });
  it('mantém a grade única de KPIs', () => {
    expect(src).toContain('const kpisFinanceiro = [');
  });
  it('periodo-mensal.ts saiu (limites vêm de @shared/periodos)', () => {
    expect(existsSync(join(raiz, 'web/lib/financeiro/periodo-mensal.ts'))).toBe(false);
  });
});
