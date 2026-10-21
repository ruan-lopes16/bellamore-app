/**
 * Regras puras das visões da Agenda do web (Timeline, Semana e Mês).
 *
 * - Horas sempre em Brasília (`@shared/periodos`), como a janela de `janelaDoDia`.
 * - Semana de domingo a sábado (`diasDaSemana`) em todas as visões.
 * - "Todas as profissionais" (`FILTRO_TODAS`) só vale com `agenda.ver_equipe`.
 */
import { colunasPorProfissional, diasDaSemana, janelaDoDia, type Janela } from '@shared/agenda';
import { chaveDiaBRT, chaveDiaExibido, horaBRT, instanteMs, limitesDias, somarDias } from '@shared/periodos';

/** Valor do seletor que mostra a agenda de todas as profissionais. */
export const FILTRO_TODAS = 'todas' as const;
/** Filtro da agenda: id de uma profissional ou "todas" ('' enquanto a sessão carrega). */
export type FiltroProfissional = string | typeof FILTRO_TODAS;

/** Pixels por hora na timeline. */
export const TL_HOUR_H = 72;
/** Pixels por minuto na timeline. */
export const TL_MIN_H = TL_HOUR_H / 60;

type AgLike = { data_hora_inicio: string; data_hora_fim: string; profissional: { id: string; nome: string } | null };
type BloqLike = {
  profissional_id: string | null; data_inicio: string; data_fim: string;
  situacao: 'aprovado' | 'pendente'; criado_por: string | null;
};

/**
 * "todas" sem `agenda.ver_equipe` volta para a própria pessoa (a RLS só mostraria a agenda dela
 * de qualquer jeito). Derivado, não grava estado: a permissão pode chegar depois da preferência.
 */
export function filtroEfetivo(filtro: FiltroProfissional, verEquipe: boolean, meuUserId: string): FiltroProfissional {
  return filtro === FILTRO_TODAS && !verEquipe ? meuUserId : filtro;
}

function limitesMsDoDia(chaveDia: string): { ini: number; fim: number } {
  const l = limitesDias(chaveDia, chaveDia);
  return { ini: instanteMs(l.startIso), fim: instanteMs(l.endIso) + 1 };
}

/** Indica se [inicio, fim) toca o dia `chaveDia` de Brasília. */
function tocaODia(inicio: string, fim: string, chaveDia: string): boolean {
  const d = limitesMsDoDia(chaveDia);
  return instanteMs(inicio) < d.fim && instanteMs(fim) > d.ini;
}

/** Corta o intervalo no dia (00:00–23:59:59.999 em Brasília). */
function cortarNoDia(inicio: string, fim: string, chaveDia: string): { inicio: string; fim: string } {
  const d = limitesMsDoDia(chaveDia);
  return {
    inicio: new Date(Math.max(instanteMs(inicio), d.ini)).toISOString(),
    fim: new Date(Math.min(instanteMs(fim), d.fim - 1)).toISOString(),
  };
}

/**
 * Janela da timeline: 7h–21h esticada (`janelaDoDia`) para cobrir todo atendimento e bloqueio do
 * dia. Bloqueio de vários dias é cortado no dia antes, para não puxar horas de outro dia.
 */
export function janelaDaTimeline(
  ags: { data_hora_inicio: string; data_hora_fim: string }[],
  bloqueios: { data_inicio: string; data_fim: string }[],
  chaveDia: string,
): Janela {
  const itens = [
    ...ags.map((a) => ({ inicio: a.data_hora_inicio, fim: a.data_hora_fim })),
    ...bloqueios
      .filter((b) => tocaODia(b.data_inicio, b.data_fim, chaveDia))
      .map((b) => cortarNoDia(b.data_inicio, b.data_fim, chaveDia)),
  ];
  return janelaDoDia(itens);
}

/** Horas cheias da janela, das `ini` às `fim` (inclusive, para a última linha). */
export function horasDaJanela(j: Janela): number[] {
  return Array.from({ length: j.fim - j.ini + 1 }, (_, i) => j.ini + i);
}

/** Altura total (px) da grade da janela. */
export function alturaDaJanela(j: Janela): number {
  return (j.fim - j.ini) * TL_HOUR_H;
}

/** Minutos desde 00:00 (Brasília) de `chaveDia`, limitados a 0..1440. */
function minutosNoDia(iso: string, chaveDia: string): number {
  const m = (instanteMs(iso) - limitesMsDoDia(chaveDia).ini) / 60000;
  return Math.min(1440, Math.max(0, m));
}

/**
 * Topo e altura (px) de um item na grade. Altura mínima `minPx`; quando o mínimo passaria do fim
 * da janela, o card sobe para caber (nenhum card fica cortado).
 */
export function posicaoNaTimeline(
  inicioIso: string, fimIso: string, chaveDia: string, j: Janela, minPx: number,
): { top: number; height: number } {
  const total = alturaDaJanela(j);
  const base = j.ini * 60;
  const top = Math.min(total, Math.max(0, (minutosNoDia(inicioIso, chaveDia) - base) * TL_MIN_H));
  const fundo = Math.min(total, Math.max(0, (minutosNoDia(fimIso, chaveDia) - base) * TL_MIN_H));
  const height = Math.max(fundo - top, minPx);
  return { top: top + height > total ? Math.max(0, total - height) : top, height };
}

/** "HH:mm" do clique na altura `y` (px), de 15 em 15 min, dentro da janela. */
export function horaDoClique(y: number, j: Janela): string {
  let min = j.ini * 60 + Math.round(Math.max(0, y) / TL_MIN_H / 15) * 15;
  min = Math.min(min, j.fim * 60 - 15);
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** Topo (px) da linha de "agora", ou null se `agoraIso` não é do dia ou está fora da janela. */
export function topoAgora(agoraIso: string, chaveDia: string, j: Janela): number | null {
  if (chaveDiaBRT(agoraIso) !== chaveDia) return null;
  const m = minutosNoDia(agoraIso, chaveDia);
  if (m < j.ini * 60 || m >= j.fim * 60) return null;
  return (m - j.ini * 60) * TL_MIN_H;
}

/**
 * Colunas da timeline (`colunasPorProfissional`): em "todas", uma por profissional da empresa;
 * senão só a escolhida. Profissional que só aparece num atendimento (ex.: desativada) ganha coluna.
 */
export function colunasDaTimeline<T extends AgLike>(
  ags: T[], profissionais: { id: string; nome: string }[], filtro: FiltroProfissional,
): { profissional: { id: string; nome: string }; itens: T[] }[] {
  const mapa = new Map<string, string>();
  for (const p of profissionais) if (filtro === FILTRO_TODAS || p.id === filtro) mapa.set(p.id, p.nome);
  for (const a of ags) if (a.profissional && !mapa.has(a.profissional.id)) mapa.set(a.profissional.id, a.profissional.nome);
  const profs = Array.from(mapa, ([id, nome]) => ({ id, nome }));
  const comId = ags.map((ag) => ({ profissional_id: ag.profissional?.id ?? '', ag }));
  return colunasPorProfissional(comId, profs).map((c) => ({ profissional: c.profissional, itens: c.itens.map((i) => i.ag) }));
}

/**
 * Bloqueios que a tela mostra: do filtro (em "todas", todos; senão os da profissional e os gerais)
 * e, se pendentes, só para quem aprova ou quem criou (a RLS já filtra; aqui é defesa visual).
 */
export function bloqueiosVisiveis<B extends BloqLike>(
  bloqueios: B[], filtro: FiltroProfissional, meuUserId: string, podeAprovar: boolean,
): B[] {
  return bloqueios
    .filter((b) => filtro === FILTRO_TODAS || b.profissional_id === null || b.profissional_id === filtro)
    .filter((b) => b.situacao === 'aprovado' || podeAprovar || b.criado_por === meuUserId);
}

/** Bloqueios que tocam o dia (Brasília), em ordem de início. */
export function bloqueiosDoDia<B extends { data_inicio: string; data_fim: string }>(bloqueios: B[], chaveDia: string): B[] {
  return bloqueios
    .filter((b) => tocaODia(b.data_inicio, b.data_fim, chaveDia))
    .sort((a, b) => instanteMs(a.data_inicio) - instanteMs(b.data_inicio));
}

/** Dias (dentre `dias`) que têm algum bloqueio. */
export function diasComBloqueio(bloqueios: { data_inicio: string; data_fim: string }[], dias: string[]): Set<string> {
  const out = new Set<string>();
  for (const dia of dias) if (bloqueios.some((b) => tocaODia(b.data_inicio, b.data_fim, dia))) out.add(dia);
  return out;
}

/** Rótulo do horário do bloqueio no dia: "Dia inteiro" ou "HH:mm–HH:mm" cortado no dia. */
export function faixaDoBloqueioNoDia(b: { data_inicio: string; data_fim: string }, chaveDia: string): string {
  const d = limitesMsDoDia(chaveDia);
  if (instanteMs(b.data_inicio) <= d.ini && instanteMs(b.data_fim) >= d.fim - 1) return 'Dia inteiro';
  const c = cortarNoDia(b.data_inicio, b.data_fim, chaveDia);
  return `${horaBRT(c.inicio)}–${horaBRT(c.fim)}`;
}

function dataLocal(chave: string): Date {
  const [a, m, d] = chave.split('-').map(Number);
  return new Date(a, m - 1, d);
}

/** Os 7 dias (domingo primeiro, `diasDaSemana`) da semana do Date da tela. */
export function semanaDoDia(d: Date): Date[] {
  return diasDaSemana(chaveDiaExibido(d)).map(dataLocal);
}

/** Grade de 6 semanas (42 dias) do mês exibido, começando no domingo da semana do dia 1. */
export function gradeDoMes(mes: Date): Date[] {
  const primeiro = `${chaveDiaExibido(mes).slice(0, 7)}-01`;
  const inicio = diasDaSemana(primeiro)[0];
  return Array.from({ length: 42 }, (_, i) => dataLocal(somarDias(inicio, i)));
}

/**
 * Lê todas as páginas de uma consulta (o PostgREST corta em 1000 linhas sem avisar). Diferente
 * de `buscarTodasPaginas` de shared, um erro em qualquer página vira exceção — lista cortada em
 * silêncio pareceria "dia sem atendimentos".
 */
export async function buscarPaginas<T>(
  montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  tamanho = 1000,
): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += tamanho) {
    const { data, error } = await montar(de, de + tamanho - 1);
    if (error) throw error;
    const linhas = data ?? [];
    todas.push(...linhas);
    if (linhas.length < tamanho) return todas;
  }
}
