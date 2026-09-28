import { describe, expect, it } from 'vitest';
import { calcularPacotesAtivosCliente, type PacoteClienteRaw } from '@shared/pacotes';

function raw(over: Partial<PacoteClienteRaw>): PacoteClienteRaw {
  return {
    id: 'pc1',
    data_validade: null,
    pacote: { nome: 'Pacote X', controla_sessoes: true, servicos: [{ servico_id: 's1', quantidade: 10 }] },
    uso: [],
    ...over,
  };
}

describe('calcularPacotesAtivosCliente', () => {
  it('pacote sem sessão usada — restantes = total', () => {
    const r = calcularPacotesAtivosCliente([raw({})], '2026-09-22');
    expect(r).toEqual([{
      id: 'pc1', nome: 'Pacote X', total: 10, usadas: 0, restantes: 10,
      servicos: [{ servico_id: 's1' }], sessoes: [],
    }]);
  });

  it('soma quantidade de múltiplos serviços do pacote', () => {
    const r = calcularPacotesAtivosCliente([raw({
      pacote: { nome: 'Combo', controla_sessoes: true, servicos: [{ servico_id: 's1', quantidade: 4 }, { servico_id: 's2', quantidade: 6 }] },
    })], '2026-09-22');
    expect(r[0].total).toBe(10);
  });

  it('sessão com quantidade null em qualquer serviço torna o pacote ilimitado (total/restantes null)', () => {
    const r = calcularPacotesAtivosCliente([raw({
      pacote: { nome: 'Ilimitado', controla_sessoes: true, servicos: [{ servico_id: 's1', quantidade: null }] },
    })], '2026-09-22');
    expect(r[0].total).toBeNull();
    expect(r[0].restantes).toBeNull();
  });

  it('desconta sessões já usadas de "restantes"', () => {
    const r = calcularPacotesAtivosCliente([raw({
      uso: [{ id: 'u1', created_at: '2026-09-01T10:00:00Z', agendamento_id: 'ag1', servico: { nome: 'Massagem' } }],
    })], '2026-09-22');
    expect(r[0].usadas).toBe(1);
    expect(r[0].restantes).toBe(9);
    expect(r[0].sessoes).toEqual([{ id: 'u1', data: '2026-09-01T10:00:00Z', servico: 'Massagem', viaAg: true }]);
  });

  it('pacote sem sessões restantes (restantes = 0) fica de fora do resultado', () => {
    const usoCheio = Array.from({ length: 10 }, (_, i) => ({ id: `u${i}`, created_at: '2026-09-01T10:00:00Z', agendamento_id: null, servico: null }));
    const r = calcularPacotesAtivosCliente([raw({ uso: usoCheio })], '2026-09-22');
    expect(r).toEqual([]);
  });

  it('pacote vencido (data_validade no passado) fica de fora', () => {
    const r = calcularPacotesAtivosCliente([raw({ data_validade: '2026-01-01' })], '2026-09-22');
    expect(r).toEqual([]);
  });

  it('data_validade igual a hoje ainda conta como válido', () => {
    const r = calcularPacotesAtivosCliente([raw({ data_validade: '2026-09-22' })], '2026-09-22');
    expect(r).toHaveLength(1);
  });

  it('pacote combo (controla_sessoes = false) fica de fora — não tem conceito de sessão', () => {
    const r = calcularPacotesAtivosCliente([raw({
      pacote: { nome: 'Combo fixo', controla_sessoes: false, servicos: [{ servico_id: 's1', quantidade: 1 }] },
    })], '2026-09-22');
    expect(r).toEqual([]);
  });

  it('pacote sem data_validade (null) nunca vence', () => {
    const r = calcularPacotesAtivosCliente([raw({ data_validade: null })], '2026-09-22');
    expect(r).toHaveLength(1);
  });

  it('sessoes ordenadas da mais recente para a mais antiga', () => {
    const r = calcularPacotesAtivosCliente([raw({
      uso: [
        { id: 'u1', created_at: '2026-09-01T10:00:00Z', agendamento_id: null, servico: null },
        { id: 'u2', created_at: '2026-09-10T10:00:00Z', agendamento_id: null, servico: null },
      ],
    })], '2026-09-22');
    expect(r[0].sessoes.map(s => s.id)).toEqual(['u2', 'u1']);
  });
});
