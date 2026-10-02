// web/tests/unit/shared-relatorios.test.ts
import { describe, expect, it } from 'vitest';
import { limitesMes } from '@shared/periodos';
import { calcularKpisFinanceiros, recortarDados } from '@shared/kpis-financeiros';
import {
  ABAS_RELATORIO, rankingDespesasPorCategoria, comissaoPorProfissional, resumoInsumos, resumoAvaliacoes,
  cartoesKpiRelatorio, linhasResumoFinanceiro, type AvaliacaoRow,
} from '@shared/relatorios';
import { carregarSaidasEstoque, carregarAvaliacoes, COLUNAS_AVALIACAO } from '@shared/relatorios-consultas';
import { fixtureSetembro } from './fixtures/kpis-setembro-2026';
import { fakeDb, opsDe } from './fixtures/fake-db';

const SET = limitesMes('2026-09');
const fx = fixtureSetembro();
const k = calcularKpisFinanceiros(fx, SET);
const kAnt = calcularKpisFinanceiros(fx, limitesMes('2026-08'));
const fmt = (v: number) => `R$${v}`;

describe('abas e rankings', () => {
  it('mesma lista de abas', () => {
    expect(ABAS_RELATORIO.map(a => a.key)).toEqual(['financeiro', 'servicos', 'equipe', 'clientes', 'estoque', 'comissoes', 'avaliacoes']);
  });
  it('despesas por categoria (pagas do período)', () => {
    const r = rankingDespesasPorCategoria(recortarDados(fx, SET).despesas);
    expect(r.map(x => [x.nome, x.valor, x.qtd])).toEqual([['Aluguel', 250, 1], ['Energia', 45.5, 1]]);
    expect(r[1].pct).toBeCloseTo(18.2);
    expect(rankingDespesasPorCategoria([{ valor: '10', categoria: null }])[0].nome).toBe('Outros');
  });
  it('comissão por profissional = soma das comissões do período', () => {
    expect(comissaoPorProfissional(recortarDados(fx, SET).comissoes)).toEqual({ p1: 80, p2: 60 });
  });
  it('insumos: top por quantidade, custo total de todos', () => {
    const movs = [
      { produto_id: 'x', quantidade: '2', produto: { nome: 'Ácido', preco_custo: '10.50' } },
      { produto_id: 'x', quantidade: 1, produto: { nome: 'Ácido', preco_custo: 10.5 } },
      { produto_id: 'y', quantidade: 5, produto: null },
    ];
    const r = resumoInsumos(movs, 3, 1);
    expect(r.ranking).toEqual([{ produtoId: 'y', nome: 'Produto', qtd: 5, custo: 0, pct: 100 }]);
    expect(r.custoTotal).toBe(31.5);
    expect(r.custoMedioPorAtendimento).toBe(10.5);
    expect(resumoInsumos(movs, 0).custoMedioPorAtendimento).toBeNull();
  });
  it('avaliações', () => {
    const avs: AvaliacaoRow[] = [
      { nota: 5, comentario: null, created_at: 'x', profissional_id: 'm1', profissional: { user: { nome: 'Ana' } }, cliente: { nome: 'C' } },
      { nota: 4, comentario: 'ok', created_at: 'x', profissional_id: 'm1', profissional: { user: { nome: 'Ana' } }, cliente: null },
      { nota: 4, comentario: null, created_at: 'x', profissional_id: null, profissional: null, cliente: null },
    ];
    const r = resumoAvaliacoes(avs);
    expect(r.notaMedia).toBeCloseTo(4.333, 2);
    expect([r.total, r.comNota5, r.pctNota5]).toEqual([3, 1, 33]);
    expect(r.ranking).toEqual([{ nome: 'Ana', media: 4.5, qtd: 2 }, { nome: 'Sem profissional', media: 4, qtd: 1 }]);
    expect(resumoAvaliacoes([])).toEqual({ notaMedia: null, total: 0, comNota5: 0, pctNota5: null, ranking: [] });
  });
});

describe('cartões e resumo financeiro (mesma lista web e app)', () => {
  it('cartões', () => {
    const c = cartoesKpiRelatorio(k, kAnt, { periodo: 'mes', isOwner: false, retiradasPeriodo: 0, fmt });
    expect(c.map(x => x.id)).toEqual(['bruto', 'cartao', 'liquido', 'lucro', 'atendimentos', 'ticket', 'comparecimento', 'cancelamento', 'taxas', 'comissoes']);
    expect(c[0]).toMatchObject({ valor: 'R$560', sub: 'inc. R$130 em vendas', delta: 2140, rotuloDelta: 'vs mês anterior' });
    expect(c.find(x => x.id === 'atendimentos')).toMatchObject({ valor: '3', delta: null });
    expect(c.find(x => x.id === 'cancelamento')).toMatchObject({ valor: '33.3%', sub: '2 perdido(s)', negativo: true });
    expect(c.find(x => x.id === 'comissoes')?.sub).toBe('R$80 pendentes');
    const dona = cartoesKpiRelatorio(k, kAnt, { periodo: 'mes', isOwner: true, retiradasPeriodo: 17, fmt });
    expect(dona.map(x => x.id).slice(3, 5)).toEqual(['lucro', 'aposRetiradas']);
    expect(dona[4]).toMatchObject({ valor: 'R$100', sub: '(−) R$17 da dona' });
  });
  it('resumo financeiro', () => {
    expect(linhasResumoFinanceiro(k, { isOwner: false, retiradasPeriodo: 0 }).map(l => [l.id, l.valor])).toEqual([
      ['servicos', 350], ['vendas', 130], ['taxas', 80], ['bruto', 560], ['cartao', 7.5], ['comissoes', 140], ['despesas', 295.5], ['lucro', 117],
    ]);
    expect(linhasResumoFinanceiro(k, { isOwner: true, retiradasPeriodo: 17 }).slice(-2).map(l => [l.id, l.valor]))
      .toEqual([['retiradas', 17], ['aposRetiradas', 100]]);
  });
});

describe('consultas das abas sob demanda', () => {
  it('estoque: saídas do período, paginado', async () => {
    const { db, chamadas } = fakeDb();
    await carregarSaidasEstoque(db, 'emp', SET);
    const [ops] = opsDe(chamadas, 'estoque_movimentos');
    expect(ops).toContainEqual(['eq', ['tipo', 'saida']]);
    expect(ops).toContainEqual(['gte', ['created_at', SET.startIso]]);
    expect(ops).toContainEqual(['order', ['id']]);
  });
  it('avaliações: nome da profissional pelo membro → users (empresa_membros não tem nome)', async () => {
    expect(COLUNAS_AVALIACAO).toContain('empresa_membros!avaliacoes_profissional_id_fkey(user:users!empresa_membros_user_id_fkey(nome))');
    const { db, chamadas } = fakeDb();
    await carregarAvaliacoes(db, 'emp', SET);
    expect(opsDe(chamadas, 'avaliacoes')[0]).toContainEqual(['order', ['created_at', { ascending: false }]]);
    await expect(carregarAvaliacoes(fakeDb({ erroEm: 'avaliacoes' }).db, 'emp', SET)).rejects.toThrow();
  });
});
