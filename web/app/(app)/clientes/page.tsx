'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, UserPlus, Phone, Mail, X, ChevronRight, Users, UserCheck, CalendarPlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Cliente } from '@/types';
import { format, startOfMonth } from 'date-fns';
import { Sk } from '@/components/Skeleton';
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
  const [nasc,     setNasc]     = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro,     setErro]     = useState('');

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setSalvando(true);
    const { data, error } = await supabase.from('clientes').insert({
      empresa_id: empresaId, nome: nome.trim(),
      telefone: telefone.trim() || null,
      email: email.trim() || null,
      data_nascimento: nasc || null,
    }).select().single();
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    router.push(`/clientes/${(data as Cliente).id}?aba=anamnese&editar=1`);
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
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Data de nascimento</label>
            <input value={nasc} onChange={e => setNasc(e.target.value)} type="date" className={inputClass}/>
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
  const [clientes,  setClientes]  = useState<Cliente[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [busca,     setBusca]     = useState('');
  const [filtro,    setFiltro]    = useState<'todas' | 'novas' | 'aniver'>('todas');
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [modal,     setModal]     = useState(false);

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
    <div>
      {/* Header Bellamore */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>
            Base de clientes
          </p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>
            Clientes
          </h1>
        </div>
        <div className="flex flex-wrap gap-2 sm:pt-1">
          <ExportButton
            filename="clientes"
            title="Clientes"
            columns={[
              { header: 'Nome',          accessor: (c: Cliente) => c.nome,            width: 30 },
              { header: 'Telefone',      accessor: (c: Cliente) => c.telefone ?? '',  width: 18 },
              { header: 'E-mail',        accessor: (c: Cliente) => c.email ?? '',     width: 28 },
              { header: 'Nascimento',    accessor: (c: Cliente) => c.data_nascimento
                  ? format(new Date(c.data_nascimento + 'T00:00:00'), 'dd/MM/yyyy')
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
        <div className="flex gap-2 mb-5">
          {([
            { key: 'todas' as const, label: 'Todas' },
            { key: 'novas' as const, label: 'Novas' },
            { key: 'aniver' as const, label: 'Aniversariantes' },
          ]).map(f => (
            <button key={f.key} onClick={() => setFiltro(f.key)}
              className="press"
              style={{
                fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 700,
                padding: '6px 14px', borderRadius: 999, transition: 'all 150ms',
                background: filtro === f.key ? 'var(--color-primary)' : 'var(--color-surface)',
                color: filtro === f.key ? '#fff' : 'var(--color-ink3)',
                border: `1px solid ${filtro === f.key ? 'var(--color-primary)' : 'var(--color-border)'}`,
              }}>
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Lista */}
      {loading ? (
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
                {/* Avatar */}
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
                    {c.data_nascimento && <span style={{ fontSize: 12, color: 'var(--color-ink4)', fontFamily: 'var(--font-sans)' }}>{format(new Date(c.data_nascimento + 'T00:00:00'), 'dd/MM/yyyy')}</span>}
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--color-ink4)', flexShrink: 0 }} strokeWidth={2}/>
              </button>
            );
          })}
        </div>
      )}

      {modal && empresaId && (
        <NovoClienteModal empresaId={empresaId} onClose={() => setModal(false)}/>
      )}
    </div>
  );
}
