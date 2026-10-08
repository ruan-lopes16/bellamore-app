import { getAppContext } from '@/lib/auth/server-context';
import { pode } from '@/lib/permissions';
import DashboardProfissionalView from './DashboardProfissionalView';
import Link from 'next/link';
import { CountUp } from '@/components/CountUp';
import { SparkBars } from '@/components/SparkBars';
import Tilt from '@/components/Tilt';
import {
  CalendarDays, Users, Wallet,
  AlertTriangle, ShoppingBag, Clock, ArrowUp, ArrowDown,
  CalendarPlus, Receipt, UserPlus, BadgeDollarSign, ChevronRight, ChevronLeft, Target,
  UserMinus, Cake, XCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { somaDevolucoesPorRetirada, saldoDevedorTotal } from '@shared/retiradas-socia';
import type { RetiradaSociaRow, RetiradaSociaDevolucaoRow } from '@shared/retiradas-socia';
import { hojeBRT, limitesMes, limitesDias, uniaoLimites, rotuloMesAno, horaBRT, rotuloDataHoraBRT } from '@shared/periodos';
import {
  navegacaoMesDashboard, clientesParaReconquistar, aniversariantesProximos, resumoComandasNaoFechadas,
  progressoMetaEmpresa, rotuloProgressoMeta, cartoesKpiDashboard,
} from '@shared/dashboard';
import {
  carregarUltimasVisitas, carregarAniversariantes, carregarDespesasVencendo, carregarComandasNaoFechadas,
} from '@shared/dashboard-consultas';
import {
  calcularKpisFinanceiros, variacaoPercentual, receitaAcumuladaPorDia, resumoComissoesPendentes,
  retiradasDoPeriodo,
} from '@shared/kpis-financeiros';
import {
  carregarDadosFinanceiros, carregarComissoesPendentes, carregarRetiradas,
} from '@shared/kpis-financeiros-consultas';
import { Secret, PrivacyToggle } from '@/components/privacy';
import { formatarMoeda as fmt } from '@shared/moeda';

const STATUS_MAP: Record<string, { label: string; tone: string }> = {
  agendado:   { label: 'Agendado',   tone: 'accent'   },
  confirmado: { label: 'Confirmado', tone: 'green'     },
  concluido:  { label: 'Concluído',  tone: 'primary'   },
  cancelado:  { label: 'Cancelado',  tone: 'rose'      },
  faltou:     { label: 'Faltou',     tone: 'amber'     },
};

function StatusChip({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, tone: 'neutral' };
  const toneMap: Record<string, { color: string; bg: string }> = {
    accent:  { color: 'var(--color-accent)',  bg: 'var(--color-accent-soft)' },
    green:   { color: 'var(--color-green)',   bg: 'var(--color-green-soft)'  },
    primary: { color: 'var(--color-primary)', bg: 'var(--color-primary-soft)'},
    rose:    { color: 'var(--color-rose)',    bg: 'var(--color-rose-soft)'   },
    amber:   { color: 'var(--color-amber)',   bg: 'var(--color-amber-soft)'  },
    neutral: { color: 'var(--color-ink3)',    bg: 'var(--color-bg2)'         },
  };
  const { color, bg } = toneMap[s.tone] ?? toneMap.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700, letterSpacing: 0.2,
      padding: '4px 9px', borderRadius: 999,
      color, background: bg, lineHeight: 1, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { supabase, empresaId, empresa, user, permissoes } = await getAppContext();

  if (!pode(permissoes, 'financeiro.ver')) {
    return <DashboardProfissionalView supabase={supabase} empresaId={empresaId} userId={user.id} />;
  }

  // Datas sempre em Brasília — o servidor roda em UTC (ver @shared/periodos).
  const hojeStr  = hojeBRT();
  const hoje     = new Date(`${hojeStr}T12:00:00`);   // só para rótulos e aniversários
  const diaLabel = format(hoje, "EEEE, d 'de' MMMM", { locale: ptBR });

  // Mês em exibição: navegável via ?mes=yyyy-MM, padrão = mês atual, sem ir ao futuro.
  const { mes: mesParam } = await searchParams;
  const nav           = navegacaoMesDashboard(mesParam, hojeStr);
  const mesRefKey     = nav.chave;
  const mesRef        = new Date(`${mesRefKey}-01T12:00:00`);
  const isMesAtual    = nav.isMesAtual;
  const mesRefLabel   = rotuloMesAno(mesRefKey);
  const paramAnterior = nav.anterior;
  const paramSeguinte = nav.seguinte;

  const limMes  = limitesMes(mesRefKey);
  const limAnt  = limitesMes(paramAnterior);
  const limHoje = limitesDias(hojeStr, hojeStr);

  // Qualquer falha de consulta vira tela de erro — nunca números zerados apresentados como reais.
  let carga;
  try {
    // Retiradas/empréstimos da dona só aparecem para a própria dona (owner).
    const empOwner = await supabase.from('empresas').select('owner_id').eq('id', empresaId).single();
    if (empOwner.error) throw empOwner.error;
    const isOwnerCarga = empOwner.data.owner_id === user.id;

    const resultado = await Promise.all([
      supabase.from('agendamentos')
        .select('id,status,valor,data_hora_inicio,pacote_cliente_id,cliente:clientes!agendamentos_cliente_id_fkey(nome),servico:servicos(nome)')
        .eq('empresa_id', empresaId).gte('data_hora_inicio', limHoje.startIso).lte('data_hora_inicio', limHoje.endIso)
        // "Agenda hoje" não conta cancelados (decisão do dono, 2026-10-01) — igual ao app.
        .neq('status', 'cancelado')
        .order('data_hora_inicio'),
      supabase.from('clientes').select('id', { count: 'exact', head: true })
        .eq('empresa_id', empresaId).eq('ativo', true),
      supabase.from('v_produtos_estoque_baixo').select('id,nome,estoque_atual,estoque_minimo')
        .eq('empresa_id', empresaId).eq('ativo', true),
      carregarDespesasVencendo(supabase, empresaId, hojeStr),
      carregarUltimasVisitas(supabase, empresaId),
      carregarAniversariantes(supabase, empresaId),
      // Mês exibido + anterior (comparativo) numa busca só — mesmas linhas do Financeiro.
      carregarDadosFinanceiros(supabase, empresaId, uniaoLimites(limAnt, limMes)),
      // "Fat. hoje" quando o mês exibido não é o atual.
      isMesAtual ? Promise.resolve(null) : carregarDadosFinanceiros(supabase, empresaId, limHoje),
      // Alerta: TODAS as comissões pendentes, de qualquer mês (regra única web + mobile).
      carregarComissoesPendentes(supabase, empresaId),
      isOwnerCarga
        ? carregarRetiradas(supabase, empresaId)
        : Promise.resolve({ rows: [] as RetiradaSociaRow[], devs: [] as RetiradaSociaDevolucaoRow[] }),
      carregarComandasNaoFechadas(supabase, empresaId, new Date().toISOString()),
    ] as const);

    // Erro em qualquer consulta direta aborta a carga (sem isso viraria "sem dados").
    for (const r of [resultado[0], resultado[1], resultado[2]]) {
      if (r.error) throw r.error;
    }
    carga = { resultado, isOwnerCarga };
  } catch (e) {
    return (
      <div className="bm-page max-w-5xl mx-auto w-full">
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', marginBottom: 16 }}>
          Dashboard
        </h1>
        <div className="rounded-2xl p-5" role="alert"
          style={{ background: 'var(--color-rose-soft)', border: '1px solid var(--color-border-soft)' }}>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700, color: 'var(--color-rose)' }}>
            Não foi possível carregar o Dashboard.
          </p>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-ink3)', marginTop: 4 }}>
            {(e as { message?: string })?.message || 'Erro desconhecido.'} Atualize a página para tentar de novo.
          </p>
        </div>
      </div>
    );
  }

  const isOwner = carga.isOwnerCarga;
  const [
    agendamentosHoje, totalClientes, estoqueBaixo, despVencendo,
    ultimasVisitas, clientesComAniversario,
    dados, dadosDeHoje, comissoesPendentesRows, retiradasDados, comandasRows,
  ] = carga.resultado;

  // KPIs — mesmas funções do Financeiro, Relatórios e app mobile.
  const kpis     = calcularKpisFinanceiros(dados, limMes);
  const kpisAnt  = calcularKpisFinanceiros(dados, limAnt);
  const kpisHoje = calcularKpisFinanceiros(dadosDeHoje ?? dados, limHoje);
  const { bruto, lucro } = kpis;
  const pctBruto = variacaoPercentual(bruto, kpisAnt.bruto);

  // Retiradas/empréstimos da dona (owner-only) — linhas ADITIVAS, não mudam o lucro.
  const retiradasMes       = retiradasDoPeriodo(retiradasDados.rows, retiradasDados.devs, limMes);
  const emprestimosAbertos = saldoDevedorTotal(retiradasDados.rows, somaDevolucoesPorRetirada(retiradasDados.devs));

  const agsHoje       = agendamentosHoje.data ?? [];
  const agsConcluidos = agsHoje.filter(a => a.status === 'concluido');
  const fatHoje       = kpisHoje.bruto;

  const estoqueBaixoItems  = estoqueBaixo.data ?? [];
  const despPendentesItems = despVencendo;
  const totalComPendente   = resumoComissoesPendentes(comissoesPendentesRows).total;
  // Só quem fecha comanda recebe o alerta (hoje: owner/gestor, que já veem o Dashboard financeiro).
  const comandas           = pode(permissoes, 'comanda.fechar')
    ? resumoComandasNaoFechadas(comandasRows)
    : { quantidade: 0, maisAntiga: null };
  const totalAlertas       = estoqueBaixoItems.length + despPendentesItems.length + (totalComPendente > 0 ? 1 : 0)
    + (comandas.quantidade > 0 ? 1 : 0);

  // Reconquista (inativos > 45 dias) e aniversariantes (7 dias): regras únicas de shared, em Brasília.
  const clientesInativos = clientesParaReconquistar(ultimasVisitas, hojeStr);
  const aniversariantes  = aniversariantesProximos(clientesComAniversario, hojeStr);
  const meta             = progressoMetaEmpresa(bruto, empresa.meta_mensal);
  const cartoesMes       = cartoesKpiDashboard(kpis, kpisAnt, { isOwner, retiradasMes, emprestimosAbertos, fmt });

  // Receita acumulada dia a dia (mês atual: até hoje · mês passado: completo), em Brasília.
  const sparkData = receitaAcumuladaPorDia(dados, limMes, isMesAtual ? hojeStr : limMes.endDate);


  return (
    <div className="bm-page max-w-5xl mx-auto w-full">

      {/* ── Header ── */}
      <div className="mb-6">
        <div className="flex items-center gap-1 mb-1">
          <Link href={`/dashboard?mes=${paramAnterior}`} aria-label="Mês anterior"
            className="flex items-center justify-center rounded-md transition-colors hover:bg-[var(--color-bg2)]"
            style={{ width: 22, height: 22, color: 'var(--color-ink4)' }}>
            <ChevronLeft size={12} strokeWidth={2.4} />
          </Link>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            {mesRefLabel}
          </p>
          {!isMesAtual && paramSeguinte ? (
            <Link href={`/dashboard?mes=${paramSeguinte}`} aria-label="Próximo mês"
              className="flex items-center justify-center rounded-md transition-colors hover:bg-[var(--color-bg2)]"
              style={{ width: 22, height: 22, color: 'var(--color-ink4)' }}>
              <ChevronRight size={12} strokeWidth={2.4} />
            </Link>
          ) : (
            <span style={{ width: 22, height: 22 }} />
          )}
          {!isMesAtual && (
            <Link href="/dashboard"
              style={{ fontFamily: 'var(--font-sans)', fontSize: 9.5, fontWeight: 700, color: 'var(--color-accent)', background: 'var(--color-accent-soft)', borderRadius: 999, padding: '2px 8px', marginLeft: 2 }}>
              Hoje
            </Link>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>
            Dashboard
          </h1>
          <PrivacyToggle />
        </div>
      </div>

      {/* ── Hero receita ── */}
      <Tilt className="mb-4">
      <div className="relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #2C1750 0%, #4A2A86 100%)',
          borderRadius: 24,
          padding: '22px 28px 24px',
          boxShadow: '0 12px 36px rgba(44,23,80,0.20), 0 4px 10px rgba(44,23,80,0.12)',
        }}>

        <div className="relative" style={{ zIndex: 1 }}>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.48)', textTransform: 'uppercase', letterSpacing: '0.13em', marginBottom: 8 }}>
            Receita - {format(mesRef, 'MMMM yyyy', { locale: ptBR }).toUpperCase()}
          </p>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'clamp(28px, 8vw, 38px)', fontWeight: 800, color: '#fff', letterSpacing: '-0.04em', lineHeight: 1 }}>
            <span style={{ fontSize: 16, fontWeight: 500, opacity: 0.6, marginRight: 4 }}>R$</span>
            <Secret><CountUp value={bruto} decimals={2} /></Secret>
          </p>
          <div className="flex items-center gap-3 mt-3">
            {pctBruto !== null && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: pctBruto >= 0 ? 'rgba(52,201,146,0.20)' : 'rgba(232,114,154,0.20)', borderRadius: 999, padding: '4px 10px', fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700, color: pctBruto >= 0 ? '#A8F0D4' : '#F4B8CE' }}>
                {pctBruto >= 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                <Secret>{pctBruto >= 0 ? '+' : '-'}{Math.abs(pctBruto).toFixed(0)}%</Secret>
              </span>
            )}
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11.5, color: 'rgba(255,255,255,0.38)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Lucro <Secret>{fmt(lucro)}</Secret>
            </span>
          </div>
          {kpis.mesesComFechamento.length > 0 && (
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 10, maxWidth: 'calc(100% - 140px)' }}>
              Mês com fechamento importado — o gráfico diário mostra só os lançamentos ao vivo.
            </p>
          )}
        </div>

        <div className="absolute pointer-events-none" style={{ right: 24, bottom: 14, zIndex: 0 }}>
          <SparkBars data={sparkData} />
        </div>
      </div>
      </Tilt>

      {/* ── KPIs do mês ── */}
      {/* "Fat. Bruto" saiu daqui: repete o valor do card hero (Receita) logo acima. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-4">
        {cartoesMes.map(({ id, rotulo, valor, sub, subDestaque, delta, tom }, i, arr) => {
          const Icon = id === 'cancelamento' ? XCircle : id === 'comissoes' || id === 'donaDeve' ? BadgeDollarSign : Wallet;
          const color = tom === 'negativo' ? 'var(--color-rose)' : tom === 'alerta' ? 'var(--color-amber)' : 'var(--color-primary)';
          return (
          <div key={id} className={`rounded-2xl p-3 md:p-5 bm-stagger min-w-0 ${
            i === arr.length - 1 && arr.length % 2 === 1 ? 'col-span-2 lg:col-span-1' : ''
          }`}
            style={{ '--bm-i': i, '--bm-step': '55ms', background: 'var(--color-surface)', border: '1px solid var(--color-border-soft)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)' } as React.CSSProperties}>
            <div className="flex items-start justify-between mb-2 gap-1">
              <p className="truncate" style={{ fontFamily: 'var(--font-sans)', fontSize: 9, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{rotulo}</p>
              <Icon size={12} style={{ color, opacity: 0.7, flexShrink: 0 }} strokeWidth={2} />
            </div>
            <p className="whitespace-nowrap tabular-nums" style={{ fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 700, color, letterSpacing: '-0.03em', lineHeight: 1 }}><Secret>{valor}</Secret></p>
            {delta !== null && (
              <span className="flex items-center gap-0.5 mt-1.5" style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 600, color: delta >= 0 ? 'var(--color-green)' : 'var(--color-rose)' }}>
                {delta >= 0 ? <ArrowUp size={9} /> : <ArrowDown size={9} />}
                <Secret>{Math.abs(delta).toFixed(0)}%</Secret>
              </span>
            )}
            {sub !== null && (
              <p className="mt-1.5 leading-tight sm:truncate" style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: subDestaque ? 'var(--color-amber)' : 'var(--color-ink4)', fontWeight: subDestaque ? 600 : 400 }}><Secret>{sub}</Secret></p>
            )}
          </div>
          );
        })}
      </div>

      {/* ── KPIs do dia ── */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-7">
        {[
          { label: 'Agenda hoje',    value: String(agsHoje.length), sub: `${agsConcluidos.length} concluído(s)`, icon: CalendarDays,  color: 'var(--color-accent)'   },
          { label: 'Fat. hoje',       value: fmt(fatHoje),         sub: 'Serv. + vendas + taxas',                     icon: ShoppingBag,   color: 'var(--color-primary)' },
          { label: 'Clientes',         value: String(totalClientes.count ?? 0), sub: 'Total na base',          icon: Users,         color: 'var(--color-amber)'    },
        ].map(({ label, value, sub, icon: Icon, color }, i) => (
          <div key={label} className="rounded-2xl p-3 md:p-5 bm-stagger min-w-0"
            style={{ '--bm-i': i + 3, '--bm-step': '55ms', background: 'var(--color-surface)', border: '1px solid var(--color-border-soft)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)' } as React.CSSProperties}>
            <div className="flex items-start justify-between mb-2 gap-1">
              <p className="truncate" style={{ fontFamily: 'var(--font-sans)', fontSize: 9, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
              <Icon size={12} style={{ color, opacity: 0.7, flexShrink: 0 }} strokeWidth={2} />
            </div>
            <p className="whitespace-nowrap tabular-nums" style={{ fontFamily: 'var(--font-sans)', fontSize: 18, fontWeight: 700, color, letterSpacing: '-0.03em', lineHeight: 1 }}><Secret>{value}</Secret></p>
            <p className="truncate" style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: 'var(--color-ink4)', marginTop: 4 }}><Secret>{sub}</Secret></p>
          </div>
        ))}
      </div>

      {/* ── Meta mensal ── */}
      {meta.temMeta && (
          <div className="mb-4 rounded-2xl p-4 md:p-5"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-soft)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Target size={13} style={{ color: meta.atingida ? 'var(--color-green)' : 'var(--color-accent)', flexShrink: 0 }} strokeWidth={2}/>
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.08em', flex: 1 }}>
                Meta do mês
              </p>
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11.5, fontWeight: 700, color: meta.atingida ? 'var(--color-green)' : 'var(--color-ink2)' }}>
                <Secret>{fmt(bruto)} / {fmt(Number(empresa.meta_mensal))}</Secret>
              </p>
            </div>
            <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>
              <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
                style={{ width: `${meta.percentual}%`, background: meta.atingida ? 'var(--color-green)' : 'linear-gradient(90deg, var(--color-primary), var(--color-accent))' }}/>
            </div>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, color: meta.atingida ? 'var(--color-green)' : 'var(--color-ink4)', marginTop: 6, fontWeight: meta.atingida ? 700 : 400 }}>
              <Secret>{rotuloProgressoMeta(meta, fmt)}</Secret>
            </p>
          </div>
      )}

      {/* ── Ações rápidas ── */}
      <div className="mb-7">
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>
          Ações rápidas
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { href: '/agenda',    label: 'Agendar',  icon: CalendarPlus,    fg: 'var(--color-accent)', bg: 'var(--color-accent-soft)' },
            { href: '/comanda',   label: 'Comanda',  icon: Receipt,         fg: 'var(--color-rose)',   bg: 'var(--color-rose-soft)'   },
            { href: '/clientes',  label: 'Cliente',  icon: UserPlus,        fg: 'var(--color-green)',  bg: 'var(--color-green-soft)'  },
            { href: '/financeiro',label: 'Despesa',  icon: BadgeDollarSign, fg: 'var(--color-amber)',  bg: 'var(--color-amber-soft)'  },
          ].map(({ href, label, icon: Icon, fg, bg }, i) => (
            <Link key={href} href={href}
              className="flex flex-col items-center gap-2 press transition-transform">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center bm-stagger"
                style={{ '--bm-i': i, '--bm-step': '55ms', background: bg, boxShadow: '0 1px 2px rgba(44,23,80,0.05)' } as React.CSSProperties}>
                <Icon size={22} style={{ color: fg }} strokeWidth={1.9} />
              </div>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700, color: 'var(--color-ink2)', textAlign: 'center' }}>
                {label}
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Retenção de clientes ── */}
      {(clientesInativos.length > 0 || aniversariantes.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-7">

          {/* Clientes inativos */}
          {clientesInativos.length > 0 && (
            <div className={`rounded-2xl p-5${aniversariantes.length === 0 ? ' lg:col-span-2' : ''}`}
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)' }}>
              <div className="flex items-center gap-2 mb-4">
                <UserMinus size={14} style={{ color: 'var(--color-rose)' }} strokeWidth={2} />
                <h2 style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: 'var(--color-ink)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Reconquistar
                </h2>
                <span className="ml-auto text-xs font-bold text-white px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--color-rose)', fontFamily: 'var(--font-sans)', fontSize: 10 }}>
                  {clientesInativos.length}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {clientesInativos.map(c => {
                  return (
                    <Link key={c.clienteId} href={`/clientes/${c.clienteId}`}
                      className="flex items-center gap-3 p-3 rounded-xl transition-opacity hover:opacity-80"
                      style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border-soft)' }}>
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: 'var(--color-rose-soft)', fontSize: 11, fontWeight: 700, color: 'var(--color-rose)', fontFamily: 'var(--font-sans)' }}>
                        {c.nome.split(' ').slice(0,2).map((n: string) => n[0]).join('').toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</p>
                        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-ink3)', marginTop: 1 }}>Sem visita há {c.diasSemVisita} dias</p>
                      </div>
                      <ChevronRight size={13} style={{ color: 'var(--color-ink4)', flexShrink: 0 }} strokeWidth={2} />
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* Aniversariantes */}
          {aniversariantes.length > 0 && (
            <div className={`rounded-2xl p-5${clientesInativos.length === 0 ? ' lg:col-span-2' : ''}`}
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)' }}>
              <div className="flex items-center gap-2 mb-4">
                <Cake size={14} style={{ color: 'var(--color-primary)' }} strokeWidth={2} />
                <h2 style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: 'var(--color-ink)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Aniversariantes
                </h2>
                <span className="ml-auto text-xs font-bold text-white px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--color-primary)', fontFamily: 'var(--font-sans)', fontSize: 10 }}>
                  {aniversariantes.length}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {aniversariantes.map(c => {
                  const isToday = c.diasAte === 0;
                  const label = c.rotulo;
                  const dateStr = `${c.dataAniversario.slice(8, 10)}/${c.dataAniversario.slice(5, 7)}`;
                  return (
                    <Link key={c.id} href={`/clientes/${c.id}`}
                      className="flex items-center gap-3 p-3 rounded-xl transition-opacity hover:opacity-80"
                      style={{ background: isToday ? 'var(--color-primary-soft)' : 'var(--color-bg)', border: `1px solid ${isToday ? 'rgba(44,23,80,0.12)' : 'var(--color-border-soft)'}` }}>
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: 'var(--color-primary-soft)', fontFamily: 'var(--font-sans)' }}>
                        <Cake size={14} style={{ color: 'var(--color-primary)' }} strokeWidth={2} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</p>
                        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-ink3)', marginTop: 1 }}>{dateStr} · {label}</p>
                      </div>
                      <ChevronRight size={13} style={{ color: 'var(--color-ink4)', flexShrink: 0 }} strokeWidth={2} />
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── Grid: Agenda hoje + Alertas ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Agenda do dia */}
        <div className="lg:col-span-2 rounded-2xl p-5"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Clock size={14} style={{ color: 'var(--color-ink3)' }} />
            <h2 style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: 'var(--color-ink)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Agenda de hoje
            </h2>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11.5, color: 'var(--color-ink4)', fontWeight: 400, textTransform: 'capitalize' }}>
              · {diaLabel}
            </span>
            <Link href="/agenda" className="ml-auto flex items-center gap-0.5"
              style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: 'var(--color-accent)' }}>
              Ver <ChevronRight size={13} strokeWidth={2.4} />
            </Link>
          </div>

          {agsHoje.length > 0 ? (
            <div className="flex flex-col gap-2">
              {agsHoje.map((a: any, i: number) => {
                const horario = horaBRT(a.data_hora_inicio);
                return (
                  <div key={a.id} className="flex items-center gap-3 p-3 rounded-xl bm-stagger"
                    style={{ '--bm-i': i, '--bm-step': '70ms', background: 'var(--color-bg)', border: '1px solid var(--color-border-soft)' } as React.CSSProperties}>
                    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13.5, fontWeight: 800, color: 'var(--color-primary)', minWidth: 40, flexShrink: 0 }}>
                      {horario}
                    </span>
                    <div style={{ width: 1, height: 28, background: 'var(--color-border-soft)', flexShrink: 0 }} />
                    <div className="flex-1 min-w-0">
                      <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13.5, fontWeight: 700, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {(a.cliente as any)?.nome ?? '—'}
                      </p>
                      <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11.5, color: 'var(--color-ink3)', marginTop: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {(a.servico as any)?.nome ?? '—'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 800, color: 'var(--color-ink)', whiteSpace: 'nowrap' }}>
                        {fmt(Number(a.valor))}
                      </span>
                      <StatusChip status={a.status} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <CalendarDays size={28} style={{ color: 'var(--color-ink4)' }} strokeWidth={1.5} />
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13.5, color: 'var(--color-ink4)' }}>
                Nenhum agendamento para hoje
              </p>
              <Link href="/agenda" style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, color: 'var(--color-accent)' }}>
                Ver agenda →
              </Link>
            </div>
          )}
        </div>

        {/* Alertas */}
        <div className="rounded-2xl p-5"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)' }}>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={14} style={{ color: 'var(--color-amber)' }} />
            <h2 style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: 'var(--color-ink)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Alertas
            </h2>
            {totalAlertas > 0 && (
              <span className="ml-auto text-xs font-bold text-white px-2 py-0.5 rounded-full"
                style={{ background: 'var(--color-rose)', fontFamily: 'var(--font-sans)', fontSize: 10 }}>
                {totalAlertas}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {estoqueBaixoItems.map((p: any) => (
              <Link key={p.id} href="/estoque"
                className="flex items-start gap-3 p-3 rounded-xl transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-amber-soft)', border: '1px solid rgba(166,90,27,0.13)' }}>
                <AlertTriangle size={13} style={{ color: 'var(--color-amber)', flexShrink: 0, marginTop: 1 }} strokeWidth={2} />
                <div className="min-w-0">
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: 'var(--color-amber)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nome}</p>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-ink3)', marginTop: 1 }}>
                    <Secret>{p.estoque_atual} un · mín. {p.estoque_minimo}</Secret>
                  </p>
                </div>
              </Link>
            ))}

            {despPendentesItems.map((d: any) => (
              <Link key={d.id} href="/financeiro"
                className="flex items-start gap-3 p-3 rounded-xl transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-rose-soft)', border: '1px solid rgba(201,82,127,0.13)' }}>
                <AlertTriangle size={13} style={{ color: 'var(--color-rose)', flexShrink: 0, marginTop: 1 }} strokeWidth={2} />
                <div className="min-w-0">
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: 'var(--color-rose)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.descricao}</p>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-ink3)', marginTop: 1 }}>
                    Vence {d.data_vencimento.slice(8, 10)}/{d.data_vencimento.slice(5, 7)} · <Secret>{fmt(Number(d.valor))}</Secret>
                  </p>
                </div>
              </Link>
            ))}

            {comandas.quantidade > 0 && comandas.maisAntiga && (
              <Link href="/comanda"
                className="flex items-start gap-3 p-3 rounded-xl transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-rose-soft)', border: '1px solid rgba(201,82,127,0.13)' }}>
                <Receipt size={13} style={{ color: 'var(--color-rose)', flexShrink: 0, marginTop: 1 }} strokeWidth={2} />
                <div className="min-w-0">
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: 'var(--color-rose)' }}>
                    {comandas.quantidade} {comandas.quantidade === 1 ? 'comanda não fechada' : 'comandas não fechadas'}
                  </p>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-ink3)', marginTop: 1 }}>
                    Mais antiga: {rotuloDataHoraBRT(comandas.maisAntiga.data_hora_inicio)}
                  </p>
                </div>
              </Link>
            )}

            {totalComPendente > 0 && (
              <Link href="/comissoes"
                className="flex items-start gap-3 p-3 rounded-xl transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-primary-soft)', border: '1px solid rgba(44,23,80,0.1)' }}>
                <Wallet size={13} style={{ color: 'var(--color-primary)', flexShrink: 0, marginTop: 1 }} strokeWidth={2} />
                <div>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: 'var(--color-primary)' }}>Comissões a pagar</p>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-ink3)', marginTop: 1 }}><Secret>{fmt(totalComPendente)}</Secret> pendentes</p>
                </div>
              </Link>
            )}

            {totalAlertas === 0 && (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <span style={{ fontSize: 22 }}>✓</span>
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-ink4)' }}>Nenhum alerta</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
