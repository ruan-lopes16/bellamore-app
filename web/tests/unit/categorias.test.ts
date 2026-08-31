import { describe, expect, it } from 'vitest';
import {
  CATEGORIA_PALETA,
  CATEGORIA_ICONES,
  bgDaCor,
  resolverCategoriaServico,
  type CategoriaCustom,
} from '@shared/categorias';

const custom: CategoriaCustom = {
  id: 'c1', empresa_id: 'e1', nome: 'Massagem', cor: '#DC2626', icone: 'Heart',
};

describe('paleta e icones curados', () => {
  it('tem 10 cores e 12 icones', () => {
    expect(CATEGORIA_PALETA).toHaveLength(10);
    expect(CATEGORIA_ICONES).toHaveLength(12);
  });
  it('bgDaCor devolve o bg do par ou cinza para cor fora da paleta', () => {
    expect(bgDaCor('#DC2626')).toBe('#FEF2F2');
    expect(bgDaCor('#123456')).toBe('#F3F4F6');
  });
});

describe('resolverCategoriaServico', () => {
  it('categoria built-in conhecida', () => {
    const r = resolverCategoriaServico('cilios', null, []);
    expect(r.tipo).toBe('builtin');
    expect(r.chave).toBe('cilios');
    expect(r.label).toBe('Cílios');
    expect(r.cor).toBe('#4F46E5');
    expect(r.iconeBuiltin).toBe('cilios');
  });

  it('categoria_id com custom presente na lista', () => {
    const r = resolverCategoriaServico(null, 'c1', [custom]);
    expect(r.tipo).toBe('custom');
    expect(r.chave).toBe('c1');
    expect(r.label).toBe('Massagem');
    expect(r.cor).toBe('#DC2626');
    expect(r.bg).toBe('#FEF2F2');
    expect(r.iconeCustom).toBe('Heart');
  });

  it('categoria_id apontando para custom ausente (categoria apagada) cai em Outros', () => {
    const r = resolverCategoriaServico(null, 'c-removida', [custom]);
    expect(r.tipo).toBe('nenhuma');
    expect(r.chave).toBe('outros');
    expect(r.label).toBe('Outros');
    expect(r.iconeBuiltin).toBe('outros');
  });

  it('ambos nulos cai em Outros', () => {
    expect(resolverCategoriaServico(null, null, []).chave).toBe('outros');
    expect(resolverCategoriaServico(undefined, undefined, []).tipo).toBe('nenhuma');
  });

  it('categoria texto fora das 8 chaves, sem categoria_id, cai em Outros', () => {
    const r = resolverCategoriaServico('massagem-legada', null, []);
    expect(r.chave).toBe('outros');
    expect(r.tipo).toBe('nenhuma');
  });
});
