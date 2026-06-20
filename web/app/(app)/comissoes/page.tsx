'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, Banknote, CircleCheck,
  X, AlertCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Sk } from '@/components/Skeleton';
import { ExportButton } from '@/components/ExportButton';
import { CategoriaIcon, CATEGORIA_COR, CATEGORIA_BG } from '@/components/CategoriaIcon';
import type { CategoriaServico } from '@/components/CategoriaIcon';
import {
  addMonths, subMonths, startOfMonth, endOfMonth,
  format, isSameMonth,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

const supabase = createClient();

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);
}
function iniciais(nome: string) {
  return nome.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}
function avatarHue(nome: string) {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 360;
  return h;
}
function avatarGradient(nome: string) {
  const h = avatarHue(nome);
  return `linear-gradient(140deg, oklch(0.55 0.16 ${h}), oklch(0.42 0.17 ${h}))`;
}

type ComissaoRow = {
  id: string;
  profissional_id: string;
  agendamento_id: string;
  valor_servico: number;
  percentual: number;
  valor_comissao: number;
  status: 'pendente' | 'pago';
  created_at: string;
  agendamento: {
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

type Filtro = 'todas' | 'pendentes' | 'pagas';

export default function ComissoesPage() {
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mesRef, setMesRef] = useState(new Date());
  const [comissoes, setComissoes] = useState<ComissaoRow[]>([]);
  const [membros, setMembros] = useState<{ user_id: string; percentual_comissao: number; users: { nome: string } | null }[]>([]);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [pagando, setPagando] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [toast, setToast] = useState('');
  const isHoje = isSameMonth(mesRef, new Date());

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
    const ini = startOfMonth(mesRef).toISOString();
    const fim = endOfMonth(mesRef).toISOString();

    const [rCom, rMem] = await Promise.all([
      supabase.from('comissoes')
        .select(`id, profissional_id, agendamento_id, valor_servico, percentual, valor_comissao, status, created_at,
          agendamento:agendamentos(servico:servicos(nome, categoria))`)
        .eq('empresa_id', empresaId)
        .gte('created_at', ini)
        .lte('created_at', fim)
        .order('created_at', { ascending: false }),
      supabase.from('empresa_membros')
        .select('user_id, percentual_comissao, users:users!empresa_membros_user_id_fkey(nome)')
        .eq('empresa_id', empresaId).eq('ativo', true),
    ]);

    setComissoes((rCom.data ?? []) as unknown as ComissaoRow[]);
    setMembros((rMem.data ?? []) as any[]);
    setLoading(false);
  }, [empresaId, mesRef]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const profissionais = useMemo<ProfRow[]>(() => {
    const map: Record<string, ProfRow> = {};
    for (const m of membros) {
      map[m.user_id] = {
        profissional_id: m.user_id,
        nome: m.users?.nome ?? 'Profissional',
        percentual: m.percentual_comissao,
        comissoes: [],
        total: 0, pendente: 0, pago: 0, totalAtendimentos: 0,
      };
    }
    for (const c of comissoes) {
      if (!map[c.profissional_id]) continue;
      map[c.profissional_id].comissoes.push(c);
      map[c.profissional_id].total += c.valor_comissao;
      map[c.profissional_id].totalAtendimentos++;
      if (c.status === 'pendente') map[c.profissional_id].pendente += c.valor_comissao;
      else map[c.profissional_id].pago += c.valor_comissao;
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

  const mesLabel = format(mesRef, 'MMMM yyyy', { locale: ptBR }).replace(/^\w/, c => c.toUpperCase());

  type ExRow = { prof: string; servico: string; valor: number; perc: string; comissao: number; status: string };
  const exportRows: ExRow[] = comissoes.map(c => {
    const p = profissionais.find(x => x.profissional_id === c.profissional_id);
    return {
      prof:     p?.nome ?? '',
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
        <div className="flex items-center gap-3">
          <ExportButton<ExRow>
            filename={`comissoes-${format(mesRef, 'yyyy-MM')}`}
            title={`Comissões — ${mesLabel}`}
            columns={[
              { header: 'Profissional',  accessor: r => r.prof },
              { header: 'Serviço',       accessor: r => r.servico },
              { header: 'Valor serviço', accessor: r => r.valor },
              { header: '% Comissão',    accessor: r => r.perc },
              { header: 'Comissão',      accessor: r => r.comissao },
              { header: 'Status',        accessor: r => r.status },
            ]}
            getData={() => exportRows}
          />
        </div>
      </div>

      {/* Seletor de mês */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => setMesRef(m => subMonths(m, 1))}
          className="w-8 h-8 rounded-lg border border-border bg-surface flex items-center justify-center hover:bg-bg transition">
          <ChevronLeft size={14} />
        </button>
        <span className="text-sm font-semibold text-text min-w-[140px] text-center">{mesLabel}</span>
        <button onClick={() => !isHoje && setMesRef(m => addMonths(m, 1))}
          disabled={isHoje}
          className="w-8 h-8 rounded-lg border border-border bg-surface flex items-center justify-center hover:bg-bg transition disabled:opacity-30">
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Resumo cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Total', val: resumo.total, cor: 'var(--color-primary)' },
          { label: 'Pendente', val: resumo.pendente, cor: 'var(--color-amber)' },
          { label: 'Pago', val: resumo.pago, cor: 'var(--color-green)' },
        ].map(s => (
          <div key={s.label} className="bg-surface border border-border rounded-2xl p-4"
            style={{ boxShadow: '0 1px 4px rgba(44,23,80,0.04)' }}>
            <p className="text-[10px] font-bold text-text-3 uppercase tracking-widest mb-2">{s.label}</p>
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

      {/* Cards dos profissionais */}
      {loading ? (
        <div className="flex flex-col gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-4">
                <Sk className="w-10 h-10 rounded-xl" />
                <div className="flex-1"><Sk className="h-4 w-24 mb-2" /><Sk className="h-3 w-16" /></div>
                <Sk className="h-5 w-16" />
              </div>
              <Sk className="h-12 w-full rounded-xl mb-2" />
              <Sk className="h-12 w-full rounded-xl" />
            </div>
          ))}
        </div>
      ) : profissionais.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Banknote size={28} className="text-text-4 mb-3" />
          <h2 className="font-serif text-xl text-text mb-1">Sem comissões</h2>
          <p className="text-sm text-text-3">Nenhum atendimento concluído no período.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {profissionais.map(prof => {
            const list = filtro === 'pendentes' ? prof.comissoes.filter(c => c.status === 'pendente')
              : filtro === 'pagas' ? prof.comissoes.filter(c => c.status === 'pago')
              : prof.comissoes;
            if (list.length === 0) return null;
            const temPendente = prof.pendente > 0;

            return (
              <div key={prof.profissional_id}
                className="bg-surface border border-border rounded-2xl overflow-hidden"
                style={{ boxShadow: '0 1px 4px rgba(44,23,80,0.04)', animation: 'bm-stagger .38s ease both' }}>
                {/* Header do profissional */}
                <div className="flex items-center gap-3 p-4 border-b border-border">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                    style={{ background: avatarGradient(prof.nome) }}>
                    {iniciais(prof.nome)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-text truncate">{prof.nome}</p>
                    <p className="text-xs text-text-3">{prof.percentual}% de comissão</p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-bold text-text">{fmtBRL(prof.total)}</p>
                    <p className="text-xs text-text-3">{prof.totalAtendimentos} atend.</p>
                  </div>
                </div>

                {/* Lista de comissões */}
                {list.map((c, i) => {
                  const cat = (c.agendamento?.servico?.categoria ?? 'outros') as CategoriaServico;
                  const cor = CATEGORIA_COR[cat] ?? '#6B7280';
                  const bg  = CATEGORIA_BG[cat]  ?? '#F3F4F6';
                  return (
                    <div key={c.id}
                      className={`flex items-center gap-3 px-4 py-3 ${i < list.length - 1 ? 'border-b border-border' : ''}`}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: bg }}>
                        <CategoriaIcon categoria={cat} size={16} color={cor} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-text truncate">{c.agendamento?.servico?.nome ?? '—'}</p>
                        <p className="text-[10px] text-text-3">
                          {fmtBRL(c.valor_servico)} × {c.percentual}%
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-bold text-text">{fmtBRL(c.valor_comissao)}</p>
                        <span className={`inline-block text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md mt-0.5 ${
                          c.status === 'pago' ? 'bg-green-soft text-green' : 'bg-amber-soft text-amber'
                        }`}>
                          {c.status === 'pago' ? 'Pago' : 'Pendente'}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {/* Footer */}
                <div className="flex items-center justify-between px-4 py-3 bg-bg border-t border-border">
                  <div>
                    <p className="text-[10px] text-text-3">{temPendente ? 'Pendente para repassar' : 'Tudo repassado'}</p>
                    <p className={`text-sm font-bold ${temPendente ? 'text-amber' : 'text-green'}`}>
                      {fmtBRL(temPendente ? prof.pendente : prof.pago)}
                    </p>
                  </div>
                  {temPendente ? (
                    <button onClick={() => setPagando(prof.profissional_id)}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-green text-white text-xs font-bold hover:opacity-90 transition">
                      <Banknote size={13} strokeWidth={2} />Pagar
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-green-soft text-green text-xs font-bold">
                      <CircleCheck size={13} strokeWidth={2} />Pago
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de pagamento */}
      {pagando && (() => {
        const prof = profissionais.find(p => p.profissional_id === pagando);
        if (!prof) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={() => !salvando && setPagando(null)}>
            <div className="bg-surface rounded-2xl p-6 w-full max-w-sm md:w-96 shadow-xl mx-4" onClick={e => e.stopPropagation()}
              style={{ animation: 'bm-pop .3s cubic-bezier(.2,.85,.3,1)' }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[10px] text-text-3 font-bold uppercase tracking-widest">Confirmar pagamento</p>
                  <h3 className="font-serif text-xl text-text">{prof.nome}</h3>
                </div>
                <button onClick={() => setPagando(null)}
                  className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
                  <X size={16} />
                </button>
              </div>
              <div className="bg-amber-soft rounded-xl p-4 text-center mb-6">
                <p className="text-xs text-amber font-semibold mb-1">Total a repassar</p>
                <p className="text-3xl font-bold text-amber" style={{ letterSpacing: '-0.02em' }}>{fmtBRL(prof.pendente)}</p>
              </div>
              <button onClick={() => marcarPago(prof.profissional_id)}
                disabled={salvando}
                className="w-full h-12 rounded-xl bg-green text-white text-sm font-bold hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2">
                {salvando ? 'Salvando...' : <><Banknote size={16} /> Confirmar pagamento</>}
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
