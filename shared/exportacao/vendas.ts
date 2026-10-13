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

/** Venda como o histórico (web e app) a carrega. */
export type VendaHistoricoExportavel = {
  created_at: string; cliente: { nome: string } | null; valor_final: number;
  itens: { produto: { nome: string } | null; quantidade: number }[];
  pagamentos_venda: { metodo: string; valor: number }[];
};

/** Linhas da exportação a partir das vendas carregadas (mesma montagem no web e no app). */
export function linhasVendas(vendas: VendaHistoricoExportavel[], rotuloMetodo: (metodo: string) => string): LinhaVenda[] {
  return vendas.map(v => ({
    criadoEm: v.created_at,
    cliente: v.cliente?.nome ?? null,
    itens: v.itens.map(i => ({ produto: i.produto?.nome ?? '?', quantidade: i.quantidade })),
    total: Number(v.valor_final),
    pagamentos: v.pagamentos_venda.map(p => ({ metodo: rotuloMetodo(p.metodo), valor: Number(p.valor) })),
  }));
}
