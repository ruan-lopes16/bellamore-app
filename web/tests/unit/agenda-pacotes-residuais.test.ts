// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atendimentosVinculados, ROTULO_DESVINCULAR_TODOS } from '@shared/pacotes';
import { continuacoesPorHora } from '@shared/agenda-grade';
import { CHAVES_AGENDA, invalidarAgenda } from '@shared/agenda-consultas';

const DIA = '2026-11-04';
const HORAS = [8, 9, 10, 11, 12];
const ag = (ini: string, fim: string, status = 'agendado') => ({
  data_hora_inicio: `${DIA}T${ini}:00-03:00`,
  data_hora_fim: `${DIA}T${fim}:00-03:00`,
  status,
});

describe('atendimentosVinculados', () => {
  it('devolve o atendimento com vínculo e linha na comanda', () => {
    expect(atendimentosVinculados([{ agendamento_id: 'a1' }, { agendamento_id: 'a2' }], { a1: 'p1', a2: null }))
      .toEqual(['a1']);
  });
  it('ignora vínculo sem linha na comanda', () => {
    expect(atendimentosVinculados([{ agendamento_id: 'a2' }], { a1: 'p1' })).toEqual([]);
  });
  it('ignora vínculo nulo ou indefinido', () => {
    expect(atendimentosVinculados([{ agendamento_id: 'a1' }, { agendamento_id: 'a2' }], { a1: null, a2: undefined }))
      .toEqual([]);
  });
  it('tem o rótulo do botão', () => {
    expect(ROTULO_DESVINCULAR_TODOS).toBe('Desvincular e cobrar normal');
  });
});

describe('continuacoesPorHora', () => {
  it('9:00–11:00 continua na hora 10', () => {
    const a = ag('09:00', '11:00');
    expect(continuacoesPorHora([a], DIA, HORAS)).toEqual({ 10: [a] });
  });
  it('9:30–10:15 continua na hora 10', () => {
    const a = ag('09:30', '10:15');
    expect(continuacoesPorHora([a], DIA, HORAS)).toEqual({ 10: [a] });
  });
  it('9:00–10:00 não continua em nenhuma hora', () => {
    expect(continuacoesPorHora([ag('09:00', '10:00')], DIA, HORAS)).toEqual({});
  });
  it('cancelado e faltou ficam fora', () => {
    expect(continuacoesPorHora([ag('09:00', '12:00', 'cancelado'), ag('09:00', '12:00', 'faltou')], DIA, HORAS)).toEqual({});
  });
  it('hora fora da janela não aparece', () => {
    const a = ag('09:00', '13:00');
    expect(Object.keys(continuacoesPorHora([a], DIA, [9, 10])).map(Number)).toEqual([10]);
  });
});

describe('CHAVES_AGENDA', () => {
  const raiz = join(__dirname, '..', '..', '..');
  it('cobre toda queryKey de mobile/hooks/useAgenda.ts', () => {
    const src = readFileSync(join(raiz, 'mobile', 'hooks', 'useAgenda.ts'), 'utf8');
    const usadas = new Set([...src.matchAll(/queryKey:\s*\[\s*'([^']+)'/g)].map((m) => m[1]));
    expect(usadas.size).toBeGreaterThan(0);
    for (const k of usadas) expect(CHAVES_AGENDA).toContain(k);
  });
  it('invalidarAgenda invalida cada chave', () => {
    const vistas: unknown[][] = [];
    invalidarAgenda({ invalidateQueries: (f) => { vistas.push(f.queryKey); } });
    expect(vistas).toEqual(CHAVES_AGENDA.map((k) => [k]));
  });
});
