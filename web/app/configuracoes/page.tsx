'use client';

/**
 * @file configuracoes/page.tsx
 * Página de configurações do salão e perfil do usuário.
 *
 * ## Abas
 * - Empresa  : nome, CNPJ, telefone, endereço, logo, horários de funcionamento
 * - Meu perfil : nome e telefone do usuário logado
 *
 * ## Campos salvos
 * - empresas: nome, cnpj, telefone, endereco, logo_url, horario_funcionamento (JSONB)
 * - users: nome, telefone
 *
 * ## Logo
 * - Upload para Supabase Storage bucket "logos"
 * - URL pública salva em empresas.logo_url
 * - Prévia em tempo real antes de salvar
 *
 * ## Horários
 * - JSONB: { seg: { aberto: boolean, inicio: "HH:MM", fim: "HH:MM" }, ... }
 * - Toggle liga/desliga o dia; inputs só ativos quando aberto = true
 */

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Sk } from '@/components/Skeleton';
import { AlertCircle, Check, Upload, Building2, User, Clock, Moon, Sun } from 'lucide-react';
import Image from 'next/image';

const supabase = createClient();

// ── Tipos ─────────────────────────────────────────────────────

type DiaSemana = 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab' | 'dom';
type HorarioDia = { aberto: boolean; inicio: string; fim: string };
type Horarios    = Record<DiaSemana, HorarioDia>;

const DIAS: { key: DiaSemana; label: string }[] = [
  { key: 'seg', label: 'Segunda-feira' },
  { key: 'ter', label: 'Terça-feira'   },
  { key: 'qua', label: 'Quarta-feira'  },
  { key: 'qui', label: 'Quinta-feira'  },
  { key: 'sex', label: 'Sexta-feira'   },
  { key: 'sab', label: 'Sábado'        },
  { key: 'dom', label: 'Domingo'       },
];

const HORARIO_DEFAULT: Horarios = {
  seg: { aberto: true,  inicio: '08:00', fim: '18:00' },
  ter: { aberto: true,  inicio: '08:00', fim: '18:00' },
  qua: { aberto: true,  inicio: '08:00', fim: '18:00' },
  qui: { aberto: true,  inicio: '08:00', fim: '18:00' },
  sex: { aberto: true,  inicio: '08:00', fim: '18:00' },
  sab: { aberto: true,  inicio: '08:00', fim: '13:00' },
  dom: { aberto: false, inicio: '08:00', fim: '12:00' },
};

// ── Helpers ───────────────────────────────────────────────────

const inputCls = "w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
const labelCls = "block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5";

/**
 * Máscara de telefone progressiva — aplica conforme o usuário digita.
 * Suporta celular (11 dígitos): (XX) XXXXX-XXXX
 * e fixo (10 dígitos): (XX) XXXX-XXXX
 */
function maskPhone(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2)  return `(${d}`;
  if (d.length <= 6)  return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/**
 * Máscara de CNPJ progressiva — aplica conforme o usuário digita.
 * Formato: XX.XXX.XXX/XXXX-XX
 */
function maskCnpj(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 14);
  if (d.length === 0)  return '';
  if (d.length <= 2)   return d;
  if (d.length <= 5)   return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8)   return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12)  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function SectionCard({ title, icon: Icon, children, hue = 270 }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  hue?: number;
}) {
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 20, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 16, borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(140deg, oklch(0.55 0.16 ${hue}), oklch(0.42 0.17 ${hue}))`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={14} color="white" strokeWidth={2}/>
        </div>
        <h2 style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14, color: 'var(--color-ink)' }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

// ── Página ────────────────────────────────────────────────────

export default function ConfiguracoesPage() {

  const [aba, setAba] = useState<'empresa' | 'perfil'>('empresa');
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('bellamore_dark_mode') === 'true';
    setDarkMode(stored);
    document.documentElement.classList.toggle('dark', stored);
  }, []);

  function toggleDark() {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('bellamore_dark_mode', String(next));
    document.documentElement.classList.toggle('dark', next);
  }

  // IDs
  const [empresaId, setEmpresaId] = useState('');
  const [userId,    setUserId]    = useState('');
  const [isOwner,   setIsOwner]   = useState(false);

  // Campos empresa
  const [nome,     setNome]     = useState('');
  const [cnpj,     setCnpj]     = useState('');
  const [telefone, setTelefone] = useState('');
  const [endereco, setEndereco] = useState('');
  const [logoUrl,  setLogoUrl]  = useState('');
  const [logoPreview, setLogoPreview] = useState('');
  const [horarios, setHorarios] = useState<Horarios>(HORARIO_DEFAULT);

  // Campos perfil
  const [perfilNome,     setPerfilNome]     = useState('');
  const [perfilTelefone, setPerfilTelefone] = useState('');
  const [perfilEmail,    setPerfilEmail]    = useState('');

  // Upload logo
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadando,  setUploadando]  = useState(false);

  // Feedback
  const [salvando, setSalvando] = useState(false);
  const [toast,    setToast]    = useState('');
  const [erro,     setErro]     = useState('');

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  // ── Carregar dados
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      setPerfilEmail(user.email ?? '');

      // Empresa
      const { data: membro } = await supabase
        .from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (!membro) return;

      setEmpresaId(membro.empresa_id);

      const [{ data: empresa }, { data: perfil }] = await Promise.all([
        supabase.from('empresas').select('nome, cnpj, telefone, endereco, logo_url, horario_funcionamento, owner_id')
          .eq('id', membro.empresa_id).single(),
        supabase.from('users').select('nome, telefone').eq('id', user.id).single(),
      ]);

      if (empresa) {
        setNome(empresa.nome ?? '');
        setCnpj(maskCnpj(empresa.cnpj ?? ''));
        setTelefone(maskPhone(empresa.telefone ?? ''));
        setEndereco(empresa.endereco ?? '');
        setLogoUrl(empresa.logo_url ?? '');
        setLogoPreview(empresa.logo_url ?? '');
        setIsOwner(empresa.owner_id === user.id);
        if (empresa.horario_funcionamento) {
          // Merge com default para garantir todos os dias presentes
          setHorarios({ ...HORARIO_DEFAULT, ...(empresa.horario_funcionamento as Horarios) });
        }
      }

      if (perfil) {
        setPerfilNome(perfil.nome ?? '');
        setPerfilTelefone(maskPhone(perfil.telefone ?? ''));
      }

      setLoading(false);
    })();
  }, []);

  // ── Upload de logo
  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Prévia local imediata
    const objectUrl = URL.createObjectURL(file);
    setLogoPreview(objectUrl);

    setUploadando(true);
    const ext  = file.name.split('.').pop();
    const path = `empresa_${empresaId}.${ext}`;

    const { error } = await supabase.storage
      .from('logos')
      .upload(path, file, { upsert: true });

    if (error) {
      setErro(`Erro no upload: ${error.message}`);
      setLogoPreview(logoUrl); // volta para original
      setUploadando(false);
      return;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('logos').getPublicUrl(path);

    setLogoUrl(publicUrl);
    setUploadando(false);
  }

  // ── Salvar empresa
  async function salvarEmpresa(e: React.FormEvent) {
    e.preventDefault();
    if (!isOwner) { setErro('Somente o dono da empresa pode editar as configurações.'); return; }
    setSalvando(true); setErro('');

    const { error } = await supabase.from('empresas').update({
      nome:     nome.trim(),
      cnpj:     cnpj.trim()     || null,
      telefone: telefone.trim() || null,
      endereco: endereco.trim() || null,
      logo_url: logoUrl         || null,
      horario_funcionamento: horarios,
    }).eq('id', empresaId);

    setSalvando(false);
    if (error) { setErro(error.message); return; }
    showToast('Configurações salvas!');
  }

  // ── Salvar perfil
  async function salvarPerfil(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true); setErro('');

    const { error } = await supabase.from('users').update({
      nome:     perfilNome.trim(),
      telefone: perfilTelefone.trim() || null,
    }).eq('id', userId);

    setSalvando(false);
    if (error) { setErro(error.message); return; }
    showToast('Perfil atualizado!');
  }

  // ── Horários helpers
  function setHorarioDia(dia: DiaSemana, campo: keyof HorarioDia, valor: boolean | string) {
    setHorarios(prev => ({
      ...prev,
      [dia]: { ...prev[dia], [campo]: valor },
    }));
  }

  // ── Render ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div>
        <div className="mb-6"><Sk className="h-3 w-32 mb-2"/><Sk className="h-9 w-40"/></div>
        <div className="flex gap-1 border-b border-border mb-8">
          <Sk className="h-9 w-24 rounded-t-lg"/><Sk className="h-9 w-24 rounded-t-lg"/>
        </div>
        <div className="max-w-2xl flex flex-col gap-6">
          <Sk className="h-32 rounded-2xl"/>
          <Sk className="h-48 rounded-2xl"/>
          <Sk className="h-72 rounded-2xl"/>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-green text-white px-5 py-3 rounded-2xl shadow-lg font-semibold text-sm">
          <Check size={16} strokeWidth={2.5}/> {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>Administração</p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 30, fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>Configurações</h1>
        </div>
        <button onClick={toggleDark} title={darkMode ? 'Modo claro' : 'Modo escuro'}
          className="press mt-1 w-10 h-10 rounded-2xl flex items-center justify-center transition"
          style={{ background: darkMode ? 'var(--color-primary-soft)' : 'var(--color-bg2)', border: '1px solid var(--color-border)' }}>
          {darkMode
            ? <Sun size={18} style={{ color: 'var(--color-primary)' }} strokeWidth={2}/>
            : <Moon size={18} style={{ color: 'var(--color-ink3)' }} strokeWidth={2}/>
          }
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border mb-8">
        {([
          { key: 'empresa', label: 'Empresa' },
          { key: 'perfil',  label: 'Meu perfil' },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => { setAba(key); setErro(''); }}
            className={`px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition ${
              aba === key ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text'
            }`}>{label}
          </button>
        ))}
      </div>

      {/* ══════════ TAB: EMPRESA ══════════ */}
      {aba === 'empresa' && (
        <form onSubmit={salvarEmpresa} className="max-w-2xl flex flex-col gap-6">

          {!isOwner && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <AlertCircle size={15} className="text-amber-500 flex-shrink-0"/>
              <p className="text-sm text-amber-700">Somente o dono da empresa pode editar estas configurações.</p>
            </div>
          )}

          {/* Dados gerais */}
          <SectionCard title="Dados da empresa" icon={Building2} hue={270}>
            <div>
              <label className={labelCls}>Nome do salão *</label>
              <input value={nome} onChange={e => setNome(e.target.value)} required
                placeholder="Ex: Studio Bella" className={inputCls} disabled={!isOwner}/>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>CNPJ</label>
                <input
                  value={cnpj}
                  onChange={e => setCnpj(maskCnpj(e.target.value))}
                  placeholder="00.000.000/0001-00"
                  inputMode="numeric"
                  maxLength={18}
                  className={inputCls}
                  disabled={!isOwner}
                />
              </div>
              <div>
                <label className={labelCls}>Telefone</label>
                <input
                  value={telefone}
                  onChange={e => setTelefone(maskPhone(e.target.value))}
                  placeholder="(11) 99999-9999"
                  inputMode="numeric"
                  maxLength={15}
                  className={inputCls}
                  disabled={!isOwner}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Endereço</label>
              <input value={endereco} onChange={e => setEndereco(e.target.value)}
                placeholder="Rua, número, bairro, cidade" className={inputCls} disabled={!isOwner}/>
            </div>
          </SectionCard>

          {/* Logo */}
          <SectionCard title="Logo" icon={Upload} hue={220}>
            <div className="flex items-center gap-5">
              {/* Prévia */}
              <div
                onClick={() => isOwner && fileInputRef.current?.click()}
                className={`w-20 h-20 rounded-2xl border-2 border-dashed flex items-center justify-center overflow-hidden flex-shrink-0 transition ${
                  isOwner
                    ? 'border-border hover:border-accent cursor-pointer'
                    : 'border-border cursor-not-allowed opacity-60'
                }`}>
                {logoPreview ? (
                  <Image src={logoPreview} alt="Logo" width={80} height={80} className="w-full h-full object-cover"/>
                ) : (
                  <Upload size={20} className="text-text-4"/>
                )}
              </div>

              {/* Info */}
              <div className="flex flex-col gap-2">
                <p className="text-sm text-text font-semibold">
                  {logoPreview ? 'Logo carregada' : 'Nenhuma logo'}
                </p>
                <p className="text-xs text-text-4">PNG, JPG até 2 MB. Clique na imagem para trocar.</p>
                {isOwner && (
                  <button type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadando}
                    className="w-fit h-8 px-3 rounded-xl border border-border text-xs font-semibold text-text-2 hover:bg-bg transition disabled:opacity-50">
                    {uploadando ? 'Enviando...' : 'Escolher arquivo'}
                  </button>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoUpload}
              />
            </div>
          </SectionCard>

          {/* Horários */}
          <SectionCard title="Horários de funcionamento" icon={Clock} hue={145}>
            <div className="flex flex-col gap-3">
              {DIAS.map(({ key, label }) => {
                const h = horarios[key];
                return (
                  <div key={key} className="flex items-center gap-4">
                    {/* Toggle */}
                    <button
                      type="button"
                      onClick={() => isOwner && setHorarioDia(key, 'aberto', !h.aberto)}
                      disabled={!isOwner}
                      className={`relative w-10 h-5 rounded-full transition flex-shrink-0 ${
                        h.aberto ? 'bg-primary' : 'bg-border'
                      } ${!isOwner ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${
                        h.aberto ? 'left-[22px]' : 'left-0.5'
                      }`}/>
                    </button>

                    {/* Nome do dia */}
                    <span className={`text-sm w-32 flex-shrink-0 ${h.aberto ? 'text-text font-semibold' : 'text-text-4'}`}>
                      {label}
                    </span>

                    {/* Horários */}
                    {h.aberto ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="time"
                          value={h.inicio}
                          onChange={e => setHorarioDia(key, 'inicio', e.target.value)}
                          disabled={!isOwner}
                          className="h-9 px-2.5 rounded-xl border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent transition disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                        <span className="text-text-4 text-sm">até</span>
                        <input
                          type="time"
                          value={h.fim}
                          onChange={e => setHorarioDia(key, 'fim', e.target.value)}
                          disabled={!isOwner}
                          className="h-9 px-2.5 rounded-xl border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent transition disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-text-4 italic">Fechado</span>
                    )}
                  </div>
                );
              })}
            </div>
          </SectionCard>

          {/* Erro */}
          {erro && (
            <div className="flex items-center gap-2 bg-red-soft rounded-xl px-3 py-2.5 border border-red/20">
              <AlertCircle size={14} className="text-red flex-shrink-0"/>
              <p className="text-sm text-red">{erro}</p>
            </div>
          )}

          {/* Salvar */}
          {isOwner && (
            <div className="pb-6">
              <button type="submit" disabled={salvando || uploadando}
                className="press h-11 rounded-2xl bg-primary text-white font-bold text-sm transition disabled:opacity-50 flex items-center justify-center gap-2 px-8"
                style={{ boxShadow: '0 6px 20px rgba(44,23,80,0.2)' }}>
                <Check size={16} strokeWidth={2.5}/> {salvando ? 'Salvando...' : 'Salvar configurações'}
              </button>
            </div>
          )}
        </form>
      )}

      {/* ══════════ TAB: MEU PERFIL ══════════ */}
      {aba === 'perfil' && (
        <form onSubmit={salvarPerfil} className="max-w-2xl flex flex-col gap-6">
          <SectionCard title="Meu perfil" icon={User} hue={330}>
            <div>
              <label className={labelCls}>Nome *</label>
              <input value={perfilNome} onChange={e => setPerfilNome(e.target.value)} required
                placeholder="Seu nome completo" className={inputCls}/>
            </div>
            <div>
              <label className={labelCls}>Telefone</label>
              <input
                value={perfilTelefone}
                onChange={e => setPerfilTelefone(maskPhone(e.target.value))}
                placeholder="(11) 99999-9999"
                inputMode="numeric"
                maxLength={15}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>E-mail</label>
              <input value={perfilEmail} disabled
                className={`${inputCls} opacity-50 cursor-not-allowed`}
                placeholder="E-mail não disponível"/>
              <p className="text-xs text-text-4 mt-1">O e-mail é gerenciado pela autenticação e não pode ser alterado aqui.</p>
            </div>
          </SectionCard>

          {/* Erro */}
          {erro && (
            <div className="flex items-center gap-2 bg-red-soft rounded-xl px-3 py-2.5 border border-red/20">
              <AlertCircle size={14} className="text-red flex-shrink-0"/>
              <p className="text-sm text-red">{erro}</p>
            </div>
          )}

          <div className="pb-6">
            <button type="submit" disabled={salvando}
              className="press h-11 rounded-2xl bg-primary text-white font-bold text-sm transition disabled:opacity-50 flex items-center justify-center gap-2 px-8"
              style={{ boxShadow: '0 6px 20px rgba(44,23,80,0.2)' }}>
              <Check size={16} strokeWidth={2.5}/> {salvando ? 'Salvando...' : 'Salvar perfil'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
