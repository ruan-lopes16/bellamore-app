import { describe, expect, it } from 'vitest';
import { ehCaminhoInterno, nextSeguro } from '@shared/navegacao';

describe('ehCaminhoInterno', () => {
  it.each(['/dashboard', '/clientes/123?aba=fotos', '/convite/aceitar?token=abc#x', '/'])('aceita %s', (c) => {
    expect(ehCaminhoInterno(c)).toBe(true);
  });
  it.each([
    '', '//evil.com', '/\\evil.com', '\\\\evil.com', 'https://evil.com', 'http:/x', 'javascript:alert(1)',
    'dashboard', ' /dashboard', '/dash\nboard', '/a\tb', '/%0d%0aSet-Cookie', '/%2f%2fevil.com',
  ])('recusa %j', (c) => {
    expect(ehCaminhoInterno(c)).toBe(false);
  });
  it('recusa o que não é string', () => {
    expect(ehCaminhoInterno(null)).toBe(false);
    expect(ehCaminhoInterno(undefined)).toBe(false);
  });
});

describe('nextSeguro', () => {
  it('devolve o caminho interno', () => expect(nextSeguro('/agenda?dia=2026-10-28')).toBe('/agenda?dia=2026-10-28'));
  it('caminho externo ou vazio → padrão /dashboard', () => {
    expect(nextSeguro('//evil.com')).toBe('/dashboard');
    expect(nextSeguro(null)).toBe('/dashboard');
  });
  it('padrão configurável', () => expect(nextSeguro(undefined, '/criar-empresa')).toBe('/criar-empresa'));
});
