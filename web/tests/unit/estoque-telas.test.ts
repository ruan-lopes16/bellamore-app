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

describe('app', () => {
  const tela = ler('mobile', 'app', '(empresa)', 'estoque.tsx');
  const novo = ler('mobile', 'app', '(empresa)', 'novo-produto.tsx');
  const editar = ler('mobile', 'app', '(empresa)', 'editar-produto', '[id].tsx');
  const hook = ler('mobile', 'hooks', 'useEstoque.ts');
  const modal = ler('mobile', 'components', 'UnidadesEstoqueModal.tsx');
  const comanda = ler('mobile', 'app', '(empresa)', 'nova-comanda.tsx');
  const vendas = ler('mobile', 'app', '(empresa)', 'vendas.tsx');

  it('hook pelas consultas de shared (movimentação lança erro)', () => {
    for (const f of ['carregarProdutosEstoque', 'carregarMovimentosMes', 'movimentarEstoque', 'carregarUnidadesVisiveis', 'salvarUnidadesVisiveis']) {
      expect(hook).toContain(f);
    }
    expect(hook).toContain("'estoque-movimentos'");
  });
  it('cadastro e edição pela mesma regra do web, sem as listas antigas', () => {
    for (const src of [novo, editar]) {
      expect(src).toContain('montarProduto');
      expect(src).toContain('CATEGORIAS_PRODUTO');
      expect(src).toContain('unidadesParaSeletor');
      expect(src).toContain('unidadePedeQtdPorUnidade');
      expect(src).toContain('margemVenda');
      expect(src).not.toContain('parseBRLFloat');
      expect(src).not.toMatch(/'Cabelo'|'Maquiagem'|'Massagem'/);
    }
  });
  it('tela com cartões, movimentações em Brasília, filtros pelo id e exportação', () => {
    for (const f of ['resumoMovimentos', 'useMovimentosMes', 'chaveMesBRT', 'somarMeses', 'definicaoEstoqueMovimentacoes',
      'Materiais / Insumos', 'Para venda (PDV)', 'Precisam de reposição', 'Valor total em estoque', 'UnidadesEstoqueModal']) {
      expect(tela).toContain(f);
    }
    expect(tela).toContain('produto_id === filtroProdId');
    expect(tela).not.toContain('parseFloat(');
    expect(tela).not.toContain('Number(quantidade.replace');
    expect(modal).toContain('GRUPOS_UNIDADE');
    expect(modal).toContain('UNIDADES_PADRAO');
  });
  it('comanda e vendas atualizam o estoque depois de gravar', () => {
    expect(comanda).toContain("queryKey: ['estoque']");
    expect(vendas).toContain("queryKey: ['estoque']");
  });
});
