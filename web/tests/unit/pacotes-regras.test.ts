import { describe, expect, it } from 'vitest';
import {
  calcularPacotesAtivosCliente, dataValidade, itensACobrar, pacoteValidoEm, rotuloValidade,
  saldoSessoes, statusPacoteCliente, totalSessoes, type PacoteClienteRaw, type ItemPacote,
} from '@shared/pacotes';

describe('pacoteValidoEm', () => {
  it('sem validade vale sempre', () => expect(pacoteValidoEm(null, '2026-10-23')).toBe(true));
  it('o ultimo dia vale', () => expect(pacoteValidoEm('2026-10-23', '2026-10-23')).toBe(true));
  it('dia seguinte nao vale', () => expect(pacoteValidoEm('2026-10-22', '2026-10-23')).toBe(false));
});

describe('dataValidade', () => {
  it('null sem dias', () => expect(dataValidade(null, '2026-10-23')).toBeNull());
  it('soma dias e vira o mes', () => expect(dataValidade(10, '2026-10-25')).toBe('2026-11-04'));
  it('zero dias = proprio dia', () => expect(dataValidade(0, '2026-10-25')).toBe('2026-10-25'));
});

describe('saldoSessoes', () => {
  const itens = [
    { servico_id: 'a', quantidade: 3 },
    { servico_id: 'b', quantidade: null },
    { servico_id: 'c', quantidade: 2, ilimitado: true },
  ];
  it('calcula por servico, ilimitado = null', () => {
    const s = saldoSessoes(itens, [{ servico_id: 'a' }, { servico_id: 'a' }, { servico_id: 'b' }], false);
    expect(s).toEqual([
      { servico_id: 'a', total: 3, usadas: 2, restantes: 1 },
      { servico_id: 'b', total: null, usadas: 1, restantes: null },
      { servico_id: 'c', total: null, usadas: 0, restantes: null },
    ]);
  });
  it('restantes nunca negativo', () => {
    const s = saldoSessoes([{ servico_id: 'a', quantidade: 1 }], [{ servico_id: 'a' }, { servico_id: 'a' }], false);
    expect(s[0].restantes).toBe(0);
  });
  it('uso sem servico nao conta para nenhum', () => {
    const s = saldoSessoes([{ servico_id: 'a', quantidade: 2 }], [{ servico_id: null }], false);
    expect(s[0].usadas).toBe(0);
  });
});

describe('totalSessoes', () => {
  it('soma', () => expect(totalSessoes([{ servico_id: 'a', quantidade: 3 }, { servico_id: 'b', quantidade: 2 }])).toBe(5));
  it('null se algum ilimitado', () => expect(totalSessoes([{ servico_id: 'a', quantidade: 3 }, { servico_id: 'b', quantidade: null }])).toBeNull());
  it('null se flag ilimitado', () => expect(totalSessoes([{ servico_id: 'a', quantidade: 3, ilimitado: true }])).toBeNull());
});

describe('rotuloValidade', () => {
  it('com dias', () => expect(rotuloValidade(90)).toBe('Válido por 90 dias'));
  it('1 dia', () => expect(rotuloValidade(1)).toBe('Válido por 1 dia'));
  it('sem validade', () => expect(rotuloValidade(null)).toBe('Sem validade'));
});

describe('statusPacoteCliente', () => {
  const itens: ItemPacote[] = [{ servico_id: 'a', quantidade: 2 }];
  const hoje = '2026-10-23';
  const st = (p: { data_validade: string | null; status: string | null; combo: boolean }, usos: { servico_id: string | null }[], it: ItemPacote[] = itens) =>
    statusPacoteCliente(p, saldoSessoes(it, usos, p.combo), usos.length, hoje);
  it('ativo', () => expect(st({ data_validade: null, status: 'ativo', combo: false }, [{ servico_id: 'a' }])).toBe('ativo'));
  it('concluido ao esgotar', () => expect(st({ data_validade: null, status: 'ativo', combo: false }, [{ servico_id: 'a' }, { servico_id: 'a' }])).toBe('concluido'));
  it('combo nao conclui por sessao', () => expect(st({ data_validade: null, status: 'ativo', combo: true }, [{ servico_id: 'a' }, { servico_id: 'a' }])).toBe('ativo'));
  it('ilimitado nao conclui', () => expect(st({ data_validade: null, status: 'ativo', combo: false }, [{ servico_id: 'a' }], [{ servico_id: 'a', quantidade: null }])).toBe('ativo'));
  it('expirado apos a validade', () => expect(st({ data_validade: '2026-10-22', status: 'ativo', combo: false }, [])).toBe('expirado'));
  it('ultimo dia ainda ativo', () => expect(st({ data_validade: hoje, status: 'ativo', combo: false }, [])).toBe('ativo'));
  it('status gravado concluido/expirado/cancelado prevalece', () => {
    expect(st({ data_validade: null, status: 'concluido', combo: false }, [])).toBe('concluido');
    expect(st({ data_validade: null, status: 'expirado', combo: false }, [])).toBe('expirado');
    // Cancelado é distinto de expirado: a tela mostra "Cancelado", nunca "Expirado".
    expect(st({ data_validade: null, status: 'cancelado', combo: false }, [])).toBe('cancelado');
    expect(st({ data_validade: '2020-01-01', status: 'cancelado', combo: false }, [])).toBe('cancelado');
  });
  it('status desconhecido gravado cai em expirado (nunca ativo)', () => {
    expect(st({ data_validade: null, status: 'xyz', combo: false }, [])).toBe('expirado');
  });
});

describe('itensACobrar', () => {
  it('monta item de pacote a cobrar', () => {
    expect(itensACobrar([{ id: 'pc1', pacote_id: 'p1', nome: 'Fio', valor_pago: 300 }])).toEqual([
      { tipo: 'pacote', pacote_id: 'p1', pacote_cliente_id: 'pc1', descricao: 'Pacote Fio — a cobrar', valor_unit: 300, quantidade: 1 },
    ]);
  });
});

describe('calcularPacotesAtivosCliente: validade', () => {
  const raw = (v: string | null): PacoteClienteRaw => ({
    id: 'x', data_validade: v,
    pacote: { nome: 'P', controla_sessoes: true, servicos: [{ servico_id: 'a', quantidade: 2 }] }, uso: [],
  });
  it('ultimo dia vale', () => expect(calcularPacotesAtivosCliente([raw('2026-10-23')], '2026-10-23')).toHaveLength(1));
  it('vencido nao entra', () => expect(calcularPacotesAtivosCliente([raw('2026-10-22')], '2026-10-23')).toHaveLength(0));
});
