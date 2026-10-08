import { formatarMoeda } from '../moeda';
import { dataHoraBR, type DefinicaoExportacao } from './tipos';

/** `metodo` dos pagamentos já vem com o rótulo da plataforma. */
export type LinhaVenda = { criadoEm: string; cliente: string | null; itens: { produto: string; quantidade: number }[]; total: number; pagamentos: { metodo: string; valor: number }[] };

/** Exportação do histórico de vendas avulsas. */
export function definicaoVendas(): DefinicaoExportacao<LinhaVenda> {
  return {
    arquivo: 'vendas-historico',
    titulo: 'Histórico de Vendas',
    colunas: [
      { cabecalho: 'Data', valor: l => dataHoraBR(l.criadoEm), largura: 18 },
      { cabecalho: 'Cliente', valor: l => l.cliente ?? 'Avulso', largura: 24 },
      { cabecalho: 'Itens', valor: l => l.itens.map(i => `${i.produto} ×${i.quantidade}`).join(', '), largura: 40 },
      { cabecalho: 'Total', valor: l => formatarMoeda(l.total), largura: 14 },
      { cabecalho: 'Pagamentos', valor: l => l.pagamentos.map(p => `${p.metodo} ${formatarMoeda(p.valor)}`).join(' + '), largura: 30 },
    ],
  };
}
