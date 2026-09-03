import { describe, expect, it } from 'vitest';
import {
  ehHoraDaVespera, selecionar30min, selecionarVespera,
  corpo30min, resumosVespera, destinatarios, type AgLembrete,
} from '@shared/lembretes';

const base: AgLembrete = {
  id: 'a1', profissional_id: 'p1', data_hora_inicio: '2026-09-04T17:30:00-03:00',
  cliente_nome: 'Lazara', servico_nome: 'Design com tintura',
  lembrete_vespera_em: null, lembrete_30min_em: null,
};

describe('ehHoraDaVespera (America/Sao_Paulo, corte 18:00)', () => {
  it('true às 18:30 de SP', () => {
    expect(ehHoraDaVespera(new Date('2026-09-03T21:30:00Z'))).toBe(true); // 18:30 -03
  });
  it('false às 17:30 de SP', () => {
    expect(ehHoraDaVespera(new Date('2026-09-03T20:30:00Z'))).toBe(false); // 17:30 -03
  });
});

describe('selecionar30min', () => {
  const agora = new Date('2026-09-04T17:05:00-03:00');
  it('inclui atendimento que começa em 25 min e ainda não avisado', () => {
    expect(selecionar30min([base], agora).map(a => a.id)).toEqual(['a1']);
  });
  it('exclui quem já tem lembrete_30min_em', () => {
    expect(selecionar30min([{ ...base, lembrete_30min_em: '2026-09-04T16:00:00-03:00' }], agora)).toEqual([]);
  });
  it('exclui quem começa daqui a 2 h', () => {
    expect(selecionar30min([{ ...base, data_hora_inicio: '2026-09-04T19:05:00-03:00' }], agora)).toEqual([]);
  });
  it('exclui quem já começou', () => {
    expect(selecionar30min([{ ...base, data_hora_inicio: '2026-09-04T16:50:00-03:00' }], agora)).toEqual([]);
  });
});

describe('selecionarVespera', () => {
  it('filtra os que já têm véspera enviada', () => {
    const b2 = { ...base, id: 'a2', lembrete_vespera_em: '2026-09-03T18:00:00-03:00' };
    expect(selecionarVespera([base, b2]).map(a => a.id)).toEqual(['a1']);
  });
});

describe('corpo30min', () => {
  it('formata "Em 30 min: <cliente> — <serviço> · HH:mm"', () => {
    expect(corpo30min(base)).toBe('Em 30 min: Lazara — Design com tintura · 17:30');
  });
});

describe('resumosVespera', () => {
  it('1 resumo por profissional, com contagem e 1º horário', () => {
    const ags: AgLembrete[] = [
      { ...base, id: 'x1', profissional_id: 'p1', data_hora_inicio: '2026-09-04T09:00:00-03:00', cliente_nome: 'Ana' },
      { ...base, id: 'x2', profissional_id: 'p1', data_hora_inicio: '2026-09-04T14:00:00-03:00', cliente_nome: 'Bia' },
      { ...base, id: 'x3', profissional_id: 'p2', data_hora_inicio: '2026-09-04T10:00:00-03:00', cliente_nome: 'Cida' },
    ];
    const r = resumosVespera(ags);
    expect(r).toEqual([
      { profissionalId: 'p1', corpo: 'Amanhã: 2 atendimentos · 1º às 09:00 — Ana' },
      { profissionalId: 'p2', corpo: 'Amanhã: 1 atendimento · 1º às 10:00 — Cida' },
    ]);
  });
});

describe('destinatarios', () => {
  it('profissional do ag + owners/gestores, sem duplicar', () => {
    const membros = [
      { user_id: 'p1', role: 'profissional' },
      { user_id: 'owner1', role: 'owner' },
      { user_id: 'g1', role: 'gestor' },
      { user_id: 'p2', role: 'profissional' },
    ];
    expect(destinatarios('p1', membros).sort()).toEqual(['g1', 'owner1', 'p1'].sort());
  });
});
