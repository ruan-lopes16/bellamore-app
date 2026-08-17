import { describe, expect, it } from 'vitest';
import {
  buildDespesaPagamentoUpdate,
  calcularRecorrenciaAtePorParcelas,
  clampParcelaAtual,
  diasParaVencimento,
  formatValorMonetarioInput,
  parseValorMonetario,
  progressoVencimento,
  proximaParcelaAtual,
  recorrenciaAindaAtiva,
  templatesRecorrentesParaLancar,
} from '@shared/despesas';

describe('despesas helpers', () => {
  it('converte valores monetarios com virgula, ponto e prefixo de moeda', () => {
    expect(parseValorMonetario('125,90')).toBe(125.9);
    expect(parseValorMonetario('125.90')).toBe(125.9);
    expect(parseValorMonetario('1.250')).toBe(1250);
    expect(parseValorMonetario('R$ 1.250,90')).toBe(1250.9);
  });

  it('rejeita valores vazios, zerados ou invalidos', () => {
    expect(parseValorMonetario('')).toBeNull();
    expect(parseValorMonetario('0')).toBeNull();
    expect(parseValorMonetario('abc')).toBeNull();
  });

  it('monta payload de pagamento com valor editado apenas para o lancamento mensal', () => {
    expect(buildDespesaPagamentoUpdate('2026-07-08', '980,50')).toEqual({
      status: 'pago',
      data_pagamento: '2026-07-08',
      valor: 980.5,
    });
  });

  it('formata valor numerico para input monetario editavel', () => {
    expect(formatValorMonetarioInput(980.5)).toBe('980,50');
  });

  it('considera recorrencia sem data de termino sempre ativa', () => {
    expect(recorrenciaAindaAtiva(null, '2026-08-01')).toBe(true);
    expect(recorrenciaAindaAtiva(undefined, '2026-08-01')).toBe(true);
  });

  it('considera ativa quando o termino cai no mes visualizado ou depois', () => {
    expect(recorrenciaAindaAtiva('2026-08-01', '2026-08-01')).toBe(true);
    expect(recorrenciaAindaAtiva('2026-08-15', '2026-08-01')).toBe(true);
    expect(recorrenciaAindaAtiva('2026-12-01', '2026-08-01')).toBe(true);
  });

  it('considera encerrada quando o termino ja passou antes do mes visualizado', () => {
    expect(recorrenciaAindaAtiva('2026-07-31', '2026-08-01')).toBe(false);
    expect(recorrenciaAindaAtiva('2026-01-01', '2026-08-01')).toBe(false);
  });

  it('calcula dias restantes ate o vencimento (negativo quando atrasada)', () => {
    expect(diasParaVencimento('2026-08-15', '2026-08-07')).toBe(8);
    expect(diasParaVencimento('2026-08-07', '2026-08-07')).toBe(0);
    expect(diasParaVencimento('2026-08-01', '2026-08-07')).toBe(-6);
  });

  it('calcula o progresso entre a criacao e o vencimento, limitado entre 0 e 1', () => {
    expect(progressoVencimento('2026-08-01T10:00:00.000Z', '2026-08-11', '2026-08-06')).toBe(0.5);
    expect(progressoVencimento('2026-08-01T10:00:00.000Z', '2026-08-11', '2026-07-30')).toBe(0);
    expect(progressoVencimento('2026-08-01T10:00:00.000Z', '2026-08-11', '2026-08-20')).toBe(1);
  });

  it('nao divide por zero quando o vencimento e anterior ou igual a criacao', () => {
    expect(progressoVencimento('2026-08-05T00:00:00.000Z', '2026-08-05', '2026-08-05')).toBe(1);
    expect(progressoVencimento('2026-08-05T00:00:00.000Z', '2026-08-01', '2026-08-05')).toBe(1);
  });

  describe('templatesRecorrentesParaLancar', () => {
    const base = { descricao: 'Aluguel', categoria: 'Fixo', valor: 1500, periodicidade: 'mensal' };

    it('nao revive uma recorrencia encerrada por causa de uma linha antiga sem data de termino', () => {
      // Historico vem "mais recente primeiro" (mesma ordem da query real,
      // .order('data_vencimento', { ascending: false })). A linha mais recente
      // ja tem recorrencia_ate no passado (encerrada antes do mes visualizado);
      // a linha mais antiga nunca teve data de termino e sozinha pareceria ativa.
      // Filtrar antes de agrupar deixaria a linha antiga "ganhar" a chave e
      // reviver a recorrencia — o bug que este teste trava.
      const historico = [
        { ...base, data_vencimento: '2026-07-05', recorrencia_ate: '2026-06-30' },
        { ...base, data_vencimento: '2026-06-05', recorrencia_ate: undefined },
      ];

      const resultado = templatesRecorrentesParaLancar(historico, new Set(), '2026-08-01');

      expect(resultado).toEqual([]);
    });

    it('lanca o template mais recente quando sua recorrencia ainda esta ativa', () => {
      const semTermino = [
        { ...base, data_vencimento: '2026-07-05', recorrencia_ate: undefined },
        { ...base, data_vencimento: '2026-06-05', recorrencia_ate: '2026-06-01' },
      ];
      expect(templatesRecorrentesParaLancar(semTermino, new Set(), '2026-08-01')).toEqual([
        { ...base, data_vencimento: '2026-07-05', recorrencia_ate: undefined },
      ]);

      const terminoFuturo = [
        { ...base, data_vencimento: '2026-07-05', recorrencia_ate: '2026-12-01' },
        { ...base, data_vencimento: '2026-06-05', recorrencia_ate: '2026-06-01' },
      ];
      expect(templatesRecorrentesParaLancar(terminoFuturo, new Set(), '2026-08-01')).toEqual([
        { ...base, data_vencimento: '2026-07-05', recorrencia_ate: '2026-12-01' },
      ]);
    });

    it('exclui template cuja despesa ja existe no mes atual, mesmo com recorrencia ativa', () => {
      const historico = [
        { ...base, data_vencimento: '2026-07-05', recorrencia_ate: undefined },
      ];
      const chavesMesAtual = new Set(['Aluguel||Fixo']);

      const resultado = templatesRecorrentesParaLancar(historico, chavesMesAtual, '2026-08-01');

      expect(resultado).toEqual([]);
    });
  });

  describe('calcularRecorrenciaAtePorParcelas', () => {
    it('contrato novo: parcela 1 de 12, conta 11 meses a partir do vencimento', () => {
      expect(calcularRecorrenciaAtePorParcelas('2026-08-13', 12, 1)).toBe('2027-07-13');
    });

    it('contrato ja em andamento: parcela 5 de 12, conta 7 meses a partir do vencimento (exemplo do pedido original)', () => {
      expect(calcularRecorrenciaAtePorParcelas('2026-08-13', 12, 5)).toBe('2027-03-13');
    });

    it('ultima parcela: parcela atual igual ao total, recorrencia_ate e o proprio vencimento', () => {
      expect(calcularRecorrenciaAtePorParcelas('2026-08-13', 12, 12)).toBe('2026-08-13');
    });

    it('faz o clamp do dia quando o mes calculado tem menos dias (31 de janeiro + 1 mes cai em fevereiro)', () => {
      expect(calcularRecorrenciaAtePorParcelas('2026-01-31', 2, 1)).toBe('2026-02-28');
    });

    it('atravessa a virada de ano corretamente', () => {
      expect(calcularRecorrenciaAtePorParcelas('2026-11-10', 6, 4)).toBe('2027-01-10');
    });

    it('clampa parcela atual maior que o total em vez de gerar data invalida', () => {
      expect(calcularRecorrenciaAtePorParcelas('2026-01-15', 3, 4)).toBe('2026-01-15');
    });
  });

  describe('clampParcelaAtual', () => {
    it('clampa para o total quando parcela atual excede o total', () => {
      expect(clampParcelaAtual(15, 12)).toBe(12);
    });

    it('clampa para 1 quando parcela atual e menor que 1', () => {
      expect(clampParcelaAtual(0, 12)).toBe(1);
    });
  });

  describe('proximaParcelaAtual', () => {
    it('mes seguinte sem pular: incrementa em 1', () => {
      expect(proximaParcelaAtual(5, 12, '2026-08-13', 2026, 9)).toBe(6);
    });

    it('pulando um mes: incrementa pelos meses realmente decorridos', () => {
      expect(proximaParcelaAtual(6, 12, '2026-09-13', 2026, 11)).toBe(8);
    });

    it('faz o clamp no total quando os meses pulados ultrapassariam o total de parcelas', () => {
      expect(proximaParcelaAtual(11, 12, '2027-02-13', 2027, 4)).toBe(12);
    });

    it('atravessa a virada de ano corretamente', () => {
      expect(proximaParcelaAtual(10, 12, '2026-11-13', 2027, 1)).toBe(12);
    });
  });
});
