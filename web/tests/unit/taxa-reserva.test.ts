import { describe, expect, it } from 'vitest';
import {
  aplicarDescontoReserva,
  buildTaxaReservaInsert,
  somarTaxasReservaPagas,
} from '@shared/taxa-reserva';

describe('taxa de reserva helpers', () => {
  describe('buildTaxaReservaInsert', () => {
    const base = { empresaId: 'emp1', agendamentoId: 'ag1', clienteId: 'cli1', valor: 50 };

    it('retorna null quando o valor e zero ou negativo', () => {
      expect(buildTaxaReservaInsert({ ...base, valor: 0, jaCobrada: false }, '2026-08-12T10:00:00.000Z')).toBeNull();
      expect(buildTaxaReservaInsert({ ...base, valor: -5, jaCobrada: true }, '2026-08-12T10:00:00.000Z')).toBeNull();
    });

    it('marca como paga com paga_em quando ja foi cobrada', () => {
      expect(buildTaxaReservaInsert({ ...base, jaCobrada: true }, '2026-08-12T10:00:00.000Z')).toEqual({
        empresa_id: 'emp1',
        agendamento_id: 'ag1',
        cliente_id: 'cli1',
        valor: 50,
        status: 'pago',
        paga_em: '2026-08-12T10:00:00.000Z',
        metodo: null,
      });
    });

    it('marca como pendente sem paga_em quando ainda nao foi cobrada', () => {
      expect(buildTaxaReservaInsert({ ...base, jaCobrada: false }, '2026-08-12T10:00:00.000Z')).toEqual({
        empresa_id: 'emp1',
        agendamento_id: 'ag1',
        cliente_id: 'cli1',
        valor: 50,
        status: 'pendente',
        paga_em: null,
        metodo: null,
      });
    });

    it('grava o metodo quando informado junto com ja foi cobrada', () => {
      expect(buildTaxaReservaInsert({ ...base, jaCobrada: true, metodo: 'pix' }, '2026-08-12T10:00:00.000Z'))
        .toMatchObject({ status: 'pago', metodo: 'pix' });
    });

    it('descarta o metodo quando a taxa nasce pendente (ainda nao foi cobrada)', () => {
      // Um metodo so faz sentido para um pagamento que ja aconteceu — gravar
      // metodo numa linha 'pendente' sugeriria uma cobranca que nao existe.
      expect(buildTaxaReservaInsert({ ...base, jaCobrada: false, metodo: 'pix' }, '2026-08-12T10:00:00.000Z'))
        .toMatchObject({ status: 'pendente', metodo: null });
    });
  });

  describe('somarTaxasReservaPagas', () => {
    it('soma so as taxas cujo agendamento esta na lista informada', () => {
      const taxas = [
        { agendamento_id: 'a1', valor: 30 },
        { agendamento_id: 'a3', valor: 20 },
      ];
      expect(somarTaxasReservaPagas(['a1', 'a2'], taxas)).toBe(30);
    });

    it('soma multiplas taxas quando varios agendamentos da comanda tem taxa paga', () => {
      const taxas = [
        { agendamento_id: 'a1', valor: 30 },
        { agendamento_id: 'a2', valor: 20 },
      ];
      expect(somarTaxasReservaPagas(['a1', 'a2'], taxas)).toBe(50);
    });

    it('retorna zero quando nao ha ids ou nao ha taxas', () => {
      expect(somarTaxasReservaPagas([], [{ agendamento_id: 'a1', valor: 30 }])).toBe(0);
      expect(somarTaxasReservaPagas(['a1'], [])).toBe(0);
    });
  });

  describe('aplicarDescontoReserva', () => {
    it('desconta a taxa de reserva paga do total, exemplo do usuario (100 - 30 = 70)', () => {
      expect(aplicarDescontoReserva(100, 0, 30)).toEqual({ total: 70, descontoReservaAplicado: 30 });
    });

    it('limita o desconto de reserva ao que sobra depois do desconto manual', () => {
      expect(aplicarDescontoReserva(100, 80, 30)).toEqual({ total: 0, descontoReservaAplicado: 20 });
    });

    it('nunca deixa o total negativo quando a reserva paga e maior que o subtotal', () => {
      expect(aplicarDescontoReserva(50, 0, 80)).toEqual({ total: 0, descontoReservaAplicado: 50 });
    });

    it('nao aplica nada quando o subtotal ja e zero', () => {
      expect(aplicarDescontoReserva(0, 0, 30)).toEqual({ total: 0, descontoReservaAplicado: 0 });
    });
  });
});
