import { describe, expect, it } from 'vitest';
import { formatarDuracao } from '@shared/dominio';
import { rotuloCategoriaProduto, statusEstoque, rotuloStatusEstoque } from '@shared/estoque';

describe('formatarDuracao', () => {
  it('formata minutos e horas', () => {
    expect(formatarDuracao(45)).toBe('45 min');
    expect(formatarDuracao(60)).toBe('1h');
    expect(formatarDuracao(90)).toBe('1h30');
    expect(formatarDuracao(120)).toBe('2h');
  });
});

describe('estoque', () => {
  it('rótulo de categoria, com fallback na chave', () => {
    expect(rotuloCategoriaProduto('cilios')).toBe('Cílios');
    expect(rotuloCategoriaProduto('depilacao')).toBe('Depilação');
    expect(rotuloCategoriaProduto('xyz')).toBe('xyz');
  });
  it('status segue a regra do web', () => {
    expect(statusEstoque(0, 5)).toBe('critico');
    expect(statusEstoque(-1, 0)).toBe('critico');
    expect(statusEstoque(5, 5)).toBe('baixo');
    expect(statusEstoque(6, 5)).toBe('ok');
    expect(statusEstoque(1, 0)).toBe('ok');
  });
  it('rótulos de status', () => {
    expect(rotuloStatusEstoque('ok')).toBe('OK');
    expect(rotuloStatusEstoque('baixo')).toBe('Baixo');
    expect(rotuloStatusEstoque('critico')).toBe('Zerado');
  });
});
