import { formatarMoeda } from '../moeda';
import { rotuloMesAno } from '../periodos';
import type { DefinicaoExportacao } from './tipos';

/** `atendimentosMes`/`totalMes` = `null` quando a pessoa não pode ver esse número (sai "—", igual à tela). */
export type LinhaEquipe = { nome: string; telefone: string | null; percentual: number; atendimentosMes: number | null; totalMes: number | null; ativo: boolean };

/** Exportação da equipe com o resumo do mês ('yyyy-MM'). */
export function definicaoEquipe(mes: string): DefinicaoExportacao<LinhaEquipe> {
  return {
    arquivo: `equipe-${mes}`,
    titulo: `Equipe — ${rotuloMesAno(mes)}`,
    colunas: [
      { cabecalho: 'Nome', valor: l => l.nome, largura: 28 },
      { cabecalho: 'Telefone', valor: l => l.telefone ?? '', largura: 18 },
      { cabecalho: 'Comissão (%)', valor: l => `${l.percentual}%`, largura: 14 },
      { cabecalho: 'Atend./mês', valor: l => l.atendimentosMes ?? '—', largura: 14 },
      { cabecalho: 'Total/mês', valor: l => (l.totalMes === null ? '—' : formatarMoeda(l.totalMes)), largura: 16 },
      { cabecalho: 'Status', valor: l => (l.ativo ? 'Ativo' : 'Inativo'), largura: 10 },
    ],
  };
}
