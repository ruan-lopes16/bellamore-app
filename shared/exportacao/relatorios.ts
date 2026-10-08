import { formatarMoeda } from '../moeda';
import { dataBR, dataHoraBR, nomeArquivoSeguro, type DefinicaoExportacao } from './tipos';

export type AbaRelatorio = 'financeiro' | 'servicos' | 'equipe' | 'clientes' | 'estoque' | 'comissoes' | 'avaliacoes';
/** Ranking por serviço, profissional ou cliente (`comissao` só na aba Equipe). */
export type LinhaRanking = { nome: string; quantidade: number; valor: number; comissao?: number };
export type LinhaInsumo = { nome: string; quantidade: number; custo: number };
/** `status` já vem com o rótulo da plataforma. */
export type LinhaAtendimento = { inicio: string; cliente: string | null; servico: string | null; valor: number; status: string };
export type LinhaComissaoRelatorio = { profissional: string; dia: string; cliente: string; servico: string; valorAtendimento: number | null; percentual: number; comissao: number; pago: boolean };

/**
 * Exportação de uma aba dos Relatórios. A aba 'avaliacoes' não exporta
 * (o web não exporta hoje): lança `Error('Aba sem exportação')`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function definicaoRelatorio(aba: AbaRelatorio, rotuloAba: string, rotuloPeriodo: string): DefinicaoExportacao<any> {
  const base = { arquivo: nomeArquivoSeguro(`relatorio-${aba}-${rotuloPeriodo}`), titulo: `Relatório ${rotuloAba} — ${rotuloPeriodo}` };
  switch (aba) {
    case 'servicos':
      return { ...base, colunas: [
        { cabecalho: 'Serviço', valor: (l: LinhaRanking) => l.nome, largura: 30 },
        { cabecalho: 'Atendimentos', valor: (l: LinhaRanking) => l.quantidade, largura: 14 },
        { cabecalho: 'Receita', valor: (l: LinhaRanking) => formatarMoeda(l.valor), largura: 16 },
      ] };
    case 'equipe':
      return { ...base, colunas: [
        { cabecalho: 'Profissional', valor: (l: LinhaRanking) => l.nome, largura: 28 },
        { cabecalho: 'Atendimentos', valor: (l: LinhaRanking) => l.quantidade, largura: 14 },
        { cabecalho: 'Receita gerada', valor: (l: LinhaRanking) => formatarMoeda(l.valor), largura: 16 },
        { cabecalho: 'Comissão', valor: (l: LinhaRanking) => formatarMoeda(l.comissao ?? 0), largura: 16 },
      ] };
    case 'clientes':
      return { ...base, colunas: [
        { cabecalho: 'Cliente', valor: (l: LinhaRanking) => l.nome, largura: 28 },
        { cabecalho: 'Atendimentos', valor: (l: LinhaRanking) => l.quantidade, largura: 14 },
        { cabecalho: 'Total gasto', valor: (l: LinhaRanking) => formatarMoeda(l.valor), largura: 16 },
      ] };
    case 'estoque':
      return { ...base, colunas: [
        { cabecalho: 'Produto', valor: (l: LinhaInsumo) => l.nome, largura: 28 },
        { cabecalho: 'Qtd consumida', valor: (l: LinhaInsumo) => l.quantidade, largura: 14 },
        { cabecalho: 'Custo estimado', valor: (l: LinhaInsumo) => formatarMoeda(l.custo), largura: 16 },
      ] };
    case 'comissoes':
      return { ...base, colunas: [
        { cabecalho: 'Profissional', valor: (l: LinhaComissaoRelatorio) => l.profissional, largura: 22 },
        { cabecalho: 'Data', valor: (l: LinhaComissaoRelatorio) => dataBR(l.dia), largura: 12 },
        { cabecalho: 'Cliente', valor: (l: LinhaComissaoRelatorio) => l.cliente, largura: 22 },
        { cabecalho: 'Serviço', valor: (l: LinhaComissaoRelatorio) => l.servico, largura: 22 },
        { cabecalho: 'Vlr atend.', valor: (l: LinhaComissaoRelatorio) => (l.valorAtendimento != null ? formatarMoeda(l.valorAtendimento) : '—'), largura: 12 },
        { cabecalho: '%', valor: (l: LinhaComissaoRelatorio) => `${l.percentual}%`, largura: 6 },
        { cabecalho: 'Comissão', valor: (l: LinhaComissaoRelatorio) => formatarMoeda(l.comissao), largura: 12 },
        { cabecalho: 'Status', valor: (l: LinhaComissaoRelatorio) => (l.pago ? 'Pago' : 'Pendente'), largura: 10 },
      ] };
    case 'financeiro':
      return { ...base, colunas: [
        { cabecalho: 'Data', valor: (l: LinhaAtendimento) => dataHoraBR(l.inicio), largura: 18 },
        { cabecalho: 'Cliente', valor: (l: LinhaAtendimento) => l.cliente ?? '—', largura: 26 },
        { cabecalho: 'Serviço', valor: (l: LinhaAtendimento) => l.servico ?? '—', largura: 26 },
        { cabecalho: 'Valor', valor: (l: LinhaAtendimento) => formatarMoeda(l.valor), largura: 14 },
        { cabecalho: 'Status', valor: (l: LinhaAtendimento) => l.status, largura: 12 },
      ] };
    default:
      throw new Error('Aba sem exportação');
  }
}
