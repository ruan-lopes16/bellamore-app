import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { maskPhone, toWhatsApp, digits } from '@shared/mascaras';
import {
  parseEndereco, serializarEndereco, montarAniversario, partesAniversario,
  idadeCliente, formatarAniversario,
} from '@shared/clientes';

describe('shared/mascaras', () => {
  it('maskPhone formata celular e fixo', () => {
    expect(maskPhone('11987654321')).toBe('(11) 98765-4321');
    expect(maskPhone('1133334444')).toBe('(11) 3333-4444');
  });
  it('toWhatsApp não duplica o DDI 55', () => {
    expect(toWhatsApp('(34) 99178-0000')).toBe('5534991780000');
    expect(toWhatsApp('+55 34 99178-0000')).toBe('5534991780000');
  });
  it('web/lib/masks reexporta de shared (fonte única)', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'lib', 'masks.ts'), 'utf8');
    expect(src).toContain("from '@shared/mascaras'");
    expect(src).not.toMatch(/export function maskPhone/);
    expect(digits('a1b2')).toBe('12');
  });
});

describe('shared/clientes — endereço', () => {
  it('lê JSON do web', () => {
    expect(parseEndereco('{"logradouro":"Rua A","numero":"10","bairro":"Centro"}'))
      .toEqual({ logradouro: 'Rua A', numero: '10', bairro: 'Centro', complemento: '' });
  });
  it('texto livre legado vira logradouro', () => {
    expect(parseEndereco('Rua B, 5')).toEqual({ logradouro: 'Rua B, 5', numero: '', bairro: '', complemento: '' });
  });
  it('vazio e nulo', () => {
    expect(parseEndereco(null)).toEqual({ logradouro: '', numero: '', bairro: '', complemento: '' });
  });
  it('serializa só quando há conteúdo', () => {
    expect(serializarEndereco({ logradouro: '', numero: '', bairro: '', complemento: '' })).toBeNull();
    expect(JSON.parse(serializarEndereco({ logradouro: ' Rua A ', numero: '1', bairro: '', complemento: '' })!))
      .toEqual({ logradouro: 'Rua A', numero: '1', bairro: '', complemento: '' });
  });
});

describe('shared/clientes — aniversário (formato 1900-MM-DD)', () => {
  it('monta só com mês e dia', () => {
    expect(montarAniversario('3', '7')).toBe('1900-03-07');
    expect(montarAniversario('', '7')).toBeNull();
  });
  it('partes de uma data gravada', () => {
    expect(partesAniversario('1900-03-07')).toEqual({ mes: '03', dia: '07' });
    expect(partesAniversario('1990-12-25')).toEqual({ mes: '12', dia: '25' });
    expect(partesAniversario(null)).toEqual({ mes: '', dia: '' });
  });
  it('idade só quando o ano é real (> 1905)', () => {
    const hoje = new Date(2026, 8, 29);
    expect(idadeCliente('1900-03-07', hoje)).toBeNull();
    expect(idadeCliente('1990-12-25', hoje)).toBe(35);
    expect(idadeCliente('1990-09-29', hoje)).toBe(36);
  });
  it('formata dd/MM sem deslocar fuso', () => {
    expect(formatarAniversario('1900-03-07')).toBe('07/03');
    expect(formatarAniversario(undefined)).toBe('');
  });
});
