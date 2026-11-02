import { describe, expect, it } from 'vitest';
import { usarLembreteLocal } from '@shared/lembretes-locais';

describe('usarLembreteLocal', () => {
  it('só usa o lembrete local quando a 097 não existe (caminho antigo)', () => {
    expect(usarLembreteLocal('sem_migration')).toBe(true);
  });
  it('aparelho registrado no servidor: o lembrete vem por push, nunca local (não chega dobrado)', () => {
    expect(usarLembreteLocal('registrado')).toBe(false);
  });
  it('sem permissão, sem suporte ou registro ainda não feito: nenhum lembrete local', () => {
    expect(usarLembreteLocal('sem_permissao')).toBe(false);
    expect(usarLembreteLocal('sem_suporte')).toBe(false);
    expect(usarLembreteLocal(null)).toBe(false);
    expect(usarLembreteLocal(undefined)).toBe(false);
  });
});
