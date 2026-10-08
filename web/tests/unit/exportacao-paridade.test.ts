import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
const root = join(__dirname, '..', '..', '..');
const ler = (p: string) => readFileSync(join(root, p), 'utf8');

const WEB: [string, string][] = [
  ['web/app/(app)/agenda/page.tsx', 'definicaoAgenda'],
  ['web/app/(app)/clientes/page.tsx', 'definicaoClientes'],
  ['web/app/(app)/comissoes/ComissoesGestorView.tsx', 'definicaoComissoes'],
  ['web/app/(app)/equipe/page.tsx', 'definicaoEquipe'],
  ['web/app/(app)/estoque/page.tsx', 'definicaoEstoqueProdutos'],
  ['web/app/(app)/estoque/page.tsx', 'definicaoEstoqueMovimentacoes'],
  ['web/app/(app)/financeiro/page.tsx', 'definicaoDespesas'],
  ['web/app/(app)/pacotes/page.tsx', 'definicaoPacotesCatalogo'],
  ['web/app/(app)/pacotes/page.tsx', 'definicaoPacotesVendidos'],
  ['web/app/(app)/pacotes/page.tsx', 'definicaoPacotesUtilizacao'],
  ['web/app/(app)/relatorios/page.tsx', 'definicaoRelatorio'],
  ['web/app/(app)/servicos/page.tsx', 'definicaoServicos'],
  ['web/app/(app)/vendas/page.tsx', 'definicaoVendas'],
];

describe('web exporta pelas definições compartilhadas', () => {
  for (const [arq, fn] of WEB) {
    it(`${arq} usa ${fn}`, () => {
      const src = ler(arq);
      expect(src).toContain(`${fn}(`);
      expect(src).not.toMatch(/columns=\{\[/);
    });
  }
  it('relatórios não exporta a aba de avaliações', () => {
    expect(ler('web/app/(app)/relatorios/page.tsx')).toContain("aba !== 'avaliacoes'");
  });
});
