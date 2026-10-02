import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');
const hook = ler('mobile/hooks/useComissoesGestor.ts');
const tela = ler('mobile/app/(empresa)/comissoes.tsx');
const mais = ler('mobile/app/(empresa)/mais.tsx');
const dash = ler('mobile/hooks/useDashboard.ts');

describe('app Comissões = web Comissões', () => {
  it('hook', () => {
    for (const t of ['carregarComissoesDoPeriodo(', 'normalizarComissoes(', 'comissoesPorProfissional(', 'resumoComissoes(',
      'limitesPeriodoComissao(', 'pagarComissoes(', 'mutateAsync', 'invalidarFinanceiro(qc)', "'comissoes-gestor'",
      'MENSAGEM_PAGAMENTO_PARCIAL']) expect(hook).toContain(t);
    for (const t of ['startOfMonth', 'endOfMonth', 'toISOString()', '.update(']) expect(hook).not.toContain(t);
  });
  it('tela', () => {
    for (const t of ['PERIODOS_COMISSAO', 'rotuloPeriodoComissao(', 'FILTROS_COMISSAO', 'agruparComissoesPorData(',
      'filtrarComissoes(', 'Não foi possível carregar as comissões', 'Alert.alert', 'rotuloPercentualComissao(']) expect(tela).toContain(t);
    for (const t of ['subMonths', 'border: 1', 'percentual}% de comissão']) expect(tela).not.toContain(t);
  });
  it('menu Mais com Comissões e badge de pendentes', () => {
    expect(mais).toContain("router.push('/(empresa)/comissoes'");
    expect(mais).toContain('useResumoComissoesPendentes(');
    expect(mais).toContain('badge=');
    expect(dash).toContain('export function useResumoComissoesPendentes');
  });
});
