import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { CountUp } from '@/components/CountUp';
import { SparkBars } from '@/components/SparkBars';
import Tilt from '@/components/Tilt';
import {
  TrendingUp, CalendarDays, Users, Wallet,
  AlertTriangle, ShoppingBag, Clock, ArrowUp, ArrowDown,
  CalendarPlus, Receipt, UserPlus, BadgeDollarSign, ChevronRight,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfDay, endOfDay, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';

function fmt(v: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 0,
  }).format(v);
}

function pct(atual: number, anterior: number): number | null {
  if (anterior === 0) return null;
  return ((atual - anterior) / anterior) * 100;
}

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

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: membro } = await supabase
    .from('empresa_membros')
    .select('empresa_id')
    .eq('user_id', user.id).eq('ativo', true).limit(1).single();
  if (!membro) redirect('/criar-empresa');
  const empresaId = membro.empresa_id;

  const hoje         = new Date();
  const mesLabel     = format(hoje, "MMMM 'de' yyyy", { locale: ptBR });
  const diaLabel     = format(hoje, "EEEE, d 'de' MMMM", { locale: ptBR });
  const inicioMes    = startOfMonth(hoje).toISOString();
  const fimMes       = endOfMonth(hoje).toISOString();
  const inicioHoje   = startOfDay(hoje).toISOString();
  const fimHoje      = endOfDay(hoje).toISOString();
  const inicioMesAnt = startOfMonth(subMonths(hoje, 1)).toISOString();
  const fimMesAnt    = endOfMonth(subMonths(hoje, 1)).toISOString();
  const daqui7       = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const hojeStr      = hoje.toISOString().slice(0, 10);

  const [
    agendamentosHoje, agsMes, agsMesAnt, membros,
    despMes, despMesAnt, vendasMes, vendasMesAnt, vendasHoje,
    totalClientes, estoqueBaixo, despPendentes, comissoesPendentes,
  ] = await Promise.all([
    supabase.from('agendamentos')
      .select('id,status,valor,data_hora_inicio,cliente:clientes!agendamentos_cliente_id_fkey(nome),servico:servicos(nome)')
      .eq('empresa_id', empresaId).gte('data_hora_inicio', inicioHoje).lte('data_hora_inicio', fimHoje)
      .order('data_hora_inicio'),
    supabase.from('agendamentos').select('profissional_id,valor,data_hora_inicio')
      .eq('empresa_id', empresaId).eq('status', 'concluido')
      .gte('data_hora_inicio', inicioMes).lte('data_hora_inicio', fimMes),
    supabase.from('agendamentos').select('valor')
      .eq('empresa_id', empresaId).eq('status', 'concluido')
      .gte('data_hora_inicio', inicioMesAnt).lte('data_hora_inicio', fimMesAnt),
    supabase.from('empresa_membros').select('user_id,percentual_comissao')
      .eq('empresa_id', empresaId).eq('role', 'profissional'),
    supabase.from('despesas').select('valor')
      .eq('empresa_id', empresaId).eq('status', 'pago')
      .gte('data_pagamento', inicioMes.slice(0,10)).lte('data_pagamento', fimMes.slice(0,10)),
    supabase.from('despesas').select('valor')
      .eq('empresa_id', empresaId).eq('status', 'pago')
      .gte('data_pagamento', inicioMesAnt.slice(0,10)).lte('data_pagamento', fimMesAnt.slice(0,10)),
    supabase.from('vendas').select('valor_final,created_at')
      .eq('empresa_id', empresaId).gte('created_at', inicioMes).lte('created_at', fimMes),
    supabase.from('vendas').select('valor_final')
      .eq('empresa_id', empresaId).gte('created_at', inicioMesAnt).lte('created_at', fimMesAnt),
    supabase.from('vendas').select('valor_final')
      .eq('empresa_id', empresaId).gte('created_at', inicioHoje).lte('created_at', fimHoje),
    supabase.from('clientes').select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId).eq('ativo', true),
    supabase.from('produtos').select('id,nome,estoque_atual,estoque_minimo')
      .eq('empresa_id', empresaId).eq('ativo', true).filter('estoque_atual', 'lte', 'estoque_minimo'),
    supabase.from('despesas').select('id,descricao,valor,data_vencimento')
      .eq('empresa_id', empresaId).eq('status', 'pendente')
      .gte('data_vencimento', hojeStr).lte('data_vencimento', daqui7).order('data_vencimento'),
    supabase.from('comissoes').select('id,valor_comissao')
      .eq('empresa_id', empresaId).eq('status', 'pendente'),
  ]);

  // KPIs
  const comMap: Record<string, number> = {};
  (membros.data ?? []).forEach(m => { comMap[m.user_id] = m.percentual_comissao ?? 0; });

  const brutoConcluido = (agsMes.data ?? []).reduce((s, a) => s + Number(a.valor), 0);
  const brutoVendas    = (vendasMes.data ?? []).reduce((s, v) => s + Number(v.valor_final), 0);
  const bruto          = brutoConcluido + brutoVendas;
  const comissoes      = (agsMes.data ?? []).reduce(
    (s, a) => s + Number(a.valor) * (comMap[a.profissional_id] ?? 0) / 100, 0,
  );
  const liquido  = bruto - comissoes;
  const gastos   = (despMes.data ?? []).reduce((s, d) => s + Number(d.valor), 0);
  const lucro    = liquido - gastos;
  const brutoAnt = (agsMesAnt.data ?? []).reduce((s, a) => s + Number(a.valor), 0)
                 + (vendasMesAnt.data ?? []).reduce((s, v) => s + Number(v.valor_final), 0);
  const gastosAnt = (despMesAnt.data ?? []).reduce((s, d) => s + Number(d.valor), 0);

  const agsHoje       = agendamentosHoje.data ?? [];
  const agsConcluidos = agsHoje.filter(a => a.status === 'concluido');
  const fatHoje       = agsConcluidos.reduce((s, a) => s + Number(a.valor), 0)
                      + (vendasHoje.data ?? []).reduce((s, v) => s + Number(v.valor_final), 0);

  const estoqueBaixoItems  = estoqueBaixo.data ?? [];
  const despPendentesItems = despPendentes.data ?? [];
  const totalComPendente   = (comissoesPendentes.data ?? []).reduce((s, c) => s + Number(c.valor_comissao), 0);
  const totalAlertas       = estoqueBaixoItems.length + despPendentesItems.length + (totalComPendente > 0 ? 1 : 0);

  const pctBruto = pct(bruto, brutoAnt);
  const pctLucro = pct(lucro, brutoAnt - gastosAnt);

  // Receita diária acumulada para o sparkline
  const todayDay = hoje.getDate();
  const dailyMap: Record<number, number> = {};
  (agsMes.data ?? []).forEach(a => {
    const d = new Date(a.data_hora_inicio).getDate();
    dailyMap[d] = (dailyMap[d] ?? 0) + Number(a.valor);
  });
  (vendasMes.data ?? []).forEach(v => {
    const d = new Date(v.created_at).getDate();
    dailyMap[d] = (dailyMap[d] ?? 0) + Number(v.valor_final);
  });
  const sparkData: number[] = [];
  let acc = 0;
  for (let d = 1; d <= todayDay; d++) {
    acc += dailyMap[d] ?? 0;
    sparkData.push(acc);
  }

  return (
    <div className="max-w-5xl mx-auto w-full">

      {/* ── Header ── */}
      <div className="mb-7">
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>
          {mesLabel}
        </p>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 30, fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>
          Dashboard
        </h1>
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
            Receita - {format(hoje, 'MMMM yyyy', { locale: ptBR }).toUpperCase()}
          </p>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 38, fontWeight: 800, color: '#fff', letterSpacing: '-0.04em', lineHeight: 1 }}>
            <span style={{ fontSize: 16, fontWeight: 500, opacity: 0.6, marginRight: 4 }}>R$</span>
            <CountUp value={bruto} />
          </p>
          <div className="flex items-center gap-3 mt-3">
            {pctBruto !== null && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: pctBruto >= 0 ? 'rgba(52,201,146,0.20)' : 'rgba(232,114,154,0.20)', borderRadius: 999, padding: '4px 10px', fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700, color: pctBruto >= 0 ? '#A8F0D4' : '#F4B8CE' }}>
                {pctBruto >= 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                {pctBruto >= 0 ? '+' : '-'}{Math.abs(pctBruto).toFixed(0)}%
              </span>
            )}
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11.5, color: 'rgba(255,255,255,0.38)' }}>
              Lucro {fmt(lucro)}
            </span>
          </div>
        </div>

        <div className="absolute pointer-events-none" style={{ right: 24, bottom: 14, zIndex: 0 }}>
          <SparkBars data={sparkData} />
        </div>
      </div>
      </Tilt>

      {/* ── KPIs do mês ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        {[
          { label: 'Fat. Bruto',    value: fmt(bruto),   color: 'var(--color-green)',   delta: pctBruto, icon: TrendingUp  },
          { label: 'Fat. Líquido',  value: fmt(liquido), color: 'var(--color-primary)', delta: null,     icon: Wallet      },
          { label: 'Lucro do mês',  value: fmt(lucro),   color: lucro >= 0 ? 'var(--color-primary)' : 'var(--color-rose)', delta: pctLucro, icon: Wallet },
        ].map(({ label, value, color, delta, icon: Icon }, i) => (
          <div key={label} className="rounded-2xl p-4 md:p-5 bm-stagger"
            style={{ '--bm-i': i, '--bm-step': '55ms', background: 'var(--color-surface)', border: '1px solid var(--color-border-soft)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)' } as React.CSSProperties}>
            <div className="flex items-start justify-between mb-2.5">
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 9.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</p>
              <Icon size={14} style={{ color, opacity: 0.7 }} strokeWidth={2} />
            </div>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 18, fontWeight: 800, color, letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</p>
            {delta !== null && (
              <span className="flex items-center gap-0.5 mt-2" style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 600, color: delta >= 0 ? 'var(--color-green)' : 'var(--color-rose)' }}>
                {delta >= 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                {Math.abs(delta).toFixed(0)}%
              </span>
            )}
          </div>
        ))}
      </div>

      {/* ── KPIs do dia ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-7">
        {[
          { label: 'Agenda hoje',    value: String(agsHoje.length), sub: `${agsConcluidos.length} concluído(s)`, icon: CalendarDays,  color: 'var(--color-accent)'   },
          { label: 'Faturamento hoje', value: fmt(fatHoje),         sub: 'Serviços + vendas',                   icon: ShoppingBag,   color: 'var(--color-primary)' },
          { label: 'Clientes ativos',  value: String(totalClientes.count ?? 0), sub: 'Total na base',          icon: Users,         color: 'var(--color-amber)'    },
        ].map(({ label, value, sub, icon: Icon, color }, i) => (
          <div key={label} className="rounded-2xl p-4 md:p-5 bm-stagger"
            style={{ '--bm-i': i + 3, '--bm-step': '55ms', background: 'var(--color-surface)', border: '1px solid var(--color-border-soft)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)' } as React.CSSProperties}>
            <div className="flex items-start justify-between mb-2.5">
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 9.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</p>
              <Icon size={14} style={{ color, opacity: 0.7 }} strokeWidth={2} />
            </div>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 22, fontWeight: 800, color, letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</p>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, color: 'var(--color-ink4)', marginTop: 6 }}>{sub}</p>
          </div>
        ))}
      </div>

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
                const horario = format(new Date(a.data_hora_inicio), 'HH:mm');
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
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13.5, fontWeight: 800, color: 'var(--color-ink)' }}>
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
                    {p.estoque_atual} un · mín. {p.estoque_minimo}
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
                    Vence {format(new Date(d.data_vencimento + 'T12:00:00'), 'dd/MM', { locale: ptBR })} · {fmt(Number(d.valor))}
                  </p>
                </div>
              </Link>
            ))}

            {totalComPendente > 0 && (
              <Link href="/equipe"
                className="flex items-start gap-3 p-3 rounded-xl transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-primary-soft)', border: '1px solid rgba(44,23,80,0.1)' }}>
                <Wallet size={13} style={{ color: 'var(--color-primary)', flexShrink: 0, marginTop: 1 }} strokeWidth={2} />
                <div>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: 'var(--color-primary)' }}>Comissões a pagar</p>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-ink3)', marginTop: 1 }}>{fmt(totalComPendente)} pendentes</p>
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
