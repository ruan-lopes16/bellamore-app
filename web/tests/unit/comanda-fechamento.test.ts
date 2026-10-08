import { describe, expect, it } from 'vitest';
import { calcularDesconto, resumoComanda, montarPagamentos, parseValorBR } from '@shared/comanda-fechamento';
import { TAXAS_PADRAO } from '@shared/taxas-cartao';

describe('calcularDesconto', () => {
  it('percentual e valor', () => {
    expect(calcularDesconto(200, 10, 'percentual')).toEqual({ valor: 20, erro: null });
    expect(calcularDesconto(200, 10, 'valor')).toEqual({ valor: 10, erro: null });
    expect(calcularDesconto(99.9, 10, 'percentual')).toEqual({ valor: 9.99, erro: null });
  });
  it('negativo vira 0; acima do subtotal bloqueia', () => {
    expect(calcularDesconto(100, -5, 'valor')).toEqual({ valor: 0, erro: null });
    expect(calcularDesconto(100, 150, 'valor')).toEqual({ valor: 100, erro: 'O desconto não pode ser maior que o subtotal' });
    expect(calcularDesconto(100, 120, 'percentual').erro).toBe('O desconto não pode ser maior que o subtotal');
  });
});

describe('resumoComanda', () => {
  const base = { subtotal: 200, desconto: 20, descontoReserva: 30, splits: [] as { metodo: string; valor: number }[] };
  it('sem pagamento não fecha e diz quanto falta', () => {
    const r = resumoComanda(base);
    expect(r.total).toBe(150);
    expect(r.podeFechar).toBe(false);
    expect(r.falta).toBe(150);
    expect(r.motivo).toBe('Ainda faltam R$ 150,00 para cobrir o total');
  });
  it('pagamento exato fecha; a mais vira troco', () => {
    expect(resumoComanda({ ...base, splits: [{ metodo: 'pix', valor: 150 }] }).podeFechar).toBe(true);
    const r = resumoComanda({ ...base, splits: [{ metodo: 'dinheiro', valor: 160 }] });
    expect(r.podeFechar).toBe(true);
    expect(r.troco).toBe(10);
    expect(r.falta).toBe(0);
  });
  it('total zero = cortesia automática, fecha sem pagamento', () => {
    const r = resumoComanda({ subtotal: 100, desconto: 0, descontoReserva: 100, splits: [] });
    expect(r.cortesiaAutomatica).toBe(true);
    expect(r.podeFechar).toBe(true);
  });
  it('erro de desconto bloqueia mesmo coberto', () => {
    const r = resumoComanda({ ...base, erroDesconto: 'O desconto não pode ser maior que o subtotal', splits: [{ metodo: 'pix', valor: 999 }] });
    expect(r.podeFechar).toBe(false);
    expect(r.motivo).toBe('O desconto não pode ser maior que o subtotal');
  });
});

describe('montarPagamentos', () => {
  const ctx = { empresaId: 'e', comandaId: 'c', taxas: TAXAS_PADRAO, total: 300 };
  it('cartão grava bandeira, parcelas, taxa e líquido; pix sem taxa', () => {
    const linhas = montarPagamentos([
      { metodo: 'credito', valor: 100, bandeira: 'visa', parcelas: 3 },
      { metodo: 'debito', valor: 100, bandeira: 'master' },
      { metodo: 'pix', valor: 100, bandeira: 'visa' },
    ], ctx);
    expect(linhas[0]).toEqual({ empresa_id: 'e', comanda_id: 'c', valor: 100, metodo: 'credito', bandeira: 'visa', parcelas: 3, taxa_perc: 0.0559, valor_liquido: 94.41, status: 'pago' });
    expect(linhas[1]).toMatchObject({ metodo: 'debito', parcelas: 1, taxa_perc: 0.0239, valor_liquido: 97.61, bandeira: 'master' });
    expect(linhas[2]).toMatchObject({ metodo: 'pix', bandeira: null, parcelas: 1, taxa_perc: null, valor_liquido: null });
  });
  it('ignora splits de valor zero; total zero sem splits = cortesia', () => {
    expect(montarPagamentos([{ metodo: 'pix', valor: 0 }], ctx)).toEqual([]);
    expect(montarPagamentos([], { ...ctx, total: 0 })).toEqual([
      { empresa_id: 'e', comanda_id: 'c', valor: 0, metodo: 'cortesia', bandeira: null, parcelas: 1, taxa_perc: null, valor_liquido: null, status: 'pago' },
    ]);
  });
});

describe('parseValorBR', () => {
  it('formatos brasileiros', () => {
    expect(parseValorBR('1.234,56')).toBe(1234.56);
    expect(parseValorBR('12,5')).toBe(12.5);
    expect(parseValorBR('')).toBe(0);
    expect(parseValorBR('abc')).toBe(0);
  });
  it('ponto como decimal, milhar com ponto, R$ e espaços', () => {
    expect(parseValorBR('10.50')).toBe(10.5);
    expect(parseValorBR('10.5')).toBe(10.5);
    expect(parseValorBR('1.234')).toBe(1234);
    expect(parseValorBR('1.234.567')).toBe(1234567);
    expect(parseValorBR('R$ 10,00')).toBe(10);
    expect(parseValorBR(' 12,5 ')).toBe(12.5);
    expect(parseValorBR('R$ 1.234,56')).toBe(1234.56);
    expect(parseValorBR('-5')).toBe(0);
  });
});
