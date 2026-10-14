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
  it('edição passa o original, preenche pelo formatarQuantidadeBR e a tela não regrava saldo velho', () => {
    expect(web).toContain('original:');
    expect(web).toContain('formatarQuantidadeBR(ed.estoque_atual)');
    expect(web).toContain('formatarQuantidadeBR(ed.estoque_minimo)');
  });
  it('mês de movimentações: contador de requisição, Brasília e próximo mês travado no atual', () => {
    expect(web).toContain('++reqMov.current');
    expect(web).toContain('req !== reqMov.current');
    expect(web).toContain('rotuloDataHoraBRT');
    expect(web).toContain('disabled={mesMov >= chaveMesBRT(new Date())}');
    expect(web).not.toContain("from 'date-fns'");
  });
  it('erros de carga escondem cartões, lista e tabela; modais não fecham gravando', () => {
    expect(web).toContain('erroCarga ? null : loading');
    expect(web).toContain('erroMov ? null : loadingMov');
    expect(web).toContain('if (!salvando) onClose()');
    expect(modal).toContain('if (!salvando) onClose()');
  });
  it('textos iguais ao app: "Via comanda" e quantidades pelo formatarQuantidadeBR', () => {
    expect(web).toContain('Via comanda');
    expect(web).toContain('formatarQuantidadeBR(resumoMov.qtdSaidas)');
    expect(web).toContain('formatarQuantidadeBR(qtd)');
  });
  it('unidade do produto novo vem do seletor da empresa', () => {
    expect(web).toContain('unidadesParaSeletor(visiveis)[0]');
  });
  it('modal de unidades: Salvar desabilitado com 0 unidades ligadas', () => {
    expect(modal).toContain('disabled={ligadas.length === 0 || salvando}');
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
    expect(hook).toContain("'estoque-baixo'");
    expect(hook).toMatch(/finally \{[^}]*invalidateQueries/);
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
    for (const src of [comanda, vendas]) {
      expect(src).toContain("queryKey: ['estoque-movimentos']");
      expect(src).toContain("queryKey: ['estoque-baixo']");
    }
  });
  it('próximo mês travado, trava de duplo toque e paginação local', () => {
    expect(tela).toContain('disabled={!podeAvancar}');
    expect(tela).toContain('gravandoRef');
    expect(modal).toContain('salvandoRef');
    expect(tela).toContain('Mostrar mais');
  });
});
