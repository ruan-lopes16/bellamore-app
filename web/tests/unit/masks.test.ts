import { describe, it, expect } from 'vitest';
import { digits, maskPhone, maskCNPJ, maskCPF, maskCEP } from '@/lib/masks';

describe('digits', () => {
  it('remove caracteres não numéricos', () => {
    expect(digits('(11) 98765-4321')).toBe('11987654321');
    expect(digits('12.345.678/0001-95')).toBe('12345678000195');
    expect(digits('abc123def')).toBe('123');
  });

  it('retorna string vazia para entrada sem dígitos', () => {
    expect(digits('')).toBe('');
    expect(digits('abc')).toBe('');
  });
});

describe('maskPhone', () => {
  it('formata celular (11 dígitos)', () => {
    expect(maskPhone('11987654321')).toBe('(11) 98765-4321');
  });

  it('formata telefone fixo (10 dígitos)', () => {
    expect(maskPhone('1133334444')).toBe('(11) 3333-4444');
  });

  it('formata parcialmente durante digitação', () => {
    expect(maskPhone('11')).toBe('(11');
    expect(maskPhone('119')).toBe('(11) 9');
    expect(maskPhone('11987')).toBe('(11) 987');
    expect(maskPhone('119876')).toBe('(11) 9876');
    expect(maskPhone('1198765')).toBe('(11) 9876-5');
  });

  it('aceita entrada já formatada (idempotente)', () => {
    expect(maskPhone('(11) 98765-4321')).toBe('(11) 98765-4321');
    expect(maskPhone('(11) 3333-4444')).toBe('(11) 3333-4444');
  });

  it('retorna string vazia para entrada vazia', () => {
    expect(maskPhone('')).toBe('');
  });

  it('ignora dígitos além de 11', () => {
    expect(maskPhone('119876543211234')).toBe('(11) 98765-4321');
  });
});

describe('maskCNPJ', () => {
  it('formata CNPJ completo', () => {
    expect(maskCNPJ('12345678000195')).toBe('12.345.678/0001-95');
  });

  it('formata parcialmente durante digitação', () => {
    expect(maskCNPJ('12')).toBe('12');
    expect(maskCNPJ('123')).toBe('12.3');
    expect(maskCNPJ('12345')).toBe('12.345');
    expect(maskCNPJ('123456')).toBe('12.345.6');
    expect(maskCNPJ('12345678')).toBe('12.345.678');
    expect(maskCNPJ('123456780001')).toBe('12.345.678/0001');
  });

  it('aceita entrada já formatada (idempotente)', () => {
    expect(maskCNPJ('12.345.678/0001-95')).toBe('12.345.678/0001-95');
  });

  it('ignora dígitos além de 14', () => {
    expect(maskCNPJ('123456780001951234')).toBe('12.345.678/0001-95');
  });
});

describe('maskCPF', () => {
  it('formata CPF completo', () => {
    expect(maskCPF('12345678909')).toBe('123.456.789-09');
  });

  it('formata parcialmente durante digitação', () => {
    expect(maskCPF('123')).toBe('123');
    expect(maskCPF('1234')).toBe('123.4');
    expect(maskCPF('123456')).toBe('123.456');
    expect(maskCPF('1234567')).toBe('123.456.7');
    expect(maskCPF('123456789')).toBe('123.456.789');
    expect(maskCPF('12345678909')).toBe('123.456.789-09');
  });

  it('aceita entrada já formatada (idempotente)', () => {
    expect(maskCPF('123.456.789-09')).toBe('123.456.789-09');
  });
});

describe('maskCEP', () => {
  it('formata CEP completo', () => {
    expect(maskCEP('01310100')).toBe('01310-100');
  });

  it('formata parcialmente durante digitação', () => {
    expect(maskCEP('0131')).toBe('0131');
    expect(maskCEP('01310')).toBe('01310');
    expect(maskCEP('013101')).toBe('01310-1');
  });

  it('aceita entrada já formatada (idempotente)', () => {
    expect(maskCEP('01310-100')).toBe('01310-100');
  });

  it('ignora dígitos além de 8', () => {
    expect(maskCEP('013101001234')).toBe('01310-100');
  });
});
