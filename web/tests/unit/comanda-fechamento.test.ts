import { describe, expect, it } from 'vitest';
import { calcularDesconto, resumoComanda, montarPagamentos, parseValorBR, taxaDoSplit } from '@shared/comanda-fechamento';
import { configLegada, type ConfigCartoes } from '@shared/taxas-cartao';

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
  it('total de R$ 0,01 exige pagamento (não vira cortesia nem fecha vazio)', () => {
    const r = resumoComanda({ subtotal: 10.01, desconto: 10, descontoReserva: 0, splits: [] });
    expect(r.total).toBe(0.01);
    expect(r.cortesiaAutomatica).toBe(false);
    expect(r.podeFechar).toBe(false);
    expect(resumoComanda({ subtotal: 10.01, desconto: 10, descontoReserva: 0, splits: [{ metodo: 'pix', valor: 0.01 }] }).podeFechar).toBe(true);
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
  const ctx = { empresaId: 'e', comandaId: 'c', config: configLegada({}), total: 300 };
  it('cartão grava bandeira, parcelas, taxa e líquido; pix sem taxa', () => {
    const linhas = montarPagamentos([
      { metodo: 'credito', valor: 100, bandeira: 'visa', parcelas: 3 },
      { metodo: 'debito', valor: 100, bandeira: 'master' },
      { metodo: 'pix', valor: 100, bandeira: 'visa' },
    ], ctx);
    expect(linhas[0]).toEqual({ empresa_id: 'e', comanda_id: 'c', valor: 100, metodo: 'credito', bandeira: 'visa', parcelas: 3, taxa_perc: 0.0559, valor_liquido: 94.41, maquininha_id: null, status: 'pago' });
    expect(linhas[1]).toMatchObject({ metodo: 'debito', parcelas: 1, taxa_perc: 0.0239, valor_liquido: 97.61, bandeira: 'master' });
    expect(linhas[2]).toMatchObject({ metodo: 'pix', bandeira: null, parcelas: 1, taxa_perc: null, valor_liquido: null });
  });
  it('ignora splits de valor zero; total zero sem splits = cortesia', () => {
    expect(montarPagamentos([{ metodo: 'pix', valor: 0 }], ctx)).toEqual([]);
    expect(montarPagamentos([], { ...ctx, total: 0 })).toEqual([
      { empresa_id: 'e', comanda_id: 'c', valor: 0, metodo: 'cortesia', bandeira: null, parcelas: 1, taxa_perc: null, valor_liquido: null, maquininha_id: null, status: 'pago' },
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

describe('montarPagamentos — split reaberto na edição (taxaGravada)', () => {
  const taxasNovas = { taxa_cartao_debito: 0.03, taxa_cartao_credito_avista: 0.06, taxa_cartao_credito_parcelado: 0.07 };
  const ctx = { empresaId: 'e', comandaId: 'c', config: configLegada(taxasNovas), total: 200 };
  it('split reaberto e não alterado mantém a taxa gravada e o created_at original', () => {
    const [l] = montarPagamentos([{
      metodo: 'credito', valor: 100, bandeira: 'visa', parcelas: 1,
      taxaGravada: 0.0499, metodoGravado: 'credito', parcelasGravadas: 1, criadoEm: '2026-09-10T15:00:00+00:00',
    }], ctx);
    expect(l).toMatchObject({ taxa_perc: 0.0499, valor_liquido: 95.01, created_at: '2026-09-10T15:00:00+00:00' });
  });
  it('taxa gravada nula (pagamento antigo sem taxa) continua sem taxa', () => {
    const [l] = montarPagamentos([{ metodo: 'debito', valor: 100, taxaGravada: null, metodoGravado: 'debito', parcelasGravadas: 1 }], ctx);
    expect(l).toMatchObject({ taxa_perc: null, valor_liquido: null });
    expect(l).not.toHaveProperty('created_at');
  });
  it('parcelas alteradas usam a taxa atual (mas mantêm o created_at do pagamento)', () => {
    const [l] = montarPagamentos([{
      metodo: 'credito', valor: 100, parcelas: 3,
      taxaGravada: 0.0499, metodoGravado: 'credito', parcelasGravadas: 1, criadoEm: '2026-09-10T15:00:00+00:00',
    }], ctx);
    expect(l).toMatchObject({ taxa_perc: 0.07, valor_liquido: 93, created_at: '2026-09-10T15:00:00+00:00' });
  });
  it('método diferente do gravado usa a taxa atual', () => {
    const [l] = montarPagamentos([{ metodo: 'debito', valor: 100, taxaGravada: 0.0499, metodoGravado: 'credito', parcelasGravadas: 1 }], ctx);
    expect(l.taxa_perc).toBe(0.03);
  });
  it('split novo usa a taxa atual e não grava created_at', () => {
    const [l] = montarPagamentos([{ metodo: 'credito', valor: 100, parcelas: 1 }], ctx);
    expect(l.taxa_perc).toBe(0.06);
    expect(l).not.toHaveProperty('created_at');
  });
});

describe('montarPagamentos — maquininha', () => {
  const cfg: ConfigCartoes = {
    legado: false,
    bandeiras: [{ id: 'b1', chave: 'visa', nome: 'Visa', ativa: true, ordem: 1 }],
    maquininhas: [
      { id: 'm1', nome: 'A', maxParcelas: 2, ativa: true, padrao: true, ordem: 1, taxas: [
        { bandeiraId: null, modalidade: 'debito', parcelas: 1, taxa: 0.02 },
        { bandeiraId: null, modalidade: 'credito', parcelas: 1, taxa: 0.04 },
        { bandeiraId: null, modalidade: 'credito', parcelas: 2, taxa: 0.05 } ] },
      { id: 'm2', nome: 'B', maxParcelas: 1, ativa: true, padrao: false, ordem: 2, taxas: [
        { bandeiraId: null, modalidade: 'debito', parcelas: 1, taxa: 0.01 },
        { bandeiraId: null, modalidade: 'credito', parcelas: 1, taxa: 0.03 } ] },
    ],
  };
  const ctx = { empresaId: 'e', comandaId: 'c', config: cfg, total: 100 };
  it('grava a maquininha e a taxa dela; sem maquininha usa a padrão', () => {
    expect(montarPagamentos([{ metodo: 'credito', valor: 100, bandeira: 'visa', parcelas: 1, maquininhaId: 'm2' }], ctx)[0])
      .toMatchObject({ maquininha_id: 'm2', taxa_perc: 0.03, valor_liquido: 97 });
    expect(montarPagamentos([{ metodo: 'debito', valor: 100, bandeira: 'visa' }], ctx)[0])
      .toMatchObject({ maquininha_id: 'm1', taxa_perc: 0.02 });
  });
  it('pix sem maquininha; taxa não cadastrada grava sem taxa', () => {
    expect(montarPagamentos([{ metodo: 'pix', valor: 100, maquininhaId: 'm2' }], ctx)[0]).toMatchObject({ maquininha_id: null, taxa_perc: null });
    expect(montarPagamentos([{ metodo: 'credito', valor: 100, parcelas: 5, maquininhaId: 'm1' }], ctx)[0])
      .toMatchObject({ maquininha_id: 'm1', taxa_perc: null, valor_liquido: null });
  });
  it('reaberto mantém a taxa só se maquininha e bandeira também não mudaram', () => {
    const base = { metodo: 'credito', valor: 100, parcelas: 1, bandeira: 'visa', taxaGravada: 0.09, metodoGravado: 'credito', parcelasGravadas: 1, maquininhaGravada: 'm1', bandeiraGravada: 'visa' };
    expect(montarPagamentos([{ ...base, maquininhaId: 'm1' }], ctx)[0].taxa_perc).toBe(0.09);
    expect(montarPagamentos([{ ...base, maquininhaId: 'm2' }], ctx)[0].taxa_perc).toBe(0.03);
    expect(montarPagamentos([{ ...base, maquininhaId: 'm1', bandeira: 'amex' }], ctx)[0].taxa_perc).toBe(0.04);
  });
  it('reaberto antigo (gravado antes da 086, sem maquininha) mantém a taxa da época até trocarem a maquininha', () => {
    const antigo = { metodo: 'credito', valor: 100, parcelas: 1, bandeira: 'visa', taxaGravada: 0.09, metodoGravado: 'credito', parcelasGravadas: 1, maquininhaGravada: null, bandeiraGravada: 'visa' };
    expect(montarPagamentos([antigo], ctx)[0]).toMatchObject({ taxa_perc: 0.09, maquininha_id: null });
    expect(montarPagamentos([{ ...antigo, parcelas: 2 }], ctx)[0]).toMatchObject({ taxa_perc: 0.05, maquininha_id: 'm1' });
    expect(montarPagamentos([{ ...antigo, maquininhaId: null }], ctx)[0].taxa_perc).toBe(0.09);
    expect(montarPagamentos([{ ...antigo, maquininhaId: 'm2' }], ctx)[0].taxa_perc).toBe(0.03);
  });
  it('venda grava venda_id e não comanda_id; legado grava maquininha null', () => {
    const l = montarPagamentos([{ metodo: 'pix', valor: 10 }], { empresaId: 'e', vendaId: 'v', config: cfg, total: 10 })[0];
    expect(l).toMatchObject({ venda_id: 'v' });
    expect(l).not.toHaveProperty('comanda_id');
    expect(montarPagamentos([{ metodo: 'debito', valor: 10 }], { empresaId: 'e', comandaId: 'c', config: configLegada({}), total: 10 })[0].maquininha_id).toBeNull();
  });
  it('maquininha fora da configuração grava a padrão', () => {
    expect(montarPagamentos([{ metodo: 'debito', valor: 10, maquininhaId: 'legado' }], ctx)[0]).toMatchObject({ maquininha_id: 'm1', taxa_perc: 0.02 });
  });
  it('taxaDoSplit: null quando a combinação não tem taxa; 0 fora do cartão', () => {
    expect(taxaDoSplit({ metodo: 'credito', parcelas: 5, maquininhaId: 'm1' }, cfg)).toBeNull();
    expect(taxaDoSplit({ metodo: 'pix' }, cfg)).toBe(0);
  });
});
