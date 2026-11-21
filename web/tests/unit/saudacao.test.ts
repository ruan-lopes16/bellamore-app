import { describe, expect, it } from 'vitest';
import { primeiroNome, saudacao } from '@shared/saudacao';

// Brasília = UTC-3: 12:00Z = 09:00 BRT.
const utc = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 21, h, m));

describe('saudacao', () => {
  it('bom dia das 5h às 11h59 (Brasília)', () => {
    expect(saudacao('Ana', utc(8))).toBe('Bom dia, Ana');       // 05:00 BRT
    expect(saudacao('Ana', utc(14, 59))).toBe('Bom dia, Ana');  // 11:59 BRT
  });
  it('boa tarde das 12h às 17h59', () => {
    expect(saudacao('Ana', utc(15))).toBe('Boa tarde, Ana');    // 12:00 BRT
    expect(saudacao('Ana', utc(20, 59))).toBe('Boa tarde, Ana'); // 17:59 BRT
  });
  it('boa noite no resto, inclusive madrugada', () => {
    expect(saudacao('Ana', utc(21))).toBe('Boa noite, Ana');    // 18:00 BRT
    expect(saudacao('Ana', utc(5))).toBe('Boa noite, Ana');     // 02:00 BRT
    expect(saudacao('Ana', utc(7, 59))).toBe('Boa noite, Ana'); // 04:59 BRT
  });
  it('usa a hora de Brasília, não a do servidor (UTC já virou o dia)', () => {
    expect(saudacao('Ana', utc(2))).toBe('Boa noite, Ana');     // 23:00 BRT do dia anterior
  });
  it('sem nome devolve só a saudação', () => {
    expect(saudacao(null, utc(15))).toBe('Boa tarde');
    expect(saudacao('  ', utc(15))).toBe('Boa tarde');
  });
  it('primeiroNome', () => {
    expect(primeiroNome('Ana Paula Souza')).toBe('Ana');
    expect(primeiroNome('  ')).toBeNull();
    expect(primeiroNome(null)).toBeNull();
  });
});
