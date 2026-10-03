/**
 * @file relatorios.ts
 * Regras ÚNICAS das abas dos Relatórios (web e mobile). Os números vêm de
 * calcularKpisFinanceiros; aqui ficam as listas que as duas telas desenham
 * (cartões, resumo financeiro) e os rankings das abas.
 */
import { arredondar, num, variacaoPercentual, type KpisFinanceiros, type Valor } from './kpis-financeiros';
import { ROTULO_COMPARACAO, type PeriodoRelatorio } from './periodos';

export type AbaRelatorio = 'financeiro' | 'servicos' | 'equipe' | 'clientes' | 'estoque' | 'comissoes' | 'avaliacoes';

export const ABAS_RELATORIO: { key: AbaRelatorio; label: string }[] = [
  { key: 'financeiro', label: 'Financeiro' },
  { key: 'servicos', label: 'Serviços' },
  { key: 'equipe', label: 'Equipe' },
  { key: 'clientes', label: 'Clientes' },
  { key: 'estoque', label: 'Estoque' },
  { key: 'comissoes', label: 'Comissões' },
  { key: 'avaliacoes', label: 'Avaliações' },
];

export type ItemRankingSimples = { nome: string; valor: number; qtd: number; pct: number };

/** Despesas PAGAS do período por categoria (sem categoria = 'Outros'); pct relativo à maior. */
export function rankingDespesasPorCategoria(despesas: { valor: Valor; categoria: string | null }[]): ItemRankingSimples[] {
  const mapa = new Map<string, { valor: number; qtd: number }>();
  for (const d of despesas) {
    const chave = d.categoria || 'Outros';
    const item = mapa.get(chave) ?? { valor: 0, qtd: 0 };
    item.valor += num(d.valor);
    item.qtd += 1;
    mapa.set(chave, item);
  }
  const lista = [...mapa.entries()]
    .map(([nome, v]) => ({ nome, valor: arredondar(v.valor), qtd: v.qtd, pct: 0 }))
    .sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome, 'pt-BR'));
  const max = lista[0]?.valor ?? 0;
  return lista.map(i => ({ ...i, pct: max > 0 ? (i.valor / max) * 100 : 0 }));
}

/** Comissão gerada por profissional (linhas já recortadas ao período). */
export function comissaoPorProfissional(comissoes: { profissional_id: string; valor_comissao: Valor }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of comissoes) out[c.profissional_id] = (out[c.profissional_id] ?? 0) + num(c.valor_comissao);
  for (const k of Object.keys(out)) out[k] = arredondar(out[k]);
  return out;
}

export type MovEstoqueRow = { produto_id: string; quantidade: Valor; produto: { nome: string | null; preco_custo: Valor } | null };
export type ItemInsumo = { produtoId: string; nome: string; qtd: number; custo: number; pct: number };
export type ResumoInsumos = { ranking: ItemInsumo[]; custoTotal: number; custoMedioPorAtendimento: number | null };

/** Insumos consumidos: ranking por quantidade (top `limite`); custo total sobre TODAS as saídas. */
export function resumoInsumos(movs: MovEstoqueRow[], atendimentos: number, limite = 10): ResumoInsumos {
  const mapa = new Map<string, { nome: string; qtd: number; custo: number }>();
  for (const m of movs) {
    const item = mapa.get(m.produto_id) ?? { nome: m.produto?.nome || 'Produto', qtd: 0, custo: 0 };
    const qtd = num(m.quantidade);
    item.qtd += qtd;
    item.custo += qtd * num(m.produto?.preco_custo);
    mapa.set(m.produto_id, item);
  }
  const todos = [...mapa.entries()].map(([produtoId, v]) => ({ produtoId, ...v }))
    .sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome, 'pt-BR'));
  const top = todos.slice(0, limite);
  const maxQ = top[0]?.qtd ?? 0;
  const custoTotal = arredondar(todos.reduce((s, i) => s + i.custo, 0));
  return {
    ranking: top.map(i => ({ ...i, custo: arredondar(i.custo), pct: maxQ > 0 ? (i.qtd / maxQ) * 100 : 0 })),
    custoTotal,
    custoMedioPorAtendimento: atendimentos > 0 ? arredondar(custoTotal / atendimentos) : null,
  };
}

export type AvaliacaoRow = {
  nota: number;
  comentario: string | null;
  created_at: string;
  profissional_id: string | null;
  profissional: { user: { nome: string | null } | null } | null;
  cliente: { nome: string | null } | null;
};
export type ResumoAvaliacoes = {
  notaMedia: number | null; total: number; comNota5: number; pctNota5: number | null;
  ranking: { nome: string; media: number; qtd: number }[];
};

export function resumoAvaliacoes(avs: AvaliacaoRow[]): ResumoAvaliacoes {
  if (avs.length === 0) return { notaMedia: null, total: 0, comNota5: 0, pctNota5: null, ranking: [] };
  const mapa = new Map<string, { nome: string; soma: number; qtd: number }>();
  for (const a of avs) {
    const chave = a.profissional_id ?? '__sem__';
    const item = mapa.get(chave) ?? { nome: a.profissional?.user?.nome || 'Sem profissional', soma: 0, qtd: 0 };
    item.soma += a.nota;
    item.qtd += 1;
    mapa.set(chave, item);
  }
  const comNota5 = avs.filter(a => a.nota === 5).length;
  return {
    notaMedia: avs.reduce((s, a) => s + a.nota, 0) / avs.length,
    total: avs.length,
    comNota5,
    pctNota5: Math.round((comNota5 / avs.length) * 100),
    ranking: [...mapa.values()].map(v => ({ nome: v.nome, media: v.soma / v.qtd, qtd: v.qtd }))
      .sort((a, b) => b.media - a.media || b.qtd - a.qtd),
  };
}

export type CartaoKpiRelatorio = {
  id: 'bruto' | 'cartao' | 'liquido' | 'lucro' | 'aposRetiradas' | 'atendimentos' | 'ticket'
    | 'comparecimento' | 'cancelamento' | 'taxas' | 'comissoes';
  rotulo: string;
  valor: string;
  sub: string | null;
  delta: number | null;
  rotuloDelta: string | null;
  /** Valor "ruim" (vermelho): saídas e resultados negativos. */
  negativo: boolean;
};

/** Grade de KPIs dos Relatórios — a MESMA lista no web e no app. */
export function cartoesKpiRelatorio(
  k: KpisFinanceiros, kAnt: KpisFinanceiros,
  o: { periodo: PeriodoRelatorio; isOwner: boolean; retiradasPeriodo: number; fmt: (v: number) => string },
): CartaoKpiRelatorio[] {
  const { fmt } = o;
  const rd = ROTULO_COMPARACAO[o.periodo];
  const base = { sub: null, delta: null, rotuloDelta: null, negativo: false };
  const lista: CartaoKpiRelatorio[] = [{
    ...base, id: 'bruto', rotulo: 'Faturamento bruto', valor: fmt(k.bruto),
    sub: k.receitaVendas > 0 ? `inc. ${fmt(k.receitaVendas)} em vendas` : null,
    delta: variacaoPercentual(k.bruto, kAnt.bruto), rotuloDelta: rd,
  }];
  if (k.taxasCartao > 0) lista.push({ ...base, id: 'cartao', rotulo: 'Taxas de cartão', valor: fmt(k.taxasCartao), negativo: true });
  lista.push({ ...base, id: 'liquido', rotulo: 'Líquido após taxas', valor: fmt(k.liquidoAposTaxas) });
  lista.push({ ...base, id: 'lucro', rotulo: 'Lucro real', valor: fmt(k.lucro), negativo: k.lucro < 0 });
  if (o.isOwner && o.retiradasPeriodo > 0) {
    const apos = arredondar(k.lucro - o.retiradasPeriodo);
    lista.push({ ...base, id: 'aposRetiradas', rotulo: 'Resultado após retiradas', valor: fmt(apos),
      sub: `(−) ${fmt(o.retiradasPeriodo)} da dona`, negativo: apos < 0 });
  }
  lista.push({ ...base, id: 'atendimentos', rotulo: 'Atendimentos', valor: String(k.atendimentos), sub: 'concluídos',
    delta: variacaoPercentual(k.atendimentos, kAnt.atendimentos), rotuloDelta: rd });
  lista.push({ ...base, id: 'ticket', rotulo: 'Ticket médio', valor: fmt(k.ticketMedio),
    delta: variacaoPercentual(k.ticketMedio, kAnt.ticketMedio), rotuloDelta: rd });
  lista.push({ ...base, id: 'comparecimento', rotulo: 'Taxa comparecimento', valor: `${k.pctComparecimento.toFixed(1)}%` });
  lista.push({ ...base, id: 'cancelamento', rotulo: 'Taxa de cancelamento',
    valor: k.totalAgendamentos > 0 ? `${k.pctCancelamento.toFixed(1)}%` : '—',
    sub: k.perdidos > 0 ? `${k.perdidos} perdido(s)` : null, negativo: true });
  const taxas = arredondar(k.receitaTaxasCancelamento + k.receitaTaxasReserva);
  if (taxas > 0) lista.push({ ...base, id: 'taxas', rotulo: 'Taxas (cancel. + reserva)', valor: fmt(taxas) });
  lista.push({ ...base, id: 'comissoes', rotulo: 'Total comissões', valor: fmt(k.comissoes),
    sub: k.comissoesPendentes > 0 ? `${fmt(k.comissoesPendentes)} pendentes` : 'Em dia' });
  return lista;
}

export type LinhaResumoFinanceiro = {
  id: 'servicos' | 'vendas' | 'taxas' | 'bruto' | 'cartao' | 'comissoes' | 'despesas' | 'lucro' | 'retiradas' | 'aposRetiradas';
  rotulo: string;
  valor: number;
  tipo: 'entrada' | 'total' | 'saida' | 'resultado';
};

/** Linhas do bloco "Resumo financeiro" (aba Financeiro) — mesma ordem e textos. */
export function linhasResumoFinanceiro(
  k: KpisFinanceiros, o: { isOwner: boolean; retiradasPeriodo: number },
): LinhaResumoFinanceiro[] {
  const l: LinhaResumoFinanceiro[] = [{ id: 'servicos', rotulo: 'Serviços concluídos', valor: k.receitaServicos, tipo: 'entrada' }];
  if (k.receitaVendas > 0) l.push({ id: 'vendas', rotulo: 'Vendas avulsas', valor: k.receitaVendas, tipo: 'entrada' });
  const taxas = arredondar(k.receitaTaxasCancelamento + k.receitaTaxasReserva);
  if (taxas > 0) l.push({ id: 'taxas', rotulo: 'Taxas (cancel. + reserva)', valor: taxas, tipo: 'entrada' });
  l.push(
    { id: 'bruto', rotulo: '= Faturamento bruto', valor: k.bruto, tipo: 'total' },
    { id: 'cartao', rotulo: '(−) Taxas de cartão', valor: k.taxasCartao, tipo: 'saida' },
    { id: 'comissoes', rotulo: '(−) Comissões', valor: k.comissoes, tipo: 'saida' },
    { id: 'despesas', rotulo: '(−) Despesas', valor: k.despesas, tipo: 'saida' },
    { id: 'lucro', rotulo: 'Lucro real', valor: k.lucro, tipo: 'resultado' },
  );
  if (o.isOwner && o.retiradasPeriodo > 0) {
    l.push(
      { id: 'retiradas', rotulo: '(−) Retiradas da dona', valor: o.retiradasPeriodo, tipo: 'saida' },
      { id: 'aposRetiradas', rotulo: 'Resultado após retiradas', valor: arredondar(k.lucro - o.retiradasPeriodo), tipo: 'resultado' },
    );
  }
  return l;
}
