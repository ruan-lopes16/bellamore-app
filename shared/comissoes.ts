/**
 * @file comissoes.ts
 * Regras ÚNICAS das telas de comissão de web e mobile: Comissões (gestão e
 * profissional), aba Comissões dos Relatórios e "Pagar" da Equipe.
 * - Fonte: tabela `comissoes` (valor gerado), período por created_at em
 *   Brasília. Nunca recalcular pelo percentual atual da profissional.
 * - "Pagar" = só as pendentes do período exibido (decisão do dono, 2026-10-01).
 */
import { arredondar, num, type Valor } from './kpis-financeiros';
import {
  chaveDiaBRT, chaveMesBRT, contemInstante, instanteMs, rotuloDiaCurto, rotuloMesAno,
  type Limites, type PeriodoComissao,
} from './periodos';

export type ComissaoDetalheRow = {
  id: string;
  profissional_id: string;
  agendamento_id: string | null;
  valor_servico: Valor;
  percentual: Valor;
  valor_comissao: Valor;
  status: string;
  created_at: string;
  profissional?: { nome: string | null } | null;
  agendamento?: {
    data_hora_inicio: string | null;
    valor?: Valor;
    servico?: { nome: string | null; categoria?: string | null; categoria_id?: string | null } | null;
    cliente?: { nome: string | null } | null;
  } | null;
};

export type ComissaoItem = {
  id: string;
  profissionalId: string;
  profissionalNome: string;
  agendamentoId: string | null;
  valorServico: number;
  percentual: number;
  valorComissao: number;
  status: 'pendente' | 'pago';
  criadaEm: string;
  /** Início do atendimento (exibição e agrupamento); null se o atendimento não veio. */
  dataAtendimento: string | null;
  valorAtendimento: number | null;
  servicoNome: string;
  servicoCategoria: string | null;
  servicoCategoriaId: string | null;
  clienteNome: string;
};

/** Converte uma linha crua (numeric vem como string) no formato usado pelas telas. */
export function normalizarComissao(r: ComissaoDetalheRow): ComissaoItem {
  const ag = r.agendamento ?? null;
  return {
    id: r.id,
    profissionalId: r.profissional_id,
    profissionalNome: r.profissional?.nome || 'Profissional',
    agendamentoId: r.agendamento_id ?? null,
    valorServico: num(r.valor_servico),
    percentual: num(r.percentual),
    valorComissao: num(r.valor_comissao),
    status: r.status === 'pago' ? 'pago' : 'pendente',
    criadaEm: r.created_at,
    dataAtendimento: ag?.data_hora_inicio ?? null,
    valorAtendimento: ag && ag.valor != null ? num(ag.valor) : null,
    servicoNome: ag?.servico?.nome || 'Serviço',
    servicoCategoria: ag?.servico?.categoria ?? null,
    servicoCategoriaId: ag?.servico?.categoria_id ?? null,
    clienteNome: ag?.cliente?.nome || '—',
  };
}

export function normalizarComissoes(rows: ComissaoDetalheRow[]): ComissaoItem[] {
  return rows.map(normalizarComissao);
}

export type FiltroComissao = 'todas' | 'pendentes' | 'pagas';
export const FILTROS_COMISSAO: { key: FiltroComissao; label: string }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'pendentes', label: 'Pendentes' },
  { key: 'pagas', label: 'Pagas' },
];

export function filtrarComissoes(itens: ComissaoItem[], filtro: FiltroComissao): ComissaoItem[] {
  if (filtro === 'pendentes') return itens.filter(c => c.status === 'pendente');
  if (filtro === 'pagas') return itens.filter(c => c.status === 'pago');
  return itens;
}

export type ResumoComissoes = { total: number; pendente: number; pago: number; quantidade: number };

export function resumoComissoes(itens: ComissaoItem[]): ResumoComissoes {
  let total = 0;
  let pendente = 0;
  for (const c of itens) {
    total += c.valorComissao;
    if (c.status === 'pendente') pendente += c.valorComissao;
  }
  const t = arredondar(total);
  const p = arredondar(pendente);
  return { total: t, pendente: p, pago: arredondar(t - p), quantidade: itens.length };
}

export type ComissoesDaProfissional = {
  profissionalId: string;
  nome: string;
  itens: ComissaoItem[];
  total: number;
  pendente: number;
  pago: number;
  atendimentos: number;
  /** Percentual das comissões do período, se for um só; null quando variou. */
  percentual: number | null;
  /** O que "Pagar" marca: as pendentes DESTE período. */
  idsPendentes: string[];
};

/** Um card por profissional (inclusive inativas), maior total primeiro. */
export function comissoesPorProfissional(itens: ComissaoItem[]): ComissoesDaProfissional[] {
  const mapa = new Map<string, ComissaoItem[]>();
  for (const c of itens) {
    const lista = mapa.get(c.profissionalId);
    if (lista) lista.push(c); else mapa.set(c.profissionalId, [c]);
  }
  const out: ComissoesDaProfissional[] = [];
  for (const [profissionalId, doProf] of mapa) {
    const r = resumoComissoes(doProf);
    const percentuais = new Set(doProf.map(c => c.percentual));
    out.push({
      profissionalId,
      nome: doProf[0].profissionalNome,
      itens: doProf,
      total: r.total, pendente: r.pendente, pago: r.pago,
      atendimentos: doProf.length,
      percentual: percentuais.size === 1 ? doProf[0].percentual : null,
      idsPendentes: doProf.filter(c => c.status === 'pendente').map(c => c.id),
    });
  }
  return out.sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
}

export type GrupoComissoes = { chave: string; rotulo: string; itens: ComissaoItem[] };

/** Por dia (Dia/Semana/Mês) ou por mês (Trimestre/Semestre/Ano), mais recente primeiro, em Brasília. */
export function agruparComissoesPorData(itens: ComissaoItem[], periodo: PeriodoComissao): GrupoComissoes[] {
  const porMes = periodo === 'trimestre' || periodo === 'semestre' || periodo === 'ano';
  const mapa = new Map<string, ComissaoItem[]>();
  for (const c of itens) {
    const ref = c.dataAtendimento ?? c.criadaEm;
    const chave = porMes ? chaveMesBRT(ref) : chaveDiaBRT(ref);
    const lista = mapa.get(chave);
    if (lista) lista.push(c); else mapa.set(chave, [c]);
  }
  return [...mapa.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([chave, lista]) => ({ chave, rotulo: porMes ? rotuloMesAno(chave) : rotuloDiaCurto(chave), itens: lista }));
}

export type PendentesDaProfissional = { idsDoPeriodo: string[]; valorDoPeriodo: number; valorAnterior: number };

/** Pendentes separadas em "do período" (o que Pagar marca) e "anteriores ao período" (só aviso). */
export function pendentesPorProfissional(
  rows: { id: string; profissional_id: string; valor_comissao: Valor; created_at: string }[],
  l: Limites,
): Record<string, PendentesDaProfissional> {
  const out: Record<string, PendentesDaProfissional> = {};
  const inicio = instanteMs(l.startIso);
  for (const c of rows) {
    const p = (out[c.profissional_id] ??= { idsDoPeriodo: [], valorDoPeriodo: 0, valorAnterior: 0 });
    if (contemInstante(l, c.created_at)) {
      p.idsDoPeriodo.push(c.id);
      p.valorDoPeriodo += num(c.valor_comissao);
    } else if (instanteMs(c.created_at) < inicio) {
      p.valorAnterior += num(c.valor_comissao);
    }
  }
  for (const p of Object.values(out)) {
    p.valorDoPeriodo = arredondar(p.valorDoPeriodo);
    p.valorAnterior = arredondar(p.valorAnterior);
  }
  return out;
}

export function rotuloPercentualComissao(percentual: number | null): string {
  return percentual == null ? 'vários %' : `${String(percentual).replace('.', ',')}%`;
}

export function textoConfirmarPagamento(nome: string, valorFormatado: string, rotuloPeriodo: string): string {
  return `Marcar como pagas as comissões pendentes de ${nome} em ${rotuloPeriodo} (${valorFormatado})?`;
}

export const MENSAGEM_PAGAMENTO_PARCIAL =
  'Algumas comissões não foram marcadas como pagas (sem permissão ou já estavam pagas). A lista foi atualizada.';
