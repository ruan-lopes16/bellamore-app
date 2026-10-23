import { describe, expect, it } from 'vitest';
import { DURACOES_PADRAO, duracaoValida, validarServico } from '@shared/servicos';

describe('duracaoValida', () => {
  it('limites', () => {
    expect(duracaoValida(5)).toBe(true);
    expect(duracaoValida(600)).toBe(true);
    expect(duracaoValida(4)).toBe(false);
    expect(duracaoValida(601)).toBe(false);
    expect(duracaoValida(30.5)).toBe(false);
    expect(duracaoValida(NaN)).toBe(false);
  });
  it('todas as padrao sao validas', () => DURACOES_PADRAO.forEach(d => expect(duracaoValida(d)).toBe(true)));
});

describe('validarServico', () => {
  it('ok', () => expect(validarServico({ nome: 'Corte', preco: 50, duracao: 60 })).toBeNull());
  it('preco zero e permitido (cortesia)', () => expect(validarServico({ nome: 'Corte', preco: 0, duracao: 60 })).toBeNull());
  it('nome vazio', () => expect(validarServico({ nome: '  ', preco: 50, duracao: 60 })).toBe('Informe o nome do serviço.'));
  it('preco negativo ou invalido', () => {
    expect(validarServico({ nome: 'A', preco: -1, duracao: 60 })).toBe('Informe um preço válido.');
    expect(validarServico({ nome: 'A', preco: NaN, duracao: 60 })).toBe('Informe um preço válido.');
  });
  it('duracao invalida', () => expect(validarServico({ nome: 'A', preco: 1, duracao: 3 })).toBe('A duração deve ficar entre 5 minutos e 10 horas.'));
});
