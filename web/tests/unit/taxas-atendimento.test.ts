import { beforeEach, describe, expect, it } from 'vitest';
import {
  _limparCacheColunaCobrarTaxa,
  carregarConfigTaxas,
  colunaCobrarTaxaExiste,
  perguntaTaxaCancelamento,
  valorTaxaCancelamento,
  valorTaxaReservaSugerida,
} from '@shared/taxas-atendimento';
import { buildTaxaReservaInsert } from '@shared/taxa-reserva';

const canc = {
  ativa: true, modo: 'percentual' as const, valor: 50, aplicaCancelado: true, aplicaFaltou: true,
};

describe('valorTaxaReservaSugerida', () => {
  it('desligada → 0', () => {
    expect(valorTaxaReservaSugerida({ ativa: false, modo: 'fixo', valor: 30 }, 100)).toBe(0);
  });
  it('fixo → valor da configuração', () => {
    expect(valorTaxaReservaSugerida({ ativa: true, modo: 'fixo', valor: 30 }, 100)).toBe(30);
  });
  it('percentual com 2 casas (sem erro de ponto flutuante)', () => {
    expect(valorTaxaReservaSugerida({ ativa: true, modo: 'percentual', valor: 30 }, 150)).toBe(45);
    expect(valorTaxaReservaSugerida({ ativa: true, modo: 'percentual', valor: 10 }, 10.05)).toBe(1.01);
    expect(valorTaxaReservaSugerida({ ativa: true, modo: 'percentual', valor: 33.33 }, 99.99)).toBe(33.33);
  });
  it('preço inválido ou negativo → 0', () => {
    expect(valorTaxaReservaSugerida({ ativa: true, modo: 'percentual', valor: 30 }, NaN)).toBe(0);
    expect(valorTaxaReservaSugerida({ ativa: true, modo: 'percentual', valor: 30 }, -10)).toBe(0);
  });
});

describe('valorTaxaCancelamento', () => {
  it('desligada → 0', () => {
    expect(valorTaxaCancelamento({ ...canc, ativa: false }, 100)).toBe(0);
  });
  it('fixo ignora o valor do atendimento', () => {
    expect(valorTaxaCancelamento({ ...canc, modo: 'fixo', valor: 25 }, 999)).toBe(25);
  });
  it('percentual arredonda em 2 casas como o trigger', () => {
    expect(valorTaxaCancelamento(canc, 120)).toBe(60);
    expect(valorTaxaCancelamento({ ...canc, valor: 15 }, 33.3)).toBe(5);
    expect(valorTaxaCancelamento({ ...canc, valor: 50 }, 0.01)).toBe(0.01);
  });
});

describe('perguntaTaxaCancelamento', () => {
  it('pergunta ao cancelar com chave ligada, cliente e valor > 0', () => {
    expect(perguntaTaxaCancelamento(canc, 'cancelado', 'cli1', 100)).toEqual({ perguntar: true, valor: 50 });
    expect(perguntaTaxaCancelamento(canc, 'faltou', 'cli1', 100)).toEqual({ perguntar: true, valor: 50 });
  });
  it('não pergunta com a chave desligada', () => {
    expect(perguntaTaxaCancelamento({ ...canc, ativa: false }, 'cancelado', 'cli1', 100).perguntar).toBe(false);
  });
  it('não pergunta para status fora da configuração', () => {
    expect(perguntaTaxaCancelamento({ ...canc, aplicaCancelado: false }, 'cancelado', 'cli1', 100).perguntar).toBe(false);
    expect(perguntaTaxaCancelamento({ ...canc, aplicaFaltou: false }, 'faltou', 'cli1', 100).perguntar).toBe(false);
    expect(perguntaTaxaCancelamento(canc, 'concluido', 'cli1', 100).perguntar).toBe(false);
    expect(perguntaTaxaCancelamento(canc, 'agendado', 'cli1', 100).perguntar).toBe(false);
  });
  it('não pergunta sem cliente vinculada', () => {
    expect(perguntaTaxaCancelamento(canc, 'cancelado', null, 100).perguntar).toBe(false);
    expect(perguntaTaxaCancelamento(canc, 'cancelado', '', 100).perguntar).toBe(false);
  });
  it('não pergunta com valor zero', () => {
    expect(perguntaTaxaCancelamento(canc, 'cancelado', 'cli1', 0)).toEqual({ perguntar: false, valor: 0 });
    expect(perguntaTaxaCancelamento({ ...canc, modo: 'fixo', valor: 0 }, 'cancelado', 'cli1', 100).perguntar).toBe(false);
  });
});

describe('buildTaxaReservaInsert com cobrar', () => {
  const base = { empresaId: 'e', agendamentoId: 'a', clienteId: 'c', valor: 40, jaCobrada: false };
  it('cobrar: false → nenhuma linha', () => {
    expect(buildTaxaReservaInsert({ ...base, cobrar: false }, '2026-10-15T10:00:00.000Z')).toBeNull();
    expect(buildTaxaReservaInsert({ ...base, jaCobrada: true, cobrar: false }, '2026-10-15T10:00:00.000Z')).toBeNull();
  });
  it('cobrar omitido ou true → comportamento de antes', () => {
    expect(buildTaxaReservaInsert(base, 'x')?.status).toBe('pendente');
    expect(buildTaxaReservaInsert({ ...base, cobrar: true }, 'x')?.valor).toBe(40);
  });
});

/** Cliente falso: devolve a resposta configurada para a 1ª consulta, e conta as chamadas. */
function dbFalso(resposta: { data?: unknown; error?: { message: string; code?: string } | null }) {
  const chamadas: { tabela: string; colunas?: string; filtros: unknown[] }[] = [];
  return {
    chamadas,
    from(tabela: string) {
      const c: { tabela: string; colunas?: string; filtros: unknown[] } = { tabela, filtros: [] };
      chamadas.push(c);
      const q = {
        select(col: string) { c.colunas = col; return q; },
        eq(k: string, v: unknown) { c.filtros.push([k, v]); return q; },
        limit() { return Promise.resolve({ data: resposta.data ?? null, error: resposta.error ?? null }); },
        maybeSingle() { return Promise.resolve({ data: resposta.data ?? null, error: resposta.error ?? null }); },
      };
      return q;
    },
  };
}

describe('carregarConfigTaxas', () => {
  it('lê as colunas taxa_reserva_* e taxa_cancelamento_* da empresa', async () => {
    const db = dbFalso({
      data: {
        taxa_reserva_ativa: true, taxa_reserva_modo: 'fixo', taxa_reserva_valor: '20.00',
        taxa_cancelamento_ativa: true, taxa_cancelamento_modo: 'percentual', taxa_cancelamento_valor: '50',
        taxa_cancelamento_aplica_cancelado: true, taxa_cancelamento_aplica_faltou: false,
      },
    });
    const cfg = await carregarConfigTaxas(db, 'emp1');
    expect(cfg).toEqual({
      reserva: { ativa: true, modo: 'fixo', valor: 20 },
      cancelamento: { ativa: true, modo: 'percentual', valor: 50, aplicaCancelado: true, aplicaFaltou: false },
    });
    expect(db.chamadas[0].tabela).toBe('empresas');
    expect(db.chamadas[0].filtros).toEqual([['id', 'emp1']]);
    for (const col of ['taxa_reserva_ativa', 'taxa_reserva_modo', 'taxa_reserva_valor', 'taxa_cancelamento_ativa',
      'taxa_cancelamento_modo', 'taxa_cancelamento_valor', 'taxa_cancelamento_aplica_cancelado', 'taxa_cancelamento_aplica_faltou']) {
      expect(db.chamadas[0].colunas).toContain(col);
    }
  });
  it('lança o erro do banco (nunca devolve taxas desligadas por engano)', async () => {
    await expect(carregarConfigTaxas(dbFalso({ error: { message: 'falhou' } }), 'emp1')).rejects.toThrow('falhou');
  });
  it('empresa não encontrada → tudo desligado', async () => {
    const cfg = await carregarConfigTaxas(dbFalso({ data: null }), 'emp1');
    expect(cfg.reserva.ativa).toBe(false);
    expect(cfg.cancelamento.ativa).toBe(false);
  });
});

describe('colunaCobrarTaxaExiste', () => {
  beforeEach(() => _limparCacheColunaCobrarTaxa());

  it('sem erro → true, e guarda em cache', async () => {
    const db = dbFalso({ data: [] });
    expect(await colunaCobrarTaxaExiste(db)).toBe(true);
    expect(await colunaCobrarTaxaExiste(db)).toBe(true);
    expect(db.chamadas).toHaveLength(1);
    expect(db.chamadas[0]).toMatchObject({ tabela: 'agendamentos', colunas: 'cobrar_taxa_cancelamento' });
  });
  it('coluna inexistente (antes da 091) → false, e guarda em cache', async () => {
    const db = dbFalso({ error: { code: '42703', message: 'column agendamentos.cobrar_taxa_cancelamento does not exist' } });
    expect(await colunaCobrarTaxaExiste(db)).toBe(false);
    expect(await colunaCobrarTaxaExiste(db)).toBe(false);
    expect(db.chamadas).toHaveLength(1);
  });
  it('outro erro (rede) → false sem guardar em cache', async () => {
    const db = dbFalso({ error: { message: 'Failed to fetch' } });
    expect(await colunaCobrarTaxaExiste(db)).toBe(false);
    await colunaCobrarTaxaExiste(db);
    expect(db.chamadas).toHaveLength(2);
  });
});
