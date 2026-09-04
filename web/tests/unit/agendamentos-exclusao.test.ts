import { describe, expect, it } from 'vitest';
import {
  podeExcluirAgendamento, motivoExclusaoBloqueada, STATUS_NAO_EXCLUIVEL,
} from '@shared/agendamentos';

describe('podeExcluirAgendamento', () => {
  it('permite owner/gestor em status nao-concluido', () => {
    for (const role of ['owner', 'gestor']) {
      for (const st of ['agendado', 'confirmado', 'cancelado', 'faltou']) {
        expect(podeExcluirAgendamento(st, role)).toBe(true);
      }
    }
  });

  it('nunca permite status concluido, mesmo para owner', () => {
    expect(podeExcluirAgendamento('concluido', 'owner')).toBe(false);
    expect(podeExcluirAgendamento('concluido', 'gestor')).toBe(false);
  });

  it('nunca permite profissional, seja qual for o status', () => {
    for (const st of ['agendado', 'confirmado', 'cancelado', 'faltou', 'concluido']) {
      expect(podeExcluirAgendamento(st, 'profissional')).toBe(false);
    }
  });

  it('role desconhecido nao pode', () => {
    expect(podeExcluirAgendamento('cancelado', 'cliente')).toBe(false);
    expect(podeExcluirAgendamento('cancelado', '')).toBe(false);
  });
});

describe('motivoExclusaoBloqueada', () => {
  it('explica o bloqueio para concluido', () => {
    expect(motivoExclusaoBloqueada('concluido')).toMatch(/conclu[ií]do/i);
  });
  it('retorna null para status excluiveis', () => {
    expect(motivoExclusaoBloqueada('cancelado')).toBeNull();
    expect(motivoExclusaoBloqueada('agendado')).toBeNull();
  });
});

describe('STATUS_NAO_EXCLUIVEL', () => {
  it('contem apenas concluido', () => {
    expect([...STATUS_NAO_EXCLUIVEL]).toEqual(['concluido']);
  });
});
