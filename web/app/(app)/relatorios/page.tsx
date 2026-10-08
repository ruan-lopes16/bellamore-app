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

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  TrendingUp, BarChart2, Users, Package, Scissors,
  ChevronDown, ChevronLeft, ChevronRight, DollarSign, Target, Activity, User, Check, Star, CreditCard, XCircle,
  Receipt,
} from 'lucide-react';
import { ExportButton } from '@/components/ExportButton';
import { definicaoRelatorio } from '@shared/exportacao/relatorios';
import { createClient } from '@/lib/supabase/client';
import { Sk } from '@/components/Skeleton';
import { KpiCardSkeleton } from './RelatoriosSkeleton';
import { SmoothTabs } from '@/components/SmoothTabs';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  PERIODOS_RELATORIO, limitesDoPeriodo, rotuloDoPeriodo, uniaoLimites, hojeBRT, chaveDiaBRT, rotuloDataBR,
  type PeriodoRelatorio, type OpcoesPeriodo,
} from '@shared/periodos';
import {
  calcularKpisFinanceiros, recortarDados, serieFaturamento, rankingAtendimentos, metricasRetorno,
  clientesAtendidosNoPeriodo, retiradasDoPeriodo, clientesSumidas, DADOS_VAZIOS,
  type DadosFinanceiros, type ItemRanking,
} from '@shared/kpis-financeiros';
import {
  carregarDadosFinanceiros, carregarClientesComHistoricoAntes, carregarRetiradas,
} from '@shared/kpis-financeiros-consultas';
import {
  ABAS_RELATORIO, cartoesKpiRelatorio, linhasResumoFinanceiro, rankingDespesasPorCategoria, comissaoPorProfissional,
  resumoInsumos, resumoAvaliacoes, type AbaRelatorio, type ItemInsumo, type CartaoKpiRelatorio, type MovEstoqueRow, type AvaliacaoRow,
} from '@shared/relatorios';
import { carregarSaidasEstoque, carregarAvaliacoes } from '@shared/relatorios-consultas';
import {
  normalizarComissoes, comissoesPorProfissional, resumoComissoes, textoConfirmarPagamento, MENSAGEM_PAGAMENTO_PARCIAL,
  type ComissaoItem,
} from '@shared/comissoes';
import { carregarComissoesDoPeriodo, pagarComissoes } from '@shared/comissoes-consultas';
import { carregarUltimasVisitas } from '@shared/dashboard-consultas';
import { datasDasUltimasVisitas } from '@shared/dashboard';
import type { RetiradaSociaRow, RetiradaSociaDevolucaoRow } from '@shared/retiradas-socia';
import { Secret, PrivacyToggle } from '@/components/privacy';
import { usePermissoes } from '@/components/PermissoesProvider';
import { formatarMoeda as fmtBRL } from '@shared/moeda';

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

/** Item genérico de ranking (serviços, equipe, clientes) */
type RankItem = { nome: string; valor: number; qtd: number; pct: number };

// ── Constantes ────────────────────────────────────────────────

const ICONE_ABA: Record<AbaRelatorio, React.ComponentType<{ size?: number }>> = {
  financeiro: BarChart2, servicos: Scissors, equipe: Users, clientes: User, estoque: Package, comissoes: DollarSign, avaliacoes: Star,
};
const ABA_OPTS = ABAS_RELATORIO.map(a => ({ ...a, icon: ICONE_ABA[a.key] }));
type Aba = AbaRelatorio;

const ICONE_KPI: Record<CartaoKpiRelatorio['id'], React.ElementType> = {
  bruto: DollarSign, cartao: CreditCard, liquido: TrendingUp, lucro: Activity, aposRetiradas: Activity,
  atendimentos: Scissors, ticket: Target, comparecimento: Users, cancelamento: XCircle, taxas: Receipt, comissoes: DollarSign,
};
const COR_KPI: Record<CartaoKpiRelatorio['id'], string> = {
  bruto: '#7C3AED', cartao: '#DC2626', liquido: '#16A34A', lucro: '#0D7E5F', aposRetiradas: '#0D7E5F',
  atendimentos: '#D4608A', ticket: '#B45309', comparecimento: '#1D4ED8', cancelamento: '#DC2626', taxas: '#DC2626', comissoes: '#D97706',
};

const AVATAR_CORES = ['#7C3AED', '#D4608A', '#0D7E5F', '#B45309', '#1D4ED8', '#7C2D12'];

// ── Helpers ───────────────────────────────────────────────────

/** Formata número para BRL sem centavos */
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
      <div className="flex-1 min-w-0 w-full overflow-hidden">
        <p className="text-sm sm:text-lg font-bold text-text leading-tight whitespace-nowrap tabular-nums"><Secret>{value}</Secret></p>
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
  // O UPDATE de `comissoes` no banco exige `comissoes.pagar` (igual ao app e às outras telas de pagar).
  const podePagarComissoes = usePermissoes().pode('comissoes.pagar');


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
  // Contadores de requisição: descartam respostas de cargas antigas (troca rápida de período).
  const reqRef = useRef(0);
  const reqRetiradasRef = useRef(0);
  const [comissoes,  setComissoes]  = useState<ComissaoItem[]>([]);
  const [movs,       setMovs]       = useState<MovEstoqueRow[]>([]);
  const [avaliacoes, setAvaliacoes] = useState<AvaliacaoRow[]>([]);
  // Clientes sumidas (+60d) até o fim do período; null = ainda não carregou / falhou.
  const [sumidas, setSumidas] = useState<number | null>(null);
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
    const req = ++reqRef.current;
    setLoading(true);
    setErroCarga('');
    const { atual: lAtual, anterior: lAnterior } = limitesDoPeriodo(per, hojeBRT(), opts);
    try {
      const [d, rCom, ultimas] = await Promise.all([
        carregarDadosFinanceiros(supabase, empId, uniaoLimites(lAnterior, lAtual)),
        carregarComissoesDoPeriodo(supabase, empId, lAtual),
        carregarUltimasVisitas(supabase, empId, lAtual.endIso),
      ]);
      if (req !== reqRef.current) return;   // resposta velha
      const ids = clientesAtendidosNoPeriodo(recortarDados(d, lAtual).agendamentos);
      const hist = await carregarClientesComHistoricoAntes(supabase, empId, ids, lAtual.startIso);
      if (req !== reqRef.current) return;
      setDados(d);
      setComissoes(normalizarComissoes(rCom));
      setSumidas(clientesSumidas(datasDasUltimasVisitas(ultimas), lAtual.endIso));
      setHistoricoClientes(hist);
    } catch (e) {
      if (req !== reqRef.current) return;
      const msg = `Erro ao carregar o relatório: ${(e as Error).message}`;
      setDados(DADOS_VAZIOS);
      setComissoes([]);
      setSumidas(null);
      setHistoricoClientes(new Set());
      setErroCarga(msg);
      showErro(msg);
    }
    if (req === reqRef.current) setLoading(false);
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
    const reqR = ++reqRetiradasRef.current;
    carregarRetiradas(supabase, empresaId)
      .then(r => { if (reqR !== reqRetiradasRef.current) return; setRetiradasRows(r.rows); setRetiradasDevsRows(r.devs); })
      .catch(e => {
        if (reqR !== reqRetiradasRef.current) return;
        setRetiradasRows([]); setRetiradasDevsRows([]);
        showErro(`Erro ao carregar retiradas: ${(e as Error).message}`);
      });
  }, [empresaId, isOwner]);

  // ── Aba Estoque: carrega sob demanda (sai da query principal)
  useEffect(() => {
    if (aba !== 'estoque' || !empresaId) return;
    const chave = `${empresaId}-${periodo}-${semanaOffset}-${anoOffset}-${customIni}-${customFim}`;
    if (estoqueChave === chave) return;
    // Guarda: resposta de período/aba antigo não pode sobrescrever o estado atual.
    let ativo = true;
    (async () => {
      setLoadingAba(true);
      try {
        const rows = await carregarSaidasEstoque(supabase, empresaId, atual);
        if (!ativo) return;
        setMovs(rows);
        setEstoqueChave(chave);
      } catch (e) {
        if (!ativo) return;
        setMovs([]);
        showErro(`Erro ao carregar o estoque: ${(e as Error).message}`);
      }
      if (ativo) setLoadingAba(false);
    })();
    return () => { ativo = false; };
  }, [aba, empresaId, periodo, semanaOffset, anoOffset, customIni, customFim, periodoOpts, estoqueChave, atual]);

  // ── Aba Avaliações: carrega sob demanda (sai da query principal)
  useEffect(() => {
    if (aba !== 'avaliacoes' || !empresaId) return;
    const chave = `${empresaId}-${periodo}-${semanaOffset}-${anoOffset}-${customIni}-${customFim}`;
    if (avalChave === chave) return;
    // Guarda: resposta de período/aba antigo não pode sobrescrever o estado atual.
    let ativo = true;
    (async () => {
      setLoadingAba(true);
      try {
        const rows = await carregarAvaliacoes(supabase, empresaId, atual);
        if (!ativo) return;
        setAvaliacoes(rows);
        setAvalChave(chave);
      } catch (e) {
        if (!ativo) return;
        setAvaliacoes([]);
        showErro(`Erro ao carregar as avaliações: ${(e as Error).message}`);
      }
      if (ativo) setLoadingAba(false);
    })();
    return () => { ativo = false; };
  }, [aba, empresaId, periodo, semanaOffset, anoOffset, customIni, customFim, periodoOpts, avalChave, atual]);

  // ── Números únicos (mesmas funções do Financeiro, Dashboard e app mobile)
  const dadosPeriodo = useMemo(() => recortarDados(dados, atual), [dados, atual]);
  const kpis    = useMemo(() => calcularKpisFinanceiros(dados, atual),    [dados, atual]);
  const kpisAnt = useMemo(() => calcularKpisFinanceiros(dados, anterior), [dados, anterior]);
  const ags = useMemo(() => dadosPeriodo.agendamentos.map(a => ({
    ...a, valor: Number(a.valor ?? 0),
    servico: a.servico ?? null, profissional: a.profissional ?? null, cliente: a.cliente ?? null,
  })) as Ag[], [dadosPeriodo]);
  const concluidos = useMemo(() => ags.filter(a => a.status === 'concluido'), [ags]);

  const bruto = kpis.bruto;
  const comTot = kpis.comissoes;

  // Retiradas da dona no período — linha ADITIVA, não muda o "Lucro real".
  const retiradasPeriodo = useMemo(
    () => (isOwner ? retiradasDoPeriodo(retiradasRows, retiradasDevsRows, atual) : 0),
    [isOwner, retiradasRows, retiradasDevsRows, atual],
  );
  const cartoes = cartoesKpiRelatorio(kpis, kpisAnt, { periodo, isOwner, retiradasPeriodo, fmt: fmtBRL });
  const linhasResumo = linhasResumoFinanceiro(kpis, { isOwner, retiradasPeriodo });

  // ── Rankings (quantidade = concluídos; receita = só sem pacote)
  const paraRank = (lista: ItemRanking[]): RankItem[] =>
    lista.map(r => ({ nome: r.nome, valor: r.receita, qtd: r.quantidade, pct: r.percentual }));
  const rankServicos = useMemo(() => paraRank(rankingAtendimentos(dadosPeriodo.agendamentos, 'servico')), [dadosPeriodo]);
  // Comissão por profissional: mesma fonte do KPI (linhas de comissoes do período).
  const comPorProf = useMemo(() => comissaoPorProfissional(dadosPeriodo.comissoes), [dadosPeriodo]);
  const rankEquipe = useMemo<(RankItem & { comissao: number })[]>(() => {
    return rankingAtendimentos(dadosPeriodo.agendamentos, 'profissional').map(r => ({
      nome: r.nome, valor: r.receita, qtd: r.quantidade, pct: r.percentual, comissao: comPorProf[r.chave] ?? 0,
    }));
  }, [dadosPeriodo, comPorProf]);
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

  const rankDespCat = useMemo(() => rankingDespesasPorCategoria(dadosPeriodo.despesas), [dadosPeriodo]);
  const insumos = useMemo(() => resumoInsumos(movs, kpis.atendimentos), [movs, kpis.atendimentos]);
  const aval = useMemo(() => resumoAvaliacoes(avaliacoes), [avaliacoes]);
  const comissoesPorProf = useMemo(() => comissoesPorProfissional(comissoes), [comissoes]);
  const resumoCom = useMemo(() => resumoComissoes(comissoes), [comissoes]);

  // ── Marcar comissões como pagas (optimistic UI) — só as pendentes do período exibido
  const [pagandoId, setPagandoId] = useState<string | null>(null);
  async function marcarComoPago(profissionalId: string) {
    if (pagandoId || !podePagarComissoes) return;
    const prof = comissoesPorProf.find(p => p.profissionalId === profissionalId);
    if (!empresaId || !prof) return;
    const ids = prof.idsPendentes;
    if (ids.length === 0) return;
    if (!confirm(textoConfirmarPagamento(prof.nome, fmtBRL(prof.pendente), labelPeriodo))) return;

    // Sem flip otimista: só marca como paga o que o banco confirmou (mesmo comportamento das outras telas de pagar).
    const marcar = (idsAlvo: string[], status: 'pago') => {
      setComissoes(prev => prev.map(c => idsAlvo.includes(c.id) ? { ...c, status } : c));
      setDados(prev => ({
        ...prev,
        comissoes: prev.comissoes.map(c => idsAlvo.includes(c.id) ? { ...c, status } : c),
      }));
    };
    const req = reqRef.current;
    // pagarComissoes confere as linhas afetadas.
    setPagandoId(profissionalId);
    let r: Awaited<ReturnType<typeof pagarComissoes>>;
    try { r = await pagarComissoes(supabase, empresaId, ids); } finally { setPagandoId(null); }
    // Se o período mudou durante a chamada, a tela já recarregou com o estado do banco.
    if (req === reqRef.current) marcar(r.confirmados, 'pago');
    const confirmados = new Set(r.confirmados);
    const naoConfirmados = ids.filter(id => !confirmados.has(id));
    if (naoConfirmados.length > 0 || r.erro) {
      showErro(r.erro ? `Erro ao atualizar comissões: ${r.erro}` : MENSAGEM_PAGAMENTO_PARCIAL);
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
  const { atendidas: clientesUnicos, retornaram, novas, pctRetorno } = useMemo(
    () => metricasRetorno(dadosPeriodo.agendamentos, historicoClientes),
    [dadosPeriodo, historicoClientes],
  );

  // ── Render ────────────────────────────────────────────────────

  /** Linha padrão da aba exibida (mesmos arrays que alimentam a tela). */
  const linhasExportacao: unknown[] =
    aba === 'servicos' ? rankServicos.map(r => ({ nome: r.nome, quantidade: r.qtd, valor: r.valor })) :
    aba === 'equipe' ? rankEquipe.map(r => ({ nome: r.nome, quantidade: r.qtd, valor: r.valor, comissao: (r as { comissao?: number }).comissao ?? 0 })) :
    aba === 'clientes' ? rankClientes.map(r => ({ nome: r.nome, quantidade: r.qtd, valor: r.valor })) :
    aba === 'estoque' ? insumos.ranking.map(r => ({ nome: r.nome, quantidade: r.qtd, custo: r.custo })) :
    aba === 'comissoes' ? comissoes.map(c => ({ profissional: c.profissionalNome, dia: chaveDiaBRT(c.dataAtendimento ?? c.criadaEm), cliente: c.clienteNome, servico: c.servicoNome, valorAtendimento: c.valorAtendimento, percentual: c.percentual, comissao: c.valorComissao, pago: c.status === 'pago' })) :
    concluidos.map(a => ({ inicio: a.data_hora_inicio, cliente: a.cliente?.nome ?? null, servico: a.servico?.nome ?? null, valor: a.valor, status: a.status }));

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
          {!loading && !erroCarga && aba !== 'avaliacoes' && (
            <ExportButton
              variant="mobileHeader"
              className="bm-mobile-header-export"
              definicao={definicaoRelatorio(aba, ABA_OPTS.find(a => a.key === aba)?.label ?? '', labelPeriodo)}
              getLinhas={() => linhasExportacao}
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
        {cartoes.map(c => (
          <KpiCard key={c.id} icon={ICONE_KPI[c.id]} label={c.rotulo} value={c.valor}
            sub={c.sub ?? undefined} delta={c.delta} rotuloDelta={c.rotuloDelta ?? undefined}
            cor={c.negativo ? '#DC2626' : COR_KPI[c.id]} loading={loading} />
        ))}
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
                  {linhasResumo.map(l => (
                    <div key={l.id}>
                      <div className={
                        l.tipo === 'resultado' ? 'flex items-center justify-between pt-3 mt-1'
                        : l.tipo === 'total' ? 'flex items-center justify-between py-2.5 border-b border-border bg-bg/50 px-1 rounded'
                        : 'flex items-center justify-between py-2.5 border-b border-border'
                      }>
                        <span className={l.tipo === 'resultado' || l.tipo === 'total' ? 'text-sm font-bold text-text' : 'text-sm text-text-2'}>{l.rotulo}</span>
                        <span className={l.tipo === 'resultado' ? 'text-base font-bold' : l.tipo === 'total' ? 'text-sm font-bold' : 'text-sm font-semibold'}
                          style={{ color: l.tipo === 'resultado' ? (l.valor >= 0 ? '#0D7E5F' : '#DC2626') : l.tipo === 'saida' ? '#DC2626' : '#7C3AED' }}>
                          <Secret>{l.tipo === 'saida' && l.valor > 0 ? '− ' : ''}{fmtBRL(l.valor)}</Secret>
                        </span>
                      </div>
                      {l.id === 'bruto' && kpis.mesesComFechamento.length > 0 && (
                        <p className="text-xs text-text-3 py-1.5">Inclui fechamento importado de {kpis.mesesComFechamento.join(', ')}.</p>
                      )}
                    </div>
                  ))}
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
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
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
              <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm text-center">
                <p className="text-2xl font-bold text-teal-600">{clientesUnicos > 0 ? `${pctRetorno}%` : '—'}</p>
                <p className="text-xs text-text-3 mt-1">Taxa de retorno</p>
              </div>
              <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm text-center">
                <p className="text-2xl font-bold text-amber-600">{sumidas == null ? '—' : sumidas}</p>
                <p className="text-xs text-text-3 mt-1">Sumidas +60d</p>
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
            {!loading && insumos.ranking.length > 0 && (
              <span className="text-xs font-semibold text-text-2">
                Custo total: {fmtBRL(insumos.custoTotal)}
              </span>
            )}
          </div>
          <p className="text-xs text-text-3 mb-4">Saídas de estoque (consumo via atendimentos)</p>

          {loading || loadingAba ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3, 4, 5].map(i => <Sk key={i} className="h-14 rounded-xl" />)}
            </div>
          ) : insumos.ranking.length === 0 ? (
            <div className="text-center py-10">
              <Package className="mx-auto mb-2 text-text-4" size={28} />
              <p className="text-sm text-text-3">Sem saídas de estoque registradas no período</p>
              <p className="text-xs text-text-4 mt-1">Use o ConsumoModal ao concluir atendimentos</p>
            </div>
          ) : (
            <>
              {insumos.ranking.map((e, i) => (
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
              {(
                <div className="mt-4 pt-3 border-t border-border grid grid-cols-2 gap-3">
                  <div className="bg-bg rounded-xl p-3">
                    <p className="text-xs text-text-3 mb-1">Custo total de insumos</p>
                    <p className="text-sm font-bold text-text">
                      {fmtBRL(insumos.custoTotal)}
                    </p>
                  </div>
                  <div className="bg-bg rounded-xl p-3">
                    <p className="text-xs text-text-3 mb-1">Custo médio / atendimento</p>
                    <p className="text-sm font-bold text-text">
                      {insumos.custoMedioPorAtendimento != null ? fmtBRL(insumos.custoMedioPorAtendimento) : '—'}
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
                  {fmtBRL(resumoCom.pendente)}
                </p>
                <p className="text-xs text-text-3 mt-1">A pagar (pendente)</p>
              </div>
              <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm text-center">
                <p className="text-2xl font-bold text-green-600" style={{ letterSpacing: '-0.02em' }}>
                  {fmtBRL(resumoCom.pago)}
                </p>
                <p className="text-xs text-text-3 mt-1">Já pago</p>
              </div>
              <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm text-center">
                <p className="text-2xl font-bold text-text" style={{ letterSpacing: '-0.02em' }}>{resumoCom.quantidade}</p>
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
              <div key={prof.profissionalId} className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">

                {/* Cabeçalho do profissional */}
                <div className="flex items-center gap-3 px-5 py-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                    style={{ background: avatarCor(prof.nome) }}>
                    {iniciais(prof.nome)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-text">{prof.nome}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      {prof.pendente > 0 && (
                        <span className="text-xs font-semibold text-amber-600">
                          {fmtBRL(prof.pendente)} pendente ({prof.itens.filter(c => c.status === 'pendente').length}×)
                        </span>
                      )}
                      {prof.pago > 0 && (
                        <span className="text-xs text-text-3">
                          {fmtBRL(prof.pago)} pago ({prof.itens.filter(c => c.status === 'pago').length}×)
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {prof.pendente > 0 && podePagarComissoes && (
                      <button
                        onClick={() => marcarComoPago(prof.profissionalId)}
                        disabled={pagandoId !== null}
                        className="h-8 px-3 rounded-xl bg-green text-white text-xs font-bold hover:opacity-90 transition flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
                        <Check size={12} strokeWidth={3}/>
                        Pagar {fmtBRL(prof.pendente)}
                      </button>
                    )}
                    <button
                      onClick={() => toggleExpandido(prof.profissionalId)}
                      className="h-8 px-3 rounded-xl border border-border text-xs font-semibold text-text-3 hover:bg-bg transition flex items-center gap-1">
                      {expandidos.has(prof.profissionalId) ? 'Ocultar' : 'Detalhar'}
                      <ChevronDown size={12} className={`transition-transform ${expandidos.has(prof.profissionalId) ? 'rotate-180' : ''}`}/>
                    </button>
                  </div>
                </div>

                {/* Tabela de comissões individuais */}
                {expandidos.has(prof.profissionalId) && (
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
                        {prof.itens.map(c => (
                          <tr key={c.id} className="border-b border-border last:border-0 hover:bg-bg/50 transition">
                            <td className="px-4 py-3 text-text-3 whitespace-nowrap">
                              {rotuloDataBR(chaveDiaBRT(c.dataAtendimento ?? c.criadaEm))}
                            </td>
                            <td className="px-4 py-3 text-text truncate max-w-[160px]">
                              {c.clienteNome}
                            </td>
                            <td className="px-4 py-3 text-text-2 truncate max-w-[160px]">
                              {c.servicoNome}
                            </td>
                            <td className="px-4 py-3 text-right text-text-2 whitespace-nowrap">
                              {c.valorAtendimento != null ? fmtBRL(c.valorAtendimento) : '—'}
                            </td>
                            <td className="px-4 py-3 text-right text-text-3">{c.percentual}%</td>
                            <td className="px-4 py-3 text-right font-semibold text-text whitespace-nowrap">
                              {fmtBRL(c.valorComissao)}
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
                            Total — {prof.itens.length} comissões
                          </td>
                          <td className="px-4 py-2.5 text-right font-bold text-text">
                            {fmtBRL(prof.total)}
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
              value={aval.notaMedia != null ? aval.notaMedia.toFixed(1) : '—'}
              sub={aval.total > 0 ? `${aval.total} avaliaç${aval.total !== 1 ? 'ões' : 'ão'}` : 'Nenhuma ainda'}/>
            <KpiCard loading={loading || loadingAba} icon={Users} label="Profissionais avaliados" cor="#7C3AED"
              value={String(aval.ranking.length)}/>
            <KpiCard loading={loading || loadingAba} icon={TrendingUp} label="Com nota 5" cor="#0D7E5F"
              value={String(aval.comNota5)}
              sub={aval.pctNota5 != null ? `${aval.pctNota5}% das avaliações` : undefined}/>
          </div>

          {/* Ranking por profissional */}
          {aval.ranking.length > 0 && (
            <div className="bg-surface border border-border rounded-2xl p-5">
              <h3 className="text-sm font-bold text-text mb-3 uppercase tracking-wide text-text-3" style={{ fontSize: 10.5 }}>
                Nota média por profissional
              </h3>
              <div className="flex flex-col gap-1">
                {aval.ranking.map((p, i) => (
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
                        {av.profissional?.user?.nome && (
                          <span className="text-xs text-text-4">· {av.profissional.user.nome}</span>
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
