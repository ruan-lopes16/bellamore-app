import { formatarMoeda } from '../moeda';
import { dataBR, nomeArquivoSeguro, type DefinicaoExportacao } from './tipos';

export type LinhaComissao = { profissional: string; dia: string; servico: string; valorServico: number | null; percentual: number; comissao: number; pago: boolean };

/** Exportação da tela de Comissões para o período exibido (ex.: 'Outubro 2026'). */
export function definicaoComissoes(rotuloPeriodo: string): DefinicaoExportacao<LinhaComissao> {
  return {
    arquivo: nomeArquivoSeguro(`comissoes-${rotuloPeriodo}`),
    titulo: `Comissões — ${rotuloPeriodo}`,
    colunas: [
      { cabecalho: 'Profissional', valor: l => l.profissional, largura: 22 },
      { cabecalho: 'Data', valor: l => dataBR(l.dia), largura: 12 },
      { cabecalho: 'Serviço', valor: l => l.servico, largura: 24 },
      { cabecalho: 'Valor serviço', valor: l => (l.valorServico != null ? formatarMoeda(l.valorServico) : '—'), largura: 14 },
      { cabecalho: '% Comissão', valor: l => `${l.percentual}%`, largura: 12 },
      { cabecalho: 'Comissão', valor: l => formatarMoeda(l.comissao), largura: 12 },
      { cabecalho: 'Status', valor: l => (l.pago ? 'Pago' : 'Pendente'), largura: 10 },
    ],
  };
}
