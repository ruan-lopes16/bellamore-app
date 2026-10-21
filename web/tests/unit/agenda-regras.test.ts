import { describe, expect, it } from 'vitest';
import {
  janelaDoDia, horariosDoDia, diasDaSemana, semanaVizinha, instanteNoPassado, statusPermitidos,
  precisaConfirmarStatus, montarAgendamento, conflitosDeHorario, linhasIniciaisEdicao,
  colunasPorProfissional, resumoDoDia, msgConflito, MSG_CONCLUIDO_COM_COMANDA, MSG_REABRIR,
  MSG_HORARIO_PASSADO,
} from '@shared/agenda';

// Brasília = UTC-3: 08:00 BRT = 11:00Z
const z = (hhmmBrt: string, dia = '2026-10-19') => {
  const [h, m] = hhmmBrt.split(':').map(Number);
  return new Date(Date.UTC(+dia.slice(0, 4), +dia.slice(5, 7) - 1, +dia.slice(8, 10), h + 3, m)).toISOString();
};

describe('janelaDoDia / horariosDoDia', () => {
  it('janela padrão sem itens', () => {
    expect(janelaDoDia([])).toEqual({ ini: 7, fim: 21 });
  });
  it('estica para cobrir início (floor) e fim (ceil)', () => {
    expect(janelaDoDia([{ inicio: z('05:30'), fim: z('22:15') }])).toEqual({ ini: 5, fim: 23 });
  });
  it('não encolhe a janela padrão', () => {
    expect(janelaDoDia([{ inicio: z('09:00'), fim: z('10:00') }])).toEqual({ ini: 7, fim: 21 });
  });
  it('respeita limites 0 e 24', () => {
    expect(janelaDoDia([{ inicio: z('00:10'), fim: z('23:50') }])).toEqual({ ini: 0, fim: 24 });
    expect(janelaDoDia([{ inicio: z('22:00'), fim: z('00:30', '2026-10-20') }])).toEqual({ ini: 7, fim: 24 });
  });
  it('horários de 15 em 15', () => {
    expect(horariosDoDia({ ini: 7, fim: 9 })).toEqual(['07:00', '07:15', '07:30', '07:45', '08:00', '08:15', '08:30', '08:45']);
    expect(horariosDoDia({ ini: 7, fim: 8 }, 30)).toEqual(['07:00', '07:30']);
  });
});

describe('semana', () => {
  it('começa no domingo', () => {
    expect(diasDaSemana('2026-10-21')).toEqual([
      '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24',
    ]);
    expect(diasDaSemana('2026-10-18')[0]).toBe('2026-10-18');
  });
  it('virada de mês e de ano', () => {
    expect(diasDaSemana('2026-12-31')).toEqual([
      '2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02',
    ]);
    expect(diasDaSemana('2026-09-30')[0]).toBe('2026-09-27');
  });
  it('semanaVizinha mantém a posição', () => {
    expect(semanaVizinha('2026-10-21', 1)).toBe('2026-10-28');
    expect(semanaVizinha('2026-10-21', -1)).toBe('2026-10-14');
    expect(semanaVizinha('2026-12-30', 1)).toBe('2027-01-06');
  });
});

describe('instanteNoPassado', () => {
  it('compara com agora', () => {
    const agora = Date.parse('2026-10-19T12:00:00Z');
    expect(instanteNoPassado('2026-10-19T11:59:00Z', agora)).toBe(true);
    expect(instanteNoPassado('2026-10-19T12:00:00Z', agora)).toBe(false);
    expect(instanteNoPassado('2026-10-19T12:01:00Z', agora)).toBe(false);
  });
});

describe('status', () => {
  it('tabela inteira', () => {
    expect(statusPermitidos('agendado', false)).toEqual(['confirmado', 'concluido', 'cancelado', 'faltou']);
    expect(statusPermitidos('confirmado', false)).toEqual(['agendado', 'concluido', 'cancelado', 'faltou']);
    expect(statusPermitidos('cancelado', false)).toEqual(['agendado', 'confirmado']);
    expect(statusPermitidos('faltou', false)).toEqual(['agendado', 'confirmado']);
    expect(statusPermitidos('concluido', false)).toEqual(['agendado', 'confirmado', 'cancelado', 'faltou']);
    expect(statusPermitidos('concluido', true)).toEqual([]);
  });
  it('mensagens', () => {
    expect(MSG_CONCLUIDO_COM_COMANDA).toBe('Já fechado na comanda. Para mudar, edite a comanda.');
    expect(MSG_REABRIR).toBe('Reabrir este atendimento?');
    expect(MSG_HORARIO_PASSADO).toBe('Esse horário já passou. Registrar mesmo assim?');
    expect(msgConflito('Ana', '09:30')).toBe('Já existe atendimento de Ana às 09:30. Agendar mesmo assim?');
  });
  it('confirmações', () => {
    expect(precisaConfirmarStatus('agendado', 'cancelado')).toBe('Cancelar este atendimento?');
    expect(precisaConfirmarStatus('confirmado', 'faltou')).toBe('Marcar falta neste atendimento?');
    expect(precisaConfirmarStatus('cancelado', 'agendado')).toBe(MSG_REABRIR);
    expect(precisaConfirmarStatus('faltou', 'confirmado')).toBe(MSG_REABRIR);
    expect(precisaConfirmarStatus('agendado', 'confirmado')).toBeNull();
    expect(precisaConfirmarStatus('confirmado', 'concluido')).toBeNull();
    expect(precisaConfirmarStatus('concluido', 'agendado')).toBeNull();
  });
});

describe('montarAgendamento', () => {
  const base = { servico_id: 's1', profissional_id: 'p1', duracao_min: 30, preco: 100 };
  const inicioIso = '2026-10-19T12:00:00.000Z';
  it('soma valores e durações; fim = início + duração', () => {
    const r = montarAgendamento({ inicioIso, linhas: [
      { ...base, valor: '80,50' }, { ...base, servico_id: 's2', valor: '20', duracao_min: 45, preco: 50 },
    ] });
    expect(r.valorTotal).toBe(100.5);
    expect(r.duracaoMin).toBe(75);
    expect(r.fimIso).toBe('2026-10-19T13:15:00.000Z');
    expect(r.linhas[1]).toEqual({ servico_id: 's2', profissional_id: 'p1', valor: 20, duracao_min: 45 });
  });
  it('campo vazio vira o preço; "0" continua 0 (cortesia)', () => {
    expect(montarAgendamento({ inicioIso, linhas: [{ ...base, valor: '' }] }).valorTotal).toBe(100);
    expect(montarAgendamento({ inicioIso, linhas: [{ ...base, valor: '   ' }] }).valorTotal).toBe(100);
    const c = montarAgendamento({ inicioIso, linhas: [{ ...base, valor: '0' }] });
    expect(c.valorTotal).toBe(0);
    expect(c.linhas[0].valor).toBe(0);
  });
  it('duração editada substitui a soma (só se > 0)', () => {
    expect(montarAgendamento({ inicioIso, duracaoEditadaMin: 90, linhas: [{ ...base, valor: '' }] }).duracaoMin).toBe(90);
    expect(montarAgendamento({ inicioIso, duracaoEditadaMin: 0, linhas: [{ ...base, valor: '' }] }).duracaoMin).toBe(30);
    expect(montarAgendamento({ inicioIso, duracaoEditadaMin: null, linhas: [{ ...base, valor: '' }] }).duracaoMin).toBe(30);
  });
});

describe('conflitosDeHorario', () => {
  const ex = (o: Partial<{ id: string; profissional_id: string; inicio: string; fim: string; status: string }>) => ({
    id: 'a', profissional_id: 'p1', inicio: z('09:00'), fim: z('10:00'), status: 'agendado', cliente_nome: 'Ana', ...o,
  });
  const novo = (ini: string, fim: string, p = 'p1') => ({ profissional_id: p, inicioIso: z(ini), fimIso: z(fim) });
  it('sobreposição estrita', () => {
    expect(conflitosDeHorario(novo('09:30', '10:30'), [ex({})])).toEqual([{ id: 'a', cliente_nome: 'Ana', inicio: z('09:00') }]);
    expect(conflitosDeHorario(novo('10:00', '11:00'), [ex({})])).toEqual([]);
    expect(conflitosDeHorario(novo('08:00', '09:00'), [ex({})])).toEqual([]);
  });
  it('ignora cancelado, faltou, outra profissional e ignorarId', () => {
    const lista = [ex({ id: 'c', status: 'cancelado' }), ex({ id: 'f', status: 'faltou' }), ex({ id: 'o', profissional_id: 'p2' }), ex({ id: 'me' })];
    expect(conflitosDeHorario(novo('09:00', '10:00'), lista, 'me')).toEqual([]);
    expect(conflitosDeHorario(novo('09:00', '10:00'), lista).map(c => c.id)).toEqual(['me']);
  });
  it('cliente_nome ausente vira null', () => {
    expect(conflitosDeHorario(novo('09:00', '10:00'), [{ ...ex({}), cliente_nome: undefined }])[0].cliente_nome).toBeNull();
  });
});

describe('linhasIniciaisEdicao', () => {
  it('mantém as linhas existentes', () => {
    const l = [{ servico_id: 's', profissional_id: 'p', valor: 5, duracao_min: 10 }];
    expect(linhasIniciaisEdicao({ servico_id: 's', profissional_id: 'p', valor: 9, duracao_min: 20 }, l)).toEqual(l);
  });
  it('atendimento antigo sem linhas vira uma linha', () => {
    expect(linhasIniciaisEdicao({ servico_id: 's', profissional_id: 'p', valor: 90, duracao_min: 40 }, []))
      .toEqual([{ servico_id: 's', profissional_id: 'p', valor: 90, duracao_min: 40 }]);
    expect(linhasIniciaisEdicao({ servico_id: 's', profissional_id: 'p', valor: null, duracao_min: null }, []))
      .toEqual([{ servico_id: 's', profissional_id: 'p', valor: 0, duracao_min: 0 }]);
  });
  it('sem serviço e sem linhas → vazio', () => {
    expect(linhasIniciaisEdicao({ servico_id: null, profissional_id: 'p', valor: 1, duracao_min: 1 }, [])).toEqual([]);
  });
});

describe('colunasPorProfissional', () => {
  it('agrupa na ordem das profissionais, mantendo as sem atendimento', () => {
    const profs = [{ id: 'a', nome: 'A' }, { id: 'b', nome: 'B' }];
    const r = colunasPorProfissional([{ profissional_id: 'b', n: 1 }, { profissional_id: 'a', n: 2 }, { profissional_id: 'b', n: 3 }, { profissional_id: 'x', n: 4 }], profs);
    expect(r.map(c => [c.profissional.id, c.itens.map(i => i.n)])).toEqual([['a', [2]], ['b', [1, 3]]]);
    expect(colunasPorProfissional([], profs).map(c => c.itens.length)).toEqual([0, 0]);
  });
});

describe('resumoDoDia', () => {
  it('total e profissionais sem cancelados; receita prevista sem cancelado/faltou/pacote; pendentes', () => {
    const r = resumoDoDia([
      { status: 'agendado', profissional_id: 'a', valor: 100 },
      { status: 'confirmado', profissional_id: 'a', valor: 50.5 },
      { status: 'cancelado', profissional_id: 'b', valor: 200 },
      { status: 'concluido', profissional_id: 'c', valor: 30, pacote_cliente_id: 'pc' },
      { status: 'agendado', profissional_id: 'b', valor: null },
    ]);
    expect(r).toEqual({ total: 4, receitaPrevista: 150.5, profissionais: 3, pendentes: 2 });
  });
  it('receita prevista desconta o desconto rateado da comanda (igual ao app e ao Financeiro)', () => {
    const r = resumoDoDia([
      { status: 'concluido', profissional_id: 'a', valor: 100, desconto_rateado: 15 },
      { status: 'agendado', profissional_id: 'a', valor: 60 },
      { status: 'faltou', profissional_id: 'b', valor: 40, desconto_rateado: 0 },
    ]);
    expect(r.receitaPrevista).toBe(145);
  });
  it('vazio', () => {
    expect(resumoDoDia([])).toEqual({ total: 0, receitaPrevista: 0, profissionais: 0, pendentes: 0 });
  });
});
