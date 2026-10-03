import { describe, expect, it } from 'vitest';
import { pode, rotaInicial, podeAtribuirRole } from '@/lib/permissions';

describe('web/lib/permissions', () => {
  it('reexporta pode', () => {
    expect(pode({ isOwner: false, papel: 'profissional', chaves: ['agenda.excluir'] }, 'agenda.excluir')).toBe(true);
  });
  it('rotaInicial e podeAtribuirRole seguem iguais', () => {
    expect(rotaInicial('profissional')).toBe('/dashboard');
    expect(podeAtribuirRole('gestor', 'gestor')).toBe(false);
    expect(podeAtribuirRole('owner', 'gestor')).toBe(true);
  });
});
