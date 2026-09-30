import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', '..', 'app', '(app)', 'relatorios', 'page.tsx'), 'utf8');

describe('web Relatórios usa períodos e números únicos de shared', () => {
  it('lista de períodos e limites vêm de @shared/periodos', () => {
    expect(src).toContain('PERIODOS_RELATORIO');
    expect(src).toContain('limitesDoPeriodo(');
    expect(src).toContain('rotuloDoPeriodo(');
    expect(src).not.toContain('function periodoParaDatas');
  });
  it('KPIs, série, rankings e retorno pelas funções únicas', () => {
    for (const t of [
      'carregarDadosFinanceiros(', 'calcularKpisFinanceiros(', 'serieFaturamento(',
      'rankingAtendimentos(', 'metricasRetorno(', 'carregarClientesComHistoricoAntes(',
    ]) expect(src).toContain(t);
    expect(src).not.toContain('somarPeriodoComFechamentos');
    expect(src).not.toContain('async function buscarTodasPaginas');
    expect(src).not.toMatch(/\.slice\(0,\s*7\)/);
  });
  it('deltas vs período anterior (bruto, atendimentos, ticket)', () => {
    expect(src).toContain('variacaoPercentual(kpis.bruto, kpisAnt.bruto)');
    expect(src).toContain('variacaoPercentual(kpis.atendimentos, kpisAnt.atendimentos)');
    expect(src).toContain('variacaoPercentual(kpis.ticketMedio, kpisAnt.ticketMedio)');
    expect(src).toContain('ROTULO_COMPARACAO[periodo]');
  });
  it('"Única visita" virou "Novas" (retorno = atendida antes do período)', () => {
    expect(src).not.toContain('Única visita');
    expect(src).toContain('>Novas<');
  });
  it('nota de fechamento importado nos detalhamentos', () => {
    expect(src).toContain('Período inclui mês com fechamento importado');
  });
});
