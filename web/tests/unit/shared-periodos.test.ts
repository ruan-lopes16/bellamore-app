import { describe, expect, it } from 'vitest';
import {
  limitesMes, limitesDias, getMonthQueryBounds, chaveMesBRT, chaveDiaBRT, hojeBRT,
  contemInstante, contemData, somarMeses, somarDias, ultimoDiaDoMes, uniaoLimites,
  mesesDoIntervalo, mesesInteirosDoIntervalo, limitesDoPeriodo, PERIODOS_RELATORIO,
  rotuloDoPeriodo, rotuloMesCurto, diaDaSemana,
} from '@shared/periodos';

describe('limites do mês em Brasília (UTC−3 fixo)', () => {
  it('setembro/2026 vai de 01/09 00:00 BRT a 30/09 23:59:59.999 BRT', () => {
    expect(limitesMes('2026-09')).toEqual({
      startIso: '2026-09-01T03:00:00.000Z',
      endIso: '2026-10-01T02:59:59.999Z',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
  });
  it('dezembro vira o ano e fevereiro bissexto tem 29 dias', () => {
    expect(limitesMes('2026-12').endIso).toBe('2027-01-01T02:59:59.999Z');
    expect(limitesMes('2028-02').endDate).toBe('2028-02-29');
    expect(ultimoDiaDoMes('2026-02')).toBe('2026-02-28');
  });
  it('getMonthQueryBounds usa o mês exibido na tela (compatível com o antigo web/lib)', () => {
    const b = getMonthQueryBounds(new Date(2026, 0, 15));
    expect(b.startDate).toBe('2026-01-01');
    expect(b.endDate).toBe('2026-01-31');
    expect(b.startIso).toBe('2026-01-01T03:00:00.000Z');
  });
  it('limites de um dia só', () => {
    expect(limitesDias('2026-09-30', '2026-09-30')).toEqual({
      startIso: '2026-09-30T03:00:00.000Z',
      endIso: '2026-10-01T02:59:59.999Z',
      startDate: '2026-09-30',
      endDate: '2026-09-30',
    });
  });
});

describe('fronteira das 21:00–23:59 do último dia do mês (BRT)', () => {
  const set = limitesMes('2026-09');
  it('30/09 21:00 e 23:59:59 BRT ainda são setembro', () => {
    expect(chaveMesBRT('2026-10-01T00:00:00.000Z')).toBe('2026-09');
    expect(chaveMesBRT('2026-10-01T02:59:59+00:00')).toBe('2026-09');
    expect(contemInstante(set, '2026-10-01T02:59:59.999Z')).toBe(true);
  });
  it('01/10 00:00 BRT já é outubro', () => {
    expect(chaveMesBRT('2026-10-01T03:00:00Z')).toBe('2026-10');
    expect(contemInstante(set, '2026-10-01T03:00:00.000Z')).toBe(false);
  });
  it('01/09 antes das 03:00 UTC ainda é agosto', () => {
    expect(chaveMesBRT('2026-09-01T02:59:59Z')).toBe('2026-08');
    expect(contemInstante(set, '2026-09-01T02:59:59Z')).toBe(false);
  });
  it('coluna date (yyyy-MM-dd) não sofre fuso', () => {
    expect(chaveDiaBRT('2026-09-30')).toBe('2026-09-30');
    expect(contemData(set, '2026-09-30')).toBe(true);
    expect(contemData(set, '2026-10-01')).toBe(false);
    expect(contemData(set, null)).toBe(false);
    expect(contemInstante(set, null)).toBe(false);
  });
  it('hojeBRT à 01:00 UTC ainda é o dia anterior', () => {
    expect(hojeBRT(new Date('2026-10-01T01:00:00Z'))).toBe('2026-09-30');
  });
});

describe('aritmética de datas em string', () => {
  it('somarMeses e somarDias atravessam o ano', () => {
    expect(somarMeses('2026-01', -1)).toBe('2025-12');
    expect(somarMeses('2026-12', 1)).toBe('2027-01');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('dia da semana (0 = domingo)', () => {
    expect(diaDaSemana('2026-09-27')).toBe(0);
    expect(diaDaSemana('2026-09-30')).toBe(3);
  });
  it('meses do intervalo e meses cobertos por inteiro', () => {
    const l = limitesDias('2026-07-15', '2026-09-02');
    expect(mesesDoIntervalo(l)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(mesesInteirosDoIntervalo(l)).toEqual(['2026-08']);
    expect(mesesInteirosDoIntervalo(limitesMes('2026-09'))).toEqual(['2026-09']);
  });
  it('união de limites', () => {
    expect(uniaoLimites(limitesMes('2026-09'), limitesMes('2026-08')))
      .toEqual(limitesDias('2026-08-01', '2026-09-30'));
  });
});

describe('períodos dos relatórios — lista única, semana no domingo', () => {
  const hoje = '2026-09-30'; // quarta-feira
  it('lista única nas duas plataformas', () => {
    expect(PERIODOS_RELATORIO.map(p => p.key))
      .toEqual(['hoje', 'semana', 'mes', 'mes_anterior', 'trimestre', 'semestre', 'ano', 'custom']);
  });
  it('hoje × ontem', () => {
    const { atual, anterior } = limitesDoPeriodo('hoje', hoje);
    expect(atual).toEqual(limitesDias('2026-09-30', '2026-09-30'));
    expect(anterior).toEqual(limitesDias('2026-09-29', '2026-09-29'));
  });
  it('semana começa no domingo; deslocamento volta semanas inteiras', () => {
    const { atual, anterior } = limitesDoPeriodo('semana', hoje);
    expect([atual.startDate, atual.endDate]).toEqual(['2026-09-27', '2026-10-03']);
    expect([anterior.startDate, anterior.endDate]).toEqual(['2026-09-20', '2026-09-26']);
    expect(limitesDoPeriodo('semana', hoje, { semanaOffset: -1 }).atual.startDate).toBe('2026-09-20');
    expect(limitesDoPeriodo('semana', '2026-09-27').atual.startDate).toBe('2026-09-27');
  });
  it('mês e mês anterior', () => {
    expect(limitesDoPeriodo('mes', hoje).atual).toEqual(limitesMes('2026-09'));
    expect(limitesDoPeriodo('mes', hoje).anterior).toEqual(limitesMes('2026-08'));
    expect(limitesDoPeriodo('mes_anterior', hoje).atual).toEqual(limitesMes('2026-08'));
    expect(limitesDoPeriodo('mes_anterior', hoje).anterior).toEqual(limitesMes('2026-07'));
  });
  it('3 meses e 6 meses = mês atual + anteriores; comparação com o bloco imediatamente antes', () => {
    const tri = limitesDoPeriodo('trimestre', hoje);
    expect([tri.atual.startDate, tri.atual.endDate]).toEqual(['2026-07-01', '2026-09-30']);
    expect([tri.anterior.startDate, tri.anterior.endDate]).toEqual(['2026-04-01', '2026-06-30']);
    const sem = limitesDoPeriodo('semestre', hoje);
    expect([sem.atual.startDate, sem.atual.endDate]).toEqual(['2026-04-01', '2026-09-30']);
    expect([sem.anterior.startDate, sem.anterior.endDate]).toEqual(['2025-10-01', '2026-03-31']);
  });
  it('ano com deslocamento', () => {
    const { atual, anterior } = limitesDoPeriodo('ano', hoje, { anoOffset: -1 });
    expect([atual.startDate, atual.endDate]).toEqual(['2025-01-01', '2025-12-31']);
    expect([anterior.startDate, anterior.endDate]).toEqual(['2024-01-01', '2024-12-31']);
  });
  it('personalizado: anterior = mesmo nº de dias imediatamente antes; fim limitado a hoje', () => {
    const { atual, anterior } = limitesDoPeriodo('custom', hoje, { custom: { ini: '2026-09-10', fim: '2026-09-19' } });
    expect([atual.startDate, atual.endDate]).toEqual(['2026-09-10', '2026-09-19']);
    expect([anterior.startDate, anterior.endDate]).toEqual(['2026-08-31', '2026-09-09']);
    expect(limitesDoPeriodo('custom', hoje, { custom: { ini: '2026-09-10', fim: '2026-12-01' } }).atual.endDate)
      .toBe('2026-09-30');
    expect(limitesDoPeriodo('custom', hoje, { custom: { ini: '2026-10-05', fim: '2026-09-20' } }).atual.startDate)
      .toBe('2026-09-20');
  });
});

describe('rótulos iguais nas duas plataformas', () => {
  it('rotuloMesCurto e rotuloDoPeriodo', () => {
    expect(rotuloMesCurto('2026-09')).toBe('set');
    expect(rotuloDoPeriodo('mes', limitesMes('2026-09'))).toBe('setembro 2026');
    expect(rotuloDoPeriodo('semana', limitesDias('2026-09-27', '2026-10-03'))).toBe('27/09 – 03/10');
    expect(rotuloDoPeriodo('trimestre', limitesDias('2026-07-01', '2026-09-30'))).toBe('jul – set 2026');
    expect(rotuloDoPeriodo('ano', limitesDias('2026-01-01', '2026-12-31'))).toBe('2026');
    expect(rotuloDoPeriodo('custom', limitesDias('2026-09-10', '2026-09-19'))).toBe('10/09/2026 – 19/09/2026');
    expect(rotuloDoPeriodo('hoje', limitesDias('2026-09-30', '2026-09-30'))).toBe('30/09/2026');
  });
});
