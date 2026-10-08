import { formatarMoeda } from '../moeda';
import { horaBRT, rotuloDiaExtenso } from '../periodos';
import type { DefinicaoExportacao } from './tipos';

/** Linha de atendimento da agenda do dia; `status` já vem com o rótulo da plataforma. */
export type LinhaAgenda = { inicio: string; cliente: string | null; servico: string | null; profissional: string | null; valor: number; status: string };

/** Exportação da agenda de um dia ('yyyy-MM-dd'). */
export function definicaoAgenda(dia: string): DefinicaoExportacao<LinhaAgenda> {
  return {
    arquivo: `agenda-${dia}`,
    titulo: `Agenda — ${rotuloDiaExtenso(dia)}`,
    colunas: [
      { cabecalho: 'Horário', valor: l => horaBRT(l.inicio), largura: 10 },
      { cabecalho: 'Cliente', valor: l => l.cliente ?? '—', largura: 26 },
      { cabecalho: 'Serviço', valor: l => l.servico ?? '—', largura: 26 },
      { cabecalho: 'Profissional', valor: l => l.profissional ?? '—', largura: 20 },
      { cabecalho: 'Valor', valor: l => formatarMoeda(l.valor), largura: 14 },
      { cabecalho: 'Status', valor: l => l.status, largura: 12 },
    ],
  };
}
