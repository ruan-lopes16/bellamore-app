import { describe, it, expect } from 'vitest';
import {
  propagarPadraoParaExcecoes, avisoExcecoesAcompanharam, opcoesMaquininha, type ConfigCartoes, type TaxaLinha,
} from '@shared/taxas-cartao';

const L = (bandeiraId: string | null, modalidade: 'debito' | 'credito', parcelas: number, taxa: number): TaxaLinha => ({ bandeiraId, modalidade, parcelas, taxa });

describe('propagarPadraoParaExcecoes', () => {
  const antiga = [L(null, 'debito', 1, 0.02), L(null, 'credito', 1, 0.05)];
  const nova = [L(null, 'debito', 1, 0.03), L(null, 'credito', 1, 0.05)];
  it('exceção igual à padrão antiga acompanha a nova', () => {
    const r = propagarPadraoParaExcecoes(antiga, nova, [L('v', 'debito', 1, 0.02)]);
    expect(r.excecoes[0].taxa).toBe(0.03);
    expect(r.acompanharam).toBe(1);
  });
  it('exceção diferente da antiga fica como está', () => {
    const r = propagarPadraoParaExcecoes(antiga, nova, [L('v', 'debito', 1, 0.04)]);
    expect(r.excecoes[0].taxa).toBe(0.04);
    expect(r.acompanharam).toBe(0);
  });
  it('padrão que não mudou não conta', () => {
    const r = propagarPadraoParaExcecoes(antiga, nova, [L('v', 'credito', 1, 0.05)]);
    expect(r.acompanharam).toBe(0);
  });
  it('compara sem erro de ponto flutuante', () => {
    const r = propagarPadraoParaExcecoes([L(null, 'debito', 1, 0.1 + 0.2)], [L(null, 'debito', 1, 0.5)], [L('v', 'debito', 1, 0.3)]);
    expect(r.acompanharam).toBe(1);
  });
  it('linha sem bandeira em excecoes volta intacta', () => {
    const r = propagarPadraoParaExcecoes(antiga, nova, [L(null, 'debito', 1, 0.02)]);
    expect(r.excecoes[0].taxa).toBe(0.02);
  });
  it('aviso no singular e plural', () => {
    expect(avisoExcecoesAcompanharam(1)).toBe('1 exceção acompanhou a tabela padrão.');
    expect(avisoExcecoesAcompanharam(3)).toBe('3 exceções acompanharam a tabela padrão.');
  });
});

describe('opcoesMaquininha', () => {
  const mq = (id: string, nome: string, ativa: boolean) => ({ id, nome, maxParcelas: 12, ativa, padrao: false, ordem: 1, taxas: [] });
  const cfg = (...m: ReturnType<typeof mq>[]): ConfigCartoes => ({ legado: false, bandeiras: [], maquininhas: m });
  it('uma ativa: sem seletor, com texto', () => {
    const r = opcoesMaquininha(cfg(mq('a', 'Stone', true)), 'a');
    expect(r.mostrarSeletor).toBe(false);
    expect(r.textoUnica).toBe('Maquininha: Stone');
  });
  it('duas ativas: seletor', () => {
    const r = opcoesMaquininha(cfg(mq('a', 'A', true), mq('b', 'B', true)), 'a');
    expect(r.mostrarSeletor).toBe(true);
    expect(r.textoUnica).toBeNull();
  });
  it('inativa selecionada aparece marcada; inativa não selecionada não', () => {
    const c = cfg(mq('a', 'A', true), mq('x', 'Velha', false));
    const r = opcoesMaquininha(c, 'x');
    expect(r.opcoes.map(o => o.rotulo)).toEqual(['A', 'Velha (desativada)']);
    expect(r.mostrarSeletor).toBe(true);
    expect(opcoesMaquininha(c, 'a').opcoes.map(o => o.id)).toEqual(['a']);
  });
  it('sem maquininha: nada', () => {
    const r = opcoesMaquininha(cfg(), null);
    expect(r.mostrarSeletor).toBe(false);
    expect(r.textoUnica).toBeNull();
  });
});
