'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, Banknote, CircleCheck, X, ChevronDown,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Sk } from '@/components/Skeleton';
import { ExportButton } from '@/components/ExportButton';
import { CategoriaIcon, CATEGORIA_COR, CATEGORIA_BG } from '@/components/CategoriaIcon';
import type { CategoriaServico } from '@/components/CategoriaIcon';
import {
  addDays, subDays, addWeeks, subWeeks, addMonths, subMonths, addYears, subYears,
  startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfYear, endOfYear, format, parseISO,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

const supabase = createClient();

type Periodo = 'dia' | 'semana' | 'mes' | 'trimestre' | 'semestre' | 'ano';
type Filtro  = 'todas' | 'pendentes' | 'pagas';

const PERIODOS: { key: Periodo; label: string }[] = [
  { key: 'dia',       label: 'Dia'       },
  { key: 'semana',    label: 'Semana'    },
  { key: 'mes',       label: 'Mês'       },
  { key: 'trimestre', label: 'Trimestre' },
  { key: 'semestre',  label: 'Semestre'  },
  { key: 'ano',       label: 'Ano'       },
];

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);
}
function iniciais(nome: string) {
  return nome.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}
function avatarGradient(nome: string) {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 360;
  return `linear-gradient(140deg, oklch(0.55 0.16 ${h}), oklch(0.42 0.17 ${h}))`;
}

function getPeriodRange(date: Date, periodo: Periodo): [Date, Date] {
  switch (periodo) {
    case 'dia':       return [startOfDay(date), endOfDay(date)];
    case 'semana':    return [startOfWeek(date, { weekStartsOn: 0 }), endOfWeek(date, { weekStartsOn: 0 })];
    case 'mes':       return [startOfMonth(date), endOfMonth(date)];
    case 'trimestre': {
      const q = Math.floor(date.getMonth() / 3);
      const y = date.getFullYear();
      return [new Date(y, q * 3, 1), endOfMonth(new Date(y, q * 3 + 2, 1))];
    }
    case 'semestre': {
      const y = date.getFullYear();
      return date.getMonth() < 6
        ? [new Date(y, 0, 1), endOfMonth(new Date(y, 5, 1))]
        : [new Date(y, 6, 1), endOfMonth(new Date(y, 11, 1))];
    }
    case 'ano':       return [startOfYear(date), endOfYear(date)];
  }
}

function navigate(date: Date, periodo: Periodo, dir: 1 | -1): Date {
  switch (periodo) {
    case 'dia':       return dir > 0 ? addDays(date, 1)    : subDays(date, 1);
    case 'semana':    return dir > 0 ? addWeeks(date, 1)   : subWeeks(date, 1);
    case 'mes':       return dir > 0 ? addMonths(date, 1)  : subMonths(date, 1);
    case 'trimestre': return dir > 0 ? addMonths(date, 3)  : subMonths(date, 3);
    case 'semestre':  return dir > 0 ? addMonths(date, 6)  : subMonths(date, 6);
    case 'ano':       return dir > 0 ? addYears(date, 1)   : subYears(date, 1);
  }
}

function getPeriodLabel(date: Date, periodo: Periodo): string {
  const [ini, fim] = getPeriodRange(date, periodo);
  switch (periodo) {
    case 'dia':
      return format(date, "EEE, dd 'de' MMM yyyy", { locale: ptBR }).replace(/^\w/, c => c.toUpperCase());
    case 'semana':
      return `${format(ini, 'dd/MM', { locale: ptBR })} – ${format(fim, 'dd/MM/yyyy', { locale: ptBR })}`;
    case 'mes':
      return format(date, 'MMMM yyyy', { locale: ptBR }).replace(/^\w/, c => c.toUpperCase());
    case 'trimestre': {
      const q = Math.floor(date.getMonth() / 3) + 1;
      return `${q}º Trimestre ${date.getFullYear()}`;
    }
    case 'semestre': {
      const s = date.getMonth() < 6 ? 1 : 2;
      return `${s}º Semestre ${date.getFullYear()}`;
    }
    case 'ano':
      return String(date.getFullYear());
  }
}

type ComissaoRow = {
  id: string;
  profissional_id: string;
  valor_servico: number;
  percentual: number;
  valor_comissao: number;
  status: 'pendente' | 'pago';
  created_at: string;
  agendamento: {
    data_hora_inicio: string | null;
    servico: { nome: string; categoria: string | null } | null;
  } | null;
};

type ProfRow = {
  profissional_id: string;
  nome: string;
  percentual: number;
  comissoes: ComissaoRow[];
  total: number;
  pendente: number;
  pago: number;
  totalAtendimentos: number;
};

function groupByPeriodo(comissoes: ComissaoRow[], periodo: Periodo) {
  const byMonth = ['trimestre', 'semestre', 'ano'].includes(periodo);
  const map: Record<string, ComissaoRow[]> = {};

  for (const c of comissoes) {
    const raw = c.agendamento?.data_hora_inicio ?? c.created_at;
    const d = parseISO(raw);
    const key = byMonth ? format(d, 'yyyy-MM') : format(d, 'yyyy-MM-dd');
    if (!map[key]) map[key] = [];
    map[key].push(c);
  }

  return Object.entries(map)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, items]) => {
      const d = parseISO(byMonth ? key + '-01' : key);
      const label = byMonth
        ? format(d, 'MMMM yyyy', { locale: ptBR }).replace(/^\w/, c => c.toUpperCase())
        : format(d, "EEE, dd 'de' MMM", { locale: ptBR }).replace(/^\w/, c => c.toUpperCase());
      return { key, label, items };
    });
}

export default function ComissoesPage() {
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [periodo,   setPeriodo]   = useState<Periodo>('mes');
  const [refDate,   setRefDate]   = useState(new Date());
  const [comissoes, setComissoes] = useState<ComissaoRow[]>([]);
  const [membros,   setMembros]   = useState<{ user_id: string; percentual_comissao: number; users: { nome: string } | null }[]>([]);
  const [filtro,    setFiltro]    = useState<Filtro>('todas');
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [pagando,   setPagando]   = useState<string | null>(null);
  const [salvando,  setSalvando]  = useState(false);
  const [toast,     setToast]     = useState('');

  const [ini, fim] = useMemo(() => getPeriodRange(refDate, periodo), [refDate, periodo]);
  const isFuturo   = fim > new Date();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (data) setEmpresaId(data.empresa_id);
    })();
  }, []);

  const fetchData = useCallback(async () => {
    if (!empresaId) return;
    setLoading(true);
    const [rCom, rMem] = await Promise.all([
      supabase.from('comissoes')
        .select(`id, profissional_id, valor_servico, percentual, valor_comissao, status, created_at,
          agendamento:agendamentos(data_hora_inicio, servico:servicos(nome, categoria))`)
        .eq('empresa_id', empresaId)
        .gte('created_at', ini.toISOString())
        .lte('created_at', fim.toISOString())
        .order('created_at', { ascending: false }),
      supabase.from('empresa_membros')
        .select('user_id, percentual_comissao, users:users!empresa_membros_user_id_fkey(nome)')
        .eq('empresa_id', empresaId).eq('ativo', true),
    ]);
    setComissoes((rCom.data ?? []) as unknown as ComissaoRow[]);
    setMembros((rMem.data ?? []) as any[]);
    setLoading(false);
  }, [empresaId, ini, fim]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setExpandidos(new Set()); }, [periodo, refDate]);

  const profissionais = useMemo<ProfRow[]>(() => {
    const map: Record<string, ProfRow> = {};
    for (const m of membros) {
      map[m.user_id] = {
        profissional_id: m.user_id,
        nome: m.users?.nome ?? 'Profissional',
        percentual: m.percentual_comissao,
        comissoes: [], total: 0, pendente: 0, pago: 0, totalAtendimentos: 0,
      };
    }
    for (const c of comissoes) {
      if (!map[c.profissional_id]) continue;
      map[c.profissional_id].comissoes.push(c);
      map[c.profissional_id].total += c.valor_comissao;
      map[c.profissional_id].totalAtendimentos++;
      if (c.status === 'pendente') map[c.profissional_id].pendente += c.valor_comissao;
      else                         map[c.profissional_id].pago     += c.valor_comissao;
    }
    return Object.values(map).filter(p => p.comissoes.length > 0).sort((a, b) => b.total - a.total);
  }, [comissoes, membros]);

  const resumo = useMemo(() => {
    let total = 0, pendente = 0, pago = 0;
    for (const c of comissoes) {
      total += c.valor_comissao;
      if (c.status === 'pendente') pendente += c.valor_comissao;
      else pago += c.valor_comissao;
    }
    return { total, pendente, pago };
  }, [comissoes]);

  function toggleExpand(id: string) {
    setExpandidos(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function marcarPago(profId: string) {
    if (!empresaId) return;
    setSalvando(true);
    const ids = comissoes.filter(c => c.profissional_id === profId && c.status === 'pendente').map(c => c.id);
    if (ids.length > 0) {
      await supabase.from('comissoes').update({ status: 'pago' }).in('id', ids).eq('empresa_id', empresaId);
    }
    setSalvando(false);
    setPagando(null);
    setToast('Pagamento registrado!');
    setTimeout(() => setToast(''), 2500);
    fetchData();
  }

  const periodoLabel = getPeriodLabel(refDate, periodo);
  type ExRow = { prof: string; data: string; servico: string; valor: number; perc: string; comissao: number; status: string };
  const exportRows: ExRow[] = comissoes.map(c => {
    const p = profissionais.find(x => x.profissional_id === c.profissional_id);
    return {
      prof:     p?.nome ?? '',
      data:     format(parseISO(c.agendamento?.data_hora_inicio ?? c.created_at), 'dd/MM/yyyy'),
      servico:  c.agendamento?.servico?.nome ?? '',
      valor:    c.valor_servico,
      perc:     `${c.percentual}%`,
      comissao: c.valor_comissao,
      status:   c.status === 'pago' ? 'Pago' : 'Pendente',
    };
  });

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-green text-white text-sm font-semibold px-5 py-2.5 rounded-full shadow-lg flex items-center gap-2 pointer-events-none"
          style={{ animation: 'bm-pop .35s cubic-bezier(.2,.85,.3,1)' }}>
          <CircleCheck size={15} strokeWidth={3}/>{toast}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>Equipe</p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>
            Comissões
          </h1>
        </div>
        <ExportButton<ExRow>
          filename={`comissoes-${periodoLabel.replace(/\s+/g, '-').toLowerCase()}`}
          title={`Comissões — ${periodoLabel}`}
          columns={[
            { header: 'Profissional',  accessor: r => r.prof,     width: 22 },
            { header: 'Data',          accessor: r => r.data,     width: 12 },
            { header: 'Serviço',       accessor: r => r.servico,  width: 24 },
            { header: 'Valor serviço', accessor: r => r.valor,    width: 14 },
            { header: '% Comissão',    accessor: r => r.perc,     width: 12 },
            { header: 'Comissão',      accessor: r => r.comissao, width: 12 },
            { header: 'Status',        accessor: r => r.status,   width: 10 },
          ]}
          getData={() => exportRows}
        />
      </div>

      {/* Tabs de período */}
      <div className="flex gap-1 mb-4 p-1 rounded-2xl w-fit" style={{ background: 'var(--color-bg2)' }}>
        {PERIODOS.map(p => (
          <button key={p.key}
            onClick={() => { setPeriodo(p.key); setRefDate(new Date()); }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
              periodo === p.key
                ? 'bg-surface text-primary border border-border shadow-sm'
                : 'text-text-3 hover:text-text-2'
            }`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Navegação */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => setRefDate(d => navigate(d, periodo, -1))}
          className="w-8 h-8 rounded-lg border border-border bg-surface flex items-center justify-center hover:bg-bg transition">
          <ChevronLeft size={14}/>
        </button>
        <span className="text-sm font-semibold text-text text-center" style={{ minWidth: 220 }}>{periodoLabel}</span>
        <button onClick={() => !isFuturo && setRefDate(d => navigate(d, periodo, 1))}
          disabled={isFuturo}
          className="w-8 h-8 rounded-lg border border-border bg-surface flex items-center justify-center hover:bg-bg transition disabled:opacity-30">
          <ChevronRight size={14}/>
        </button>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Total',    val: resumo.total,    cor: 'var(--color-primary)' },
          { label: 'Pendente', val: resumo.pendente, cor: 'var(--color-amber)'   },
          { label: 'Pago',     val: resumo.pago,     cor: 'var(--color-green)'   },
        ].map(s => (
          <div key={s.label} className="bg-surface border border-border rounded-2xl p-4"
            style={{ boxShadow: '0 1px 4px rgba(44,23,80,0.04)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--color-ink4)' }}>{s.label}</p>
            <p className="text-lg font-bold" style={{ color: s.cor, letterSpacing: '-0.02em' }}>
              {loading ? '—' : fmtBRL(s.val)}
            </p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex gap-2 mb-5">
        {(['todas', 'pendentes', 'pagas'] as Filtro[]).map(f => (
          <button key={f} onClick={() => setFiltro(f)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition ${
              filtro === f
                ? 'bg-primary text-white border-primary'
                : 'bg-surface text-text-3 border-border hover:border-accent/40'
            }`}>
            {f === 'todas' ? 'Todas' : f === 'pendentes' ? 'Pendentes' : 'Pagas'}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <Sk className="w-10 h-10 rounded-xl flex-shrink-0"/>
                <div className="flex-1"><Sk className="h-4 w-28 mb-1.5"/><Sk className="h-3 w-16"/></div>
                <Sk className="h-6 w-10"/>
                <Sk className="h-6 w-20"/>
                <Sk className="h-5 w-5 rounded"/>
              </div>
            </div>
          ))}
        </div>
      ) : profissionais.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Banknote size={28} className="mb-3" style={{ color: 'var(--color-ink4)' }}/>
          <h2 className="font-serif text-xl mb-1" style={{ color: 'var(--color-ink)' }}>Sem comissões</h2>
          <p className="text-sm" style={{ color: 'var(--color-ink3)' }}>Nenhum atendimento concluído no período.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {profissionais.map(prof => {
            const list = filtro === 'pendentes' ? prof.comissoes.filter(c => c.status === 'pendente')
                       : filtro === 'pagas'     ? prof.comissoes.filter(c => c.status === 'pago')
                       : prof.comissoes;
            if (list.length === 0) return null;

            const expanded    = expandidos.has(prof.profissional_id);
            const temPendente = prof.pendente > 0;
            const groups      = groupByPeriodo(list, periodo);

            return (
              <div key={prof.profissional_id}
                className="bg-surface border border-border rounded-2xl overflow-hidden"
                style={{ boxShadow: '0 1px 4px rgba(44,23,80,0.04)' }}>

                {/* Card colapsado */}
                <button
                  onClick={() => toggleExpand(prof.profissional_id)}
                  className="w-full flex items-center gap-3 p-4 text-left transition hover:bg-bg/50">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                    style={{ background: avatarGradient(prof.nome) }}>
                    {iniciais(prof.nome)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: 'var(--color-ink)' }}>{prof.nome}</p>
                    <p className="text-xs" style={{ color: 'var(--color-ink3)' }}>{prof.totalAtendimentos} atend.</p>
                  </div>

                  {/* % */}
                  <div className="text-center flex-shrink-0 px-2">
                    <p className="text-base font-bold" style={{ color: 'var(--color-primary)' }}>{prof.percentual}%</p>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-ink4)' }}>comissão</p>
                  </div>

                  {/* Valor R$ */}
                  <div className="text-right flex-shrink-0">
                    <p className="text-base font-bold"
                      style={{ color: temPendente ? 'var(--color-amber)' : 'var(--color-green)' }}>
                      {fmtBRL(prof.total)}
                    </p>
                    <p className="text-[10px]"
                      style={{ color: temPendente ? 'var(--color-amber)' : 'var(--color-green)' }}>
                      {temPendente ? 'pendente' : 'pago'}
                    </p>
                  </div>

                  <ChevronDown size={16} style={{ color: 'var(--color-ink4)', flexShrink: 0, transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none' }}/>
                </button>

                {/* Detalhe expandido */}
                {expanded && (
                  <div className="border-t border-border">
                    {groups.map(group => (
                      <div key={group.key}>
                        {/* Cabeçalho de dia/mês */}
                        {periodo !== 'dia' && (
                          <div className="px-4 py-2 border-b border-border" style={{ background: 'var(--color-bg)' }}>
                            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-ink4)' }}>
                              {group.label}
                            </p>
                          </div>
                        )}

                        {group.items.map((c, i) => {
                          const cat = (c.agendamento?.servico?.categoria ?? 'outros') as CategoriaServico;
                          const cor = CATEGORIA_COR[cat] ?? '#6B7280';
                          const bg  = CATEGORIA_BG[cat]  ?? '#F3F4F6';
                          return (
                            <div key={c.id}
                              className={`flex items-center gap-3 px-4 py-3 ${i < group.items.length - 1 ? 'border-b border-border' : ''}`}>
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                                style={{ background: bg }}>
                                <CategoriaIcon categoria={cat} size={15} color={cor}/>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold truncate" style={{ color: 'var(--color-ink)' }}>
                                  {c.agendamento?.servico?.nome ?? '—'}
                                </p>
                                <p className="text-[10px]" style={{ color: 'var(--color-ink3)' }}>
                                  {fmtBRL(c.valor_servico)} × {c.percentual}%
                                  {c.agendamento?.data_hora_inicio && (
                                    <span className="ml-1.5 opacity-60">
                                      {format(parseISO(c.agendamento.data_hora_inicio), 'HH:mm')}
                                    </span>
                                  )}
                                </p>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <p className="text-xs font-bold" style={{ color: 'var(--color-ink)' }}>
                                  {fmtBRL(c.valor_comissao)}
                                </p>
                                <span className={`inline-block text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md mt-0.5 ${
                                  c.status === 'pago' ? 'bg-green-soft text-green' : 'bg-amber-soft text-amber'
                                }`}>
                                  {c.status === 'pago' ? 'Pago' : 'Pendente'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}

                    {/* Rodapé com ação de pagamento */}
                    <div className="flex items-center justify-between px-4 py-3 border-t border-border" style={{ background: 'var(--color-bg)' }}>
                      <div>
                        <p className="text-[10px]" style={{ color: 'var(--color-ink3)' }}>
                          {temPendente ? 'Pendente para repassar' : 'Tudo repassado'}
                        </p>
                        <p className="text-sm font-bold" style={{ color: temPendente ? 'var(--color-amber)' : 'var(--color-green)' }}>
                          {fmtBRL(temPendente ? prof.pendente : prof.pago)}
                        </p>
                      </div>
                      {temPendente ? (
                        <button onClick={() => setPagando(prof.profissional_id)}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-bold hover:opacity-90 transition"
                          style={{ background: 'var(--color-green)' }}>
                          <Banknote size={13} strokeWidth={2}/>Pagar
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold"
                          style={{ background: 'var(--color-green-soft)', color: 'var(--color-green)' }}>
                          <CircleCheck size={13} strokeWidth={2}/>Pago
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de confirmação de pagamento */}
      {pagando && (() => {
        const prof = profissionais.find(p => p.profissional_id === pagando);
        if (!prof) return null;
        return (
          <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={() => !salvando && setPagando(null)}>
            <div className="bg-surface rounded-2xl p-6 w-full max-w-sm shadow-xl mx-4"
              onClick={e => e.stopPropagation()}
              style={{ animation: 'bm-pop .3s cubic-bezier(.2,.85,.3,1)' }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-ink3)' }}>Confirmar pagamento</p>
                  <h3 className="font-serif text-xl" style={{ color: 'var(--color-ink)' }}>{prof.nome}</h3>
                </div>
                <button onClick={() => setPagando(null)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition hover:bg-bg"
                  style={{ color: 'var(--color-ink3)' }}>
                  <X size={16}/>
                </button>
              </div>
              <div className="rounded-xl p-4 text-center mb-6" style={{ background: 'var(--color-amber-soft)' }}>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-amber)' }}>Total a repassar</p>
                <p className="text-3xl font-bold" style={{ color: 'var(--color-amber)', letterSpacing: '-0.02em' }}>
                  {fmtBRL(prof.pendente)}
                </p>
              </div>
              <button onClick={() => marcarPago(prof.profissional_id)}
                disabled={salvando}
                className="w-full h-12 rounded-xl text-white text-sm font-bold hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'var(--color-green)' }}>
                {salvando ? 'Salvando...' : <><Banknote size={16}/>Confirmar pagamento</>}
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
