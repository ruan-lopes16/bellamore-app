import { describe, expect, it } from 'vitest';
import {
  CATEGORIAS_PRODUTO, GRUPOS_UNIDADE, UNIDADES_PRODUTO, UNIDADES_PADRAO, unidadePedeQtdPorUnidade, rotuloUnidade,
  normalizarUnidadesVisiveis, unidadesParaSeletor, parseQuantidadeBR, montarProduto, resumoProdutos,
  resumoMovimentos, margemVenda, type FormProduto,
} from '@shared/estoque';

const form = (extra: Partial<FormProduto> = {}): FormProduto => ({
  nome: '  Cola  ', tipo: 'material', categoria: 'cilios', unidade: 'un', qtdPorUnidade: '',
  estoqueAtual: '3', estoqueMinimo: '1', precoCusto: '12,50', precoVenda: '', ...extra,
});

describe('catálogos', () => {
  it('categorias: as 9 do web, por chave, na ordem dos rótulos', () => {
    expect(CATEGORIAS_PRODUTO.map(c => c.key)).toEqual(['cilios', 'depilacao', 'ferramentas', 'higiene', 'materiais', 'outros', 'pele', 'sobrancelhas', 'unhas']);
    expect(CATEGORIAS_PRODUTO[0].label).toBe('Cílios');
  });
  it('unidades: catálogo completo, sem repetição, com grupo conhecido', () => {
    const chaves = UNIDADES_PRODUTO.map(u => u.key);
    expect(chaves).toEqual(['un', 'pç', 'par', 'kit', 'pct', 'cx', 'fr', 'tb', 'pote', 'amp', 'sachê', 'rolo', 'folha', 'ml', 'L', 'mg', 'g', 'kg', 'cm', 'm', 'dose']);
    expect(new Set(chaves).size).toBe(chaves.length);
    const grupos = new Set(GRUPOS_UNIDADE.map(g => g.key));
    expect(UNIDADES_PRODUTO.every(u => grupos.has(u.grupo))).toBe(true);
  });
  it('padrão = lista do web + frasco, todas no catálogo', () => {
    expect(UNIDADES_PADRAO).toEqual(['un', 'pct', 'ml', 'g', 'kg', 'L', 'cx', 'pç', 'par', 'fr']);
    expect(UNIDADES_PADRAO.every(u => UNIDADES_PRODUTO.some(c => c.key === u))).toBe(true);
  });
  it('só pacote e caixa perguntam a quantidade de dentro', () => {
    expect(UNIDADES_PRODUTO.filter(u => unidadePedeQtdPorUnidade(u.key)).map(u => u.key)).toEqual(['pct', 'cx']);
  });
  it('rótulo da unidade; desconhecida devolve a chave', () => {
    expect(rotuloUnidade('fr')).toBe('Frasco');
    expect(rotuloUnidade('xyz')).toBe('xyz');
  });
});

describe('unidades visíveis', () => {
  it('normaliza: só do catálogo, sem repetição, na ordem do catálogo', () => {
    expect(normalizarUnidadesVisiveis(['kg', 'xyz', 'un', 'kg', 'fr'])).toEqual(['un', 'fr', 'kg']);
  });
  it('seletor: sem configuração usa o padrão', () => {
    expect(unidadesParaSeletor(null)).toEqual(normalizarUnidadesVisiveis(UNIDADES_PADRAO));
  });
  it('seletor: configuração da empresa, na ordem do catálogo', () => {
    expect(unidadesParaSeletor(['kg', 'un'])).toEqual(['un', 'kg']);
  });
  it('seletor: a unidade do produto editado nunca some (mesmo oculta ou fora do catálogo)', () => {
    expect(unidadesParaSeletor(['un'], 'cx')).toEqual(['un', 'cx']);
    expect(unidadesParaSeletor(['un'], 'galão')).toEqual(['un', 'galão']);
    expect(unidadesParaSeletor(['un', 'cx'], 'cx')).toEqual(['un', 'cx']);
  });
});

describe('parseQuantidadeBR', () => {
  it('vírgula, ponto decimal, milhar; vazio e negativo viram 0', () => {
    expect(parseQuantidadeBR('0,5')).toBe(0.5);
    expect(parseQuantidadeBR('0.5')).toBe(0.5);
    expect(parseQuantidadeBR('1.234,56')).toBe(1234.56);
    expect(parseQuantidadeBR('')).toBe(0);
    expect(parseQuantidadeBR('-3')).toBe(0);
  });
});

describe('montarProduto', () => {
  it('material: payload com números lidos em BR e sem preço de venda', () => {
    const r = montarProduto(form({ precoVenda: '99' }), { empresaId: 'e1', editando: false });
    expect(r).toEqual({ payload: {
      empresa_id: 'e1', nome: 'Cola', tipo: 'material', categoria: 'cilios', unidade: 'un', qtd_por_unidade: 1,
      estoque_atual: 3, estoque_minimo: 1, preco_custo: 12.5, preco_venda: 0, ativo: true,
    } });
  });
  it('edição não manda ativo (não reativa nem desativa)', () => {
    const r = montarProduto(form(), { empresaId: 'e1', editando: true });
    expect('payload' in r && r.payload).not.toHaveProperty('ativo');
    expect('payload' in r && r.payload.estoque_atual).toBe(3);
  });
  it('venda exige preço de venda maior que zero', () => {
    expect(montarProduto(form({ tipo: 'venda', precoVenda: '' }), { empresaId: 'e1', editando: false }))
      .toEqual({ erro: 'Informe o preço de venda.' });
    const ok = montarProduto(form({ tipo: 'venda', precoVenda: '1.234,50' }), { empresaId: 'e1', editando: false });
    expect('payload' in ok && ok.payload.preco_venda).toBe(1234.5);
  });
  it('quantidade dentro só para pacote/caixa, inteira e no mínimo 1', () => {
    const pct = montarProduto(form({ unidade: 'pct', qtdPorUnidade: '12' }), { empresaId: 'e1', editando: false });
    expect('payload' in pct && pct.payload.qtd_por_unidade).toBe(12);
    const arred = montarProduto(form({ unidade: 'cx', qtdPorUnidade: '2,6' }), { empresaId: 'e1', editando: false });
    expect('payload' in arred && arred.payload.qtd_por_unidade).toBe(3);
    const vazio = montarProduto(form({ unidade: 'cx', qtdPorUnidade: '' }), { empresaId: 'e1', editando: false });
    expect('payload' in vazio && vazio.payload.qtd_por_unidade).toBe(1);
    const kit = montarProduto(form({ unidade: 'kit', qtdPorUnidade: '5' }), { empresaId: 'e1', editando: false });
    expect('payload' in kit && kit.payload.qtd_por_unidade).toBe(1);
  });
  it('erros: nome, categoria fora do catálogo, unidade vazia', () => {
    expect(montarProduto(form({ nome: '  ' }), { empresaId: 'e1', editando: false })).toEqual({ erro: 'Informe o nome do produto.' });
    expect(montarProduto(form({ categoria: 'Pele' }), { empresaId: 'e1', editando: false })).toEqual({ erro: 'Escolha uma categoria.' });
    expect(montarProduto(form({ unidade: '' }), { empresaId: 'e1', editando: false })).toEqual({ erro: 'Escolha a unidade de medida.' });
  });
});

describe('resumos', () => {
  it('resumoProdutos: contagens, alertas (baixo e zerado) e valor sem saldo negativo', () => {
    expect(resumoProdutos([
      { tipo: 'material', estoque_atual: 2, estoque_minimo: 2, preco_custo: 10.1 },
      { tipo: 'material', estoque_atual: 5, estoque_minimo: 1, preco_custo: 3 },
      { tipo: 'venda', estoque_atual: -1, estoque_minimo: 0, preco_custo: 50 },
    ])).toEqual({ materiais: 2, venda: 1, alertas: 2, valorTotal: 35.2 });
  });
  it('resumoMovimentos: contagem e soma por tipo', () => {
    expect(resumoMovimentos([
      { tipo: 'entrada', quantidade: 2 }, { tipo: 'saida', quantidade: 1.5 }, { tipo: 'entrada', quantidade: 3 },
    ])).toEqual({ entradas: 2, saidas: 1, total: 3, qtdEntradas: 5, qtdSaidas: 1.5 });
  });
  it('margemVenda: % inteiro; sem custo ou venda devolve null', () => {
    expect(margemVenda(10, 15)).toBe(50);
    expect(margemVenda(0, 15)).toBeNull();
    expect(margemVenda(10, 0)).toBeNull();
  });
});
