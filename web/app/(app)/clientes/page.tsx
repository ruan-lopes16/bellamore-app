'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, UserPlus, Phone, Mail, X, ChevronRight, Users, UserCheck, CalendarPlus, Crown, AlertTriangle, Sparkles, LayoutGrid, List } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Cliente } from '@/types';
import { format, startOfMonth } from 'date-fns';
import { Sk } from '@/components/Skeleton';
import { SmoothTabs } from '@/components/SmoothTabs';
import { maskPhone } from '@/lib/masks';
import { ExportButton } from '@/components/ExportButton';

const supabase = createClient();


function iniciais(nome: string) {
  return nome.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}
const AVATAR_CORES = [
  'bg-violet-100 text-violet-700', 'bg-pink-100 text-pink-700',
  'bg-sky-100 text-sky-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700',
];
function avatarCor(nome: string) { return AVATAR_CORES[nome.charCodeAt(0) % AVATAR_CORES.length]; }

const inputClass = "w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";

// ── Modal ─────────────────────────────────────────────────────

function NovoClienteModal({ empresaId, onClose }: {
  empresaId: string; onClose: () => void;
}) {
  const router   = useRouter();
  const [nome,     setNome]     = useState('');
  const [telefone, setTelefone] = useState('');
  const [email,    setEmail]    = useState('');
  const [nascMes,  setNascMes]  = useState('');
  const [nascDia,  setNascDia]  = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro,     setErro]     = useState('');
  const [sucesso,  setSucesso]  = useState<{ nome: string; id: string } | null>(null);

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setSalvando(true);
    const data_nascimento = (nascMes && nascDia)
      ? `1900-${nascMes.padStart(2, '0')}-${nascDia.padStart(2, '0')}`
      : null;
    const { data, error } = await supabase.from('clientes').insert({
      empresa_id: empresaId, nome: nome.trim(),
      telefone: telefone.trim() || null,
      email: email.trim() || null,
      data_nascimento,
    }).select().single();
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    setSucesso({ nome: (data as Cliente).nome, id: (data as Cliente).id });
  }

  useEffect(() => {
    if (!sucesso) return;
    const t = setTimeout(() => router.push(`/clientes/${sucesso.id}?aba=anamnese&editar=1`), 900);
    return () => clearTimeout(t);
  }, [sucesso]);

  if (sucesso) {
    return (
      <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"/>
        <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm flex flex-col items-center text-center gap-2.5 py-10 px-6">
          <div className="relative flex items-center justify-center" style={{ width: 64, height: 64 }}>
            <div className="bm-glow absolute inset-0 rounded-full blur-lg" style={{ background: 'var(--color-green-soft)' }}/>
            <div className="relative flex items-center justify-center rounded-full"
              style={{ width: 64, height: 64, background: 'var(--color-green-soft)', animation: 'bm-pop .5s cubic-bezier(.2,.9,.3,1) both' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" style={{ strokeDasharray: 30, strokeDashoffset: 30, animation: 'bm-draw .55s .3s ease forwards' }}/>
              </svg>
            </div>
          </div>
          <p className="font-serif text-lg text-text">Cliente cadastrada!</p>
          <p className="text-sm text-text-2 truncate max-w-full">{sucesso.nome}</p>
          <p className="text-xs text-text-4">Indo para a ficha de anamnese...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-serif text-xl text-text">Novo cliente</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition"><X size={16}/></button>
        </div>
        <form onSubmit={salvar} className="p-5 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Nome *</label>
            <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome completo" required className={inputClass}/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Telefone</label>
            <input value={telefone} onChange={e => setTelefone(maskPhone(e.target.value))} placeholder="(11) 99999-9999" type="tel" maxLength={15} className={inputClass}/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">E-mail</label>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="opcional" type="email" className={inputClass}/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Aniversário (opcional)</label>
            <div className="grid grid-cols-2 gap-2">
              <select value={nascMes} onChange={e => setNascMes(e.target.value)} className={inputClass}>
                <option value="">Mês</option>
                {['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'].map((m, i) => (
                  <option key={i+1} value={String(i+1).padStart(2,'0')}>{m}</option>
                ))}
              </select>
              <select value={nascDia} onChange={e => setNascDia(e.target.value)} className={inputClass}>
                <option value="">Dia</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={String(d).padStart(2,'0')}>{d}</option>
                ))}
              </select>
            </div>
          </div>
          {erro && <p className="text-red text-sm">{erro}</p>}
          <p className="text-xs text-text-4 -mt-1">
            Após cadastrar, você será direcionado para completar o perfil e preencher a anamnese.
          </p>
          <div className="flex gap-3 mt-1">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">Cancelar</button>
            <button type="submit" disabled={salvando || !nome.trim()} className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-50">
              {salvando ? 'Cadastrando...' : 'Cadastrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Tela principal ────────────────────────────────────────────

export default function ClientesPage() {
  const router    = useRouter();
  const [clientes,       setClientes]       = useState<Cliente[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [busca,          setBusca]          = useState('');
  const [filtro,         setFiltro]         = useState<'todas' | 'novas' | 'aniver' | 'segmentos'>('todas');
  const [empresaId,      setEmpresaId]      = useState<string | null>(null);
  const [modal,          setModal]          = useState(false);
  const [viewMode,       setViewMode]       = useState<'lista' | 'grade'>('lista');
  const [visitaMap,      setVisitaMap]      = useState<Map<string, { lastVisit: Date; total: number }> | null>(null);
  const [loadingVisitas, setLoadingVisitas] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membro } = await supabase.from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (!membro) return;
      setEmpresaId(membro.empresa_id);
      const { data: clData } = await supabase.from('clientes').select('*')
        .eq('empresa_id', membro.empresa_id).eq('ativo', true).order('nome');
      setClientes((clData ?? []) as Cliente[]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (filtro !== 'segmentos' || !empresaId || visitaMap !== null) return;
    (async () => {
      setLoadingVisitas(true);
      const { data } = await supabase.from('agendamentos')
        .select('cliente_id, data_hora_inicio')
        .eq('empresa_id', empresaId)
        .eq('status', 'concluido')
        .order('data_hora_inicio', { ascending: false })
        .limit(5000);
      const map = new Map<string, { lastVisit: Date; total: number }>();
      for (const ag of (data ?? [])) {
        if (!ag.cliente_id) continue;
        const d = new Date(ag.data_hora_inicio);
        if (!map.has(ag.cliente_id)) map.set(ag.cliente_id, { lastVisit: d, total: 0 });
        map.get(ag.cliente_id)!.total++;
      }
      setVisitaMap(map);
      setLoadingVisitas(false);
    })();
  }, [filtro, empresaId, visitaMap]);

  const filtrados = useMemo(() => {
    let list = clientes;
    if (filtro === 'novas') {
      list = list.filter(c => new Date(c.created_at) >= startOfMonth(new Date()));
    } else if (filtro === 'aniver') {
      const mes = new Date().getMonth();
      list = list.filter(c => {
        if (!c.data_nascimento) return false;
        return new Date(c.data_nascimento + 'T00:00:00').getMonth() === mes;
      });
    }
    const q = busca.toLowerCase().trim();
    if (q) {
      list = list.filter(c =>
        c.nome.toLowerCase().includes(q) || c.telefone?.includes(q) || c.email?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [clientes, busca, filtro]);

  const novosEsteMes = clientes.filter(c =>
    new Date(c.created_at) >= startOfMonth(new Date())
  ).length;

  function onClienteSalvo(c: Cliente) {
    setClientes(prev => [...prev, c].sort((a, b) => a.nome.localeCompare(b.nome)));
    setModal(false);
  }
  // onClienteSalvo mantido para compatibilidade, mas o redirect agora é feito dentro do modal

  const aniversariantes = clientes.filter(c => {
    if (!c.data_nascimento) return false;
    const hoje = new Date(); const nasc = new Date(c.data_nascimento + 'T00:00:00');
    return nasc.getMonth() === hoje.getMonth();
  }).length;

  return (
    <div className="bm-page">
      {/* Header Bellamore */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6 bm-mobile-page-header">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>
            Base de clientes
          </p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>
            Clientes
          </h1>
        </div>
        <div className="flex flex-wrap gap-2 sm:pt-1 bm-mobile-page-actions">
          {/* Toggle lista/grade — visível apenas no desktop */}
          <div className="hidden sm:flex items-center rounded-xl border border-border overflow-hidden">
            <button
              onClick={() => setViewMode('lista')}
              className="flex items-center justify-center w-9 h-9 transition"
              style={{ background: viewMode === 'lista' ? 'var(--color-primary-soft)' : 'var(--color-surface)', color: viewMode === 'lista' ? 'var(--color-primary)' : 'var(--color-ink4)' }}
              title="Visualização em lista">
              <List size={15} strokeWidth={2}/>
            </button>
            <button
              onClick={() => setViewMode('grade')}
              className="flex items-center justify-center w-9 h-9 transition"
              style={{ background: viewMode === 'grade' ? 'var(--color-primary-soft)' : 'var(--color-surface)', color: viewMode === 'grade' ? 'var(--color-primary)' : 'var(--color-ink4)' }}
              title="Visualização em grade">
              <LayoutGrid size={15} strokeWidth={2}/>
            </button>
          </div>
          <ExportButton
            variant="mobileHeader"
            className="bm-mobile-header-export"
            filename="clientes"
            title="Clientes"
            columns={[
              { header: 'Nome',          accessor: (c: Cliente) => c.nome,            width: 30 },
              { header: 'Telefone',      accessor: (c: Cliente) => c.telefone ?? '',  width: 18 },
              { header: 'E-mail',        accessor: (c: Cliente) => c.email ?? '',     width: 28 },
              { header: 'Nascimento',    accessor: (c: Cliente) => c.data_nascimento
                  ? format(new Date(c.data_nascimento + 'T00:00:00'), 'dd/MM')
                  : '',                                                                width: 14 },
              { header: 'Cadastrado em', accessor: (c: Cliente) => format(new Date(c.created_at), 'dd/MM/yyyy'), width: 16 },
            ]}
            getData={() => filtrados}
          />
          <button onClick={() => setModal(true)} className="press flex items-center gap-2 px-4 h-10 rounded-2xl text-white text-sm font-bold"
            style={{ background: 'var(--color-primary)', boxShadow: '0 6px 20px rgba(44,23,80,0.18)' }}>
            <UserPlus size={15} strokeWidth={2.5}/>Novo cliente
          </button>
        </div>
      </div>

      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          {[1,2,3].map(i => <div key={i} className="rounded-2xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}><Sk className="h-6 w-16 mb-2"/><Sk className="h-3 w-24"/></div>)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total de clientes', value: clientes.length, color: 'var(--color-primary)', bg: 'var(--color-primary-soft)', icon: Users },
            { label: 'Novos este mês',    value: novosEsteMes,    color: 'var(--color-green)',   bg: 'var(--color-green-soft)',   icon: CalendarPlus },
            { label: 'Aniversariantes',   value: aniversariantes, color: 'var(--color-accent)',  bg: 'var(--color-accent-soft)',  icon: UserCheck },
          ].map(({ label, value, color, bg, icon: Icon }, i) => (
            <div key={label} className="bm-stagger rounded-2xl p-4 flex items-center gap-3"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)', '--bm-i': i, '--bm-step': '55ms' } as React.CSSProperties}>
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
                <Icon size={18} style={{ color }} strokeWidth={2}/>
              </div>
              <div>
                <p className="text-2xl font-bold leading-none" style={{ fontFamily: 'var(--font-sans)', color }}>{value}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-ink3)', fontFamily: 'var(--font-sans)' }}>{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Busca */}
      <div className="relative mb-5">
        <Search size={16} style={{ color: 'var(--color-ink4)', position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} strokeWidth={2}/>
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por nome, telefone ou e-mail..."
          style={{ width: '100%', height: 48, paddingLeft: 44, paddingRight: 16, borderRadius: 16, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--color-ink)', outline: 'none', boxSizing: 'border-box' }}
          onFocus={e => { e.target.style.borderColor = 'var(--color-accent)'; e.target.style.boxShadow = '0 0 0 3px var(--color-accent-soft)'; }}
          onBlur={e => { e.target.style.borderColor = 'var(--color-border)'; e.target.style.boxShadow = 'none'; }}
        />
      </div>

      {/* Filter pills */}
      {!loading && (
        <SmoothTabs
          variant="pill"
          className="mb-5 -mx-4 px-4 sm:mx-0 sm:px-0"
          tabs={[
            { key: 'todas',     label: 'Todas' },
            { key: 'novas',     label: 'Novas' },
            { key: 'aniver',    label: 'Aniversariantes' },
            { key: 'segmentos', label: 'Segmentos' },
          ]}
          active={filtro}
          onChange={key => setFiltro(key as typeof filtro)}
        />
      )}

      {/* Segmentos */}
      {filtro === 'segmentos' && !loading && (() => {
        if (loadingVisitas || visitaMap === null) {
          return (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
              {[1,2,3].map(i => <div key={i} className="rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}><Sk className="h-6 w-12 mb-2"/><Sk className="h-3 w-28"/></div>)}
            </div>
          );
        }
        const agora = new Date();
        const cutoffRisco = new Date(agora.getTime() - 45 * 86400000);
        const cutoffNovos = new Date(agora.getTime() - 30 * 86400000);

        const vip       = clientes.filter(c => (visitaMap.get(c.id)?.total ?? 0) >= 8);
        const emRisco   = clientes.filter(c => {
          const v = visitaMap.get(c.id);
          if (!v) return false; // sem visitas = já nunca voltou, mas não tem data
          return v.lastVisit < cutoffRisco;
        });
        const semVisita = clientes.filter(c => !visitaMap.has(c.id) && new Date(c.created_at) < cutoffNovos);
        const novos     = clientes.filter(c => new Date(c.created_at) >= cutoffNovos);

        const segmentos = [
          { label: 'VIP', desc: '8+ atendimentos', icon: Crown,        cor: 'var(--color-amber)',   bg: 'var(--color-amber-soft)',   clientes: vip,       qtd: vip.length },
          { label: 'Em risco', desc: 'Sem visita há +45 dias', icon: AlertTriangle, cor: 'var(--color-rose)', bg: 'var(--color-rose-soft)', clientes: emRisco,   qtd: emRisco.length },
          { label: 'Nunca retornou', desc: 'Cadastrado há +30 dias sem atendimento', icon: Users,        cor: 'var(--color-ink3)',    bg: 'var(--color-bg)',           clientes: semVisita, qtd: semVisita.length },
          { label: 'Novos', desc: 'Cadastrados há menos de 30 dias', icon: Sparkles,    cor: 'var(--color-green)', bg: 'var(--color-green-soft)', clientes: novos,     qtd: novos.length },
        ];

        return (
          <div className="mb-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              {segmentos.map(({ label, desc, icon: Icon, cor, bg, qtd }) => (
                <div key={label} className="rounded-2xl p-4 flex items-center gap-3"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 2px 6px rgba(44,23,80,0.05)' }}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
                    <Icon size={16} style={{ color: cor }} strokeWidth={1.8}/>
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-lg leading-none" style={{ color: cor, fontFamily: 'var(--font-sans)' }}>{qtd}</p>
                    <p className="text-xs font-semibold text-text-2 mt-0.5" style={{ fontFamily: 'var(--font-sans)' }}>{label}</p>
                    <p className="text-[10px] text-text-4 mt-0.5 truncate" style={{ fontFamily: 'var(--font-sans)' }}>{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {segmentos.filter(s => s.qtd > 0).map(({ label, cor, clientes: list }) => (
              <div key={label} className="mb-4">
                <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: cor, fontFamily: 'var(--font-sans)' }}>{label}</p>
                <div className="flex flex-col gap-2">
                  {list.slice(0, 5).map(c => {
                    let h = 0;
                    for (let i = 0; i < c.nome.length; i++) h = (h * 31 + c.nome.charCodeAt(i)) % 360;
                    const inits = c.nome.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();
                    const v = visitaMap.get(c.id);
                    return (
                      <button key={c.id} onClick={() => router.push(`/clientes/${c.id}`)}
                        className="press w-full text-left flex items-center gap-3 p-3 rounded-xl"
                        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 4px rgba(44,23,80,0.04)' }}>
                        <div style={{ width: 36, height: 36, borderRadius: 12, flexShrink: 0, background: `linear-gradient(140deg, oklch(0.55 0.16 ${h}), oklch(0.42 0.17 ${h}))`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 13 }}>
                          {inits}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-text truncate" style={{ fontFamily: 'var(--font-sans)' }}>{c.nome}</p>
                          <p className="text-xs text-text-4 mt-0.5" style={{ fontFamily: 'var(--font-sans)' }}>
                            {v ? `${v.total} atend. · último ${format(v.lastVisit, 'dd/MM/yy')}` : 'Sem atendimento'}
                          </p>
                        </div>
                        <ChevronRight size={14} className="text-text-4 flex-shrink-0"/>
                      </button>
                    );
                  })}
                  {list.length > 5 && (
                    <p className="text-xs text-text-4 text-center py-1" style={{ fontFamily: 'var(--font-sans)' }}>
                      +{list.length - 5} clientes neste segmento
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Lista — oculta na view de segmentos */}
      {filtro !== 'segmentos' && (loading ? (
        <div className="flex flex-col gap-3">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="rounded-2xl p-4 flex items-center gap-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <Sk className="w-11 h-11 rounded-xl flex-shrink-0"/>
              <div className="flex-1 flex flex-col gap-2"><Sk className="h-4 w-36"/><Sk className="h-3 w-24"/></div>
            </div>
          ))}
        </div>
      ) : filtrados.length === 0 ? (
        <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <Users size={32} style={{ color: 'var(--color-ink4)', margin: '0 auto 12px' }} strokeWidth={1.5}/>
          <p style={{ fontFamily: 'var(--font-sans)', color: 'var(--color-ink3)', fontSize: 14, marginBottom: 8 }}>
            {busca ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}
          </p>
          {!busca && (
            <button onClick={() => setModal(true)} style={{ fontFamily: 'var(--font-sans)', color: 'var(--color-accent)', fontSize: 13, fontWeight: 700 }}>
              + Cadastrar primeiro cliente
            </button>
          )}
        </div>
      ) : viewMode === 'grade' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtrados.map((c, idx) => {
            let h = 0;
            for (let i = 0; i < c.nome.length; i++) h = (h * 31 + c.nome.charCodeAt(i)) % 360;
            const inits = c.nome.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();
            const isNew = new Date(c.created_at) >= new Date(new Date().getFullYear(), new Date().getMonth(), 1);
            return (
              <button key={c.id} onClick={() => router.push(`/clientes/${c.id}`)}
                className="press bm-stagger w-full text-left"
                style={{ '--bm-i': idx % 8, '--bm-step': '60ms', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 20, padding: '16px 14px', boxShadow: '0 2px 6px rgba(44,23,80,0.05)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 } as React.CSSProperties}>
                <div style={{ width: 56, height: 56, borderRadius: 56 * 0.32, background: `linear-gradient(140deg, oklch(0.55 0.16 ${h}), oklch(0.42 0.17 ${h}))`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 18, flexShrink: 0 }}>
                  {inits}
                </div>
                <div style={{ width: '100%', textAlign: 'center', minWidth: 0 }}>
                  <p className="truncate" style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 13, color: 'var(--color-ink)' }}>{c.nome}</p>
                  {isNew && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'var(--color-green-soft)', color: 'var(--color-green)' }}>Nova</span>}
                  {c.telefone && <p className="truncate mt-1" style={{ fontSize: 11.5, color: 'var(--color-ink3)', fontFamily: 'var(--font-sans)' }}>{c.telefone}</p>}
                  {c.data_nascimento && <p style={{ fontSize: 11, color: 'var(--color-ink4)', fontFamily: 'var(--font-sans)' }}>{format(new Date(c.data_nascimento + 'T00:00:00'), 'dd/MM')}</p>}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtrados.map((c, idx) => {
            let h = 0;
            for (let i = 0; i < c.nome.length; i++) h = (h * 31 + c.nome.charCodeAt(i)) % 360;
            const inits = c.nome.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();
            const isNew = new Date(c.created_at) >= new Date(new Date().getFullYear(), new Date().getMonth(), 1);
            return (
              <button key={c.id} onClick={() => router.push(`/clientes/${c.id}`)}
                className="press bm-stagger w-full text-left"
                style={{ '--bm-i': idx % 8, '--bm-step': '60ms', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 20, padding: '12px 16px', boxShadow: '0 2px 6px rgba(44,23,80,0.05)', display: 'flex', alignItems: 'center', gap: 12 } as React.CSSProperties}>
                <div style={{ width: 44, height: 44, borderRadius: 44 * 0.32, flexShrink: 0, background: `linear-gradient(140deg, oklch(0.55 0.16 ${h}), oklch(0.42 0.17 ${h}))`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 15 }}>
                  {inits}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate" style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 14, color: 'var(--color-ink)' }}>{c.nome}</span>
                    {isNew && <span className="flex-shrink-0" style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'var(--color-green-soft)', color: 'var(--color-green)' }}>Nova</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {c.telefone && <span className="flex items-center gap-1" style={{ fontSize: 12, color: 'var(--color-ink3)', fontFamily: 'var(--font-sans)' }}><Phone size={11} strokeWidth={2}/>{c.telefone}</span>}
                    {c.data_nascimento && <span style={{ fontSize: 12, color: 'var(--color-ink4)', fontFamily: 'var(--font-sans)' }}>{format(new Date(c.data_nascimento + 'T00:00:00'), 'dd/MM')}</span>}
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--color-ink4)', flexShrink: 0 }} strokeWidth={2}/>
              </button>
            );
          })}
        </div>
      ))}

      {modal && empresaId && (
        <NovoClienteModal empresaId={empresaId} onClose={() => setModal(false)}/>
      )}
    </div>
  );
}
