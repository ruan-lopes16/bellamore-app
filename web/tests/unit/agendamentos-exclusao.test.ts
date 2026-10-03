import { describe, expect, it } from 'vitest';
import {
  podeExcluirAgendamento, motivoExclusaoBloqueada, STATUS_NAO_EXCLUIVEL,
} from '@shared/agendamentos';

describe('podeExcluirAgendamento', () => {
  it('permite quem tem a permissao em status nao-concluido', () => {
    for (const st of ['agendado', 'confirmado', 'cancelado', 'faltou']) {
      expect(podeExcluirAgendamento(st, true)).toBe(true);
    }
  });

  it('nunca permite status concluido, mesmo para owner', () => {
    expect(podeExcluirAgendamento('concluido', true)).toBe(false);
  });

  it('nunca permite sem a permissao, seja qual for o status', () => {
    for (const st of ['agendado', 'confirmado', 'cancelado', 'faltou', 'concluido']) {
      expect(podeExcluirAgendamento(st, false)).toBe(false);
    }
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
