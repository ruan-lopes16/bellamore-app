import { afterEach, describe, expect, it } from 'vitest';
import {
  chaveDiaBRT, chaveMesBRT, getMonthQueryBounds, hojeBRT, limitesDias, limitesDoPeriodo, limitesMes,
} from '@shared/periodos';

/**
 * As funções de período usam UTC−3 fixo (Brasília) e não o fuso do processo. O setup do vitest fixa
 * TZ = America/Sao_Paulo; aqui o TZ é trocado em tempo de execução (Node relê a variável a cada
 * uso; funciona em Windows, Linux e macOS) e o resultado tem que ser idêntico em qualquer fuso.
 */
const TZ_ORIGINAL = process.env.TZ;
afterEach(() => { process.env.TZ = TZ_ORIGINAL; });

const AGORA = new Date('2026-09-30T02:30:00.000Z'); // 29/09 23:30 em Brasília, 30/09 em UTC
const INSTANTE = '2026-10-01T02:59:59.000Z';          // 30/09 23:59:59 em Brasília

function calcular() {
  return {
    mes: limitesMes('2026-09'),
    dias: limitesDias('2026-09-01', '2026-09-07'),
    mesDaData: getMonthQueryBounds(new Date(2026, 8, 15, 12)),
    hoje: hojeBRT(AGORA),
    dia: chaveDiaBRT(INSTANTE),
    chaveMes: chaveMesBRT(INSTANTE),
    periodo: limitesDoPeriodo('semana', hojeBRT(AGORA)),
  };
}

describe('shared/periodos não depende do fuso do processo', () => {
  it('o TZ do setup do vitest é Brasília e a troca em tempo de execução tem efeito', () => {
    process.env.TZ = 'America/Sao_Paulo';
    expect(new Date('2026-09-30T02:30:00.000Z').getHours()).toBe(23);
    process.env.TZ = 'UTC';
    expect(new Date('2026-09-30T02:30:00.000Z').getHours()).toBe(2);
  });

  it('com TZ=UTC dá os mesmos resultados que em Brasília, com instantes fixos', () => {
    process.env.TZ = 'America/Sao_Paulo';
    const brasilia = calcular();
    process.env.TZ = 'UTC';
    const utc = calcular();
    process.env.TZ = 'Asia/Tokyo';
    const toquio = calcular();

    expect(utc).toEqual(brasilia);
    expect(toquio).toEqual(brasilia);
    // Valores fixos, para não comparar só com o próprio resultado
    expect(utc.mes.startIso).toBe('2026-09-01T03:00:00.000Z');
    expect(utc.mes.endIso).toBe('2026-10-01T02:59:59.999Z');
    expect(utc.hoje).toBe('2026-09-29');
    expect(utc.dia).toBe('2026-09-30');
    expect(utc.chaveMes).toBe('2026-09');
  });
});
