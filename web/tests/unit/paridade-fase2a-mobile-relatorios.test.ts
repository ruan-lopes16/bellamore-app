import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const raiz = join(__dirname, '..', '..', '..');
const hook = readFileSync(join(raiz, 'mobile/hooks/useRelatorios.ts'), 'utf8');
const tela = readFileSync(join(raiz, 'mobile/app/(empresa)/relatorios.tsx'), 'utf8');

describe('mobile Relatórios = web Relatórios', () => {
  it('mesma lista de períodos, semana no domingo, limites em Brasília', () => {
    expect(tela).toContain('PERIODOS_RELATORIO');
    expect(hook).toContain('limitesDoPeriodo(');
    expect(tela + hook).not.toMatch(/weekStartsOn:\s*1/);
    expect(hook).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
    expect(hook).not.toContain('startOfQuarter');
  });
  it('faturamento e ticket pela regra única (sem pagamentos)', () => {
    expect(hook).not.toMatch(/from\('pagamentos'\)/);
    expect(hook).toContain('calcularKpisFinanceiros(');
    expect(hook).toContain('carregarDadosFinanceiros(');
    expect(hook).not.toContain('async function buscarTodasPaginas');
    expect(hook).not.toMatch(/\.slice\(0,\s*7\)/);
  });
  it('retorno de clientes e rankings pelas funções únicas', () => {
    for (const t of ['metricasRetorno(', 'carregarClientesComHistoricoAntes(', 'rankingAtendimentos(']) expect(hook).toContain(t);
  });
  it('deltas pela função única, legenda comum', () => {
    expect(tela).toContain('variacaoPercentual(');
    expect(tela).toContain('ROTULO_COMPARACAO[periodo]');
    expect(tela).not.toMatch(/function delta\(/);
  });
  it('erro visível, nota de fechamento importado e valores sem abreviação "k"', () => {
    expect(hook).toContain('isError');
    expect(hook).toContain('mesesComFechamento');
    expect(tela).toContain('Período inclui mês com fechamento importado');
    expect(tela).not.toMatch(/\/\s*1000\)\.toFixed/);
  });
});
