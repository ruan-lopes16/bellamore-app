'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, UserPlus, Phone, X, ChevronRight, Users, CalendarPlus, Crown, AlertTriangle, UserX, Hourglass, LayoutGrid, List, MapPin } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useScrollLock } from '@/lib/useScrollLock';
import type { Cliente } from '@/types';
import { Sk } from '@/components/Skeleton';
import { SmoothTabs } from '@/components/SmoothTabs';
import { maskPhone } from '@/lib/masks';
import { montarAniversario, diasNoMes, nomeClienteValido, erroTelefoneCliente, erroEmailCliente, serializarEndereco } from '@shared/clientes';
import {
  contarSegmentos, filtrarClientes, agregarClientes, tagsDaLinha, textoUltimaVisita, textoListaVazia,
  ROTULO_FILTRO, ROTULO_SEGMENTO, FILTROS_CLIENTES, CARTOES_CLIENTES,
  type Agregado, type ClienteBase, type FiltroClientes, type ChaveCartaoClientes,
} from '@shared/clientes-segmentos';
import { carregarBaseClientes, type BaseClientes } from '@shared/clientes-consultas';
import { hojeBRT } from '@shared/periodos';
import { formatarMoeda } from '@shared/moeda';
import { Secret } from '@/components/privacy';
import { mensagemErroBanco } from '@shared/erros';
import { avancarComEnter } from '@/lib/formNav';
import { ExportButton } from '@/components/ExportButton';
import { definicaoClientes } from '@shared/exportacao/clientes';
import { usePermissoes } from '@/components/PermissoesProvider';

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
  useScrollLock();
  const router   = useRouter();
  const [nome,     setNome]     = useState('');
  const [telefone, setTelefone] = useState('');
  const [email,    setEmail]    = useState('');
  const [nascMes,  setNascMes]  = useState('');
  const [nascDia,  setNascDia]  = useState('');
  const [obs,      setObs]      = useState('');
  const [logradouro,  setLogradouro]  = useState('');
  const [numero,      setNumero]      = useState('');
  const [bairro,      setBairro]      = useState('');
  const [complemento, setComplemento] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro,     setErro]     = useState('');
  const [sucesso,  setSucesso]  = useState<{ nome: string; id: string } | null>(null);

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro('');
    if (!nomeClienteValido(nome)) { setErro('O nome é obrigatório (mínimo 2 caracteres).'); return; }
    const erroTel = erroTelefoneCliente(telefone);
    if (erroTel) { setErro(erroTel); return; }
    const erroMail = erroEmailCliente(email);
    if (erroMail) { setErro(erroMail); return; }
    if (!!nascMes !== !!nascDia) { setErro('Escolha o mês e o dia do aniversário, ou deixe os dois em branco.'); return; }
    setSalvando(true);
    const data_nascimento = montarAniversario(nascMes, nascDia);
    const { data, error } = await supabase.from('clientes').insert({
      empresa_id: empresaId, nome: nome.trim(),
      telefone: telefone.trim() || null,
      email: email.trim() || null,
      data_nascimento,
      observacoes: obs.trim() || null,
      endereco: serializarEndereco({ logradouro, numero, bairro, complemento }),
    }).select().single();
    setSalvando(false);
    if (error) { setErro(mensagemErroBanco(error, 'cadastrar cliente')); return; }
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
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-serif text-xl text-text">Novo cliente</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition"><X size={16}/></button>
        </div>
        <form onSubmit={salvar} onKeyDown={avancarComEnter} className="p-5 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Nome *</label>
            <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome completo" required className={inputClass}/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Telefone / WhatsApp *</label>
            <input value={telefone} onChange={e => setTelefone(maskPhone(e.target.value))} placeholder="(11) 98765-4321" type="tel" maxLength={15} required className={inputClass}/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">E-mail</label>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="nome@exemplo.com" type="email" className={inputClass}/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Aniversário (opcional)</label>
            <div className="grid grid-cols-2 gap-2">
              <select value={nascMes} onChange={e => { const m = e.target.value; setNascMes(m); if (nascDia && Number(nascDia) > diasNoMes(m)) setNascDia(''); }} className={inputClass}>
                <option value="">Mês</option>
                {['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'].map((m, i) => (
                  <option key={i+1} value={String(i+1).padStart(2,'0')}>{m}</option>
                ))}
              </select>
              <select value={nascDia} onChange={e => setNascDia(e.target.value)} className={inputClass}>
                <option value="">Dia</option>
                {Array.from({ length: diasNoMes(nascMes) }, (_, i) => i + 1).map(d => (
                  <option key={d} value={String(d).padStart(2,'0')}>{d}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Observações internas (opcional)</label>
            <textarea value={obs} rows={3}
              onChange={e => setObs(e.target.value)}
              placeholder="Ex: preferências, restrições, como nos conheceu…"
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition resize-none"/>
          </div>
          <div className="border-t border-border pt-3">
            <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <MapPin size={12} strokeWidth={2}/> Endereço (opcional)
            </p>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Logradouro</label>
                <input value={logradouro} onChange={e => setLogradouro(e.target.value)} placeholder="Rua, avenida, estrada..." className={inputClass}/>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Número</label>
                  <input value={numero} onChange={e => setNumero(e.target.value)} placeholder="Ex: 123" className={inputClass}/>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Bairro</label>
                  <input value={bairro} onChange={e => setBairro(e.target.value)} placeholder="Ex: Centro" className={inputClass}/>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">
                  Complemento <span className="text-text-4 normal-case font-normal">(opcional)</span>
                </label>
                <input value={complemento} onChange={e => setComplemento(e.target.value)} placeholder="Ap. 12, Bloco B..." className={inputClass}/>
              </div>
            </div>
          </div>
          {erro && <p className="text-red text-sm">{erro}</p>}
          <p className="text-xs text-text-4 -mt-1">
            Após cadastrar, você será direcionado para completar o perfil e preencher a anamnese.
          </p>
          <div className="flex gap-3 mt-1">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">Cancelar</button>
            <button type="submit" disabled={salvando || !nomeClienteValido(nome)} className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-50">
              {salvando ? 'Cadastrando...' : 'Cadastrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Lista ─────────────────────────────────────────────────────

/** Cor de cada tag (pelo rótulo de `tagsDaLinha`). */
const COR_TAG: Record<string, { cor: string; bg: string }> = {
  [ROTULO_SEGMENTO.vip]:        { cor: 'var(--color-amber)',   bg: 'var(--color-amber-soft)' },
  [ROTULO_SEGMENTO.recorrente]: { cor: 'var(--color-primary)', bg: 'var(--color-primary-soft)' },
  [ROTULO_SEGMENTO.em_risco]:   { cor: 'var(--color-rose)',    bg: 'var(--color-rose-soft)' },
  [ROTULO_SEGMENTO.sumida]:     { cor: 'var(--color-rose)',    bg: 'var(--color-rose-soft)' },
  [ROTULO_SEGMENTO.nova]:       { cor: 'var(--color-green)',   bg: 'var(--color-green-soft)' },
};
const COR_TAG_PADRAO = { cor: 'var(--color-ink3)', bg: 'var(--color-bg)' };

/** Visual de cada cartão (rótulo e filtro vêm de `CARTOES_CLIENTES`). */
const VISUAL_CARTAO: Record<ChaveCartaoClientes, { color: string; bg: string; icon: typeof Users }> = {
  total:          { color: 'var(--color-primary)', bg: 'var(--color-primary-soft)', icon: Users },
  novasMes:       { color: 'var(--color-green)',   bg: 'var(--color-green-soft)',   icon: CalendarPlus },
  vip:            { color: 'var(--color-amber)',   bg: 'var(--color-amber-soft)',   icon: Crown },
  em_risco:       { color: 'var(--color-rose)',    bg: 'var(--color-rose-soft)',    icon: AlertTriangle },
  sumida:         { color: 'var(--color-rose)',    bg: 'var(--color-rose-soft)',    icon: UserX },
  nunca_atendida: { color: 'var(--color-ink3)',    bg: 'var(--color-bg)',           icon: Hourglass },
};

/** Tags da linha (segmentos ou "Arquivada"), por `tagsDaLinha`. */
function Tags({ cliente, agregado, hojeChave }: { cliente: ClienteBase; agregado: Agregado | undefined; hojeChave: string }) {
  const estilo = (cor: string, bg: string): React.CSSProperties => ({ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: bg, color: cor, whiteSpace: 'nowrap' });
  return (
    <>
      {tagsDaLinha(cliente, agregado, hojeChave).map(t => {
        const { cor, bg } = COR_TAG[t] ?? COR_TAG_PADRAO;
        return <span key={t} className="flex-shrink-0" style={estilo(cor, bg)}>{t}</span>;
      })}
    </>
  );
}

export default function ClientesPage() {
  const router    = useRouter();
  const { pode } = usePermissoes();
  const [base,      setBase]      = useState<BaseClientes | null>(null);
  const [erroCarga, setErroCarga] = useState('');
  const [busca,     setBusca]     = useState('');
  const [filtro,    setFiltro]    = useState<FiltroClientes>('todas');
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [modal,     setModal]     = useState(false);
  const [viewMode,  setViewMode]  = useState<'lista' | 'grade'>('lista');
  const loading = base === null && !erroCarga;
  const hojeChave = hojeBRT();

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setErroCarga('Sessão expirada. Entre de novo.'); return; }
        const { data: membro, error } = await supabase.from('empresa_membros').select('empresa_id')
          .eq('user_id', user.id).eq('ativo', true).limit(1).single();
        if (error || !membro) { setErroCarga('Não foi possível identificar a empresa.'); return; }
        setEmpresaId(membro.empresa_id);
        setBase(await carregarBaseClientes(supabase, membro.empresa_id));
      } catch (e) {
        setErroCarga(mensagemErroBanco(e as { message?: string }, 'carregar as clientes'));
      }
    })();
  }, []);

  const agregados = useMemo(
    () => (base ? agregarClientes(base.atendimentos, base.extras, base.vendas) : new Map<string, Agregado>()),
    [base],
  );
  const contagem = useMemo(
    () => (base ? contarSegmentos(base.clientes, agregados, hojeChave) : null),
    [base, agregados, hojeChave],
  );
  const filtrados = useMemo(
    () => (base ? filtrarClientes(base.clientes, agregados, filtro, busca, hojeChave) : []),
    [base, agregados, filtro, busca, hojeChave],
  );

  const cartoes = CARTOES_CLIENTES.map(c => ({
    label: c.rotulo, filtro: c.filtro, value: contagem ? contagem[c.chave] : null, ...VISUAL_CARTAO[c.chave],
  }));

  const infoLinha = (c: ClienteBase) => {
    const ag = agregados.get(c.id);
    return { ag, gasto: ag?.totalGasto ?? 0, visita: textoUltimaVisita(ag?.ultimaVisita) };
  };
  const estiloAvatar = (nome: string, tam: number) => {
    let h = 0;
    for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 360;
    return { width: tam, height: tam, borderRadius: tam * 0.32, flexShrink: 0, background: `linear-gradient(140deg, oklch(0.55 0.16 ${h}), oklch(0.42 0.17 ${h}))`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: tam > 50 ? 18 : 15 } as React.CSSProperties;
  };

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
            definicao={definicaoClientes()}
            getLinhas={() => filtrados.map(c => ({ nome: c.nome, telefone: c.telefone ?? null, email: c.email ?? null, dataNascimento: c.data_nascimento ?? null, criadoEm: c.created_at }))}
          />
          {pode('clientes.cadastrar') && (
            <button onClick={() => setModal(true)} className="press flex items-center gap-2 px-4 h-10 rounded-2xl text-white text-sm font-bold"
              style={{ background: 'var(--color-primary)', boxShadow: '0 6px 20px rgba(44,23,80,0.18)' }}>
              <UserPlus size={15} strokeWidth={2.5}/>Novo cliente
            </button>
          )}
        </div>
      </div>

      {erroCarga && (
        <div role="alert" className="rounded-2xl p-4 mb-5 text-sm" style={{ background: 'var(--color-rose-soft)', border: '1px solid var(--color-border)', color: 'var(--color-rose)', fontFamily: 'var(--font-sans)' }}>
          {erroCarga} Os números ficam em &quot;—&quot; até carregar de novo.
        </div>
      )}

      {/* Cartões clicáveis: aplicam o filtro correspondente */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          {[1,2,3,4,5,6].map(i => <div key={i} className="rounded-2xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}><Sk className="h-6 w-16 mb-2"/><Sk className="h-3 w-24"/></div>)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          {cartoes.map(({ label, filtro: alvo, value, color, bg, icon: Icon }, i) => (
            <button key={label} type="button" onClick={() => setFiltro(alvo)} aria-pressed={filtro === alvo}
              className="press bm-stagger rounded-2xl p-4 flex items-center gap-3 text-left"
              style={{ background: 'var(--color-surface)', border: `1px solid ${filtro === alvo ? color : 'var(--color-border)'}`, boxShadow: '0 2px 6px rgba(44,23,80,0.06)', '--bm-i': i, '--bm-step': '55ms' } as React.CSSProperties}>
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
                <Icon size={18} style={{ color }} strokeWidth={2}/>
              </div>
              <div>
                <p className="text-2xl font-bold leading-none" style={{ fontFamily: 'var(--font-sans)', color }}>{value ?? '—'}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-ink3)', fontFamily: 'var(--font-sans)' }}>{label}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Busca */}
      <div className="relative mb-5">
        <Search size={16} style={{ color: 'var(--color-ink4)', position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} strokeWidth={2}/>
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por nome, telefone ou e-mail"
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
          tabs={FILTROS_CLIENTES.map(f => ({ key: f, label: ROTULO_FILTRO[f] }))}
          active={filtro}
          onChange={key => setFiltro(key as FiltroClientes)}
        />
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
      ) : !base ? null : filtrados.length === 0 ? (
        <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <Users size={32} style={{ color: 'var(--color-ink4)', margin: '0 auto 12px' }} strokeWidth={1.5}/>
          <p style={{ fontFamily: 'var(--font-sans)', color: 'var(--color-ink3)', fontSize: 14, marginBottom: 8 }}>
            {textoListaVazia(filtro, busca)}
          </p>
          {!busca && filtro === 'todas' && pode('clientes.cadastrar') && (
            <button onClick={() => setModal(true)} style={{ fontFamily: 'var(--font-sans)', color: 'var(--color-accent)', fontSize: 13, fontWeight: 700 }}>
              + Cadastrar primeiro cliente
            </button>
          )}
        </div>
      ) : viewMode === 'grade' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtrados.map((c, idx) => {
            const { ag, gasto, visita } = infoLinha(c);
            const inits = c.nome.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();
            return (
              <button key={c.id} onClick={() => router.push(`/clientes/${c.id}`)}
                className="press bm-stagger w-full text-left"
                style={{ '--bm-i': idx % 8, '--bm-step': '60ms', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 20, padding: '16px 14px', boxShadow: '0 2px 6px rgba(44,23,80,0.05)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 } as React.CSSProperties}>
                <div style={estiloAvatar(c.nome, 56)}>{inits}</div>
                <div style={{ width: '100%', textAlign: 'center', minWidth: 0 }}>
                  <p className="truncate" style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 13, color: 'var(--color-ink)' }}>{c.nome}</p>
                  <div className="flex flex-wrap justify-center gap-1 mt-1"><Tags cliente={c} agregado={ag} hojeChave={hojeChave}/></div>
                  {c.telefone && <p className="truncate mt-1" style={{ fontSize: 11.5, color: 'var(--color-ink3)', fontFamily: 'var(--font-sans)' }}>{c.telefone}</p>}
                  <p style={{ fontSize: 11, color: 'var(--color-ink4)', fontFamily: 'var(--font-sans)' }}><Secret>{formatarMoeda(gasto)}</Secret> · {visita}</p>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtrados.map((c, idx) => {
            const { ag, gasto, visita } = infoLinha(c);
            const inits = c.nome.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();
            return (
              <button key={c.id} onClick={() => router.push(`/clientes/${c.id}`)}
                className="press bm-stagger w-full text-left"
                style={{ '--bm-i': idx % 8, '--bm-step': '60ms', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 20, padding: '12px 16px', boxShadow: '0 2px 6px rgba(44,23,80,0.05)', display: 'flex', alignItems: 'center', gap: 12 } as React.CSSProperties}>
                <div style={estiloAvatar(c.nome, 44)}>{inits}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="truncate" style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 14, color: 'var(--color-ink)' }}>{c.nome}</span>
                    <Tags cliente={c} agregado={ag} hojeChave={hojeChave}/>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {c.telefone && <span className="flex items-center gap-1" style={{ fontSize: 12, color: 'var(--color-ink3)', fontFamily: 'var(--font-sans)' }}><Phone size={11} strokeWidth={2}/>{c.telefone}</span>}
                    <span style={{ fontSize: 12, color: 'var(--color-ink3)', fontFamily: 'var(--font-sans)' }}>Gasto: <Secret>{formatarMoeda(gasto)}</Secret></span>
                    <span style={{ fontSize: 12, color: 'var(--color-ink4)', fontFamily: 'var(--font-sans)' }}>{visita}</span>
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
