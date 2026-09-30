'use client';

/**
 * @file relatorios/page.tsx
 * Módulo de Relatórios — análise de desempenho por período selecionável.
 *
 * ## Métricas principais (calculadas client-side via useMemo)
 * Todos os números financeiros (bruto, taxas, comissões, despesas, lucro, ticket,
 * comparecimento, deltas, séries, rankings, retorno de clientes) vêm das funções
 * ÚNICAS de `shared/` — as mesmas do Financeiro, Dashboard e app mobile. Períodos e
 * datas em Brasília via `shared/periodos`.
 *
 * ## Queries (sem N+1)
 * 1. carregarDadosFinanceiros — período + anterior numa busca só (paginada, com erro explícito)
 * 2. comissoes (lista detalhada da aba Comissões, created_at) — paginado
 * 3. estoque_movimentos saídas — lazy, só ao abrir a aba Estoque
 * 4. avaliacoes — lazy, só ao abrir a aba Avaliações
 *
 * ## Rankings gerados
 * Serviços · Equipe · Top clientes · Insumos consumidos
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  TrendingUp, BarChart2, Users, Package, Scissors,
  ChevronDown, ChevronLeft, ChevronRight, DollarSign, Target, Activity, User, Check, Star, CreditCard, XCircle,
  Receipt,
} from 'lucide-react';
import { ExportButton } from '@/components/ExportButton';
import type { ExportColumn } from '@/lib/export';
import { createClient } from '@/lib/supabase/client';
import { Sk } from '@/components/Skeleton';
import { KpiCardSkeleton } from './RelatoriosSkeleton';
import { SmoothTabs } from '@/components/SmoothTabs';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  PERIODOS_RELATORIO, ROTULO_COMPARACAO, limitesDoPeriodo, rotuloDoPeriodo, uniaoLimites, hojeBRT,
  type PeriodoRelatorio, type OpcoesPeriodo,
} from '@shared/periodos';
import {
  calcularKpisFinanceiros, recortarDados, serieFaturamento, rankingAtendimentos, metricasRetorno,
  clientesAtendidosNoPeriodo, variacaoPercentual, retiradasDoPeriodo,
  resultadoAposRetiradas as calcularAposRetiradas, DADOS_VAZIOS,
  type DadosFinanceiros, type ItemRanking,
} from '@shared/kpis-financeiros';
import {
  carregarDadosFinanceiros, carregarClientesComHistoricoAntes, carregarRetiradas,
} from '@shared/kpis-financeiros-consultas';
import { buscarTodasPaginas } from '@shared/paginacao';
import type { RetiradaSociaRow, RetiradaSociaDevolucaoRow } from '@shared/retiradas-socia';
import { Secret, PrivacyToggle } from '@/components/privacy';

const supabase = createClient();

// ── Tipos ─────────────────────────────────────────────────────

type Periodo = PeriodoRelatorio;

/** Dados brutos de um agendamento com joins resolvidos */
type Ag = {
  id: string;
  valor: number;
  status: string;
  data_hora_inicio: string;
  pacote_cliente_id: string | null;
  servico_id:       string | null;
  profissional_id:  string | null;
  cliente_id:       string | null;
  servico:      { nome: string } | null;
  profissional: { nome: string } | null;
  cliente:      { nome: string } | null;
};

type Despesa  = { valor: number; categoria: string | null };
type Comissao = {
  id:               string;
  profissional_id:  string;
  valor_comissao:   number;
  status:           'pendente' | 'pago';
  percentual:       number;
  created_at:       string;
  profissional:     { nome: string } | null;
  agendamento: {
    data_hora_inicio: string;
    valor:            number;
    servico:  { nome: string } | null;
    cliente:  { nome: string } | null;
  } | null;
};
type MovEstoque = {
  produto_id: string; quantidade: number;
  produto: { nome: string; preco_custo: number } | null;
};
type Avaliacao = {
  nota: number;
  comentario: string | null;
  created_at: string;
  profissional_id: string | null;
  profissional: { nome: string } | null;
  cliente: { nome: string } | null;
};

/** Item genérico de ranking (serviços, equipe, clientes) */
type RankItem = { nome: string; valor: number; qtd: number; pct: number };
/** Ranking de estoque com custo estimado */
type EstRankItem = { nome: string; qtd: number; custo: number; pct: number };

// ── Constantes ────────────────────────────────────────────────

const ABA_OPTS = [
  { key: 'financeiro' as const, label: 'Financeiro', icon: BarChart2  },
  { key: 'servicos'   as const, label: 'Serviços',   icon: Scissors   },
  { key: 'equipe'     as const, label: 'Equipe',     icon: Users      },
  { key: 'clientes'   as const, label: 'Clientes',   icon: User       },
  { key: 'estoque'    as const, label: 'Estoque',    icon: Package    },
  { key: 'comissoes'  as const, label: 'Comissões',  icon: DollarSign },
  { key: 'avaliacoes' as const, label: 'Avaliações', icon: Star       },
];
type Aba = typeof ABA_OPTS[number]['key'];

const AVATAR_CORES = ['#7C3AED', '#D4608A', '#0D7E5F', '#B45309', '#1D4ED8', '#7C2D12'];

// ── Helpers ───────────────────────────────────────────────────

/** Formata número para BRL sem centavos */
function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);
}

/** Cor de avatar baseada na inicial do nome */
function avatarCor(nome: string) {
  return AVATAR_CORES[(nome?.charCodeAt(0) ?? 0) % AVATAR_CORES.length];
}

/** Iniciais (até 2 letras) */
function iniciais(nome: string) {
  return nome.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

// ── Componentes auxiliares ────────────────────────────────────

/** Card de KPI com ícone e valor */
function KpiCard({
  icon: Icon, label, value, sub, cor, loading, delta = null, rotuloDelta,
}: {
  icon: React.ElementType; label: string; value: string;
  sub?: string; cor: string; loading: boolean;
  delta?: number | null; rotuloDelta?: string;
}) {
  if (loading) return <KpiCardSkeleton />;
  return (
    <div className="bg-surface border border-border rounded-2xl p-3 sm:p-4 shadow-sm flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3 min-w-0">
      <div className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center"
        style={{ background: cor + '18' }}>
        <Icon size={18} style={{ color: cor }} />
      </div>
      <div className="flex-1 min-w-0 w-full">
        <p className="text-base sm:text-lg font-bold text-text leading-tight truncate"><Secret>{value}</Secret></p>
        <p className="text-[11px] sm:text-xs text-text-3 leading-tight">{label}</p>
        {sub && <p className="text-[10px] sm:text-xs font-semibold mt-0.5 leading-tight" style={{ color: cor }}><Secret>{sub}</Secret></p>}
        {delta !== null && (
          <p className={`text-[10px] sm:text-xs font-semibold mt-0.5 leading-tight ${delta >= 0 ? 'text-green' : 'text-red'}`}>
            <Secret>{delta >= 0 ? '+' : ''}{delta}%</Secret> {rotuloDelta}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Linha de ranking com posição, barra horizontal de progresso e valor.
 * Usada em todas as abas de ranking.
 */
function RankRow({
  pos, nome, valor, qtd, qtdSuffix = 'x', pct, extra, cor = '#7C3AED',
}: {
  pos: number; nome: string; valor: string; qtd: number;
  qtdSuffix?: string; pct: number; extra?: string; cor?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-border last:border-0">
      {/* Posição */}
      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
        style={{ background: pos <= 3 ? '#7C3AED' : '#94A3B8' }}>
        {pos}
      </div>
      <div className="flex-1 min-w-0">
        {/* Nome + valor */}
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-semibold text-text truncate pr-2">{nome}</span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-text-3"><Secret>{qtd}{qtdSuffix}</Secret></span>
            <span className="text-sm font-bold text-text"><Secret>{valor}</Secret></span>
          </div>
        </div>
        {/* Barra de progresso */}
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-bg rounded-full h-1.5">
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(pct, 100)}%`, background: cor }} />
          </div>
          <span className="text-xs text-text-3 w-10 text-right flex-shrink-0"><Secret>{pct.toFixed(1)}%</Secret></span>
        </div>
        {extra && <p className="text-xs text-text-3 mt-0.5"><Secret>{extra}</Secret></p>}
      </div>
    </div>
  );
}

/** Barra vertical para o gráfico de evolução de faturamento */
function ChartBar({ label, value, maxValue }: { label: string; value: number; maxValue: number }) {
  const heightPct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  // self-stretch + min-h-0 na cadeia: sem isso o `height: %` da barra resolvia
  // contra um pai sem altura definida e todas colapsavam para o minHeight.
  return (
    <div className="flex-1 self-stretch flex flex-col items-center gap-1 min-w-0">
      {value > 0 && (
        <span className="text-[9px] text-text-3 truncate w-full text-center">
          <Secret>{fmtBRL(value)}</Secret>
        </span>
      )}
      <div className="flex-1 min-h-0 flex flex-col justify-end w-full">
        <div className="w-full rounded-t-md transition-all duration-500"
          style={{
            height: `${heightPct}%`,
            minHeight: value > 0 ? 4 : 0,
            background: 'linear-gradient(to top, #7C3AED, #A855F7)',
          }}
        />
      </div>
      <span className="text-[10px] text-text-3 truncate w-full text-center">{label}</span>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────

export default function RelatoriosPage() {


  // ── Estado
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [toastErro, setToastErro] = useState('');

  function showErro(msg: string) {
    setToastErro(msg);
    setTimeout(() => setToastErro(''), 4000);
  }
  const [periodo,   setPeriodo]   = useState<Periodo>('mes');
  const [aba,       setAba]       = useState<Aba>('financeiro');
  // Deslocamento em semanas a partir de hoje — só usado quando periodo === 'semana'
  const [semanaOffset, setSemanaOffset] = useState(0);
  // Deslocamento em anos a partir de hoje — só usado quando periodo === 'ano'
  const [anoOffset, setAnoOffset] = useState(0);
  // Intervalo personalizado (yyyy-MM-dd) — só usado quando periodo === 'custom'
  const [customIni, setCustomIni] = useState(() => hojeBRT().replace(/\d{2}$/, '01'));
  const [customFim, setCustomFim] = useState(() => hojeBRT());

  function atualizarCustomIni(v: string) {
    setCustomIni(v);
    if (v > customFim) setCustomFim(v);
  }
  function atualizarCustomFim(v: string) {
    const hojeStr = hojeBRT();
    const clamped = v > hojeStr ? hojeStr : v;
    setCustomFim(clamped);
    if (clamped < customIni) setCustomIni(clamped);
  }

  // ── Dados brutos carregados do Supabase
  const [dados, setDados] = useState<DadosFinanceiros>(DADOS_VAZIOS);
  const [historicoClientes, setHistoricoClientes] = useState<Set<string>>(() => new Set());
  // Falha na carga principal: mostra aviso e nenhum número (nunca valores zerados como se fossem reais).
  const [erroCarga, setErroCarga] = useState('');
  const [comissoes,  setComissoes]  = useState<Comissao[]>([]);
  const [movs,       setMovs]       = useState<MovEstoque[]>([]);
  const [avaliacoes, setAvaliacoes] = useState<Avaliacao[]>([]);
  // Retiradas/empréstimos da dona — só o owner enxerga (RLS + guarda de UI).
  const [isOwner, setIsOwner] = useState(false);
  const [retiradasRows,     setRetiradasRows]     = useState<RetiradaSociaRow[]>([]);
  const [retiradasDevsRows, setRetiradasDevsRows] = useState<RetiradaSociaDevolucaoRow[]>([]);

  // Abas de baixo uso (Estoque/Avaliações) carregam sob demanda — evita buscar
  // dados que a maioria das visitas ao relatório nunca chega a abrir.
  const [loadingAba,   setLoadingAba]   = useState(false);
  const [estoqueChave, setEstoqueChave] = useState('');    // `${empId}-${periodo}` já carregado
  const [avalChave,    setAvalChave]    = useState('');

  // ── Buscar empresaId ao montar
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (data) {
        setEmpresaId(data.empresa_id);
        const { data: emp } = await supabase.from('empresas').select('owner_id').eq('id', data.empresa_id).single();
        setIsOwner(!!emp && emp.owner_id === user.id);
      }
    })();
  }, []);

  /**
   * Carrega o período e o anterior (deltas) numa busca só, pelas consultas
   * únicas de shared. A lista detalhada de comissões (aba Comissões) continua
   * aqui; os TOTAIS vêm de calcularKpisFinanceiros. Qualquer falha zera o estado
   * e mostra aviso — nunca deixa números velhos ou zerados parecendo reais.
   */
  const carregar = useCallback(async (empId: string, per: Periodo, opts: OpcoesPeriodo) => {
    setLoading(true);
    setErroCarga('');
    const { atual: lAtual, anterior: lAnterior } = limitesDoPeriodo(per, hojeBRT(), opts);
    try {
      const [d, rCom] = await Promise.all([
        carregarDadosFinanceiros(supabase, empId, uniaoLimites(lAnterior, lAtual)),
        buscarTodasPaginas<Comissao>(async (from, to) => {
          const r = await supabase.from('comissoes')
            .select(`id, profissional_id, valor_comissao, status, percentual, created_at,
              profissional:users!comissoes_profissional_id_fkey(nome),
              agendamento:agendamentos(
                data_hora_inicio, valor,
                servico:servicos(nome),
                cliente:clientes!agendamentos_cliente_id_fkey(nome)
              )`)
            .eq('empresa_id', empId)
            .gte('created_at', lAtual.startIso)
            .lte('created_at', lAtual.endIso)
            .order('created_at').order('id')
            .range(from, to);
          if (r.error) throw new Error(r.error.message);
          return r;
        }),
      ]);
      const ids = clientesAtendidosNoPeriodo(recortarDados(d, lAtual).agendamentos);
      const hist = await carregarClientesComHistoricoAntes(supabase, empId, ids, lAtual.startIso);
      setDados(d);
      setComissoes(rCom as unknown as Comissao[]);
      setHistoricoClientes(hist);
    } catch (e) {
      const msg = `Erro ao carregar o relatório: ${(e as Error).message}`;
      setDados(DADOS_VAZIOS);
      setComissoes([]);
      setHistoricoClientes(new Set());
      setErroCarga(msg);
      showErro(msg);
    }
    setLoading(false);
  }, []);

  // Opções que parametrizam o período selecionado — memoizado para não recriar o objeto
  // a cada render (evitaria re-disparar os efeitos abaixo, que o têm como dependência).
  const periodoOpts = useMemo<OpcoesPeriodo>(
    () => ({ semanaOffset, anoOffset, custom: { ini: customIni, fim: customFim } }),
    [semanaOffset, anoOffset, customIni, customFim],
  );

  // ── Período (Brasília) e comparação
  const { atual, anterior } = useMemo(
    () => limitesDoPeriodo(periodo, hojeBRT(), periodoOpts),
    [periodo, periodoOpts],
  );
  const labelPeriodo = rotuloDoPeriodo(periodo, atual);

  useEffect(() => {
    if (empresaId) carregar(empresaId, periodo, periodoOpts);
  }, [empresaId, periodo, periodoOpts, carregar]);

  // Retiradas/empréstimos da dona (owner-only). O total do período sai de retiradasDoPeriodo.
  useEffect(() => {
    if (!empresaId || !isOwner) { setRetiradasRows([]); setRetiradasDevsRows([]); return; }
    carregarRetiradas(supabase, empresaId)
      .then(r => { setRetiradasRows(r.rows); setRetiradasDevsRows(r.devs); })
      .catch(e => {
        setRetiradasRows([]); setRetiradasDevsRows([]);
        showErro(`Erro ao carregar retiradas: ${(e as Error).message}`);
      });
  }, [empresaId, isOwner]);

  // ── Aba Estoque: carrega sob demanda (sai da query principal)
  useEffect(() => {
    if (aba !== 'estoque' || !empresaId) return;
    const chave = `${empresaId}-${periodo}-${semanaOffset}-${anoOffset}-${customIni}-${customFim}`;
    if (estoqueChave === chave) return;
    (async () => {
      setLoadingAba(true);
      const { data, error } = await supabase.from('estoque_movimentos')
        .select('produto_id, quantidade, produto:produtos(nome, preco_custo)')
        .eq('empresa_id', empresaId)
        .eq('tipo', 'saida')
        .gte('created_at', atual.startIso)
        .lte('created_at', atual.endIso);
      if (error) {
        setMovs([]);
        showErro(`Erro ao carregar o estoque: ${error.message}`);
        setLoadingAba(false);
        return;
      }
      setMovs((data ?? []) as unknown as MovEstoque[]);
      setEstoqueChave(chave);
      setLoadingAba(false);
    })();
  }, [aba, empresaId, periodo, semanaOffset, anoOffset, customIni, customFim, periodoOpts, estoqueChave, atual]);

  // ── Aba Avaliações: carrega sob demanda (sai da query principal)
  useEffect(() => {
    if (aba !== 'avaliacoes' || !empresaId) return;
    const chave = `${empresaId}-${periodo}-${semanaOffset}-${anoOffset}-${customIni}-${customFim}`;
    if (avalChave === chave) return;
    (async () => {
      setLoadingAba(true);
      const { data, error } = await supabase.from('avaliacoes')
        .select(`nota, comentario, created_at, profissional_id,
          profissional:empresa_membros!avaliacoes_profissional_id_fkey(nome),
          cliente:clientes!avaliacoes_cliente_id_fkey(nome)`)
        .eq('empresa_id', empresaId)
        .gte('created_at', atual.startIso)
        .lte('created_at', atual.endIso)
        .order('created_at', { ascending: false });
      if (error) {
        setAvaliacoes([]);
        showErro(`Erro ao carregar as avaliações: ${error.message}`);
        setLoadingAba(false);
        return;
      }
      setAvaliacoes((data ?? []) as unknown as Avaliacao[]);
      setAvalChave(chave);
      setLoadingAba(false);
    })();
  }, [aba, empresaId, periodo, semanaOffset, anoOffset, customIni, customFim, periodoOpts, avalChave, atual]);

  // ── Números únicos (mesmas funções do Financeiro, Dashboard e app mobile)
  const dadosPeriodo = useMemo(() => recortarDados(dados, atual), [dados, atual]);
  const kpis    = useMemo(() => calcularKpisFinanceiros(dados, atual),    [dados, atual]);
  const kpisAnt = useMemo(() => calcularKpisFinanceiros(dados, anterior), [dados, anterior]);
  const ags = useMemo(() => dadosPeriodo.agendamentos.map(a => ({
    ...a, valor: Number(a.valor ?? 0),
    servico: a.servico ?? null, profissional: a.profissional ?? null, cliente: a.cliente ?? null,
  })) as Ag[], [dadosPeriodo]);
  const despesas = useMemo<Despesa[]>(
    () => dadosPeriodo.despesas.map(d => ({ valor: Number(d.valor ?? 0), categoria: d.categoria })),
    [dadosPeriodo],
  );
  const concluidos = useMemo(() => ags.filter(a => a.status === 'concluido'), [ags]);

  const { bruto, taxasCartao, liquidoAposTaxas, lucro } = kpis;
  const brutoServicos = kpis.receitaServicos;
  const brutoVendas   = kpis.receitaVendas;
  const brutoTaxas    = kpis.receitaTaxasCancelamento;
  const brutoReserva  = kpis.receitaTaxasReserva;
  const comTot  = kpis.comissoes;
  const despTot = kpis.despesas;
  const ticket  = kpis.ticketMedio;
  const taxa    = kpis.pctComparecimento;
  const dBruto  = variacaoPercentual(kpis.bruto, kpisAnt.bruto);
  const dAtend  = variacaoPercentual(kpis.atendimentos, kpisAnt.atendimentos);
  const dTicket = variacaoPercentual(kpis.ticketMedio, kpisAnt.ticketMedio);

  // Retiradas da dona no período — linha ADITIVA, não muda o "Lucro real".
  const retiradasPeriodo = useMemo(
    () => (isOwner ? retiradasDoPeriodo(retiradasRows, retiradasDevsRows, atual) : 0),
    [isOwner, retiradasRows, retiradasDevsRows, atual],
  );
  const resultadoAposRetiradas = calcularAposRetiradas(lucro, retiradasPeriodo);

  // ── Rankings (quantidade = concluídos; receita = só sem pacote)
  const paraRank = (lista: ItemRanking[]): RankItem[] =>
    lista.map(r => ({ nome: r.nome, valor: r.receita, qtd: r.quantidade, pct: r.percentual }));
  const rankServicos = useMemo(() => paraRank(rankingAtendimentos(dadosPeriodo.agendamentos, 'servico')), [dadosPeriodo]);
  const rankEquipe = useMemo<(RankItem & { comissao: number })[]>(() => {
    const comPorProf: Record<string, number> = {};
    for (const c of comissoes) comPorProf[c.profissional_id] = (comPorProf[c.profissional_id] ?? 0) + c.valor_comissao;
    return rankingAtendimentos(dadosPeriodo.agendamentos, 'profissional').map(r => ({
      nome: r.nome, valor: r.receita, qtd: r.quantidade, pct: r.percentual, comissao: comPorProf[r.chave] ?? 0,
    }));
  }, [dadosPeriodo, comissoes]);
  const rankClientes = useMemo(
    () => paraRank(rankingAtendimentos(dadosPeriodo.agendamentos, 'cliente').slice(0, 10)),
    [dadosPeriodo],
  );

  // Fechamento importado só tem totais: detalhamentos mostram apenas os lançamentos ao vivo.
  const notaFechamento = kpis.mesesComFechamento.length > 0 ? (
    <p className="text-xs text-text-3 mt-3">
      Período inclui mês com fechamento importado — detalhamentos mostram só os lançamentos ao vivo.
    </p>
  ) : null;

  // ── Ranking: insumos consumidos (saídas de estoque)
  const rankEstoque = useMemo<EstRankItem[]>(() => {
    const map: Record<string, { nome: string; qtd: number; custo: number }> = {};
    for (const mov of movs) {
      const k = mov.produto_id;
      if (!map[k]) map[k] = { nome: mov.produto?.nome ?? 'Produto', qtd: 0, custo: 0 };
      map[k].qtd   += mov.quantidade;
      map[k].custo += mov.quantidade * (mov.produto?.preco_custo ?? 0);
    }
    const list = Object.values(map).sort((a, b) => b.qtd - a.qtd).slice(0, 10);
    const maxQ = list[0]?.qtd ?? 1;
    return list.map(s => ({ ...s, pct: (s.qtd / maxQ) * 100 }));
  }, [movs]);

  // ── Avaliações: média por profissional
  const { notaMedia, rankAvaliacoes } = useMemo(() => {
    const notaMedia = avaliacoes.length > 0
      ? avaliacoes.reduce((s, a) => s + a.nota, 0) / avaliacoes.length
      : 0;

    const map: Record<string, { nome: string; total: number; qtd: number }> = {};
    for (const av of avaliacoes) {
      const k = av.profissional_id ?? '__sem__';
      if (!map[k]) map[k] = { nome: av.profissional?.nome ?? 'Sem profissional', total: 0, qtd: 0 };
      map[k].total += av.nota;
      map[k].qtd++;
    }
    const rank = Object.values(map)
      .map(p => ({ ...p, media: p.total / p.qtd }))
      .sort((a, b) => b.media - a.media);

    return { notaMedia, rankAvaliacoes: rank };
  }, [avaliacoes]);

  // ── Ranking: despesas por categoria
  const rankDespCat = useMemo<RankItem[]>(() => {
    const map: Record<string, { nome: string; valor: number; qtd: number }> = {};
    for (const d of despesas) {
      const k = d.categoria ?? 'Outros';
      if (!map[k]) map[k] = { nome: k, valor: 0, qtd: 0 };
      map[k].valor += d.valor;
      map[k].qtd++;
    }
    const list = Object.values(map).sort((a, b) => b.valor - a.valor);
    const maxV = list[0]?.valor ?? 1;
    return list.map(s => ({ ...s, pct: (s.valor / maxV) * 100 }));
  }, [despesas]);

  // ── Comissões agrupadas por profissional (para aba Comissões)
  const comissoesPorProf = useMemo(() => {
    const map = new Map<string, {
      nome:           string;
      pendentes:      Comissao[];
      pagas:          Comissao[];
      totalPendente:  number;
      totalPago:      number;
    }>();

    for (const c of comissoes) {
      const pid = c.profissional_id;
      if (!map.has(pid)) {
        map.set(pid, {
          nome:          c.profissional?.nome ?? 'Profissional',
          pendentes:     [],
          pagas:         [],
          totalPendente: 0,
          totalPago:     0,
        });
      }
      const entry = map.get(pid)!;
      if (c.status === 'pendente') {
        entry.pendentes.push(c);
        entry.totalPendente += c.valor_comissao;
      } else {
        entry.pagas.push(c);
        entry.totalPago += c.valor_comissao;
      }
    }

    // Ordena por maior pendente primeiro
    return Array.from(map.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.totalPendente - a.totalPendente);
  }, [comissoes]);

  // ── Marcar comissões como pagas (optimistic UI)
  async function marcarComoPago(profissionalId: string) {
    const ids = comissoes
      .filter(c => c.profissional_id === profissionalId && c.status === 'pendente')
      .map(c => c.id);
    if (ids.length === 0) return;

    // Optimistic update
    setComissoes(prev => prev.map(c =>
      ids.includes(c.id) ? { ...c, status: 'pago' as const } : c
    ));

    const { data, error } = await supabase
      .from('comissoes')
      .update({ status: 'pago' })
      .in('id', ids)
      .select('id');

    // RLS pode devolver sucesso com 0 linhas afetadas: confere antes de dar por pago.
    if (error || (data?.length ?? 0) < ids.length) {
      // Revert
      setComissoes(prev => prev.map(c =>
        ids.includes(c.id) ? { ...c, status: 'pendente' as const } : c
      ));
      showErro(error ? `Erro ao atualizar comissões: ${error.message}` : 'Sem permissão para marcar todas as comissões como pagas.');
    }
  }

  // Estado de accordion: profissionais com detalhes expandidos
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  function toggleExpandido(id: string) {
    setExpandidos(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Série do gráfico (bruto completo, com vendas e taxas; semana no domingo)
  const serieGrafico = useMemo(
    () => serieFaturamento(dados, atual).map(p => ({ label: p.rotulo, valor: p.valor })),
    [dados, atual],
  );

  const maxGrafico = useMemo(() => Math.max(...serieGrafico.map(s => s.valor), 1), [serieGrafico]);

  // ── Retenção: "retornou" = atendida no período E antes dele (regra única web + mobile)
  const { atendidas: clientesUnicos, retornaram, novas } = useMemo(
    () => metricasRetorno(dadosPeriodo.agendamentos, historicoClientes),
    [dadosPeriodo, historicoClientes],
  );

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="bm-page">
      {/* Toast de erro */}
      {toastErro && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-red text-white px-5 py-3 rounded-2xl shadow-lg font-semibold text-sm pointer-events-none">
          {toastErro}
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4 bm-mobile-page-header">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>Análise</p>
          <div className="flex items-center gap-3"><h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>Relatórios</h1><PrivacyToggle /></div>
          {!loading && (
            periodo === 'custom' ? (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <input
                  type="date"
                  value={customIni}
                  max={customFim}
                  onChange={e => atualizarCustomIni(e.target.value)}
                  aria-label="Data inicial"
                  className="text-xs text-text-2 bg-surface border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <span className="text-text-4 text-xs">até</span>
                <input
                  type="date"
                  value={customFim}
                  min={customIni}
                  max={hojeBRT()}
                  onChange={e => atualizarCustomFim(e.target.value)}
                  aria-label="Data final"
                  className="text-xs text-text-2 bg-surface border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            ) : periodo === 'semana' ? (
              <div className="flex items-center gap-1 mt-0.5">
                <button
                  onClick={() => setSemanaOffset(o => o - 1)}
                  aria-label="Semana anterior"
                  className="w-5 h-5 rounded-full flex items-center justify-center text-text-3 hover:bg-surface hover:text-text transition flex-shrink-0"
                >
                  <ChevronLeft size={13} />
                </button>
                <p className="text-sm text-text-3">{labelPeriodo}</p>
                <button
                  onClick={() => setSemanaOffset(o => Math.min(o + 1, 0))}
                  disabled={semanaOffset >= 0}
                  aria-label="Próxima semana"
                  className="w-5 h-5 rounded-full flex items-center justify-center text-text-3 hover:bg-surface hover:text-text transition disabled:opacity-30 disabled:pointer-events-none flex-shrink-0"
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            ) : periodo === 'ano' ? (
              <div className="flex items-center gap-1 mt-0.5">
                <button
                  onClick={() => setAnoOffset(o => o - 1)}
                  aria-label="Ano anterior"
                  className="w-5 h-5 rounded-full flex items-center justify-center text-text-3 hover:bg-surface hover:text-text transition flex-shrink-0"
                >
                  <ChevronLeft size={13} />
                </button>
                <p className="text-sm text-text-3">{labelPeriodo}</p>
                <button
                  onClick={() => setAnoOffset(o => Math.min(o + 1, 0))}
                  disabled={anoOffset >= 0}
                  aria-label="Próximo ano"
                  className="w-5 h-5 rounded-full flex items-center justify-center text-text-3 hover:bg-surface hover:text-text transition disabled:opacity-30 disabled:pointer-events-none flex-shrink-0"
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            ) : (
              <p className="text-sm text-text-3 mt-0.5 capitalize">{labelPeriodo}</p>
            )
          )}
        </div>

        {/* Exportar */}
        <div className="flex items-center gap-2 bm-mobile-export-only">
          {!loading && (
            <ExportButton
              variant="mobileHeader"
              className="bm-mobile-header-export"
              filename={`relatorio-${aba}-${labelPeriodo.replace(/\s/g, '-')}`}
              title={`Relatório ${ABA_OPTS.find(a => a.key === aba)?.label} — ${labelPeriodo}`}
              columns={(
                aba === 'servicos' ? [
                  { header: 'Serviço',       accessor: (r: RankItem) => r.nome,          width: 30 },
                  { header: 'Atendimentos',  accessor: (r: RankItem) => r.qtd,           width: 14 },
                  { header: 'Receita',       accessor: (r: RankItem) => fmtBRL(r.valor), width: 16 },
                ] : aba === 'equipe' ? [
                  { header: 'Profissional',  accessor: (r: RankItem) => r.nome,          width: 28 },
                  { header: 'Atendimentos',  accessor: (r: RankItem) => r.qtd,           width: 14 },
                  { header: 'Receita gerada',accessor: (r: RankItem) => fmtBRL(r.valor), width: 16 },
                  { header: 'Comissão',      accessor: (r: any) => fmtBRL(r.comissao ?? 0), width: 16 },
                ] : aba === 'clientes' ? [
                  { header: 'Cliente',       accessor: (r: RankItem) => r.nome,          width: 28 },
                  { header: 'Atendimentos',  accessor: (r: RankItem) => r.qtd,           width: 14 },
                  { header: 'Total gasto',   accessor: (r: RankItem) => fmtBRL(r.valor), width: 16 },
                ] : aba === 'estoque' ? [
                  { header: 'Produto',       accessor: (r: EstRankItem) => r.nome,            width: 28 },
                  { header: 'Qtd consumida', accessor: (r: EstRankItem) => r.qtd,             width: 14 },
                  { header: 'Custo estimado',accessor: (r: EstRankItem) => fmtBRL(r.custo),   width: 16 },
                ] : aba === 'comissoes' ? [
                  { header: 'Profissional', accessor: (c: Comissao) => c.profissional?.nome ?? '—',                                         width: 22 },
                  { header: 'Data',         accessor: (c: Comissao) => c.agendamento ? format(parseISO(c.agendamento.data_hora_inicio), 'dd/MM/yyyy') : '—', width: 12 },
                  { header: 'Cliente',      accessor: (c: Comissao) => c.agendamento?.cliente?.nome ?? '—',                                  width: 22 },
                  { header: 'Serviço',      accessor: (c: Comissao) => c.agendamento?.servico?.nome ?? '—',                                  width: 22 },
                  { header: 'Vlr atend.',   accessor: (c: Comissao) => c.agendamento ? fmtBRL(c.agendamento.valor) : '—',                    width: 12 },
                  { header: '%',            accessor: (c: Comissao) => `${c.percentual}%`,                                                   width: 6  },
                  { header: 'Comissão',     accessor: (c: Comissao) => fmtBRL(c.valor_comissao),                                             width: 12 },
                  { header: 'Status',       accessor: (c: Comissao) => c.status === 'pago' ? 'Pago' : 'Pendente',                            width: 10 },
                ] : /* financeiro */ [
                  { header: 'Data',      accessor: (a: Ag) => format(parseISO(a.data_hora_inicio), 'dd/MM/yyyy HH:mm'), width: 18 },
                  { header: 'Cliente',   accessor: (a: Ag) => a.cliente?.nome ?? '—',     width: 26 },
                  { header: 'Serviço',   accessor: (a: Ag) => a.servico?.nome ?? '—',     width: 26 },
                  { header: 'Valor',     accessor: (a: Ag) => fmtBRL(a.valor),            width: 14 },
                  { header: 'Status',    accessor: (a: Ag) => a.status,                   width: 12 },
                ]
              ) as ExportColumn<any>[]}
              getData={() => (
                aba === 'servicos'   ? rankServicos :
                aba === 'equipe'     ? rankEquipe   :
                aba === 'clientes'   ? rankClientes :
                aba === 'estoque'    ? rankEstoque  :
                aba === 'comissoes'  ? comissoes    :
                concluidos
              ) as any[]}
            />
          )}
        </div>
      </div>

      {/* Seletor de período — tabs */}
      <SmoothTabs
        variant="pill"
        className="mb-6"
        tabs={PERIODOS_RELATORIO}
        active={periodo}
        onChange={key => {
          setPeriodo(key as Periodo);
          if (key === 'semana') setSemanaOffset(0);
          if (key === 'ano') setAnoOffset(0);
        }}
      />

      {erroCarga && (
        <div className="bg-red-soft border border-border rounded-2xl p-4 mb-6 text-sm font-semibold text-red">
          {erroCarga}
        </div>
      )}

      {/* ── KPIs ── */}
      {!erroCarga && <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard icon={DollarSign} label="Faturamento bruto"    value={fmtBRL(bruto)}
          sub={brutoVendas > 0 ? `inc. ${fmtBRL(brutoVendas)} em vendas` : undefined}
          delta={dBruto} rotuloDelta={ROTULO_COMPARACAO[periodo]}
          cor="#7C3AED" loading={loading} />
        {taxasCartao > 0 && (
          <KpiCard icon={CreditCard} label="Taxas de cartão"    value={fmtBRL(taxasCartao)}         cor="#DC2626" loading={loading} />
        )}
        <KpiCard icon={TrendingUp} label="Líquido após taxas"   value={fmtBRL(liquidoAposTaxas)}    cor="#16A34A" loading={loading} />
        <KpiCard icon={Activity}   label="Lucro real"           value={fmtBRL(lucro)}               cor={lucro >= 0 ? '#0D7E5F' : '#DC2626'} loading={loading} />
        {isOwner && retiradasPeriodo > 0 && (
          <KpiCard icon={Activity} label="Resultado após retiradas" value={fmtBRL(resultadoAposRetiradas)}
            sub={`(−) ${fmtBRL(retiradasPeriodo)} da dona`}
            cor={resultadoAposRetiradas >= 0 ? '#0D7E5F' : '#DC2626'} loading={loading} />
        )}
        <KpiCard icon={Scissors}   label="Atendimentos"         value={String(kpis.atendimentos)}   sub="concluídos"
          delta={dAtend} rotuloDelta={ROTULO_COMPARACAO[periodo]} cor="#D4608A" loading={loading} />
        <KpiCard icon={Target}     label="Ticket médio"         value={fmtBRL(ticket)}
          delta={dTicket} rotuloDelta={ROTULO_COMPARACAO[periodo]} cor="#B45309" loading={loading} />
        <KpiCard icon={Users}      label="Taxa comparecimento"  value={`${taxa.toFixed(1)}%`}       cor="#1D4ED8" loading={loading} />
        <KpiCard icon={XCircle} label="Taxa de cancelamento"
          value={kpis.totalAgendamentos > 0 ? `${kpis.pctCancelamento.toFixed(1)}%` : '—'}
          sub={kpis.perdidos > 0 ? `${kpis.perdidos} perdido(s)` : undefined}
          cor="#DC2626" loading={loading} />
        {(brutoTaxas + brutoReserva) > 0 && (
          <KpiCard icon={Receipt}       label="Taxas (cancel. + reserva)" value={fmtBRL(brutoTaxas + brutoReserva)}          cor="#DC2626" loading={loading} />
        )}
        <KpiCard icon={DollarSign} label="Total comissões"      value={fmtBRL(comTot)}
          sub={kpis.comissoesPendentes > 0 ? `${fmtBRL(kpis.comissoesPendentes)} pendentes` : 'Em dia'}
          cor="#D97706" loading={loading} />
      </div>}

      {/* ── Abas ── */}
      <SmoothTabs
        variant="underline"
        className="mb-6"
        tabs={ABA_OPTS}
        active={aba}
        onChange={key => setAba(key as Aba)}
      />

      {/* ════════════════════════════════════════════════════════
          TAB: FINANCEIRO
      ════════════════════════════════════════════════════════ */}
      {aba === 'financeiro' && !erroCarga && (
        <div className="flex flex-col gap-5">
          {/* Gráfico de evolução de faturamento */}
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            <h2 className="font-semibold text-text mb-4">Evolução de faturamento</h2>
            {loading ? (
              <div className="flex items-end gap-2" style={{ height: 140 }}>
                {[70, 50, 85, 40, 65, 55].map((h, i) => (
                  <Sk key={i} className="flex-1 rounded-t-lg" style={{ height: `${h}%` }} />
                ))}
              </div>
            ) : serieGrafico.every(s => s.valor === 0) ? (
              <p className="text-sm text-text-3 text-center py-8">Sem faturamento no período</p>
            ) : (
              <div className="flex items-stretch gap-2" style={{ height: 140 }}>
                {serieGrafico.map((s, i) => (
                  <ChartBar key={i} label={s.label} value={s.valor} maxValue={maxGrafico} />
                ))}
              </div>
            )}
            {!loading && notaFechamento}
          </div>

          {/* Resumo + Despesas por categoria */}
          {!loading && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Resumo financeiro */}
              <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
                <h2 className="font-semibold text-text mb-4">Resumo financeiro</h2>
                <div className="flex flex-col">
                  {/* Serviços */}
                  <div className="flex items-center justify-between py-2.5 border-b border-border">
                    <span className="text-sm text-text-2">Serviços concluídos</span>
                    <span className="text-sm font-semibold" style={{ color: '#7C3AED' }}>{fmtBRL(brutoServicos)}</span>
                  </div>
                  {/* Vendas avulsas — só aparece se > 0 */}
                  {brutoVendas > 0 && (
                    <div className="flex items-center justify-between py-2.5 border-b border-border">
                      <span className="text-sm text-text-2">Vendas avulsas</span>
                      <span className="text-sm font-semibold" style={{ color: '#7C3AED' }}>{fmtBRL(brutoVendas)}</span>
                    </div>
                  )}
                  {(brutoTaxas + brutoReserva) > 0 && (
                    <div className="flex items-center justify-between py-2.5 border-b border-border">
                      <span className="text-sm text-text-2">Taxas (cancel. + reserva)</span>
                      <span className="text-sm font-semibold" style={{ color: '#7C3AED' }}><Secret>{fmtBRL(brutoTaxas + brutoReserva)}</Secret></span>
                    </div>
                  )}
                  <div className="flex items-center justify-between py-2.5 border-b border-border bg-bg/50 px-1 rounded">
                    <span className="text-sm font-semibold text-text">= Faturamento bruto</span>
                    <span className="text-sm font-bold" style={{ color: '#7C3AED' }}><Secret>{fmtBRL(bruto)}</Secret></span>
                  </div>
                  {kpis.mesesComFechamento.length > 0 && (
                    <p className="text-xs text-text-3 py-1.5">Inclui fechamento importado de {kpis.mesesComFechamento.join(', ')}.</p>
                  )}
                  {([
                    { label: '(−) Taxas de cartão', v: taxasCartao, cor: '#DC2626' },
                    { label: '(−) Comissões',       v: comTot,      cor: '#D4608A' },
                    { label: '(−) Despesas',        v: despTot,     cor: '#DC2626' },
                  ] as const).map(({ label, v, cor }) => (
                    <div key={label} className="flex items-center justify-between py-2.5 border-b border-border">
                      <span className="text-sm text-text-2">{label}</span>
                      <span className="text-sm font-semibold" style={{ color: cor }}>
                        <Secret>{v > 0 ? '− ' : ''}{fmtBRL(v)}</Secret>
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-3 mt-1">
                    <span className="text-sm font-bold text-text">Lucro real</span>
                    <span className="text-base font-bold" style={{ color: lucro >= 0 ? '#0D7E5F' : '#DC2626' }}>
                      <Secret>{fmtBRL(lucro)}</Secret>
                    </span>
                  </div>
                  {isOwner && retiradasPeriodo > 0 && (
                    <>
                      <div className="flex items-center justify-between py-2.5 border-t border-border mt-1">
                        <span className="text-sm text-text-2">(−) Retiradas da dona</span>
                        <span className="text-sm font-semibold" style={{ color: '#DC2626' }}>− <Secret>{fmtBRL(retiradasPeriodo)}</Secret></span>
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-sm font-bold text-text">Resultado após retiradas</span>
                        <span className="text-base font-bold" style={{ color: resultadoAposRetiradas >= 0 ? '#0D7E5F' : '#DC2626' }}>
                          <Secret>{fmtBRL(resultadoAposRetiradas)}</Secret>
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Despesas por categoria */}
              <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
                <h2 className="font-semibold text-text mb-4">Despesas por categoria</h2>
                {rankDespCat.length === 0 ? (
                  <p className="text-sm text-text-3 text-center py-6">Sem despesas no período</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {rankDespCat.slice(0, 6).map((d, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-text-2 w-28 truncate flex-shrink-0">{d.nome}</span>
                        <div className="flex-1 bg-bg rounded-full h-2">
                          <div className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${d.pct}%`, background: '#DC2626' }} />
                        </div>
                        <span className="text-xs font-bold text-text w-20 text-right flex-shrink-0">
                          {fmtBRL(d.valor)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          TAB: SERVIÇOS
      ════════════════════════════════════════════════════════ */}
      {aba === 'servicos' && !erroCarga && (
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-semibold text-text">Serviços por receita</h2>
            <span className="text-xs text-text-3">{rankServicos.length} serviços</span>
          </div>
          <p className="text-xs text-text-3 mb-4">Período: <span className="capitalize">{labelPeriodo}</span></p>

          {loading ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3, 4, 5].map(i => <Sk key={i} className="h-14 rounded-xl" />)}
            </div>
          ) : rankServicos.length === 0 ? (
            <p className="text-sm text-text-3 text-center py-10">Sem atendimentos concluídos no período</p>
          ) : (
            <>
              {rankServicos.map((s, i) => (
                <RankRow
                  key={i} pos={i + 1} nome={s.nome} valor={fmtBRL(s.valor)}
                  qtd={s.qtd} qtdSuffix=" atend." pct={s.pct}
                  extra={`Ticket médio: ${fmtBRL(s.qtd > 0 ? s.valor / s.qtd : 0)}`}
                />
              ))}
              <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                <span className="text-xs text-text-3">Total</span>
                <span className="text-sm font-bold text-text"><Secret>{fmtBRL(bruto)}</Secret></span>
              </div>
              {notaFechamento}
            </>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          TAB: EQUIPE
      ════════════════════════════════════════════════════════ */}
      {aba === 'equipe' && !erroCarga && (
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-semibold text-text">Desempenho por profissional</h2>
            <span className="text-xs text-text-3">{rankEquipe.length} profissionais</span>
          </div>
          <p className="text-xs text-text-3 mb-4">Receita gerada e comissões do período</p>

          {loading ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map(i => <Sk key={i} className="h-16 rounded-xl" />)}
            </div>
          ) : rankEquipe.length === 0 ? (
            <p className="text-sm text-text-3 text-center py-10">Sem dados de equipe no período</p>
          ) : (
            <>
              {rankEquipe.map((prof, i) => (
                <div key={i} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
                  {/* Posição */}
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ background: i < 3 ? '#7C3AED' : '#94A3B8' }}>
                    {i + 1}
                  </div>
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                    style={{ background: avatarCor(prof.nome) }}>
                    {iniciais(prof.nome)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-semibold text-text truncate">{prof.nome}</span>
                      <span className="text-sm font-bold text-text">{fmtBRL(prof.valor)}</span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex-1 bg-bg rounded-full h-1.5">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${prof.pct}%`, background: '#7C3AED' }} />
                      </div>
                      <span className="text-xs text-text-3 w-10 text-right flex-shrink-0">{prof.pct.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-text-3">{prof.qtd} atend.</span>
                      {prof.comissao > 0 && (
                        <span className="text-xs font-semibold text-text-2">
                          Comissão: {fmtBRL(prof.comissao)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {/* Total de comissões */}
              {comTot > 0 && (
                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                  <span className="text-xs text-text-3">Total comissões no período</span>
                  <span className="text-sm font-bold text-text"><Secret>{fmtBRL(comTot)}</Secret></span>
                </div>
              )}
              {notaFechamento}
            </>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          TAB: CLIENTES
      ════════════════════════════════════════════════════════ */}
      {aba === 'clientes' && !erroCarga && (
        <div className="flex flex-col gap-4">
          {/* Painel de retenção */}
          {!loading && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm text-center">
                <p className="text-2xl font-bold text-violet-600">{clientesUnicos}</p>
                <p className="text-xs text-text-3 mt-1">Clientes únicos</p>
              </div>
              <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm text-center">
                <p className="text-2xl font-bold text-emerald-600">{retornaram}</p>
                <p className="text-xs text-text-3 mt-1">Retornaram</p>
              </div>
              <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm text-center">
                <p className="text-2xl font-bold text-sky-600">{novas}</p>
                <p className="text-xs text-text-3 mt-1">Novas</p>
              </div>
            </div>
          )}

          {/* Top clientes por valor */}
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-text">Top clientes por valor</h2>
              <span className="text-xs text-text-3">Top {rankClientes.length}</span>
            </div>
            <p className="text-xs text-text-3 mb-4">Valor total gasto no período</p>

            {loading ? (
              <div className="flex flex-col gap-3">
                {[1, 2, 3, 4, 5].map(i => <Sk key={i} className="h-14 rounded-xl" />)}
              </div>
            ) : rankClientes.length === 0 ? (
              <p className="text-sm text-text-3 text-center py-8">Sem atendimentos concluídos no período</p>
            ) : (
              rankClientes.map((c, i) => (
                <RankRow
                  key={i} pos={i + 1} nome={c.nome} valor={fmtBRL(c.valor)}
                  qtd={c.qtd} qtdSuffix=" visitas" pct={c.pct} cor="#D4608A"
                  extra={`Ticket médio: ${fmtBRL(c.qtd > 0 ? c.valor / c.qtd : 0)}`}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          TAB: ESTOQUE
      ════════════════════════════════════════════════════════ */}
      {aba === 'estoque' && (
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-semibold text-text">Insumos consumidos</h2>
            {!loading && rankEstoque.length > 0 && (
              <span className="text-xs font-semibold text-text-2">
                Custo total: {fmtBRL(rankEstoque.reduce((s, e) => s + e.custo, 0))}
              </span>
            )}
          </div>
          <p className="text-xs text-text-3 mb-4">Saídas de estoque (consumo via atendimentos)</p>

          {loading || loadingAba ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3, 4, 5].map(i => <Sk key={i} className="h-14 rounded-xl" />)}
            </div>
          ) : rankEstoque.length === 0 ? (
            <div className="text-center py-10">
              <Package className="mx-auto mb-2 text-text-4" size={28} />
              <p className="text-sm text-text-3">Sem saídas de estoque registradas no período</p>
              <p className="text-xs text-text-4 mt-1">Use o ConsumoModal ao concluir atendimentos</p>
            </div>
          ) : (
            <>
              {rankEstoque.map((e, i) => (
                <div key={i} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ background: i < 3 ? '#0D7E5F' : '#94A3B8' }}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-semibold text-text truncate">{e.nome}</span>
                      <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                        <span className="text-xs text-text-3">
                          {e.qtd % 1 === 0 ? e.qtd : e.qtd.toFixed(2)} un.
                        </span>
                        <span className="text-sm font-bold text-text">{fmtBRL(e.custo)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-bg rounded-full h-1.5">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${e.pct}%`, background: '#0D7E5F' }} />
                      </div>
                      <span className="text-xs text-text-3 w-10 text-right flex-shrink-0">
                        {e.pct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {/* Custo médio por atendimento */}
              {concluidos.length > 0 && (
                <div className="mt-4 pt-3 border-t border-border grid grid-cols-2 gap-3">
                  <div className="bg-bg rounded-xl p-3">
                    <p className="text-xs text-text-3 mb-1">Custo total de insumos</p>
                    <p className="text-sm font-bold text-text">
                      {fmtBRL(rankEstoque.reduce((s, e) => s + e.custo, 0))}
                    </p>
                  </div>
                  <div className="bg-bg rounded-xl p-3">
                    <p className="text-xs text-text-3 mb-1">Custo médio / atendimento</p>
                    <p className="text-sm font-bold text-text">
                      {fmtBRL(rankEstoque.reduce((s, e) => s + e.custo, 0) / concluidos.length)}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          TAB: COMISSÕES
      ════════════════════════════════════════════════════════ */}
      {aba === 'comissoes' && !erroCarga && (
        <div className="flex flex-col gap-4">

          {/* Resumo geral */}
          {!loading && comissoesPorProf.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm text-center">
                <p className="text-2xl font-bold text-amber-600" style={{ letterSpacing: '-0.02em' }}>
                  {fmtBRL(comissoesPorProf.reduce((s, p) => s + p.totalPendente, 0))}
                </p>
                <p className="text-xs text-text-3 mt-1">A pagar (pendente)</p>
              </div>
              <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm text-center">
                <p className="text-2xl font-bold text-green-600" style={{ letterSpacing: '-0.02em' }}>
                  {fmtBRL(comissoesPorProf.reduce((s, p) => s + p.totalPago, 0))}
                </p>
                <p className="text-xs text-text-3 mt-1">Já pago</p>
              </div>
              <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm text-center">
                <p className="text-2xl font-bold text-text" style={{ letterSpacing: '-0.02em' }}>{comissoes.length}</p>
                <p className="text-xs text-text-3 mt-1">Comissões no período</p>
              </div>
            </div>
          )}

          {/* Cards por profissional */}
          {loading ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map(i => <Sk key={i} className="h-24 rounded-2xl"/>)}
            </div>
          ) : comissoesPorProf.length === 0 ? (
            <div className="bg-surface border border-border rounded-2xl p-10 text-center shadow-sm">
              <DollarSign size={28} className="mx-auto mb-2 text-text-4"/>
              <p className="text-sm text-text-3">Nenhuma comissão gerada no período.</p>
              <p className="text-xs text-text-4 mt-1">Comissões são criadas ao concluir agendamentos.</p>
            </div>
          ) : (
            comissoesPorProf.map(prof => (
              <div key={prof.id} className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">

                {/* Cabeçalho do profissional */}
                <div className="flex items-center gap-3 px-5 py-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                    style={{ background: avatarCor(prof.nome) }}>
                    {iniciais(prof.nome)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-text">{prof.nome}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      {prof.totalPendente > 0 && (
                        <span className="text-xs font-semibold text-amber-600">
                          {fmtBRL(prof.totalPendente)} pendente ({prof.pendentes.length}×)
                        </span>
                      )}
                      {prof.totalPago > 0 && (
                        <span className="text-xs text-text-3">
                          {fmtBRL(prof.totalPago)} pago ({prof.pagas.length}×)
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {prof.totalPendente > 0 && (
                      <button
                        onClick={() => marcarComoPago(prof.id)}
                        className="h-8 px-3 rounded-xl bg-green text-white text-xs font-bold hover:opacity-90 transition flex items-center gap-1.5">
                        <Check size={12} strokeWidth={3}/>
                        Pagar {fmtBRL(prof.totalPendente)}
                      </button>
                    )}
                    <button
                      onClick={() => toggleExpandido(prof.id)}
                      className="h-8 px-3 rounded-xl border border-border text-xs font-semibold text-text-3 hover:bg-bg transition flex items-center gap-1">
                      {expandidos.has(prof.id) ? 'Ocultar' : 'Detalhar'}
                      <ChevronDown size={12} className={`transition-transform ${expandidos.has(prof.id) ? 'rotate-180' : ''}`}/>
                    </button>
                  </div>
                </div>

                {/* Tabela de comissões individuais */}
                {expandidos.has(prof.id) && (
                  <div className="border-t border-border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-bg border-b border-border">
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-3 uppercase tracking-wide whitespace-nowrap">Data</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-3 uppercase tracking-wide">Cliente</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-3 uppercase tracking-wide">Serviço</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-3 uppercase tracking-wide whitespace-nowrap">Vlr ag.</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-3 uppercase tracking-wide">%</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-3 uppercase tracking-wide whitespace-nowrap">Comissão</th>
                          <th className="text-center px-4 py-2.5 text-xs font-semibold text-text-3 uppercase tracking-wide">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...prof.pendentes, ...prof.pagas].map(c => (
                          <tr key={c.id} className="border-b border-border last:border-0 hover:bg-bg/50 transition">
                            <td className="px-4 py-3 text-text-3 whitespace-nowrap">
                              {c.agendamento
                                ? format(parseISO(c.agendamento.data_hora_inicio), 'dd/MM/yy')
                                : '—'}
                            </td>
                            <td className="px-4 py-3 text-text truncate max-w-[160px]">
                              {c.agendamento?.cliente?.nome ?? '—'}
                            </td>
                            <td className="px-4 py-3 text-text-2 truncate max-w-[160px]">
                              {c.agendamento?.servico?.nome ?? '—'}
                            </td>
                            <td className="px-4 py-3 text-right text-text-2 whitespace-nowrap">
                              {c.agendamento ? fmtBRL(c.agendamento.valor) : '—'}
                            </td>
                            <td className="px-4 py-3 text-right text-text-3">{c.percentual}%</td>
                            <td className="px-4 py-3 text-right font-semibold text-text whitespace-nowrap">
                              {fmtBRL(c.valor_comissao)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {c.status === 'pago' ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green-soft text-green">
                                  <Check size={10} strokeWidth={3}/> Pago
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-soft text-amber">
                                  Pendente
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-bg border-t border-border">
                          <td colSpan={5} className="px-4 py-2.5 text-xs font-semibold text-text-3">
                            Total — {prof.pendentes.length + prof.pagas.length} comissões
                          </td>
                          <td className="px-4 py-2.5 text-right font-bold text-text">
                            {fmtBRL(prof.totalPendente + prof.totalPago)}
                          </td>
                          <td/>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          TAB: AVALIAÇÕES
      ════════════════════════════════════════════════════════ */}
      {aba === 'avaliacoes' && (
        <div className="flex flex-col gap-4">

          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <KpiCard loading={loading || loadingAba} icon={Star} label="Nota média geral" cor="#D97706"
              value={notaMedia > 0 ? notaMedia.toFixed(1) : '—'}
              sub={avaliacoes.length > 0 ? `${avaliacoes.length} avaliação${avaliacoes.length !== 1 ? 'ões' : ''}` : 'Nenhuma ainda'}/>
            <KpiCard loading={loading || loadingAba} icon={Users} label="Profissionais avaliados" cor="#7C3AED"
              value={String(rankAvaliacoes.length)}/>
            <KpiCard loading={loading || loadingAba} icon={TrendingUp} label="Com nota 5" cor="#0D7E5F"
              value={String(avaliacoes.filter(a => a.nota === 5).length)}
              sub={avaliacoes.length > 0 ? `${((avaliacoes.filter(a => a.nota === 5).length / avaliacoes.length) * 100).toFixed(0)}% das avaliações` : undefined}/>
          </div>

          {/* Ranking por profissional */}
          {rankAvaliacoes.length > 0 && (
            <div className="bg-surface border border-border rounded-2xl p-5">
              <h3 className="text-sm font-bold text-text mb-3 uppercase tracking-wide text-text-3" style={{ fontSize: 10.5 }}>
                Nota média por profissional
              </h3>
              <div className="flex flex-col gap-1">
                {rankAvaliacoes.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ background: i < 3 ? 'var(--color-amber)' : 'var(--color-ink4)' }}>
                      {i + 1}
                    </div>
                    <span className="flex-1 text-sm font-semibold text-text truncate">{p.nome}</span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <div className="flex gap-0.5">
                        {[1,2,3,4,5].map(s => (
                          <Star key={s} size={12} strokeWidth={1.5}
                            fill={s <= Math.round(p.media) ? 'var(--color-amber)' : 'none'}
                            style={{ color: s <= Math.round(p.media) ? 'var(--color-amber)' : 'var(--color-border)' }}/>
                        ))}
                      </div>
                      <span className="text-sm font-bold text-amber">{p.media.toFixed(1)}</span>
                      <span className="text-xs text-text-4">({p.qtd})</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Avaliações recentes */}
          {avaliacoes.length > 0 ? (
            <div className="bg-surface border border-border rounded-2xl p-5">
              <h3 className="text-sm font-bold text-text mb-3 uppercase tracking-wide text-text-3" style={{ fontSize: 10.5 }}>
                Avaliações recentes
              </h3>
              <div className="flex flex-col gap-3">
                {avaliacoes.slice(0, 20).map((av, i) => (
                  <div key={i} className="flex flex-col gap-1 pb-3 border-b border-border last:border-0">
                    <div className="flex items-center gap-2 justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-text">{av.cliente?.nome ?? '—'}</span>
                        {av.profissional && (
                          <span className="text-xs text-text-4">· {av.profissional.nome}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {[1,2,3,4,5].map(s => (
                          <Star key={s} size={11} strokeWidth={1.5}
                            fill={s <= av.nota ? 'var(--color-amber)' : 'none'}
                            style={{ color: s <= av.nota ? 'var(--color-amber)' : 'var(--color-border)' }}/>
                        ))}
                      </div>
                    </div>
                    {av.comentario && (
                      <p className="text-xs text-text-3 italic">"{av.comentario}"</p>
                    )}
                    <p className="text-xs text-text-4">{format(parseISO(av.created_at), "dd/MM/yyyy", { locale: ptBR })}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : !loading && !loadingAba ? (
            <div className="bg-surface border border-border rounded-2xl p-10 text-center">
              <Star size={28} className="mx-auto mb-2 text-text-4" strokeWidth={1.5}/>
              <p className="text-sm text-text-3">Nenhuma avaliação registrada neste período.</p>
              <p className="text-xs text-text-4 mt-1">As avaliações são coletadas ao marcar um atendimento como concluído na Agenda.</p>
            </div>
          ) : null}
        </div>
      )}

    </div>
  );
}
