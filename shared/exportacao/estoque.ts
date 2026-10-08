import { formatarMoeda } from '../moeda';
import { rotuloMesAno } from '../periodos';
import { dataHoraBR, type DefinicaoExportacao } from './tipos';

/** `categoria` e `status` já vêm com o rótulo da plataforma. */
export type LinhaProduto = { nome: string; categoria: string; unidade: string; estoqueAtual: number; estoqueMinimo: number; precoCusto: number; status: string };

/** Exportação do cadastro de produtos do estoque. */
export function definicaoEstoqueProdutos(): DefinicaoExportacao<LinhaProduto> {
  return {
    arquivo: 'estoque-produtos',
    titulo: 'Estoque — Produtos',
    colunas: [
      { cabecalho: 'Nome', valor: l => l.nome, largura: 30 },
      { cabecalho: 'Categoria', valor: l => l.categoria, largura: 16 },
      { cabecalho: 'Unidade', valor: l => l.unidade, largura: 10 },
      { cabecalho: 'Estoque Atual', valor: l => l.estoqueAtual, largura: 14 },
      { cabecalho: 'Estoque Mín.', valor: l => l.estoqueMinimo, largura: 14 },
      { cabecalho: 'Custo Unit.', valor: l => (l.precoCusto > 0 ? formatarMoeda(l.precoCusto) : ''), largura: 14 },
      { cabecalho: 'Status', valor: l => l.status, largura: 10 },
    ],
  };
}

/** `tipo` é o valor cru do banco (entrada/saida/ajuste); web e app passam do mesmo jeito. */
export type LinhaMovimentacao = { criadoEm: string; produto: string; tipo: string; quantidade: number; unidade: string; motivo: string | null };

/** Exportação das movimentações de estoque do mês ('yyyy-MM'). */
export function definicaoEstoqueMovimentacoes(mes: string): DefinicaoExportacao<LinhaMovimentacao> {
  return {
    arquivo: 'estoque-movimentacoes',
    titulo: `Movimentações — ${rotuloMesAno(mes)}`,
    colunas: [
      { cabecalho: 'Data', valor: l => dataHoraBR(l.criadoEm), largura: 18 },
      { cabecalho: 'Produto', valor: l => l.produto, largura: 28 },
      { cabecalho: 'Tipo', valor: l => l.tipo, largura: 10 },
      { cabecalho: 'Qtd', valor: l => `${l.quantidade} ${l.unidade}`, largura: 10 },
      { cabecalho: 'Motivo', valor: l => l.motivo ?? '', largura: 28 },
    ],
  };
}
