import { describe, expect, it } from 'vitest';
import {
  somaDevolucoesPorRetirada,
  saldoEmprestimo,
  retiradasNoPeriodo,
  saldoDevedorTotal,
  somarMesesIso,
  statusParcela,
  montarRetiradaSociaInsert,
  montarDevolucaoInsert,
} from '@shared/retiradas-socia';

describe('saldoEmprestimo', () => {
  it('subtrai o devolvido do valor', () => {
    expect(saldoEmprestimo(1000, 300)).toBe(700);
  });
  it('nunca fica negativo (pagamento a mais)', () => {
    expect(saldoEmprestimo(1000, 1200)).toBe(0);
  });
  it('arredonda para centavos', () => {
    expect(saldoEmprestimo(100, 33.333)).toBe(66.67);
  });
});

describe('somaDevolucoesPorRetirada', () => {
  it('agrupa e soma por retirada_id', () => {
    expect(somaDevolucoesPorRetirada([
      { retirada_id: 'a', valor: 100 },
      { retirada_id: 'a', valor: 50 },
      { retirada_id: 'b', valor: 20 },
    ])).toEqual({ a: 150, b: 20 });
  });
  it('lista vazia vira objeto vazio', () => {
    expect(somaDevolucoesPorRetirada([])).toEqual({});
  });
});

describe('retiradasNoPeriodo', () => {
  const devs = { emp1: 400 };
  const rows = [
    { id: 'ret1', tipo: 'retirada' as const,   valor: 500,  data: '2026-08-10', convertido_em: null },
    { id: 'ret2', tipo: 'retirada' as const,   valor: 999,  data: '2026-07-31', convertido_em: null }, // fora do período
    { id: 'emp1', tipo: 'emprestimo' as const, valor: 1000, data: '2026-05-01', convertido_em: '2026-08-20' }, // saldo 600 conta em ago
    { id: 'emp2', tipo: 'emprestimo' as const, valor: 300,  data: '2026-08-02', convertido_em: null }, // empréstimo aberto: não conta
  ];
  it('soma retiradas do período + saldo de empréstimos convertidos no período', () => {
    expect(retiradasNoPeriodo(rows, devs, '2026-08-01', '2026-08-31')).toBe(1100); // 500 + (1000-400)
  });
  it('ignora empréstimo convertido fora do período', () => {
    expect(retiradasNoPeriodo(rows, devs, '2026-09-01', '2026-09-30')).toBe(0);
  });
  it('período sem nada retorna 0', () => {
    expect(retiradasNoPeriodo([], {}, '2026-08-01', '2026-08-31')).toBe(0);
  });
});

describe('saldoDevedorTotal', () => {
  it('soma só empréstimos abertos (não convertidos), líquido das devoluções', () => {
    const rows = [
      { id: 'emp1', tipo: 'emprestimo' as const, valor: 1000, convertido_em: null },
      { id: 'emp2', tipo: 'emprestimo' as const, valor: 500,  convertido_em: null },
      { id: 'emp3', tipo: 'emprestimo' as const, valor: 800,  convertido_em: '2026-08-01' }, // convertido: fora
      { id: 'ret1', tipo: 'retirada' as const,   valor: 300,  convertido_em: null },          // retirada: fora
    ];
    expect(saldoDevedorTotal(rows, { emp1: 250 })).toBe(1250); // (1000-250) + 500
  });
  it('empréstimo totalmente quitado não soma', () => {
    const rows = [{ id: 'emp1', tipo: 'emprestimo' as const, valor: 1000, convertido_em: null }];
    expect(saldoDevedorTotal(rows, { emp1: 1000 })).toBe(0);
  });
});

describe('somarMesesIso', () => {
  it('soma meses mantendo o dia', () => {
    expect(somarMesesIso('2026-01-15', 2)).toBe('2026-03-15');
  });
  it('vira o ano', () => {
    expect(somarMesesIso('2026-11-10', 3)).toBe('2027-02-10');
  });
  it('faz clamp do dia em meses curtos', () => {
    expect(somarMesesIso('2026-01-31', 1)).toBe('2026-02-28');
  });
  it('meses = 0 devolve a própria data', () => {
    expect(somarMesesIso('2026-06-05', 0)).toBe('2026-06-05');
  });
});

describe('statusParcela', () => {
  // empréstimo de 1200 em 3x de 400, 1ª parcela 2026-09-10
  it('nada devolvido: próxima parcela é a 1ª, atrasada se hoje já passou', () => {
    expect(statusParcela(400, '2026-09-10', 3, 0, '2026-09-15'))
      .toEqual({ parcelasQuitadas: 0, proximaParcelaEm: '2026-09-10', atrasada: true });
  });
  it('nada devolvido e ainda não venceu: não atrasada', () => {
    expect(statusParcela(400, '2026-09-10', 3, 0, '2026-09-01'))
      .toEqual({ parcelasQuitadas: 0, proximaParcelaEm: '2026-09-10', atrasada: false });
  });
  it('1 parcela paga: próxima vence 1 mês depois da 1ª', () => {
    expect(statusParcela(400, '2026-09-10', 3, 400, '2026-10-01'))
      .toEqual({ parcelasQuitadas: 1, proximaParcelaEm: '2026-10-10', atrasada: false });
  });
  it('pulou meses: conta as parcelas realmente cobertas pelo devolvido', () => {
    expect(statusParcela(400, '2026-09-10', 3, 800, '2026-12-01'))
      .toEqual({ parcelasQuitadas: 2, proximaParcelaEm: '2026-11-10', atrasada: true });
  });
  it('tudo quitado: sem próxima parcela, não atrasada', () => {
    expect(statusParcela(400, '2026-09-10', 3, 1200, '2027-01-01'))
      .toEqual({ parcelasQuitadas: 3, proximaParcelaEm: null, atrasada: false });
  });
  it('devolvido acima do total não passa de totalParcelas', () => {
    expect(statusParcela(400, '2026-09-10', 3, 5000, '2027-01-01').parcelasQuitadas).toBe(3);
  });
  it('valor não divisível: floor por parcela (R$1000 em 3x de 333,33)', () => {
    expect(statusParcela(333.33, '2026-09-10', 3, 333.33, '2026-09-01').parcelasQuitadas).toBe(1);
  });
});

describe('montarRetiradaSociaInsert', () => {
  const base = {
    empresaId: 'e1', data: '2026-08-30', descricao: 'uso pessoal',
    metodo: 'pix' as const, parcelado: false,
    totalParcelasInput: '', valorParcelaInput: '', primeiraParcelaEm: '',
  };
  it('retirada simples: zera todos os campos de parcela', () => {
    const r = montarRetiradaSociaInsert({ ...base, tipo: 'retirada', valorInput: '500,00' }, 'u1');
    expect(r).toEqual({ ok: true, payload: {
      empresa_id: 'e1', tipo: 'retirada', valor: 500, data: '2026-08-30',
      descricao: 'uso pessoal', metodo: 'pix', parcelado: false,
      total_parcelas: null, valor_parcela: null, primeira_parcela_em: null, criado_por: 'u1',
    }});
  });
  it('empréstimo avulso: parcelado false, campos de parcela null', () => {
    const r = montarRetiradaSociaInsert({ ...base, tipo: 'emprestimo', valorInput: '1000' }, 'u1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload).toMatchObject({ tipo: 'emprestimo', parcelado: false, total_parcelas: null });
  });
  it('empréstimo parcelado: valor_parcela default = valor-base (centavos)', () => {
    const r = montarRetiradaSociaInsert({
      ...base, tipo: 'emprestimo', valorInput: '1000', parcelado: true,
      totalParcelasInput: '3', valorParcelaInput: '', primeiraParcelaEm: '2026-09-10',
    }, 'u1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload).toMatchObject({
      parcelado: true, total_parcelas: 3, valor_parcela: 333.33, primeira_parcela_em: '2026-09-10',
    });
  });
  it('empréstimo parcelado respeita valor_parcela informado', () => {
    const r = montarRetiradaSociaInsert({
      ...base, tipo: 'emprestimo', valorInput: '1000', parcelado: true,
      totalParcelasInput: '4', valorParcelaInput: '250,00', primeiraParcelaEm: '2026-09-10',
    }, 'u1');
    if (r.ok) expect(r.payload.valor_parcela).toBe(250);
    else throw new Error('esperava ok');
  });
  it('rejeita valor <= 0', () => {
    const r = montarRetiradaSociaInsert({ ...base, tipo: 'retirada', valorInput: '0' }, 'u1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro.length).toBeGreaterThan(0);
  });
  it('rejeita parcelado sem total de parcelas', () => {
    const r = montarRetiradaSociaInsert({
      ...base, tipo: 'emprestimo', valorInput: '1000', parcelado: true,
      totalParcelasInput: '', primeiraParcelaEm: '2026-09-10',
    }, 'u1');
    expect(r.ok).toBe(false);
  });
  it('rejeita parcelado com menos de 2 parcelas', () => {
    const r = montarRetiradaSociaInsert({
      ...base, tipo: 'emprestimo', valorInput: '1000', parcelado: true,
      totalParcelasInput: '1', primeiraParcelaEm: '2026-09-10',
    }, 'u1');
    expect(r.ok).toBe(false);
  });
  it('rejeita parcelado sem data da 1ª parcela', () => {
    const r = montarRetiradaSociaInsert({
      ...base, tipo: 'emprestimo', valorInput: '1000', parcelado: true,
      totalParcelasInput: '3', primeiraParcelaEm: '',
    }, 'u1');
    expect(r.ok).toBe(false);
  });
  it('descrição vazia vira null', () => {
    const r = montarRetiradaSociaInsert({ ...base, descricao: '  ', tipo: 'retirada', valorInput: '10' }, 'u1');
    if (r.ok) expect(r.payload.descricao).toBeNull();
  });
});

describe('montarDevolucaoInsert', () => {
  it('monta payload de devolução', () => {
    expect(montarDevolucaoInsert('r1', 'e1', '150,00', '2026-08-30', 'dinheiro')).toEqual({
      ok: true, payload: { retirada_id: 'r1', empresa_id: 'e1', valor: 150, data: '2026-08-30', metodo: 'dinheiro' },
    });
  });
  it('rejeita valor invalido', () => {
    expect(montarDevolucaoInsert('r1', 'e1', 'abc', '2026-08-30', null).ok).toBe(false);
  });
  it('rejeita valor zero', () => {
    expect(montarDevolucaoInsert('r1', 'e1', '0', '2026-08-30', null).ok).toBe(false);
  });
});
