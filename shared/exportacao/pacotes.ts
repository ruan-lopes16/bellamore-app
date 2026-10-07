import { formatarMoeda } from '../moeda';
import { dataBR, type DefinicaoExportacao } from './tipos';

export type LinhaPacoteCatalogo = { nome: string; preco: number; validadeDias: number | null; servicos: { nome: string; quantidade: number | null }[]; ativo: boolean };

/** Exportação do catálogo de pacotes. */
export function definicaoPacotesCatalogo(): DefinicaoExportacao<LinhaPacoteCatalogo> {
  return {
    arquivo: 'pacotes-catalogo',
    titulo: 'Catálogo de Pacotes',
    colunas: [
      { cabecalho: 'Nome', valor: l => l.nome, largura: 28 },
      { cabecalho: 'Preço', valor: l => formatarMoeda(l.preco), largura: 14 },
      { cabecalho: 'Validade (dias)', valor: l => l.validadeDias ?? 'Sem validade', largura: 14 },
      { cabecalho: 'Serviços', valor: l => l.servicos.map(s => `${s.nome} ×${s.quantidade ?? '∞'}`).join(', '), largura: 40 },
      { cabecalho: 'Status', valor: l => (l.ativo ? 'Ativo' : 'Inativo'), largura: 10 },
    ],
  };
}

/** `status` já vem com o rótulo da plataforma; `inicio`/`validade` são 'yyyy-MM-dd' ou ISO. */
export type LinhaPacoteVendido = { cliente: string; pacote: string; usadas: number; totalSessoes: number | null; valorPago: number | null; inicio: string | null; validade: string | null; status: string };

/** Exportação dos pacotes vendidos às clientes. */
export function definicaoPacotesVendidos(): DefinicaoExportacao<LinhaPacoteVendido> {
  return {
    arquivo: 'pacotes-vendidos',
    titulo: 'Pacotes Vendidos',
    colunas: [
      { cabecalho: 'Cliente', valor: l => l.cliente, largura: 26 },
      { cabecalho: 'Pacote', valor: l => l.pacote, largura: 26 },
      { cabecalho: 'Sessões usadas', valor: l => `${l.usadas}/${l.totalSessoes ?? '∞'}`, largura: 14 },
      { cabecalho: 'Valor pago', valor: l => (l.valorPago != null ? formatarMoeda(l.valorPago) : '—'), largura: 14 },
      { cabecalho: 'Início', valor: l => dataBR(l.inicio), largura: 12 },
      { cabecalho: 'Válido até', valor: l => (l.validade ? dataBR(l.validade) : 'Sem validade'), largura: 12 },
      { cabecalho: 'Status', valor: l => l.status, largura: 12 },
    ],
  };
}

export type LinhaUtilizacaoPacote = { nome: string; vendas: number; totalSessoes: number; sessoesUsadas: number; receita: number };

/** Exportação do relatório de utilização de pacotes. */
export function definicaoPacotesUtilizacao(): DefinicaoExportacao<LinhaUtilizacaoPacote> {
  return {
    arquivo: 'pacotes-relatorio',
    titulo: 'Relatório de Utilização de Pacotes',
    colunas: [
      { cabecalho: 'Pacote', valor: l => l.nome, largura: 28 },
      { cabecalho: 'Vendas', valor: l => l.vendas, largura: 10 },
      { cabecalho: 'Sessões totais', valor: l => l.totalSessoes, largura: 14 },
      { cabecalho: 'Sessões usadas', valor: l => l.sessoesUsadas, largura: 14 },
      { cabecalho: 'Aproveitamento', valor: l => `${l.totalSessoes > 0 ? Math.round((l.sessoesUsadas / l.totalSessoes) * 100) : 0}%`, largura: 14 },
      { cabecalho: 'Receita', valor: l => formatarMoeda(l.receita), largura: 16 },
    ],
  };
}
