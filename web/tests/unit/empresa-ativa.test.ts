import { describe, expect, it } from 'vitest';
import { COOKIE_EMPRESA_ATIVA, STORAGE_EMPRESA_ATIVA, escolherEmpresaAtiva } from '@shared/empresa-ativa';

const v = (empresa_id: string, created_at: string | null, id = `m-${empresa_id}`, ativo: boolean | undefined = true) =>
  ({ id, empresa_id, created_at, ativo });

describe('escolherEmpresaAtiva', () => {
  it('nome do cookie e da chave do app', () => {
    expect(COOKIE_EMPRESA_ATIVA).toBe('bm_empresa');
    expect(STORAGE_EMPRESA_ATIVA).toBe('bm_empresa');
  });

  it('sem vínculos → null', () => {
    expect(escolherEmpresaAtiva([], 'x')).toBeNull();
  });

  it('devolve a preferida quando é um vínculo ativo da pessoa', () => {
    const lista = [v('a', '2026-01-01T00:00:00Z'), v('b', '2026-05-01T00:00:00Z')];
    expect(escolherEmpresaAtiva(lista, 'b')?.empresa_id).toBe('b');
  });

  it('preferida que não é vínculo da pessoa → a mais antiga', () => {
    const lista = [v('b', '2026-05-01T00:00:00Z'), v('a', '2026-01-01T00:00:00Z')];
    expect(escolherEmpresaAtiva(lista, 'outra')?.empresa_id).toBe('a');
  });

  it('preferida com vínculo desativado não vale', () => {
    const lista = [v('a', '2026-01-01T00:00:00Z'), v('b', '2026-05-01T00:00:00Z', 'm-b', false)];
    expect(escolherEmpresaAtiva(lista, 'b')?.empresa_id).toBe('a');
  });

  it('vínculos desativados nunca são escolhidos; só desativados → null', () => {
    expect(escolherEmpresaAtiva([v('a', '2026-01-01T00:00:00Z', 'm', false)], null)).toBeNull();
  });

  it('sem preferida: mais antiga por created_at, desempate por id (independe da ordem de entrada)', () => {
    const lista = [
      v('c', '2026-03-01T00:00:00Z', 'm3'),
      v('b', '2026-01-01T00:00:00Z', 'm2'),
      v('a', '2026-01-01T00:00:00Z', 'm1'),
    ];
    expect(escolherEmpresaAtiva(lista, undefined)?.empresa_id).toBe('a');
    expect(escolherEmpresaAtiva([...lista].reverse(), '')?.empresa_id).toBe('a');
  });

  it('created_at ausente vai para o fim', () => {
    const lista = [v('a', null, 'm0'), v('b', '2026-06-01T00:00:00Z', 'm9')];
    expect(escolherEmpresaAtiva(lista, null)?.empresa_id).toBe('b');
  });

  it('created_at com e sem fuso comparados pelo instante', () => {
    const lista = [v('a', '2026-01-01T02:00:00-03:00', 'm1'), v('b', '2026-01-01T04:00:00Z', 'm2')];
    expect(escolherEmpresaAtiva(lista, null)?.empresa_id).toBe('b');
  });

  it('ativo ausente conta como ativo (consulta já filtrada por ativo = true)', () => {
    const lista = [{ id: 'm', empresa_id: 'a', created_at: '2026-01-01T00:00:00Z' }];
    expect(escolherEmpresaAtiva(lista, 'a')?.empresa_id).toBe('a');
  });
});
