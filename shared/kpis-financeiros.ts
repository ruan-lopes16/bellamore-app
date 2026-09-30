/**
 * @file kpis-financeiros.ts
 * Números financeiros ÚNICOS de web e mobile: Financeiro, Dashboard,
 * Relatórios e área da profissional. As telas buscam as linhas com
 * kpis-financeiros-consultas.ts e chamam estas funções — nenhuma tela soma
 * receita, comissão ou lucro por conta própria.
 *
 * Regras (decisões do dono, 2026-09-30):
 * - Faturamento bruto = atendimentos 'concluido' SEM sessão de pacote
 *   (agendamentos.valor, data = data_hora_inicio) + vendas avulsas
 *   (valor_final, created_at) + taxas de cancelamento pagas (paga_em) + taxas
 *   de reserva com paga_em (inclui as retidas depois de pagas).
 *   `pagamentos` NÃO é receita: só taxa de cartão e formas de pagamento.
 * - Taxa de cartão = Σ (pagamentos.valor − valor_liquido) quando há valor_liquido.
 * - Comissões = tabela `comissoes` (valor gerado), datada por created_at.
 *   Nunca recalcular pelo percentual_comissao atual.
 * - Despesas = só status 'pago', datadas por data_pagamento.
 * - Lucro = bruto − taxa de cartão − comissões − despesas.
 * - Fechamento importado (financeiro_ajustes_mensais) substitui receita E
 *   comissão do mês e zera a taxa de cartão — só nos meses que o período
 *   cobre por inteiro. Despesas nunca vêm do fechamento.
 * - Ticket médio = receita de serviços sem pacote ÷ atendimentos sem pacote.
 * - Datas em Brasília (ver periodos.ts). Toda função recorta as linhas pelos
 *   limites recebidos: o resultado não depende da janela que a tela buscou.
 */
import {
  type Limites, contemInstante, contemData, chaveMesBRT, mesesDoIntervalo, mesesInteirosDoIntervalo,
} from './periodos';
import { type FinanceiroFechamentoRow, getFechamentoForMonth } from './fechamentos-mensais';
import {
  type RetiradaSociaRow, type RetiradaSociaDevolucaoRow, retiradasNoPeriodo, somaDevolucoesPorRetirada,
} from './retiradas-socia';

// ── Linhas (formato mínimo que as consultas trazem) ────────────────

/** numeric do Postgres pode chegar como number ou string. */
export type Valor = number | string | null | undefined;

export type AgendamentoFinRow = {
  id: string;
  valor: Valor;
  status: string;
  data_hora_inicio: string;
  pacote_cliente_id: string | null;
  cliente_id: string | null;
  profissional_id: string | null;
  servico_id: string | null;
  servico?: { nome: string; categoria?: string | null } | null;
  profissional?: { nome: string; foto_url?: string | null } | null;
  cliente?: { nome: string } | null;
};
export type VendaFinRow = { id: string; valor_final: Valor; created_at: string };
export type TaxaPagaFinRow = { id: string; valor: Valor; paga_em: string | null };
export type PagamentoFinRow = { id: string; metodo: string; valor: Valor; valor_liquido: Valor; created_at: string };
export type ComissaoFinRow = { id: string; profissional_id: string; valor_comissao: Valor; status: string; created_at: string };
export type DespesaFinRow = { id: string; valor: Valor; categoria: string | null; status: string; data_pagamento: string | null };

export type DadosFinanceiros = {
  agendamentos: AgendamentoFinRow[];
  vendas: VendaFinRow[];
  taxasCancelamento: TaxaPagaFinRow[];
  taxasReserva: TaxaPagaFinRow[];
  pagamentos: PagamentoFinRow[];
  comissoes: ComissaoFinRow[];
  despesas: DespesaFinRow[];
  fechamentos: FinanceiroFechamentoRow[];
};

export const DADOS_VAZIOS: DadosFinanceiros = {
  agendamentos: [], vendas: [], taxasCancelamento: [], taxasReserva: [],
  pagamentos: [], comissoes: [], despesas: [], fechamentos: [],
};

export type KpisFinanceiros = {
  receitaServicos: number;
  receitaVendas: number;
  receitaTaxasCancelamento: number;
  receitaTaxasReserva: number;
  /** Faturamento bruto (com fechamento importado aplicado). */
  bruto: number;
  taxasCartao: number;
  liquidoAposTaxas: number;
  comissoes: number;
  /** Comissões geradas no período ainda não pagas (ao vivo). */
  comissoesPendentes: number;
  despesas: number;
  lucro: number;
  /** Concluídos, inclusive sessões de pacote. */
  atendimentos: number;
  /** Concluídos sem pacote (base do ticket médio). */
  atendimentosFaturaveis: number;
  ticketMedio: number;
  totalAgendamentos: number;
  cancelados: number;
  faltas: number;
  perdidos: number;
  /** (cancelados + faltas) ÷ todos os agendamentos do período × 100. */
  pctCancelamento: number;
  /** concluídos ÷ (concluídos + faltas) × 100. */
  pctComparecimento: number;
  /** Meses ('yyyy-MM') em que o fechamento importado substituiu o cálculo ao vivo. */
  mesesComFechamento: string[];
};

export const KPIS_ZERADOS: KpisFinanceiros = {
  receitaServicos: 0, receitaVendas: 0, receitaTaxasCancelamento: 0, receitaTaxasReserva: 0,
  bruto: 0, taxasCartao: 0, liquidoAposTaxas: 0, comissoes: 0, comissoesPendentes: 0,
  despesas: 0, lucro: 0, atendimentos: 0, atendimentosFaturaveis: 0, ticketMedio: 0,
  totalAgendamentos: 0, cancelados: 0, faltas: 0, perdidos: 0,
  pctCancelamento: 0, pctComparecimento: 0, mesesComFechamento: [],
};

// ── Utilitários ────────────────────────────────────────────────────

export function num(v: Valor): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

export function arredondar(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Atendimento que é receita: concluído e NÃO é sessão de pacote (já paga na venda do pacote). */
export function ehAtendimentoFaturavel(a: Pick<AgendamentoFinRow, 'status' | 'pacote_cliente_id'>): boolean {
  return a.status === 'concluido' && !a.pacote_cliente_id;
}

/** Mantém só as linhas dentro dos limites (e só despesas pagas). */
export function recortarDados(d: DadosFinanceiros, l: Limites): DadosFinanceiros {
  return {
    agendamentos: d.agendamentos.filter(a => contemInstante(l, a.data_hora_inicio)),
    vendas: d.vendas.filter(v => contemInstante(l, v.created_at)),
    taxasCancelamento: d.taxasCancelamento.filter(t => contemInstante(l, t.paga_em)),
    taxasReserva: d.taxasReserva.filter(t => contemInstante(l, t.paga_em)),
    pagamentos: d.pagamentos.filter(p => contemInstante(l, p.created_at)),
    comissoes: d.comissoes.filter(c => contemInstante(l, c.created_at)),
    despesas: d.despesas.filter(x => x.status === 'pago' && contemData(l, x.data_pagamento)),
    fechamentos: d.fechamentos,
  };
}

function somarEm(mapa: Record<string, number>, chave: string, valor: number) {
  mapa[chave] = (mapa[chave] ?? 0) + valor;
}

function taxaDeCartao(p: PagamentoFinRow): number {
  return p.valor_liquido == null ? 0 : num(p.valor) - num(p.valor_liquido);
}

// ── KPIs do período ────────────────────────────────────────────────

export function calcularKpisFinanceiros(dados: DadosFinanceiros, l: Limites): KpisFinanceiros {
  const d = recortarDados(dados, l);
  const concluidos = d.agendamentos.filter(a => a.status === 'concluido');
  const faturaveis = concluidos.filter(a => !a.pacote_cliente_id);
  const faltas = d.agendamentos.filter(a => a.status === 'faltou').length;
  const cancelados = d.agendamentos.filter(a => a.status === 'cancelado').length;

  const receitaServicos = faturaveis.reduce((s, a) => s + num(a.valor), 0);
  const receitaVendas = d.vendas.reduce((s, v) => s + num(v.valor_final), 0);
  const receitaTaxasCancelamento = d.taxasCancelamento.reduce((s, t) => s + num(t.valor), 0);
  const receitaTaxasReserva = d.taxasReserva.reduce((s, t) => s + num(t.valor), 0);

  // Mês a mês (Brasília), para aplicar o fechamento importado onde houver.
  const receitaMes: Record<string, number> = {};
  const comissaoMes: Record<string, number> = {};
  const cartaoMes: Record<string, number> = {};
  faturaveis.forEach(a => somarEm(receitaMes, chaveMesBRT(a.data_hora_inicio), num(a.valor)));
  d.vendas.forEach(v => somarEm(receitaMes, chaveMesBRT(v.created_at), num(v.valor_final)));
  d.taxasCancelamento.forEach(t => somarEm(receitaMes, chaveMesBRT(t.paga_em as string), num(t.valor)));
  d.taxasReserva.forEach(t => somarEm(receitaMes, chaveMesBRT(t.paga_em as string), num(t.valor)));
  d.comissoes.forEach(c => somarEm(comissaoMes, chaveMesBRT(c.created_at), num(c.valor_comissao)));
  d.pagamentos.forEach(p => somarEm(cartaoMes, chaveMesBRT(p.created_at), taxaDeCartao(p)));

  const inteiros = new Set(mesesInteirosDoIntervalo(l));
  let bruto = 0;
  let comissoes = 0;
  let taxasCartao = 0;
  const mesesComFechamento: string[] = [];
  for (const k of mesesDoIntervalo(l)) {
    const fechamento = inteiros.has(k) ? getFechamentoForMonth(d.fechamentos, k) : null;
    if (fechamento) {
      bruto += fechamento.receitaBruta;
      comissoes += fechamento.comissao;
      mesesComFechamento.push(k);
      continue;
    }
    bruto += receitaMes[k] ?? 0;
    comissoes += comissaoMes[k] ?? 0;
    taxasCartao += cartaoMes[k] ?? 0;
  }

  const despesas = d.despesas.reduce((s, x) => s + num(x.valor), 0);
  const comissoesPendentes = d.comissoes
    .filter(c => c.status === 'pendente')
    .reduce((s, c) => s + num(c.valor_comissao), 0);
  const totalAgendamentos = d.agendamentos.length;
  const perdidos = cancelados + faltas;
  const baseComparecimento = concluidos.length + faltas;

  return {
    receitaServicos: arredondar(receitaServicos),
    receitaVendas: arredondar(receitaVendas),
    receitaTaxasCancelamento: arredondar(receitaTaxasCancelamento),
    receitaTaxasReserva: arredondar(receitaTaxasReserva),
    bruto: arredondar(bruto),
    taxasCartao: arredondar(taxasCartao),
    liquidoAposTaxas: arredondar(bruto - taxasCartao),
    comissoes: arredondar(comissoes),
    comissoesPendentes: arredondar(comissoesPendentes),
    despesas: arredondar(despesas),
    lucro: arredondar(bruto - taxasCartao - comissoes - despesas),
    atendimentos: concluidos.length,
    atendimentosFaturaveis: faturaveis.length,
    ticketMedio: faturaveis.length > 0 ? arredondar(receitaServicos / faturaveis.length) : 0,
    totalAgendamentos,
    cancelados,
    faltas,
    perdidos,
    pctCancelamento: totalAgendamentos > 0 ? (perdidos / totalAgendamentos) * 100 : 0,
    pctComparecimento: baseComparecimento > 0 ? (concluidos.length / baseComparecimento) * 100 : 0,
    mesesComFechamento,
  };
}

/**
 * Variação % inteira de `atual` sobre `anterior`. `null` com base zero (a tela
 * esconde o delta). Base negativa (lucro) usa o módulo: melhorar é positivo.
 */
export function variacaoPercentual(atual: number, anterior: number): number | null {
  if (!anterior) return null;
  return Math.round(((atual - anterior) / Math.abs(anterior)) * 100);
}

// ── Retiradas da dona ──────────────────────────────────────────────

/** "Após retiradas" = lucro − retiradas da dona no período. */
export function resultadoAposRetiradas(lucro: number, retiradas: number): number {
  return arredondar(lucro - retiradas);
}

/** Total que conta como retirada da dona nos limites (ver retiradasNoPeriodo). */
export function retiradasDoPeriodo(
  rows: Pick<RetiradaSociaRow, 'id' | 'tipo' | 'valor' | 'data' | 'convertido_em'>[],
  devs: Pick<RetiradaSociaDevolucaoRow, 'retirada_id' | 'valor'>[],
  l: Limites,
): number {
  return retiradasNoPeriodo(rows, somaDevolucoesPorRetirada(devs), l.startDate, l.endDate);
}

/** Retiradas para a LISTA do período (data ou conversão dentro), mais recentes primeiro. */
export function listarRetiradasDoPeriodo<T extends Pick<RetiradaSociaRow, 'data' | 'convertido_em'>>(
  rows: T[],
  l: Limites,
): T[] {
  return rows
    .filter(r => contemData(l, r.data) || contemData(l, r.convertido_em))
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
}
