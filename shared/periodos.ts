/**
 * @file periodos.ts
 * Limites de período no fuso de Brasília (America/Sao_Paulo). Fonte ÚNICA de
 * web e mobile para Financeiro, Dashboard, Relatórios e área da profissional.
 *
 * O Brasil não tem horário de verão desde 2019: Brasília é UTC−3 fixo. Tudo
 * aqui trabalha com strings 'yyyy-MM-dd' / 'yyyy-MM' e aritmética em UTC, então
 * o resultado NÃO depende do fuso do aparelho nem do servidor (o Dashboard web
 * roda num servidor em UTC). Sem date-fns de propósito: shared/ não tem
 * dependências.
 *
 * Regras de uso:
 * - Colunas timestamptz (data_hora_inicio, created_at, paga_em) filtram por
 *   `startIso` / `endIso` (00:00 BRT do 1º dia até 23:59:59.999 BRT do último).
 * - Colunas date (data_pagamento, data_vencimento, mes, data) filtram por
 *   `startDate` / `endDate`.
 * - A semana começa no DOMINGO nas duas plataformas.
 */

export const OFFSET_BRT_MS = 3 * 60 * 60 * 1000;
const DIA_MS = 86_400_000;

export type Limites = {
  /** 00:00:00.000 BRT do primeiro dia, em ISO UTC (ex.: '2026-09-01T03:00:00.000Z'). */
  startIso: string;
  /** 23:59:59.999 BRT do último dia, em ISO UTC (ex.: '2026-10-01T02:59:59.999Z'). */
  endIso: string;
  /** Primeiro dia 'yyyy-MM-dd' (colunas date). */
  startDate: string;
  /** Último dia 'yyyy-MM-dd' (colunas date). */
  endDate: string;
};

const pad = (n: number) => String(n).padStart(2, '0');
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

function msDoDia(dia: string): number {
  const [a, m, d] = dia.slice(0, 10).split('-').map(Number);
  return Date.UTC(a, m - 1, d);
}
function diaDoMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Soma `n` dias (pode ser negativo) a 'yyyy-MM-dd'. */
export function somarDias(dia: string, n: number): string {
  return diaDoMs(msDoDia(dia) + n * DIA_MS);
}

/** Nº de dias de `inicio` até `fim` ('2026-09-01' → '2026-09-30' = 29). */
export function diasEntre(inicio: string, fim: string): number {
  return Math.round((msDoDia(fim) - msDoDia(inicio)) / DIA_MS);
}

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(dia: string): number {
  return new Date(msDoDia(dia)).getUTCDay();
}

/** Soma `n` meses a uma chave 'yyyy-MM'. */
export function somarMeses(chave: string, n: number): string {
  const [a, m] = chave.slice(0, 7).split('-').map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** Último dia 'yyyy-MM-dd' do mês 'yyyy-MM'. */
export function ultimoDiaDoMes(chave: string): string {
  const k = chave.slice(0, 7);
  const [a, m] = k.split('-').map(Number);
  return `${k}-${pad(new Date(Date.UTC(a, m, 0)).getUTCDate())}`;
}

/**
 * Dia 'yyyy-MM-dd' em Brasília. Aceita timestamptz ('2026-10-01T02:30:00+00:00'),
 * Date ou uma data 'yyyy-MM-dd' (devolvida como está — coluna date não tem fuso).
 */
export function chaveDiaBRT(valor: string | Date): string {
  if (typeof valor === 'string' && RE_DIA.test(valor)) return valor;
  const ms = typeof valor === 'string' ? Date.parse(valor) : valor.getTime();
  return diaDoMs(ms - OFFSET_BRT_MS);
}

/** Mês 'yyyy-MM' em Brasília (substitui `timestamp.slice(0, 7)`, que agrupa em UTC). */
export function chaveMesBRT(valor: string | Date): string {
  return chaveDiaBRT(valor).slice(0, 7);
}

/** Hoje em Brasília, 'yyyy-MM-dd'. */
export function hojeBRT(agora: Date = new Date()): string {
  return chaveDiaBRT(agora);
}

/** Limites do dia `inicio` 00:00 BRT até o dia `fim` 23:59:59.999 BRT. */
export function limitesDias(inicio: string, fim: string): Limites {
  return {
    startIso: new Date(msDoDia(inicio) + OFFSET_BRT_MS).toISOString(),
    endIso: new Date(msDoDia(fim) + DIA_MS + OFFSET_BRT_MS - 1).toISOString(),
    startDate: inicio.slice(0, 10),
    endDate: fim.slice(0, 10),
  };
}

/** Limites do mês 'yyyy-MM' em Brasília. */
export function limitesMes(chave: string): Limites {
  const k = chave.slice(0, 7);
  return limitesDias(`${k}-01`, ultimoDiaDoMes(k));
}

/**
 * Chave 'yyyy-MM' do mês que a TELA mostra. `mes` é o Date do seletor de mês
 * (calendário local do aparelho): usa ano/mês locais, sem converter fuso.
 */
export function chaveDoMesExibido(mes: Date): string {
  return `${mes.getFullYear()}-${pad(mes.getMonth() + 1)}`;
}

/** Limites do mês exibido na tela (substitui web/lib/financeiro/periodo-mensal). */
export function getMonthQueryBounds(mes: Date): Limites {
  return limitesMes(chaveDoMesExibido(mes));
}

/** Menor intervalo que contém `a` e `b` (para buscar o período e o anterior numa consulta só). */
export function uniaoLimites(a: Limites, b: Limites): Limites {
  const inicio = a.startDate <= b.startDate ? a.startDate : b.startDate;
  const fim = a.endDate >= b.endDate ? a.endDate : b.endDate;
  return limitesDias(inicio, fim);
}

/** O instante (timestamptz) cai dentro dos limites? */
export function contemInstante(l: Limites, ts: string | null | undefined): boolean {
  if (!ts) return false;
  const ms = Date.parse(ts);
  return ms >= Date.parse(l.startIso) && ms <= Date.parse(l.endIso);
}

/** A data (coluna date 'yyyy-MM-dd') cai dentro dos limites? */
export function contemData(l: Limites, dia: string | null | undefined): boolean {
  if (!dia) return false;
  const d = dia.slice(0, 10);
  return d >= l.startDate && d <= l.endDate;
}

/** Chaves 'yyyy-MM' de todos os meses que o intervalo toca. */
export function mesesDoIntervalo(l: Limites): string[] {
  const out: string[] = [];
  const fim = l.endDate.slice(0, 7);
  for (let k = l.startDate.slice(0, 7); k <= fim; k = somarMeses(k, 1)) out.push(k);
  return out;
}

/** Só os meses que o intervalo cobre do dia 1 ao último dia. */
export function mesesInteirosDoIntervalo(l: Limites): string[] {
  return mesesDoIntervalo(l).filter(k => l.startDate <= `${k}-01` && l.endDate >= ultimoDiaDoMes(k));
}

// ── Períodos dos relatórios (lista ÚNICA web + mobile) ─────────────

export type PeriodoRelatorio =
  | 'hoje' | 'semana' | 'mes' | 'mes_anterior' | 'trimestre' | 'semestre' | 'ano' | 'custom';

export const PERIODOS_RELATORIO: { key: PeriodoRelatorio; label: string }[] = [
  { key: 'hoje',         label: 'Hoje' },
  { key: 'semana',       label: 'Semana' },
  { key: 'mes',          label: 'Mês' },
  { key: 'mes_anterior', label: 'Mês anterior' },
  { key: 'trimestre',    label: '3 meses' },
  { key: 'semestre',     label: '6 meses' },
  { key: 'ano',          label: 'Ano' },
  { key: 'custom',       label: 'Personalizado' },
];

/** Legenda do delta "vs …" de cada período. */
export const ROTULO_COMPARACAO: Record<PeriodoRelatorio, string> = {
  hoje:         'vs ontem',
  semana:       'vs semana anterior',
  mes:          'vs mês anterior',
  mes_anterior: 'vs mês retrasado',
  trimestre:    'vs 3 meses anteriores',
  semestre:     'vs 6 meses anteriores',
  ano:          'vs ano anterior',
  custom:       'vs período anterior',
};

export type OpcoesPeriodo = {
  /** Semanas a partir da atual (0 = esta, −1 = passada). Só em 'semana'. */
  semanaOffset?: number;
  /** Anos a partir do atual. Só em 'ano'. */
  anoOffset?: number;
  /** Intervalo 'yyyy-MM-dd'. Só em 'custom'. */
  custom?: { ini: string; fim: string };
};

function blocoDeMeses(mesAtual: string, n: number): { atual: Limites; anterior: Limites } {
  const ini = somarMeses(mesAtual, -(n - 1));
  const iniAnt = somarMeses(mesAtual, -(2 * n - 1));
  const fimAnt = somarMeses(mesAtual, -n);
  return {
    atual: limitesDias(`${ini}-01`, ultimoDiaDoMes(mesAtual)),
    anterior: limitesDias(`${iniAnt}-01`, ultimoDiaDoMes(fimAnt)),
  };
}

/**
 * Limites do período escolhido e do período anterior equivalente (para os
 * deltas). `hoje` = hojeBRT() — recebido por parâmetro para ser testável.
 */
export function limitesDoPeriodo(
  periodo: PeriodoRelatorio,
  hoje: string,
  opcoes: OpcoesPeriodo = {},
): { atual: Limites; anterior: Limites } {
  const mes = hoje.slice(0, 7);
  switch (periodo) {
    case 'hoje': {
      const ontem = somarDias(hoje, -1);
      return { atual: limitesDias(hoje, hoje), anterior: limitesDias(ontem, ontem) };
    }
    case 'semana': {
      const ref = somarDias(hoje, 7 * (opcoes.semanaOffset ?? 0));
      const ini = somarDias(ref, -diaDaSemana(ref)); // domingo
      return {
        atual: limitesDias(ini, somarDias(ini, 6)),
        anterior: limitesDias(somarDias(ini, -7), somarDias(ini, -1)),
      };
    }
    case 'mes':
      return { atual: limitesMes(mes), anterior: limitesMes(somarMeses(mes, -1)) };
    case 'mes_anterior':
      return { atual: limitesMes(somarMeses(mes, -1)), anterior: limitesMes(somarMeses(mes, -2)) };
    case 'trimestre':
      return blocoDeMeses(mes, 3);
    case 'semestre':
      return blocoDeMeses(mes, 6);
    case 'ano': {
      const a = Number(hoje.slice(0, 4)) + (opcoes.anoOffset ?? 0);
      return {
        atual: limitesDias(`${a}-01-01`, `${a}-12-31`),
        anterior: limitesDias(`${a - 1}-01-01`, `${a - 1}-12-31`),
      };
    }
    case 'custom': {
      let fim = opcoes.custom?.fim || hoje;
      if (fim > hoje) fim = hoje;
      let ini = opcoes.custom?.ini || `${mes}-01`;
      if (ini > fim) ini = fim;
      const duracao = diasEntre(ini, fim) + 1;
      const fimAnt = somarDias(ini, -1);
      return {
        atual: limitesDias(ini, fim),
        anterior: limitesDias(somarDias(fimAnt, -(duracao - 1)), fimAnt),
      };
    }
  }
}

// ── Rótulos (iguais nas duas plataformas) ─────────────────────────

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
export const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** 'set' para '2026-09' (ou '2026-09-15'). */
export function rotuloMesCurto(chave: string): string {
  return MESES_ABREV[Number(chave.slice(5, 7)) - 1];
}

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const ddmmaaaa = (d: string) => `${ddmm(d)}/${d.slice(0, 4)}`;

/** Rótulo do período exibido no cabeçalho dos relatórios. */
export function rotuloDoPeriodo(periodo: PeriodoRelatorio, l: Limites): string {
  switch (periodo) {
    case 'hoje':
      return ddmmaaaa(l.startDate);
    case 'semana':
      return `${ddmm(l.startDate)} – ${ddmm(l.endDate)}`;
    case 'mes':
    case 'mes_anterior':
      return `${MESES[Number(l.startDate.slice(5, 7)) - 1]} ${l.startDate.slice(0, 4)}`;
    case 'trimestre':
    case 'semestre':
      return `${rotuloMesCurto(l.startDate)} – ${rotuloMesCurto(l.endDate)} ${l.endDate.slice(0, 4)}`;
    case 'ano':
      return l.startDate.slice(0, 4);
    case 'custom':
      return `${ddmmaaaa(l.startDate)} – ${ddmmaaaa(l.endDate)}`;
  }
}
