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

describe('inserção em lote', () => {
  const stub = (resp: { data: unknown[] | null; error: { message: string } | null }) => {
    const chamadas: unknown[][] = [];
    const db = { from: () => ({ insert: (l: unknown) => { chamadas.push([l]); return { select: () => Promise.resolve(resp) }; } }) };
    return { db, chamadas };
  };
  const linhas = montarLancamentosRecorrentes(
    [{ descricao: 'A', valor: 1, data_vencimento: '2026-08-01' }, { descricao: 'B', valor: 2, data_vencimento: '2026-08-02' }], 'emp', '2026-09');
  it('confere a contagem inserida', async () => {
    expect(await lancarRecorrentesMensais(stub({ data: [{ id: '1' }, { id: '2' }], error: null }).db, linhas)).toBe(2);
    await expect(lancarRecorrentesMensais(stub({ data: [{ id: '1' }], error: null }).db, linhas)).rejects.toThrow();
    await expect(lancarRecorrentesMensais(stub({ data: null, error: { message: 'x' } }).db, linhas)).rejects.toThrow('x');
  });
  it('lista vazia não chama o banco', async () => {
    const s = stub({ data: [], error: null });
    expect(await lancarRecorrentesMensais(s.db, [])).toBe(0);
    expect(s.chamadas).toHaveLength(0);
  });
});
