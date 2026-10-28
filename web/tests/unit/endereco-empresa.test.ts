import { describe, expect, it } from 'vitest';
import {
  ENDERECO_EMPRESA_VAZIO, enderecoEmpresaEmLinha, lerEnderecoEmpresa, localidadeEndereco,
  serializarEnderecoEmpresa, type EnderecoEmpresa,
} from '@shared/endereco';

const completo: EnderecoEmpresa = {
  cep: '01310-100', rua: 'Av. Paulista', numero: '1000', complemento: 'Sala 5',
  bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP',
};

describe('serializarEnderecoEmpresa / lerEnderecoEmpresa', () => {
  it('ida e volta', () => {
    const s = serializarEnderecoEmpresa(completo);
    expect(typeof s).toBe('string');
    expect(JSON.parse(s!)).toEqual(completo);
    expect(lerEnderecoEmpresa(s)).toEqual(completo);
  });

  it('limpa espaços e põe a UF em maiúsculas', () => {
    const s = serializarEnderecoEmpresa({ ...ENDERECO_EMPRESA_VAZIO, rua: '  Rua A ', uf: ' sp ' });
    expect(lerEnderecoEmpresa(s)).toEqual({ ...ENDERECO_EMPRESA_VAZIO, rua: 'Rua A', uf: 'SP' });
  });

  it('tudo vazio → null', () => {
    expect(serializarEnderecoEmpresa({ ...ENDERECO_EMPRESA_VAZIO, rua: '   ' })).toBeNull();
  });

  it('vazio/nulo → endereço vazio (cópia nova a cada chamada)', () => {
    expect(lerEnderecoEmpresa(null)).toEqual(ENDERECO_EMPRESA_VAZIO);
    expect(lerEnderecoEmpresa('  ')).toEqual(ENDERECO_EMPRESA_VAZIO);
    expect(lerEnderecoEmpresa(undefined)).not.toBe(ENDERECO_EMPRESA_VAZIO);
  });

  it('JSON com campos faltando ou não-string não quebra', () => {
    expect(lerEnderecoEmpresa('{"rua":"R","numero":12}')).toEqual({ ...ENDERECO_EMPRESA_VAZIO, rua: 'R', numero: '12' });
  });

  it('JSON que não é objeto de endereço vira texto livre na rua', () => {
    expect(lerEnderecoEmpresa('[1,2]').rua).toBe('[1,2]');
    expect(lerEnderecoEmpresa('123').rua).toBe('123');
  });
});

describe('lerEnderecoEmpresa — formato antigo separado por vírgula (web antigo)', () => {
  it('rua, número, complemento, bairro, cidade - UF', () => {
    expect(lerEnderecoEmpresa('Av. Paulista, 1000, Sala 5, Bela Vista, São Paulo - SP')).toEqual({ ...completo, cep: '' });
  });

  it('rua, número, bairro, cidade - UF (sem complemento)', () => {
    expect(lerEnderecoEmpresa('Rua das Flores, 45, Centro, Campinas - SP')).toEqual({
      ...ENDERECO_EMPRESA_VAZIO, rua: 'Rua das Flores', numero: '45', bairro: 'Centro', cidade: 'Campinas', uf: 'SP',
    });
  });

  it('rua, bairro, cidade (sem número; bairro com vírgula preservado)', () => {
    expect(lerEnderecoEmpresa('Rua X, Jardim, Parte 2, Recife')).toEqual({
      ...ENDERECO_EMPRESA_VAZIO, rua: 'Rua X', bairro: 'Jardim, Parte 2', cidade: 'Recife',
    });
  });

  it('com 5+ partes e número: complemento e bairro com vírgula', () => {
    expect(lerEnderecoEmpresa('Rua Y, 10, Bloco B, Vila Nova, Etapa 1, Natal - RN')).toEqual({
      ...ENDERECO_EMPRESA_VAZIO, rua: 'Rua Y', numero: '10', complemento: 'Bloco B', bairro: 'Vila Nova, Etapa 1', cidade: 'Natal', uf: 'RN',
    });
  });

  it('menos de 3 partes (texto livre do cadastro da empresa) → tudo na rua', () => {
    expect(lerEnderecoEmpresa('Rua Única 100, Centro')).toEqual({ ...ENDERECO_EMPRESA_VAZIO, rua: 'Rua Única 100, Centro' });
  });
});

describe('exibição', () => {
  it('localidade "Cidade - UF"', () => {
    expect(localidadeEndereco(completo)).toBe('São Paulo - SP');
    expect(localidadeEndereco({ ...completo, uf: '' })).toBe('São Paulo');
    expect(localidadeEndereco({ ...completo, cidade: '' })).toBe('SP');
  });
  it('em linha, sem partes vazias', () => {
    expect(enderecoEmpresaEmLinha(completo)).toBe('Av. Paulista, 1000, Sala 5, Bela Vista, São Paulo - SP, CEP 01310-100');
    expect(enderecoEmpresaEmLinha({ ...ENDERECO_EMPRESA_VAZIO, rua: 'Rua A', cidade: 'Natal' })).toBe('Rua A, Natal');
    expect(enderecoEmpresaEmLinha(ENDERECO_EMPRESA_VAZIO)).toBe('');
  });
  it('formato antigo relido e regravado sai em JSON', () => {
    const lido = lerEnderecoEmpresa('Rua das Flores, 45, Centro, Campinas - SP');
    expect(lerEnderecoEmpresa(serializarEnderecoEmpresa(lido))).toEqual(lido);
  });
});
