/**
 * @file dashboard.ts
 * Regras ÚNICAS do Dashboard de web e mobile (decisões do dono, Fase 2B):
 * - Reconquista (= clientes inativos): última visita concluída há MAIS de 45
 *   dias de Brasília; mais antigas primeiro; até 5.
 * - Aniversariantes: próximos 7 dias (29/02 em ano comum = 28/02); até 8.
 * - Despesas vencendo: pendentes de hoje a hoje+7.
 * - Mês navegável, nunca no futuro.
 */
import { chaveDiaBRT, diasEntre, somarDias, somarMeses, ultimoDiaDoMes } from './periodos';
import { arredondar, variacaoPercentual, type KpisFinanceiros } from './kpis-financeiros';

export const DIAS_RECONQUISTA = 45;
export const DIAS_ANIVERSARIANTES = 7;
export const DIAS_DESPESAS_VENCENDO = 7;

export type UltimaVisita = { nome: string; ultimaVisita: string };
export type ClienteReconquistar = { clienteId: string; nome: string; ultimaVisita: string; diasSemVisita: number };

export function clientesParaReconquistar(
  ultimas: Map<string, UltimaVisita>, hoje: string, opcoes: { dias?: number; limite?: number } = {},
): ClienteReconquistar[] {
  const dias = opcoes.dias ?? DIAS_RECONQUISTA;
  const lista: ClienteReconquistar[] = [];
  for (const [clienteId, v] of ultimas) {
    const diasSemVisita = diasEntre(chaveDiaBRT(v.ultimaVisita), hoje);
    if (diasSemVisita > dias) lista.push({ clienteId, nome: v.nome, ultimaVisita: v.ultimaVisita, diasSemVisita });
  }
  return lista
    .sort((a, b) => b.diasSemVisita - a.diasSemVisita || a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, opcoes.limite ?? 5);
}

/** cliente_id → data da última visita (entrada de clientesSumidas). */
export function datasDasUltimasVisitas(ultimas: Map<string, UltimaVisita>): Map<string, string> {
  return new Map([...ultimas].map(([id, v]) => [id, v.ultimaVisita] as [string, string]));
}

export type ClienteAniversario = { id: string; nome: string; data_nascimento: string | null; telefone?: string | null };
export type Aniversariante = ClienteAniversario & { diasAte: number; dataAniversario: string; rotulo: string };

function aniversarioNoAno(ano: number, mm: string, dd: string): string {
  const dia = `${ano}-${mm}-${dd}`;
  const ultimo = ultimoDiaDoMes(`${ano}-${mm}`);
  return dia > ultimo ? ultimo : dia;
}

export function aniversariantesProximos(
  clientes: ClienteAniversario[], hoje: string, opcoes: { dias?: number; limite?: number } = {},
): Aniversariante[] {
  const dias = opcoes.dias ?? DIAS_ANIVERSARIANTES;
  const ano = Number(hoje.slice(0, 4));
  const out: Aniversariante[] = [];
  for (const c of clientes) {
    const [, mm = '', dd = ''] = (c.data_nascimento ?? '').split('-');
    if (!/^\d{2}$/.test(mm) || !/^\d{2}$/.test(dd.slice(0, 2))) continue;
    // Só mês 1–12 e dia 1–31; datas malformadas são ignoradas.
    if (Number(mm) < 1 || Number(mm) > 12 || Number(dd.slice(0, 2)) < 1 || Number(dd.slice(0, 2)) > 31) continue;
    let data = aniversarioNoAno(ano, mm, dd.slice(0, 2));
    if (data < hoje) data = aniversarioNoAno(ano + 1, mm, dd.slice(0, 2));
    const diasAte = diasEntre(hoje, data);
    if (diasAte > dias) continue;
    out.push({ ...c, diasAte, dataAniversario: data, rotulo: diasAte === 0 ? '🎂 Hoje!' : diasAte === 1 ? 'Amanhã' : `Em ${diasAte} dias` });
  }
  return out.sort((a, b) => a.diasAte - b.diasAte || a.nome.localeCompare(b.nome, 'pt-BR')).slice(0, opcoes.limite ?? 8);
}

export function janelaDespesasVencendo(hoje: string, dias = DIAS_DESPESAS_VENCENDO): { de: string; ate: string } {
  return { de: hoje, ate: somarDias(hoje, dias) };
}

export type ProgressoMeta = { temMeta: boolean; percentual: number; atingida: boolean; faltam: number; acima: number };

/** Meta mensal da EMPRESA (empresas.meta_mensal) contra o faturamento bruto do mês. */
export function progressoMetaEmpresa(bruto: number, meta: number | string | null | undefined): ProgressoMeta {
  const m = Number(meta ?? 0);
  if (!Number.isFinite(m) || m <= 0) return { temMeta: false, percentual: 0, atingida: false, faltam: 0, acima: 0 };
  return {
    temMeta: true,
    percentual: Math.min((bruto / m) * 100, 100),
    atingida: bruto >= m,
    faltam: arredondar(Math.max(m - bruto, 0)),
    acima: arredondar(Math.max(bruto - m, 0)),
  };
}

export function rotuloProgressoMeta(p: ProgressoMeta, fmt: (v: number) => string): string {
  return p.atingida ? `Meta atingida! +${fmt(p.acima)} acima` : `${p.percentual.toFixed(0)}% concluído · faltam ${fmt(p.faltam)}`;
}

export type ComandaNaoFechadaRow = { id: string; data_hora_inicio: string };

/** Linhas em ordem crescente de início (consulta de shared): a 1ª é a mais antiga. */
export function resumoComandasNaoFechadas(rows: ComandaNaoFechadaRow[]): { quantidade: number; maisAntiga: ComandaNaoFechadaRow | null } {
  return { quantidade: rows.length, maisAntiga: rows[0] ?? null };
}

const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Mês do Dashboard: o pedido se for válido e não futuro; senão o atual. */
export function navegacaoMesDashboard(
  solicitado: string | null | undefined, hoje: string,
): { chave: string; isMesAtual: boolean; anterior: string; seguinte: string | null } {
  const atual = hoje.slice(0, 7);
  const chave = solicitado && RE_MES.test(solicitado) && solicitado <= atual ? solicitado : atual;
  return { chave, isMesAtual: chave === atual, anterior: somarMeses(chave, -1), seguinte: chave === atual ? null : somarMeses(chave, 1) };
}

export type GeometriaSparkline = { linha: string; area: string; ultimo: { x: number; y: number }; vazio: boolean };

/** Geometria da sparkline de receita acumulada (SparkBars web e SparkLinha app). */
export function geometriaSparkline(dados: number[], largura = 200, altura = 80, progresso = 1): GeometriaSparkline {
  const padL = 8, padR = 10, padT = 12, padB = 6;
  const plotW = largura - padL - padR;
  const plotH = altura - padT - padB;
  const base = padT + plotH;
  const max = Math.max(...dados, 1);
  const vazio = dados.length === 0 || dados.every(v => v === 0);
  const pts: { x: number; y: number }[] = [{ x: padL, y: base }];
  if (!vazio) {
    dados.forEach((v, i) => {
      const alvo = base - (v / max) * plotH;
      pts.push({ x: padL + ((i + 1) / dados.length) * plotW, y: base + (alvo - base) * progresso });
    });
  } else {
    pts.push({ x: padL + plotW, y: base });
  }
  const linha = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const ultimo = pts[pts.length - 1];
  return { linha, area: `${linha} L${ultimo.x.toFixed(1)},${base} L${padL},${base} Z`, ultimo, vazio };
}

export type CartaoKpiDashboard = {
  id: 'liquido' | 'lucro' | 'comissoes' | 'cancelamento' | 'donaDeve';
  rotulo: string;
  valor: string;
  sub: string | null;
  subDestaque: boolean;
  delta: number | null;
  tom: 'primario' | 'negativo' | 'alerta';
};

/** KPIs do mês do Dashboard — a MESMA lista no web e no app. */
export function cartoesKpiDashboard(
  k: KpisFinanceiros, kAnt: KpisFinanceiros,
  o: { isOwner: boolean; retiradasMes: number; emprestimosAbertos: number; fmt: (v: number) => string },
): CartaoKpiDashboard[] {
  const { fmt } = o;
  const lista: CartaoKpiDashboard[] = [
    { id: 'liquido', rotulo: 'Líquido após taxas', valor: fmt(k.liquidoAposTaxas), sub: null, subDestaque: false, delta: null, tom: 'primario' },
    { id: 'lucro', rotulo: 'Lucro do mês', valor: fmt(k.lucro),
      sub: o.isOwner && o.retiradasMes > 0 ? `Após retiradas ${fmt(arredondar(k.lucro - o.retiradasMes))}` : null,
      subDestaque: false, delta: variacaoPercentual(k.lucro, kAnt.lucro), tom: k.lucro >= 0 ? 'primario' : 'negativo' },
    { id: 'comissoes', rotulo: 'Comissões', valor: fmt(k.comissoes),
      sub: k.comissoesPendentes > 0 ? `${fmt(k.comissoesPendentes)} de ${fmt(k.comissoes)} pendente` : 'Em dia',
      subDestaque: k.comissoesPendentes > 0, delta: null, tom: 'alerta' },
    { id: 'cancelamento', rotulo: '% Cancelamento', valor: `${k.pctCancelamento.toFixed(1)}%`,
      sub: k.perdidos > 0 ? `${k.perdidos} perdido(s)` : null, subDestaque: false, delta: null, tom: 'negativo' },
  ];
  if (o.isOwner && o.emprestimosAbertos > 0) {
    lista.push({ id: 'donaDeve', rotulo: 'A dona deve', valor: fmt(o.emprestimosAbertos), sub: 'empréstimos em aberto', subDestaque: false, delta: null, tom: 'alerta' });
  }
  return lista;
}
