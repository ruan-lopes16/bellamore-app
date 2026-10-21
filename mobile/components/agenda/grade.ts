/**
 * Grade da timeline da agenda do app (empresa e profissional). Funções puras, sem React Native,
 * sempre em Brasília (UTC−3) via `shared/periodos.ts`. A janela e os horários vêm de `shared/agenda.ts`.
 */
import { horariosDoDia, type Janela } from '@shared/agenda';
import { horaBRT, instanteMs, limitesDias } from '@shared/periodos';

/** Valor do filtro de profissional que mostra uma coluna por profissional. */
export const TODAS = 'todas' as const;
/** Profissional escolhida na agenda (id) ou "Todas". */
export type FiltroProfissional = string | typeof TODAS;

const HORA_MS = 60 * 60 * 1000;

/** Bloqueio como a grade precisa (subconjunto de `BloqueioAgenda`). */
type Bloco = {
  profissional_id: string | null;
  escopo: 'profissional' | 'geral';
  data_inicio: string;
  data_fim: string;
};

/** Horas cheias da janela (`ini` até `fim − 1`), a partir de `horariosDoDia` de hora em hora. */
export function horasDaJanela(janela: Janela): number[] {
  return horariosDoDia(janela, 60).map((h) => Number(h.slice(0, 2)));
}

/** Instante ISO de `hora`:00 do dia `dia` ("AAAA-MM-DD") em Brasília. */
export function instanteDaHora(dia: string, hora: number): string {
  return new Date(instanteMs(limitesDias(dia, dia).startIso) + hora * HORA_MS).toISOString();
}

/** Agrupa pela hora de início (Brasília), mantendo a ordem recebida. */
export function agruparPorHora<T extends { data_hora_inicio: string }>(ags: T[]): Record<number, T[]> {
  const out: Record<number, T[]> = {};
  for (const ag of ags) {
    const h = Number(horaBRT(ag.data_hora_inicio).slice(0, 2));
    (out[h] ??= []).push(ag);
  }
  return out;
}

/**
 * Bloqueios que valem para a agenda da profissional: os dela e os de escopo geral.
 * Em "Todas" devolve todos (cada coluna filtra os seus depois).
 */
export function bloqueiosDaProfissional<B extends Bloco>(bloqueios: B[], profissional: FiltroProfissional): B[] {
  if (profissional === TODAS) return bloqueios;
  return bloqueios.filter((b) => b.escopo === 'geral' || b.profissional_id === profissional);
}

/** Recorta o bloqueio ao dia (Brasília), em ms. `null` se não toca o dia. */
function recortarAoDia(b: Bloco, dia: string): { ini: number; fim: number; inicioDia: number } | null {
  const l = limitesDias(dia, dia);
  const inicioDia = instanteMs(l.startIso);
  const fimDia = instanteMs(l.endIso) + 1;
  const ini = Math.max(instanteMs(b.data_inicio), inicioDia);
  const fim = Math.min(instanteMs(b.data_fim), fimDia);
  if (Number.isNaN(ini) || Number.isNaN(fim) || fim <= ini) return null;
  return { ini, fim, inicioDia };
}

/**
 * Bloqueios por hora da grade: um bloqueio ocupa todas as horas que cruza no dia
 * (10:00–12:00 → 10 e 11; fim na hora cheia não conta aquela hora). Só horas de `horas`.
 */
export function bloqueiosPorHora<B extends Bloco>(bloqueios: B[], dia: string, horas: number[]): Record<number, B[]> {
  const out: Record<number, B[]> = {};
  for (const b of bloqueios) {
    const r = recortarAoDia(b, dia);
    if (!r) continue;
    const hIni = Math.floor((r.ini - r.inicioDia) / HORA_MS);
    const hFim = Math.ceil((r.fim - r.inicioDia) / HORA_MS);
    for (let h = hIni; h < hFim; h++) {
      if (!horas.includes(h)) continue;
      (out[h] ??= []).push(b);
    }
  }
  return out;
}

/** Itens para `janelaDoDia`: atendimentos do dia e bloqueios recortados ao dia exibido. */
export function itensDaJanela(
  dia: string,
  ags: { data_hora_inicio: string; data_hora_fim: string }[],
  bloqueios: Bloco[],
): { inicio: string; fim: string }[] {
  const itens = ags.map((a) => ({ inicio: a.data_hora_inicio, fim: a.data_hora_fim }));
  for (const b of bloqueios) {
    const r = recortarAoDia(b, dia);
    if (r) itens.push({ inicio: new Date(r.ini).toISOString(), fim: new Date(r.fim).toISOString() });
  }
  return itens;
}

/** "AAAA-MM-DD" → Date no calendário local do aparelho (para componentes que ainda pedem Date). */
export function dataDoDia(dia: string): Date {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(a, m - 1, d);
}
