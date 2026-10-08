import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
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

function arquivos(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap(n => {
    const p = `${dir}/${n}`;
    return statSync(join(root, p)).isDirectory() ? arquivos(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : [];
  });
}
describe('moeda única', () => {
  it('web não formata moeda com Intl/toLocaleString', () => {
    const ruins = ['web/app', 'web/components', 'web/lib'].flatMap(arquivos)
      .filter(a => /style:\s*'currency'|currency:\s*'BRL'/.test(ler(a)));
    expect(ruins).toEqual([]);
  });
});

const APP: [string, string][] = [
  ['mobile/app/(empresa)/agenda.tsx', 'definicaoAgenda'],
  ['mobile/app/(empresa)/clientes.tsx', 'definicaoClientes'],
  ['mobile/app/(empresa)/comissoes.tsx', 'definicaoComissoes'],
  ['mobile/app/(empresa)/equipe.tsx', 'definicaoEquipe'],
  ['mobile/app/(empresa)/estoque.tsx', 'definicaoEstoqueProdutos'],
  ['mobile/app/(empresa)/financeiro.tsx', 'definicaoDespesas'],
  ['mobile/app/(empresa)/pacotes.tsx', 'definicaoPacotesCatalogo'],
  ['mobile/app/(empresa)/relatorios.tsx', 'definicaoRelatorio'],
  ['mobile/app/(empresa)/servicos.tsx', 'definicaoServicos'],
];
describe('app exporta pelas mesmas definições', () => {
  for (const [arq, fn] of APP) {
    it(`${arq} usa ${fn} e BotaoExportar`, () => {
      const src = ler(arq);
      expect(src).toContain(`${fn}(`);
      expect(src).toContain('<BotaoExportar');
    });
  }
  it('área da profissional não ganhou exportação', () => {
    for (const n of ['agenda.tsx', 'comissoes.tsx', 'inicio.tsx', 'pacotes.tsx', 'servicos.tsx']) {
      expect(ler(`mobile/app/(profissional)/${n}`)).not.toContain('BotaoExportar');
    }
  });
});

describe('rótulos únicos (web e app iguais)', () => {
  it('estoque do app usa as funções de shared', () => {
    const src = ler('mobile/app/(empresa)/estoque.tsx');
    expect(src).toContain('rotuloCategoriaProduto(');
    expect(src).toContain('rotuloStatusEstoque(');
    expect(src).toContain('statusEstoque(');
  });
  it('estoque do web usa as funções de shared', () => {
    const src = ler('web/app/(app)/estoque/page.tsx');
    expect(src).toContain('rotuloCategoriaProduto(');
    expect(src).toContain('rotuloStatusEstoque(');
  });
  it('serviços do app e do web usam formatarDuracao', () => {
    expect(ler('mobile/app/(empresa)/servicos.tsx')).toContain('formatarDuracao(');
    expect(ler('web/app/(app)/servicos/page.tsx')).toContain('formatarDuracao(');
  });
});

describe('moeda única no app', () => {
  it('app não formata moeda com Intl nem abrevia "k"', () => {
    const ruins = ['mobile/app', 'mobile/components', 'mobile/lib', 'mobile/hooks'].flatMap(arquivos)
      .filter(a => /style:\s*'currency'|currency:\s*'BRL'|\}k`/.test(ler(a)));
    expect(ruins).toEqual([]);
  });
});
