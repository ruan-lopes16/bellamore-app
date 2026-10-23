import { describe, expect, it } from 'vitest';
import { DURACOES_PADRAO, duracaoValida, validarServico, lerPrecoServico } from '@shared/servicos';

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
  it('preco zero e recusado: a cortesia e dada no atendimento (valor 0 na agenda/comanda), nao no catalogo', () =>
    expect(validarServico({ nome: 'Corte', preco: 0, duracao: 60 })).toBe('Informe um preço maior que zero. A cortesia é dada no atendimento.'));
  it('nome vazio', () => expect(validarServico({ nome: '  ', preco: 50, duracao: 60 })).toBe('Informe o nome do serviço.'));
  it('nome com menos de 2 caracteres', () =>
    expect(validarServico({ nome: ' A ', preco: 50, duracao: 60 })).toBe('O nome do serviço precisa ter pelo menos 2 caracteres.'));
  it('preco negativo ou invalido', () => {
    expect(validarServico({ nome: 'Ab', preco: -1, duracao: 60 })).toBe('Informe um preço válido.');
    expect(validarServico({ nome: 'Ab', preco: NaN, duracao: 60 })).toBe('Informe um preço válido.');
  });
  it('duracao invalida', () => expect(validarServico({ nome: 'Ab', preco: 1, duracao: 3 })).toBe('A duração deve ficar entre 5 minutos e 10 horas.'));
});

describe('lerPrecoServico (mesma leitura no web e no app)', () => {
  it('formato brasileiro', () => {
    expect(lerPrecoServico('1.234,56')).toBe(1234.56);
    expect(lerPrecoServico('80')).toBe(80);
    expect(lerPrecoServico('R$ 45,90')).toBe(45.9);
  });
  it('sem nenhum digito vira NaN (preço inválido)', () => {
    expect(Number.isNaN(lerPrecoServico(''))).toBe(true);
    expect(Number.isNaN(lerPrecoServico('abc'))).toBe(true);
  });
});
