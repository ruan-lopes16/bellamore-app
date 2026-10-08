import { formatarMoeda } from '../moeda';
import { rotuloMesAno } from '../periodos';
import type { DefinicaoExportacao } from './tipos';

export type LinhaEquipe = { nome: string; telefone: string | null; percentual: number; atendimentosMes: number; totalMes: number; ativo: boolean };

/** Exportação da equipe com o resumo do mês ('yyyy-MM'). */
export function definicaoEquipe(mes: string): DefinicaoExportacao<LinhaEquipe> {
  return {
    arquivo: `equipe-${mes}`,
    titulo: `Equipe — ${rotuloMesAno(mes)}`,
    colunas: [
      { cabecalho: 'Nome', valor: l => l.nome, largura: 28 },
      { cabecalho: 'Telefone', valor: l => l.telefone ?? '', largura: 18 },
      { cabecalho: 'Comissão (%)', valor: l => `${l.percentual}%`, largura: 14 },
      { cabecalho: 'Atend./mês', valor: l => l.atendimentosMes, largura: 14 },
      { cabecalho: 'Total/mês', valor: l => formatarMoeda(l.totalMes), largura: 16 },
      { cabecalho: 'Status', valor: l => (l.ativo ? 'Ativo' : 'Inativo'), largura: 10 },
    ],
  };
}
