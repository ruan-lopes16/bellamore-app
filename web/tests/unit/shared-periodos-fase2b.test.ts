import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  chaveDiaBRT, chaveMesBRT, contemInstante, instanteMs, limitesDias, limitesMes,
  PERIODOS_COMISSAO, limitesPeriodoComissao, rotuloPeriodoComissao, rotuloDiaCurto, rotuloMesAno,
  rotuloDiaExtenso, rotuloDataBR, gradeCalendarioMes, rotuloIntervaloMes, chaveDiaExibido, horaBRT,
  rotuloDataHoraBRT, DIAS_SEMANA_ABREV, type PeriodoComissao,
} from '@shared/periodos';

describe('instante sem fuso é UTC (não depende do fuso do aparelho)', () => {
  const tz = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'America/Sao_Paulo'; });
  afterAll(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; });
  it('instanteMs', () => {
    expect(instanteMs('2026-10-01T02:30:00')).toBe(Date.parse('2026-10-01T02:30:00Z'));
    expect(instanteMs('2026-10-01 02:30:00')).toBe(Date.parse('2026-10-01T02:30:00Z'));
    expect(instanteMs('2026-10-01T02:30:00.123')).toBe(Date.parse('2026-10-01T02:30:00.123Z'));
    expect(instanteMs('2026-10-01T02:30:00+00:00')).toBe(Date.parse('2026-10-01T02:30:00Z'));
    expect(instanteMs('2026-10-01T02:30:00-03:00')).toBe(Date.parse('2026-10-01T05:30:00Z'));
  });
  it('chaveDiaBRT, chaveMesBRT e contemInstante usam a mesma leitura', () => {
    expect(chaveDiaBRT('2026-10-01T02:30:00')).toBe('2026-09-30');
    expect(chaveMesBRT('2026-10-01 02:30:00')).toBe('2026-09');
    expect(contemInstante(limitesMes('2026-09'), '2026-10-01T02:59:59')).toBe(true);
    expect(contemInstante(limitesMes('2026-09'), '2026-10-01T03:00:00')).toBe(false);
    expect(chaveDiaBRT('2026-09-30')).toBe('2026-09-30');
  });
});

describe('períodos de comissão — lista única, calendário, navegação', () => {
  const hoje = '2026-09-30'; // quarta
  const ini = (p: PeriodoComissao, d: number, h = hoje) => {
    const l = limitesPeriodoComissao(p, h, d); return [l.startDate, l.endDate];
  };
  it('lista única', () => {
    expect(PERIODOS_COMISSAO.map(p => p.key)).toEqual(['dia', 'semana', 'mes', 'trimestre', 'semestre', 'ano']);
    expect(PERIODOS_COMISSAO.map(p => p.label)).toEqual(['Dia', 'Semana', 'Mês', 'Trimestre', 'Semestre', 'Ano']);
  });
  it('dia, semana (domingo), mês', () => {
    expect(limitesPeriodoComissao('dia', hoje)).toEqual(limitesDias(hoje, hoje));
    expect(ini('dia', -30)).toEqual(['2026-08-31', '2026-08-31']);
    expect(ini('semana', 0)).toEqual(['2026-09-27', '2026-10-03']);
    expect(ini('semana', -1)).toEqual(['2026-09-20', '2026-09-26']);
    expect(limitesPeriodoComissao('mes', hoje)).toEqual(limitesMes('2026-09'));
    expect(limitesPeriodoComissao('mes', hoje, -9)).toEqual(limitesMes('2025-12'));
  });
  it('trimestre, semestre e ano de calendário', () => {
    expect(ini('trimestre', 0)).toEqual(['2026-07-01', '2026-09-30']);
    expect(ini('trimestre', -1)).toEqual(['2026-04-01', '2026-06-30']);
    expect(ini('trimestre', -3)).toEqual(['2025-10-01', '2025-12-31']);
    expect(ini('trimestre', 0, '2026-10-01')).toEqual(['2026-10-01', '2026-12-31']);
    expect(ini('semestre', 0)).toEqual(['2026-07-01', '2026-12-31']);
    expect(ini('semestre', -1)).toEqual(['2026-01-01', '2026-06-30']);
    expect(ini('semestre', -2)).toEqual(['2025-07-01', '2025-12-31']);
    expect(ini('ano', -1)).toEqual(['2025-01-01', '2025-12-31']);
  });
  it('rótulos', () => {
    const r = (p: PeriodoComissao, d = 0) => rotuloPeriodoComissao(p, limitesPeriodoComissao(p, hoje, d));
    expect(r('dia')).toBe('Qua, 30 de set 2026');
    expect(r('semana')).toBe('27/09 – 03/10/2026');
    expect(r('mes')).toBe('Setembro 2026');
    expect(r('trimestre')).toBe('3º Trimestre 2026');
    expect(r('semestre')).toBe('2º Semestre 2026');
    expect(r('semestre', -1)).toBe('1º Semestre 2026');
    expect(r('ano')).toBe('2026');
  });
});

describe('rótulos, calendário e horas', () => {
  it('rótulos curtos', () => {
    expect(DIAS_SEMANA_ABREV).toEqual(['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']);
    expect(rotuloDiaCurto('2026-09-27')).toBe('Dom, 27 de set');
    expect(rotuloMesAno('2026-03')).toBe('Março 2026');
    expect(rotuloDiaExtenso('2026-07-16')).toBe('16 de julho de 2026');
    expect(rotuloDataBR('2026-09-05')).toBe('05/09/2026');
    expect(rotuloIntervaloMes('2026-07')).toBe('01/07 - 31/07');
    expect(rotuloIntervaloMes('2028-02')).toBe('01/02 - 29/02');
  });
  it('grade de 6 semanas começando no domingo', () => {
    const g = gradeCalendarioMes('2026-07', '2026-07-16');
    expect(g).toHaveLength(42);
    expect(g[0]).toEqual({ dia: '2026-06-28', numero: 28, foraDoMes: true, destacado: false });
    expect(g[41].dia).toBe('2026-08-08');
    expect(g.find(c => c.destacado)?.dia).toBe('2026-07-16');
    expect(g.filter(c => !c.foraDoMes)).toHaveLength(31);
    expect(gradeCalendarioMes('2026-11')[0].dia).toBe('2026-11-01');
  });
  it('dia exibido e horas em Brasília', () => {
    expect(chaveDiaExibido(new Date(2026, 6, 16, 23, 0))).toBe('2026-07-16');
    expect(horaBRT('2026-09-30T12:05:00Z')).toBe('09:05');
    expect(horaBRT('2026-10-01T02:30:00+00:00')).toBe('23:30');
    expect(rotuloDataHoraBRT('2026-10-01T02:30:00Z')).toBe('30/09 às 23:30');
  });
});
