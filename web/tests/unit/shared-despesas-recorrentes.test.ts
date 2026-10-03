import { describe, expect, it } from 'vitest';
import {
  recorrentesParaLancarNoMes, montarLancamentosRecorrentes, vencimentoNoMes, chaveDespesa, textoRecorrentesPendentes,
  type DespesaRecorrenteTemplate,
} from '@shared/despesas';
import { carregarHistoricoRecorrentesMensais, lancarRecorrentesMensais, COLUNAS_HISTORICO_RECORRENTE } from '@shared/despesas-consultas';
import { fakeDb, opsDe } from './fixtures/fake-db';

const HIST: DespesaRecorrenteTemplate[] = [   // mais recente primeiro
  { descricao: 'Aluguel', categoria: 'Aluguel', valor: '1500.00', periodicidade: 'mensal', data_vencimento: '2026-08-31', recorrencia_ate: null },
  { descricao: 'Notebook', categoria: 'Outros', valor: 333.33, periodicidade: 'mensal', data_vencimento: '2026-07-10',
    recorrencia_ate: '2027-04-10', parcela_atual: 3, total_parcelas: 12, valor_total_compra: '4000.00' },
  { descricao: 'Internet', categoria: null, valor: 99.9, periodicidade: 'mensal', data_vencimento: '2026-08-05', recorrencia_ate: '2026-08-31' },
  { descricao: 'Aluguel', categoria: 'Aluguel', valor: 1400, periodicidade: 'mensal', data_vencimento: '2026-07-31', recorrencia_ate: null },
];

describe('quais recorrentes lançar', () => {
  it('mais recente por série, sem encerradas, sem as já lançadas no mês', () => {
    expect(recorrentesParaLancarNoMes(HIST, [], '2026-09-01').map(t => t.descricao)).toEqual(['Aluguel', 'Notebook']);
    expect(recorrentesParaLancarNoMes(HIST, [{ descricao: 'Aluguel', categoria: 'Aluguel' }], '2026-09-01').map(t => t.descricao))
      .toEqual(['Notebook']);
    expect(chaveDespesa({ descricao: 'Internet', categoria: null })).toBe(chaveDespesa({ descricao: 'Internet' }));
  });

  it('despesa de setembro paga em outubro (na lista de outubro) NÃO bloqueia o Aluguel de outubro', () => {
    const listaOutubro = [{ descricao: 'Aluguel', categoria: 'Aluguel', data_vencimento: '2026-09-30', data_pagamento: '2026-10-02' }];
    expect(recorrentesParaLancarNoMes([HIST[0]], listaOutubro, '2026-10-01').map(t => t.descricao)).toEqual(['Aluguel']);
  });

  it('despesa com vencimento no mês (qualquer status) continua bloqueando', () => {
    const listaOutubro = [{ descricao: 'Aluguel', categoria: 'Aluguel', data_vencimento: '2026-10-05' }];
    expect(recorrentesParaLancarNoMes([HIST[0]], listaOutubro, '2026-10-01')).toEqual([]);
  });
});

describe('o que é gravado', () => {
  it('vencimento preserva o dia, limitado ao fim do mês', () => {
    expect(vencimentoNoMes('2026-08-31', '2026-09')).toBe('2026-09-30');
    expect(vencimentoNoMes('2026-01-31', '2027-02')).toBe('2027-02-28');
    expect(vencimentoNoMes('2026-01-29', '2028-02')).toBe('2028-02-29');
    expect(vencimentoNoMes(null, '2026-09')).toBe('2026-09-01');
  });
  it('linhas de insert', () => {
    const [aluguel, notebook] = montarLancamentosRecorrentes(recorrentesParaLancarNoMes(HIST, [], '2026-09-01'), 'emp', '2026-09');
    expect(aluguel).toEqual({
      empresa_id: 'emp', descricao: 'Aluguel', categoria: 'Aluguel', valor: 1500, recorrente: true, periodicidade: 'mensal',
      data_vencimento: '2026-09-30', recorrencia_ate: null, total_parcelas: null, parcela_atual: null,
      valor_total_compra: null, status: 'pendente',
    });
    expect(notebook.valor).toBe(333.33);
    expect(notebook.parcela_atual).toBe(5);       // julho = 3 → setembro = 5 (meses pulados contam)
    expect(notebook.data_vencimento).toBe('2026-09-10');
    expect(notebook.valor_total_compra).toBe(4000);
  });
  it('parcela nunca passa do total', () => {
    const [x] = montarLancamentosRecorrentes([{ descricao: 'X', valor: 10, data_vencimento: '2026-01-05', parcela_atual: 11, total_parcelas: 12 }], 'emp', '2026-09');
    expect(x.parcela_atual).toBe(12);
  });
  it('texto do aviso', () => {
    expect(textoRecorrentesPendentes(1)).toBe('1 despesa recorrente do mês anterior não foi lançada.');
    expect(textoRecorrentesPendentes(3)).toBe('3 despesas recorrentes do mês anterior não foram lançadas.');
  });
});

describe('histórico paginado', () => {
  it('filtros, ordem e erro', async () => {
    const { db, chamadas } = fakeDb();
    await carregarHistoricoRecorrentesMensais(db, 'emp', '2026-09-01');
    const [ops] = opsDe(chamadas, 'despesas');
    expect(ops).toContainEqual(['select', [COLUNAS_HISTORICO_RECORRENTE]]);
    expect(ops).toContainEqual(['eq', ['recorrente', true]]);
    expect(ops).toContainEqual(['eq', ['periodicidade', 'mensal']]);
    expect(ops).toContainEqual(['lt', ['data_vencimento', '2026-09-01']]);
    expect(ops).toContainEqual(['order', ['data_vencimento', { ascending: false }]]);
    expect(ops).toContainEqual(['order', ['id']]);
    await expect(carregarHistoricoRecorrentesMensais(fakeDb({ erroEm: 'despesas' }).db, 'emp', '2026-09-01')).rejects.toThrow();
  });
});

describe('regressões de quais lançar', () => {
  it('linha antiga sem fim + linha mais nova já encerrada: série continua excluída (dedup antes do filtro)', () => {
    const hist: DespesaRecorrenteTemplate[] = [
      { descricao: 'Seguro', categoria: 'Outros', valor: 50, data_vencimento: '2026-08-10', recorrencia_ate: '2026-08-31' },
      { descricao: 'Seguro', categoria: 'Outros', valor: 50, data_vencimento: '2026-05-10', recorrencia_ate: null },
    ];
    expect(recorrentesParaLancarNoMes(hist, [], '2026-09-01')).toEqual([]);
  });
  it('categoria null e vazia contam como a mesma série já lançada no mês', () => {
    const hist: DespesaRecorrenteTemplate[] = [{ descricao: 'Luz', categoria: null, valor: 10, data_vencimento: '2026-08-10' }];
    expect(recorrentesParaLancarNoMes(hist, [{ descricao: 'Luz', categoria: '' }], '2026-09-01')).toEqual([]);
    expect(recorrentesParaLancarNoMes(hist, [{ descricao: 'Luz', categoria: null }], '2026-09-01')).toEqual([]);
  });
});

describe('inserção em lote', () => {
  type Resp = { data: unknown[] | null; error: { message: string } | null };
  const stub = (resp: Resp, noMes: { descricao: string; categoria: string | null }[] = []) => {
    const inserts: unknown[] = [];
    const selects: unknown[][] = [];
    const filtros: unknown[][] = [];
    const db = {
      from: () => {
        const q: Record<string, unknown> = {
          select: () => q,
          eq: (...a: unknown[]) => { filtros.push(['eq', ...a]); return q; },
          gte: (...a: unknown[]) => { filtros.push(['gte', ...a]); return q; },
          lte: (...a: unknown[]) => { filtros.push(['lte', ...a]); return q; },
          order: () => q,
          range: (de: number, ate: number) => Promise.resolve({ data: noMes.slice(de, ate + 1), error: null }),
          insert: (l: unknown) => { inserts.push(l); return { select: (...a: unknown[]) => { selects.push(a); return Promise.resolve(resp); } }; },
        };
        return q;
      },
    };
    return { db, inserts, selects, filtros };
  };
  const linhas = montarLancamentosRecorrentes(
    [{ descricao: 'A', valor: 1, data_vencimento: '2026-08-01' }, { descricao: 'B', valor: 2, data_vencimento: '2026-08-02' }], 'emp', '2026-09');
  it('envia as linhas, pede select(id) e confere a contagem', async () => {
    const s = stub({ data: [{ id: '1' }, { id: '2' }], error: null });
    expect(await lancarRecorrentesMensais(s.db, 'emp', '2026-09', linhas)).toEqual({ inseridas: 2, jaExistiam: 0 });
    expect(s.inserts).toEqual([linhas]);
    expect(s.selects).toEqual([['id']]);
    expect(s.filtros).toContainEqual(['gte', 'data_vencimento', '2026-09-01']);
    expect(s.filtros).toContainEqual(['lte', 'data_vencimento', '2026-09-30']);
    await expect(lancarRecorrentesMensais(stub({ data: [{ id: '1' }], error: null }).db, 'emp', '2026-09', linhas)).rejects.toThrow();
    await expect(lancarRecorrentesMensais(stub({ data: null, error: { message: 'x' } }).db, 'emp', '2026-09', linhas)).rejects.toThrow('x');
  });
  it('não insere linha cuja chave a reconsulta encontra no banco', async () => {
    const s = stub({ data: [{ id: '2' }], error: null }, [{ descricao: 'A', categoria: null }]);
    expect(await lancarRecorrentesMensais(s.db, 'emp', '2026-09', linhas)).toEqual({ inseridas: 1, jaExistiam: 1 });
    expect(s.inserts).toEqual([[linhas[1]]]);
  });
  it('tudo já existe: não chama o insert', async () => {
    const s = stub({ data: [], error: null }, [{ descricao: 'A', categoria: '' }, { descricao: 'B', categoria: null }]);
    expect(await lancarRecorrentesMensais(s.db, 'emp', '2026-09', linhas)).toEqual({ inseridas: 0, jaExistiam: 2 });
    expect(s.inserts).toHaveLength(0);
  });
  it('lista vazia não chama o banco', async () => {
    const s = stub({ data: [], error: null });
    expect(await lancarRecorrentesMensais(s.db, 'emp', '2026-09', [])).toEqual({ inseridas: 0, jaExistiam: 0 });
    expect(s.inserts).toHaveLength(0);
  });
});
