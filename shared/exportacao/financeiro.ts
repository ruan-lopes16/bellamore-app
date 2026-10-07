import { formatarMoeda } from '../moeda';
import { rotuloMesAno } from '../periodos';
import { dataBR, type DefinicaoExportacao } from './tipos';

/** `categoria` já vem com o rótulo; `vencimento`/`pagamento` são 'yyyy-MM-dd'. */
export type LinhaDespesa = { descricao: string; categoria: string | null; valor: number; vencimento: string | null; pagamento: string | null; pago: boolean; recorrente: boolean };

/** Exportação das despesas do mês ('yyyy-MM'). */
export function definicaoDespesas(mes: string): DefinicaoExportacao<LinhaDespesa> {
  return {
    arquivo: `financeiro-despesas-${mes}`,
    titulo: `Despesas — ${rotuloMesAno(mes)}`,
    colunas: [
      { cabecalho: 'Descrição', valor: l => l.descricao, largura: 30 },
      { cabecalho: 'Categoria', valor: l => l.categoria ?? '', largura: 18 },
      { cabecalho: 'Valor', valor: l => formatarMoeda(l.valor), largura: 14 },
      { cabecalho: 'Vencimento', valor: l => dataBR(l.vencimento), largura: 14 },
      { cabecalho: 'Pagamento', valor: l => dataBR(l.pagamento), largura: 14 },
      { cabecalho: 'Status', valor: l => (l.pago ? 'Pago' : 'Pendente'), largura: 12 },
      { cabecalho: 'Recorrente', valor: l => (l.recorrente ? 'Sim' : 'Não'), largura: 12 },
    ],
  };
}
