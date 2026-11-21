import { describe, it, expect } from 'vitest';
import {
  podeFiltrarPorProfissional, opcoesProfissionaisDosCartoes,
  filtrarCartoesPorProfissional, filtrarBacklogPorProfissional,
} from '@shared/comanda-filtro-profissional';

const ana = { id: 'a', nome: 'Ana' };
const bia = { id: 'b', nome: 'Bia' };
const cartoes = [
  { agendamentos: [{ profissional: bia }] },
  { agendamentos: [{ profissional: ana }, { profissional: bia }] },
  { agendamentos: [] },
];

describe('filtro de profissional da comanda', () => {
  it('quem vê a equipe ou gerencia outras ganha o filtro', () => {
    expect(podeFiltrarPorProfissional(true, false)).toBe(true);
    expect(podeFiltrarPorProfissional(false, true)).toBe(true);
    expect(podeFiltrarPorProfissional(false, false)).toBe(false);
  });
  it('opções sem repetir e em ordem', () => {
    expect(opcoesProfissionaisDosCartoes(cartoes)).toEqual([ana, bia]);
  });
  it('filtra cartões; vazio devolve todos', () => {
    expect(filtrarCartoesPorProfissional(cartoes, '')).toHaveLength(3);
    expect(filtrarCartoesPorProfissional(cartoes, 'a')).toHaveLength(1);
    expect(filtrarCartoesPorProfissional(cartoes, 'b')).toHaveLength(2);
  });
  it('filtra o backlog', () => {
    const b = [{ id: '1', profissional_id: 'a' }, { id: '2', profissional_id: null }];
    expect(filtrarBacklogPorProfissional(b, '')).toHaveLength(2);
    expect(filtrarBacklogPorProfissional(b, 'a')).toEqual([b[0]]);
  });
});
