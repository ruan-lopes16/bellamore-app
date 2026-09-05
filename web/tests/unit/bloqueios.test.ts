import { describe, expect, it } from 'vitest';
import {
  MOTIVOS_BLOQUEIO, motivoBloqueioLabel, podeSelecionarEscopoGeral,
  situacaoInicialBloqueio, montarInsertBloqueio, bloqueioEmConflito, bloqueioNoInstante, type BlocoParaChecagem,
} from '@shared/bloqueios';

const BASE = {
  meuUserId: 'u-prof',
  empresaId: 'e-1',
  motivo: 'folga' as const,
  titulo: '',
  dataInicio: '2026-09-03T14:00:00.000Z',
  dataFim: '2026-09-03T16:00:00.000Z',
};

describe('MOTIVOS_BLOQUEIO', () => {
  it('tem as 6 opcoes na ordem definida', () => {
    expect(MOTIVOS_BLOQUEIO.map((m) => m.key)).toEqual(
      ['folga', 'feriado', 'almoco', 'reuniao', 'manutencao', 'outro'],
    );
  });
});

describe('motivoBloqueioLabel', () => {
  it('traduz cada chave', () => {
    expect(motivoBloqueioLabel('almoco')).toBe('Almoço');
    expect(motivoBloqueioLabel('reuniao')).toBe('Reunião');
  });
  it('cai em travessão para nulo/desconhecido', () => {
    expect(motivoBloqueioLabel(null)).toBe('—');
    expect(motivoBloqueioLabel(undefined)).toBe('—');
    expect(motivoBloqueioLabel('xpto')).toBe('—');
  });
});

describe('podeSelecionarEscopoGeral', () => {
  it('so owner e gestor', () => {
    expect(podeSelecionarEscopoGeral('owner')).toBe(true);
    expect(podeSelecionarEscopoGeral('gestor')).toBe(true);
    expect(podeSelecionarEscopoGeral('profissional')).toBe(false);
    expect(podeSelecionarEscopoGeral('')).toBe(false);
  });
});

describe('situacaoInicialBloqueio', () => {
  it('gestao => aprovado, profissional => pendente', () => {
    expect(situacaoInicialBloqueio('owner')).toBe('aprovado');
    expect(situacaoInicialBloqueio('gestor')).toBe('aprovado');
    expect(situacaoInicialBloqueio('profissional')).toBe('pendente');
  });
});

describe('montarInsertBloqueio', () => {
  it('profissional: forca escopo=profissional, profissional_id=si, situacao=pendente — mesmo pedindo geral', () => {
    const ins = montarInsertBloqueio({
      ...BASE, role: 'profissional', escopo: 'geral', profissionalId: 'u-outra',
    });
    expect(ins.escopo).toBe('profissional');
    expect(ins.profissional_id).toBe('u-prof');
    expect(ins.situacao).toBe('pendente');
    expect(ins.criado_por).toBe('u-prof');
    expect(ins.empresa_id).toBe('e-1');
    expect(ins.motivo).toBe('folga');
  });

  it('gestor: escopo geral => profissional_id null, situacao aprovado', () => {
    const ins = montarInsertBloqueio({
      ...BASE, meuUserId: 'u-gestor', role: 'gestor', escopo: 'geral', profissionalId: 'u-x',
    });
    expect(ins.escopo).toBe('geral');
    expect(ins.profissional_id).toBeNull();
    expect(ins.situacao).toBe('aprovado');
    expect(ins.criado_por).toBe('u-gestor');
  });

  it('gestor: escopo profissional => usa o profissionalId escolhido', () => {
    const ins = montarInsertBloqueio({
      ...BASE, meuUserId: 'u-gestor', role: 'gestor', escopo: 'profissional', profissionalId: 'u-alvo',
    });
    expect(ins.escopo).toBe('profissional');
    expect(ins.profissional_id).toBe('u-alvo');
    expect(ins.situacao).toBe('aprovado');
  });

  it('titulo vazio cai no rotulo do motivo; com texto usa o texto (trim)', () => {
    expect(montarInsertBloqueio({ ...BASE, role: 'gestor', escopo: 'profissional', profissionalId: 'x' }).titulo).toBe('Folga');
    expect(montarInsertBloqueio({ ...BASE, role: 'gestor', escopo: 'profissional', profissionalId: 'x', titulo: '  Dentista  ' }).titulo).toBe('Dentista');
  });
});

const blocoBase: BlocoParaChecagem = {
  escopo: 'profissional',
  profissional_id: 'u-prof',
  situacao: 'aprovado',
  data_inicio: '2026-09-10T14:00:00.000Z',
  data_fim:    '2026-09-10T15:00:00.000Z',
  motivo: 'folga',
  titulo: 'Folga',
};

describe('bloqueioEmConflito', () => {
  it('bloqueio do próprio profissional que sobrepõe o intervalo => devolve o bloco', () => {
    const r = bloqueioEmConflito([blocoBase], 'u-prof',
      '2026-09-10T14:30:00.000Z', '2026-09-10T15:30:00.000Z');
    expect(r).toBe(blocoBase);
  });

  it('bloqueio de OUTRO profissional (escopo profissional) => null', () => {
    const r = bloqueioEmConflito([blocoBase], 'u-outra',
      '2026-09-10T14:30:00.000Z', '2026-09-10T15:30:00.000Z');
    expect(r).toBeNull();
  });

  it('bloqueio escopo "geral" colide com qualquer profissional', () => {
    const geral: BlocoParaChecagem = { ...blocoBase, escopo: 'geral', profissional_id: null };
    const r = bloqueioEmConflito([geral], 'qualquer-um',
      '2026-09-10T14:10:00.000Z', '2026-09-10T14:20:00.000Z');
    expect(r).toBe(geral);
  });

  it('situacao "pendente" também colide (não só aprovado)', () => {
    const pend: BlocoParaChecagem = { ...blocoBase, situacao: 'pendente' };
    const r = bloqueioEmConflito([pend], 'u-prof',
      '2026-09-10T14:00:00.000Z', '2026-09-10T14:30:00.000Z');
    expect(r).toBe(pend);
  });

  it('encostar não é colisão: agendamento termina exatamente quando o bloqueio começa', () => {
    const r = bloqueioEmConflito([blocoBase], 'u-prof',
      '2026-09-10T13:00:00.000Z', '2026-09-10T14:00:00.000Z');
    expect(r).toBeNull();
  });

  it('encostar não é colisão: agendamento começa exatamente quando o bloqueio termina', () => {
    const r = bloqueioEmConflito([blocoBase], 'u-prof',
      '2026-09-10T15:00:00.000Z', '2026-09-10T16:00:00.000Z');
    expect(r).toBeNull();
  });

  it('vários blocos colidindo => devolve o de menor data_inicio', () => {
    const cedo:  BlocoParaChecagem = { ...blocoBase, data_inicio: '2026-09-10T13:30:00.000Z', data_fim: '2026-09-10T14:30:00.000Z', motivo: 'reuniao' };
    const tarde: BlocoParaChecagem = { ...blocoBase };
    const r = bloqueioEmConflito([tarde, cedo], 'u-prof',
      '2026-09-10T14:00:00.000Z', '2026-09-10T15:00:00.000Z');
    expect(r).toBe(cedo);
  });

  it('lista vazia => null', () => {
    expect(bloqueioEmConflito([], 'u-prof',
      '2026-09-10T14:00:00.000Z', '2026-09-10T15:00:00.000Z')).toBeNull();
  });
});

describe('bloqueioNoInstante', () => {
  it('instante dentro do bloqueio => devolve o bloco', () => {
    expect(bloqueioNoInstante([blocoBase], 'u-prof', '2026-09-10T14:30:00.000Z')).toBe(blocoBase);
  });
  it('instante == data_inicio => colide (meia-aberto inclui o início)', () => {
    expect(bloqueioNoInstante([blocoBase], 'u-prof', '2026-09-10T14:00:00.000Z')).toBe(blocoBase);
  });
  it('instante == data_fim => não colide (meia-aberto exclui o fim)', () => {
    expect(bloqueioNoInstante([blocoBase], 'u-prof', '2026-09-10T15:00:00.000Z')).toBeNull();
  });
  it('bloqueio de outro profissional => null', () => {
    expect(bloqueioNoInstante([blocoBase], 'u-outra', '2026-09-10T14:30:00.000Z')).toBeNull();
  });
});
