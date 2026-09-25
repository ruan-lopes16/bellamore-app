import Link from 'next/link';
import { CalendarDays, Wallet, BadgeDollarSign } from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Secret, PrivacyToggle } from '@/components/privacy';
import type { AppContext } from '@/lib/auth/server-context';

function fmt(v: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 0,
  }).format(v);
}

const STATUS_LABEL: Record<string, string> = {
  agendado: 'Agendado', confirmado: 'Confirmado', concluido: 'Concluído', faltou: 'Faltou',
};

/**
 * Dashboard pessoal da profissional — números dela, não da empresa.
 * "Fat. bruto do mês" soma valor_servico (preço do serviço, não a
 * comissão) das próprias comissões do mês — mesma tabela que a tela de
 * Comissões já usa, sem query nova pesada.
 */
export default async function DashboardProfissionalView({
  supabase, empresaId, userId,
}: {
  supabase: AppContext['supabase'];
  empresaId: string;
  userId: string;
}) {
  // Brazil is UTC-3 (sem DST desde 2019).
  const hoje     = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const diaLabel = format(hoje, "EEEE, d 'de' MMMM", { locale: ptBR });
  const brYear   = hoje.getUTCFullYear();
  const brMonth  = hoje.getUTCMonth();
  const brDate   = hoje.getUTCDate();
  const inicioHoje = new Date(Date.UTC(brYear, brMonth, brDate, 3, 0, 0, 0)).toISOString();
  const fimHoje    = new Date(Date.UTC(brYear, brMonth, brDate + 1, 3, 0, 0, 0) - 1).toISOString();
  const mesRef   = new Date(brYear, brMonth, 1);
  const inicioMes = startOfMonth(mesRef).toISOString();
  const fimMes     = endOfMonth(mesRef).toISOString();

  const [{ data: agendaHoje }, { data: comissoesMes }] = await Promise.all([
    supabase.from('agendamentos')
      .select('id, data_hora_inicio, status, valor, cliente:clientes!agendamentos_cliente_id_fkey(nome), servico:servicos(nome)')
      .eq('empresa_id', empresaId).eq('profissional_id', userId)
      .gte('data_hora_inicio', inicioHoje).lte('data_hora_inicio', fimHoje)
      .neq('status', 'cancelado')
      .order('data_hora_inicio'),
    supabase.from('comissoes')
      .select('valor_servico, valor_comissao, status')
      .eq('empresa_id', empresaId).eq('profissional_id', userId)
      .gte('created_at', inicioMes).lte('created_at', fimMes),
  ]);

  const ags     = (agendaHoje ?? []) as any[];
  const fatHoje = ags.reduce((s, a) => s + Number(a.valor), 0);

  const comMes              = comissoesMes ?? [];
  const faturamentoBrutoMes = comMes.reduce((s, c) => s + Number(c.valor_servico), 0);
  const comissaoPagaMes     = comMes.filter(c => c.status === 'pago').reduce((s, c) => s + Number(c.valor_comissao), 0);
  const comissaoPendenteMes = comMes.filter(c => c.status === 'pendente').reduce((s, c) => s + Number(c.valor_comissao), 0);
  const atendimentosMes     = comMes.length;

  return (
    <div className="bm-page">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>
            {diaLabel}
          </p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>
            Minha agenda
          </h1>
        </div>
        <PrivacyToggle />
      </div>

      {/* KPIs do dia/mês */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-7">
        {[
          { label: 'Agenda hoje',       value: String(ags.length), sub: `${ags.filter(a => a.status === 'concluido').length} concluído(s)`, icon: CalendarDays, color: 'var(--color-accent)' },
          { label: 'Fat. hoje',         value: fmt(fatHoje),               sub: 'Meus atendimentos',                                          icon: Wallet,       color: 'var(--color-primary)' },
          { label: 'Fat. bruto do mês', value: fmt(faturamentoBrutoMes),   sub: `${atendimentosMes} atendimento(s)`,                          icon: Wallet,       color: 'var(--color-primary)' },
          { label: 'Comissão do mês',   value: fmt(comissaoPagaMes + comissaoPendenteMes), sub: comissaoPendenteMes > 0 ? `${fmt(comissaoPendenteMes)} pendente` : 'Em dia', icon: BadgeDollarSign, color: 'var(--color-amber)' },
        ].map(({ label, value, sub, icon: Icon, color }, i) => (
          <div key={label} className="rounded-2xl p-3 md:p-5 bm-stagger min-w-0"
            style={{ '--bm-i': i, '--bm-step': '55ms', background: 'var(--color-surface)', border: '1px solid var(--color-border-soft)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)' } as React.CSSProperties}>
            <div className="flex items-start justify-between mb-2 gap-1">
              <p className="truncate" style={{ fontFamily: 'var(--font-sans)', fontSize: 9, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
              <Icon size={12} style={{ color, opacity: 0.7, flexShrink: 0 }} strokeWidth={2} />
            </div>
            <p className="whitespace-nowrap tabular-nums" style={{ fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 700, color, letterSpacing: '-0.03em', lineHeight: 1 }}><Secret>{value}</Secret></p>
            <p className="truncate" style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: 'var(--color-ink4)', marginTop: 4 }}><Secret>{sub}</Secret></p>
          </div>
        ))}
      </div>

      {/* Agenda de hoje */}
      <div className="mb-7">
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>
          Atendimentos de hoje
        </p>
        {ags.length === 0 ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-ink4)' }}>Nenhum atendimento hoje.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {ags.map((ag) => (
              <Link key={ag.id} href="/agenda"
                className="press flex items-center gap-3 p-3.5 rounded-2xl"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div className="flex flex-col items-center flex-shrink-0" style={{ width: 46 }}>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, color: 'var(--color-ink)' }}>
                    {format(new Date(ag.data_hora_inicio), 'HH:mm')}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate" style={{ fontFamily: 'var(--font-sans)', fontSize: 13.5, fontWeight: 600, color: 'var(--color-ink)' }}>
                    {ag.cliente?.nome ?? 'Cliente'} · {ag.servico?.nome ?? 'Serviço'}
                  </p>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-ink4)', marginTop: 1 }}>
                    {STATUS_LABEL[ag.status] ?? ag.status}
                  </p>
                </div>
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', flexShrink: 0 }}>
                  <Secret>{fmt(Number(ag.valor))}</Secret>
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
