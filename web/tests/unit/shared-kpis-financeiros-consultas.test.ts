// web/tests/unit/shared-kpis-financeiros-consultas.test.ts
import { describe, expect, it } from 'vitest';
import { limitesMes } from '@shared/periodos';
import {
  carregarDadosFinanceiros, carregarComissoesPendentes, carregarClientesComHistoricoAntes,
  carregarRetiradas, filtroDespesasDoMes, COLUNAS_AGENDAMENTO_FIN,
} from '@shared/kpis-financeiros-consultas';

type Op = [string, unknown[]];
type Chamada = { tabela: string; ops: Op[] };

/** Client falso: registra a cadeia de chamadas e devolve `linhas[tabela]` fatiadas por range(). */
function fakeDb(linhas: Record<string, unknown[]> = {}, erroEm?: string) {
  const chamadas: Chamada[] = [];
  const db = {
    from(tabela: string) {
      const chamada: Chamada = { tabela, ops: [] };
      chamadas.push(chamada);
      const builder: Record<string, unknown> = new Proxy({}, {
        get(_alvo, prop) {
          if (prop === 'then') return undefined;
          return (...args: unknown[]) => {
            chamada.ops.push([String(prop), args]);
            if (prop === 'range') {
              if (tabela === erroEm) return Promise.resolve({ data: null, error: { message: `falha em ${tabela}` } });
              const [de, ate] = args as [number, number];
              return Promise.resolve({ data: (linhas[tabela] ?? []).slice(de, ate + 1), error: null });
            }
            return builder;
          };
        },
      });
      return builder;
    },
  };
  return { db, chamadas };
}
const opsDe = (chamadas: Chamada[], tabela: string) => chamadas.filter(c => c.tabela === tabela).map(c => c.ops);

const SET = limitesMes('2026-09');

describe('carregarDadosFinanceiros — mesmos filtros nas duas plataformas', () => {
  it('consulta as 9 tabelas', async () => {
    const { db, chamadas } = fakeDb();
    await carregarDadosFinanceiros(db, 'emp', SET);
    expect(chamadas.map(c => c.tabela).sort()).toEqual([
      'agendamentos', 'comanda_itens', 'comissoes', 'despesas', 'financeiro_ajustes_mensais',
      'pagamentos', 'taxas_cancelamento', 'taxas_reserva', 'vendas',
    ]);
  });
  it('agendamentos: todos os status (para % de cancelamento), limites em Brasília, ordem estável', async () => {
    const { db, chamadas } = fakeDb();
    await carregarDadosFinanceiros(db, 'emp', SET);
    const [ops] = opsDe(chamadas, 'agendamentos');
    expect(ops).toContainEqual(['select', [COLUNAS_AGENDAMENTO_FIN]]);
    expect(ops).toContainEqual(['eq', ['empresa_id', 'emp']]);
    expect(ops).toContainEqual(['gte', ['data_hora_inicio', '2026-09-01T03:00:00.000Z']]);
    expect(ops).toContainEqual(['lte', ['data_hora_inicio', '2026-10-01T02:59:59.999Z']]);
    expect(ops).toContainEqual(['order', ['id']]);
    expect(ops).toContainEqual(['range', [0, 999]]);
    expect(ops.some(([m, a]) => m === 'eq' && a[0] === 'status')).toBe(false);
  });
  it('despesas pagas por data_pagamento (coluna date)', async () => {
    const { db, chamadas } = fakeDb();
    await carregarDadosFinanceiros(db, 'emp', SET);
    const [ops] = opsDe(chamadas, 'despesas');
    expect(ops).toContainEqual(['eq', ['status', 'pago']]);
    expect(ops).toContainEqual(['gte', ['data_pagamento', '2026-09-01']]);
    expect(ops).toContainEqual(['lte', ['data_pagamento', '2026-09-30']]);
  });
  it('taxas: cancelamento pagas e reserva com paga_em', async () => {
    const { db, chamadas } = fakeDb();
    await carregarDadosFinanceiros(db, 'emp', SET);
    expect(opsDe(chamadas, 'taxas_cancelamento')[0]).toContainEqual(['eq', ['status', 'pago']]);
    expect(opsDe(chamadas, 'taxas_reserva')[0]).toContainEqual(['not', ['paga_em', 'is', null]]);
    expect(opsDe(chamadas, 'pagamentos')[0]).toContainEqual(['eq', ['status', 'pago']]);
  });
  it('comissões por created_at; fechamentos do 1º dia do mês inicial até o fim', async () => {
    const { db, chamadas } = fakeDb();
    await carregarDadosFinanceiros(db, 'emp', SET);
    expect(opsDe(chamadas, 'comissoes')[0]).toContainEqual(['gte', ['created_at', '2026-09-01T03:00:00.000Z']]);
    const fech = opsDe(chamadas, 'financeiro_ajustes_mensais')[0];
    expect(fech).toContainEqual(['gte', ['mes', '2026-09-01']]);
    expect(fech).toContainEqual(['lte', ['mes', '2026-09-30']]);
  });
  it('pagina além de 1000 linhas', async () => {
    const muitos = Array.from({ length: 1500 }, (_, i) => ({ id: `a${i}` }));
    const { db, chamadas } = fakeDb({ agendamentos: muitos });
    const dados = await carregarDadosFinanceiros(db, 'emp', SET);
    expect(dados.agendamentos).toHaveLength(1500);
    expect(opsDe(chamadas, 'agendamentos')).toHaveLength(2);
  });
  it('erro do banco vira exceção (nunca KPI zerado em silêncio)', async () => {
    const { db } = fakeDb({}, 'comissoes');
    await expect(carregarDadosFinanceiros(db, 'emp', SET)).rejects.toThrow('falha em comissoes');
  });
});

describe('demais consultas', () => {
  it('comissões pendentes: todas, de qualquer mês', async () => {
    const { db, chamadas } = fakeDb({ comissoes: [{ id: 'k', valor_comissao: 10 }] });
    expect(await carregarComissoesPendentes(db, 'emp')).toEqual([{ id: 'k', valor_comissao: 10 }]);
    const [ops] = opsDe(chamadas, 'comissoes');
    expect(ops).toContainEqual(['eq', ['status', 'pendente']]);
    expect(ops.some(([m]) => m === 'gte' || m === 'lte')).toBe(false);
  });
  it('histórico antes do período em lotes de 150 ids', async () => {
    const ids = Array.from({ length: 320 }, (_, i) => `c${i}`);
    const { db, chamadas } = fakeDb({ agendamentos: [{ cliente_id: 'c1' }] });
    const set = await carregarClientesComHistoricoAntes(db, 'emp', ids, SET.startIso);
    expect([...set]).toEqual(['c1']);
    const lotes = opsDe(chamadas, 'agendamentos').map(ops => (ops.find(([m]) => m === 'in')![1][1] as string[]).length);
    expect(lotes).toEqual([150, 150, 20]);
    expect(opsDe(chamadas, 'agendamentos')[0]).toContainEqual(['lt', ['data_hora_inicio', SET.startIso]]);
  });
  it('histórico sem ids não consulta nada', async () => {
    const { db, chamadas } = fakeDb();
    expect((await carregarClientesComHistoricoAntes(db, 'emp', [], SET.startIso)).size).toBe(0);
    expect(chamadas).toHaveLength(0);
  });
  it('retiradas: todas da empresa (saldo da dona é histórico)', async () => {
    const { db, chamadas } = fakeDb({ retiradas_socia: [{ id: 'r' }], retiradas_socia_devolucoes: [] });
    const r = await carregarRetiradas(db, 'emp');
    expect(r.rows).toEqual([{ id: 'r' }]);
    expect(opsDe(chamadas, 'retiradas_socia')[0].some(([m]) => m === 'or')).toBe(false);
  });
  it('filtro da lista de despesas do mês (vencimento OU pagamento no mês)', () => {
    expect(filtroDespesasDoMes(SET)).toBe(
      'and(data_vencimento.gte.2026-09-01,data_vencimento.lte.2026-09-30),and(data_pagamento.gte.2026-09-01,data_pagamento.lte.2026-09-30)',
    );
  });
});
