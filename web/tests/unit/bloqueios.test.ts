import { describe, expect, it } from 'vitest';
import {
  MOTIVOS_BLOQUEIO, motivoBloqueioLabel, podeSelecionarEscopoGeral,
  situacaoInicialBloqueio, montarInsertBloqueio,
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
