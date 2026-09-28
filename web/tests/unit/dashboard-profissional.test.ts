import { describe, it, expect } from 'vitest';
import {
  classificarClientesReconquista,
  progressoMetaPessoal,
  type VisitaClienteProfissional,
} from '@shared/dashboard-profissional';

const AGORA = new Date('2026-09-24T12:00:00Z');

function visita(over: Partial<VisitaClienteProfissional> = {}): VisitaClienteProfissional {
  return {
    clienteId: 'c1', nome: 'Cliente', ultimaVisita: AGORA.toISOString(), totalVisitas: 1,
    ...over,
  };
}

describe('classificarClientesReconquista', () => {
  it('cliente com 1 visita há 30+ dias entra em "não retornou"', () => {
    const ultimaVisita = new Date(AGORA.getTime() - 31 * 86_400_000).toISOString();
    const r = classificarClientesReconquista([visita({ totalVisitas: 1, ultimaVisita })], AGORA);
    expect(r.naoRetornou).toHaveLength(1);
    expect(r.emRisco).toHaveLength(0);
    expect(r.naoRetornou[0].diasSemVisita).toBe(31);
  });

  it('cliente com 1 visita há menos de 30 dias não entra em nenhuma lista', () => {
    const ultimaVisita = new Date(AGORA.getTime() - 10 * 86_400_000).toISOString();
    const r = classificarClientesReconquista([visita({ totalVisitas: 1, ultimaVisita })], AGORA);
    expect(r.naoRetornou).toHaveLength(0);
    expect(r.emRisco).toHaveLength(0);
  });

  it('cliente com 2+ visitas e 45+ dias sem voltar entra em "em risco"', () => {
    const ultimaVisita = new Date(AGORA.getTime() - 46 * 86_400_000).toISOString();
    const r = classificarClientesReconquista([visita({ totalVisitas: 3, ultimaVisita })], AGORA);
    expect(r.emRisco).toHaveLength(1);
    expect(r.naoRetornou).toHaveLength(0);
  });

  it('cliente com 2+ visitas e menos de 45 dias não entra em nenhuma lista', () => {
    const ultimaVisita = new Date(AGORA.getTime() - 20 * 86_400_000).toISOString();
    const r = classificarClientesReconquista([visita({ totalVisitas: 5, ultimaVisita })], AGORA);
    expect(r.emRisco).toHaveLength(0);
    expect(r.naoRetornou).toHaveLength(0);
  });

  it('ordena cada lista da mais atrasada para a menos atrasada', () => {
    const r = classificarClientesReconquista([
      visita({ clienteId: 'a', totalVisitas: 1, ultimaVisita: new Date(AGORA.getTime() - 31 * 86_400_000).toISOString() }),
      visita({ clienteId: 'b', totalVisitas: 1, ultimaVisita: new Date(AGORA.getTime() - 90 * 86_400_000).toISOString() }),
    ], AGORA);
    expect(r.naoRetornou.map((c) => c.clienteId)).toEqual(['b', 'a']);
  });
});

describe('progressoMetaPessoal', () => {
  it('sem meta definida, temMeta e false', () => {
    expect(progressoMetaPessoal(1000, null)).toEqual({ temMeta: false, percentual: 0, restante: 0 });
    expect(progressoMetaPessoal(1000, 0)).toEqual({ temMeta: false, percentual: 0, restante: 0 });
  });

  it('faturamento abaixo da meta calcula percentual e restante', () => {
    expect(progressoMetaPessoal(500, 1000)).toEqual({ temMeta: true, percentual: 50, restante: 500 });
  });

  it('faturamento acima da meta trava percentual em 100 e restante em 0', () => {
    expect(progressoMetaPessoal(1500, 1000)).toEqual({ temMeta: true, percentual: 100, restante: 0 });
  });
});
