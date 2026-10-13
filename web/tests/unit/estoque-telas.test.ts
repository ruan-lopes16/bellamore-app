import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const raiz = join(process.cwd(), '..');
const ler = (...p: string[]) => readFileSync(join(raiz, ...p), 'utf8');

describe('web', () => {
  const web = ler('web', 'app', '(app)', 'estoque', 'page.tsx');
  const modal = ler('web', 'app', '(app)', 'estoque', 'UnidadesModal.tsx');
  it('usa as consultas e regras de shared', () => {
    for (const f of ['carregarProdutosEstoque', 'carregarMovimentosMes', 'movimentarEstoque', 'carregarUnidadesVisiveis',
      'montarProduto', 'unidadesParaSeletor', 'unidadePedeQtdPorUnidade', 'resumoProdutos', 'resumoMovimentos', 'parseQuantidadeBR']) {
      expect(web).toContain(f);
    }
  });
  it('sem parseFloat, sem mês no fuso do navegador, sem lista local de unidades', () => {
    expect(web).not.toContain('parseFloat(');
    expect(web).not.toMatch(/startOfMonth|endOfMonth/);
    expect(web).not.toMatch(/const UNIDADES\s*=/);
  });
  it('filtro de movimentos pelo id do produto', () => {
    expect(web).toContain('produto_id === filtroProdId');
    expect(web).not.toMatch(/produto\.nome === produtoFiltradoNome/);
  });
  it('ajuste de unidades com permissão e só com a 088', () => {
    expect(web).toContain("pode('estoque.acessar')");
    expect(web).toContain('UnidadesModal');
    expect(modal).toContain('salvarUnidadesVisiveis');
    expect(modal).toContain('GRUPOS_UNIDADE');
    expect(modal).toContain('UNIDADES_PADRAO');
  });
});
