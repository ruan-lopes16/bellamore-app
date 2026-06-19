'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Sk } from '@/components/Skeleton';
import { AlertCircle, Check, Upload, Building2, User, Clock, Moon, Sun, Loader2 } from 'lucide-react';
import Image from 'next/image';

const supabase = createClient();

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

const inputCls = "w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
const labelCls = "block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5";

function maskPhone(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2)  return `(${d}`;
  if (d.length <= 6)  return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

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
  title: string; icon: React.ElementType; children: React.ReactNode; hue?: number;
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

export default function ConfiguracoesPage() {
  const router = useRouter();

  const [aba,      setAba]      = useState<'empresa' | 'perfil'>('empresa');
  const [loading,  setLoading]  = useState(true);
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

  const [empresaId, setEmpresaId] = useState('');
  const [userId,    setUserId]    = useState('');
  const [isOwner,   setIsOwner]   = useState(false);

  // Campos empresa
  const [nome,      setNome]      = useState('');
  const [segmento,  setSegmento]  = useState('Estúdio');
  const [cnpj,      setCnpj]      = useState('');
  const [telefone,  setTelefone]  = useState('');
  const [cep,       setCep]       = useState('');
  const [rua,       setRua]       = useState('');
  const [numero,    setNumero]    = useState('');
  const [bairro,    setBairro]    = useState('');
  const [localidade,setLocalidade]= useState('');
  const [logoUrl,   setLogoUrl]   = useState('');
  const [logoPreview,setLogoPreview] = useState('');
  const [horarios,  setHorarios]  = useState<Horarios>(HORARIO_DEFAULT);

  const [buscandoCep,  setBuscandoCep]  = useState(false);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);

  // Campos perfil
  const [perfilNome,     setPerfilNome]     = useState('');
  const [perfilTelefone, setPerfilTelefone] = useState('');
  const [perfilEmail,    setPerfilEmail]    = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadando, setUploadando] = useState(false);

  const [salvando, setSalvando] = useState(false);
  const [toast,    setToast]    = useState('');
  const [erro,     setErro]     = useState('');

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      setPerfilEmail(user.email ?? '');

      const { data: membro } = await supabase
        .from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (!membro) return;

      setEmpresaId(membro.empresa_id);

      const [{ data: empresa }, { data: perfil }] = await Promise.all([
        supabase.from('empresas').select('nome, segmento, cnpj, telefone, endereco, logo_url, horario_funcionamento, owner_id')
          .eq('id', membro.empresa_id).single(),
        supabase.from('users').select('nome, telefone').eq('id', user.id).single(),
      ]);

      if (empresa) {
        setNome(empresa.nome ?? '');
        setSegmento(empresa.segmento ?? 'Estúdio');
        setCnpj(maskCnpj(empresa.cnpj ?? ''));
        setTelefone(maskPhone(empresa.telefone ?? ''));
        setLogoUrl(empresa.logo_url ?? '');
        setLogoPreview(empresa.logo_url ?? '');
        setIsOwner(empresa.owner_id === user.id);
        if (empresa.horario_funcionamento) {
          setHorarios({ ...HORARIO_DEFAULT, ...(empresa.horario_funcionamento as Horarios) });
        }

        // Faz parse do endereço salvo em partes separadas
        const endRaw = (empresa.endereco ?? '').trim();
        if (endRaw) {
          const parts = endRaw.split(',').map((s: string) => s.trim()).filter(Boolean);
          if (parts.length >= 3) {
            setRua(parts[0]);
            // Se a segunda parte começa com dígito, é o número
            if (/^\d/.test(parts[1])) {
              setNumero(parts[1]);
              setBairro(parts.slice(2, -1).join(', '));
            } else {
              setBairro(parts.slice(1, -1).join(', '));
            }
            setLocalidade(parts[parts.length - 1]);
          } else {
            setRua(endRaw);
          }
        }
      }

      if (perfil) {
        setPerfilNome(perfil.nome ?? '');
        setPerfilTelefone(maskPhone(perfil.telefone ?? ''));
      }

      setLoading(false);
    })();
  }, []);

  async function buscarCEP(valor: string) {
    const d = valor.replace(/\D/g, '');
    if (d.length !== 8) return;
    setBuscandoCep(true);
    try {
      const res  = await fetch(`https://viacep.com.br/ws/${d}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setRua(data.logradouro || '');
        setBairro(data.bairro || '');
        setLocalidade(`${data.localidade} - ${data.uf}`);
        setNumero(''); // limpa para o usuário preencher
      }
    } catch {}
    finally { setBuscandoCep(false); }
  }

  async function buscarCNPJ(valor: string) {
    const d = valor.replace(/\D/g, '');
    if (d.length !== 14) return;
    setBuscandoCnpj(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`);
      if (!res.ok) return;
      const data = await res.json();
      const nomeFantasia = data.nome_fantasia || data.razao_social;
      if (nomeFantasia && !nome) setNome(nomeFantasia);
      if (data.ddd_telefone_1 && !telefone) {
        setTelefone(maskPhone((data.ddd_telefone_1 + (data.telefone_1 ?? '')).replace(/\D/g, '')));
      }
      if (data.cep) {
        const cepFormatado = data.cep.replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2');
        setCep(cepFormatado);
      }
      if (data.logradouro) {
        setRua(data.logradouro);
        setNumero(data.numero ?? '');
        setBairro(data.bairro ?? '');
        setLocalidade(`${data.municipio} - ${data.uf}`);
      }
    } catch {}
    finally { setBuscandoCnpj(false); }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Prévia imediata
    const objectUrl = URL.createObjectURL(file);
    setLogoPreview(objectUrl);
    setUploadando(true);

    const ext  = file.name.split('.').pop();
    const path = `empresa_${empresaId}.${ext}`;

    const { error } = await supabase.storage.from('logos').upload(path, file, { upsert: true });

    if (error) {
      setErro(`Erro no upload: ${error.message}`);
      setLogoPreview(logoUrl);
      setUploadando(false);
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from('logos').getPublicUrl(path);
    setLogoUrl(publicUrl);

    // Salva logo_url imediatamente para refletir na sidebar sem precisar salvar o formulário
    await supabase.from('empresas').update({ logo_url: publicUrl }).eq('id', empresaId);
    router.refresh(); // atualiza o Server Component (AppLayout / Sidebar)

    setUploadando(false);
    showToast('Logo atualizada!');
  }

  async function salvarEmpresa(e: React.FormEvent) {
    e.preventDefault();
    if (!isOwner) { setErro('Somente o dono da empresa pode editar as configurações.'); return; }
    setSalvando(true); setErro('');

    const enderecoFinal = [rua, numero, bairro, localidade].filter(Boolean).join(', ');

    const { error } = await supabase.from('empresas').update({
      nome:                  nome.trim(),
      segmento:              segmento        || 'Estúdio',
      cnpj:                  cnpj.trim()     || null,
      telefone:              telefone.trim() || null,
      endereco:              enderecoFinal   || null,
      logo_url:              logoUrl         || null,
      horario_funcionamento: horarios,
    }).eq('id', empresaId);

    setSalvando(false);
    if (error) { setErro(error.message); return; }
    showToast('Configurações salvas!');
    setTimeout(() => window.location.reload(), 1000);
  }

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

  function setHorarioDia(dia: DiaSemana, campo: keyof HorarioDia, valor: boolean | string) {
    setHorarios(prev => ({ ...prev, [dia]: { ...prev[dia], [campo]: valor } }));
  }

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
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-green text-white px-5 py-3 rounded-2xl shadow-lg font-semibold text-sm">
          <Check size={16} strokeWidth={2.5}/> {toast}
        </div>
      )}

      <div className="flex items-start justify-between mb-6">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>Administração</p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 30, fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>Configurações</h1>
        </div>
        <button onClick={toggleDark} title={darkMode ? 'Modo claro' : 'Modo escuro'}
          className="press mt-1 w-10 h-10 rounded-2xl flex items-center justify-center transition"
          style={{ background: darkMode ? 'var(--color-primary-soft)' : 'var(--color-bg2)', border: '1px solid var(--color-border)' }}>
          {darkMode
            ? <Sun  size={18} style={{ color: 'var(--color-primary)' }} strokeWidth={2}/>
            : <Moon size={18} style={{ color: 'var(--color-ink3)'   }} strokeWidth={2}/>}
        </button>
      </div>

      <div className="flex gap-0 border-b border-border mb-8">
        {([
          { key: 'empresa', label: 'Empresa'    },
          { key: 'perfil',  label: 'Meu perfil' },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => { setAba(key); setErro(''); }}
            className={`px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition ${
              aba === key ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text'
            }`}>{label}
          </button>
        ))}
      </div>

      {/* ══ TAB: EMPRESA ══ */}
      {aba === 'empresa' && (
        <form onSubmit={salvarEmpresa} className="max-w-2xl flex flex-col gap-6">

          {!isOwner && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <AlertCircle size={15} className="text-amber-500 flex-shrink-0"/>
              <p className="text-sm text-amber-700">Somente o dono da empresa pode editar estas configurações.</p>
            </div>
          )}

          {/* Logo — primeiro para reflexo imediato */}
          <SectionCard title="Logo" icon={Upload} hue={220}>
            <div className="flex items-center gap-5">
              <div
                onClick={() => isOwner && fileInputRef.current?.click()}
                className={`w-20 h-20 rounded-2xl border-2 border-dashed flex items-center justify-center overflow-hidden flex-shrink-0 transition ${
                  isOwner ? 'border-border hover:border-accent cursor-pointer' : 'border-border cursor-not-allowed opacity-60'
                }`}
                style={{ background: logoPreview ? '#fff' : undefined }}>
                {logoPreview ? (
                  <Image src={logoPreview} alt="Logo" width={80} height={80} className="w-full h-full object-contain" unoptimized/>
                ) : (
                  <Upload size={20} className="text-text-4"/>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-sm text-text font-semibold">
                  {uploadando ? 'Enviando...' : logoPreview ? 'Logo carregada' : 'Nenhuma logo'}
                </p>
                <p className="text-xs text-text-4">PNG, JPG até 2 MB. Ao fazer upload, a logo já aparece na sidebar.</p>
                {isOwner && (
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadando}
                    className="w-fit h-8 px-3 rounded-xl border border-border text-xs font-semibold text-text-2 hover:bg-bg transition disabled:opacity-50 flex items-center gap-1.5">
                    {uploadando && <Loader2 size={12} className="animate-spin"/>}
                    {uploadando ? 'Enviando...' : 'Escolher arquivo'}
                  </button>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload}/>
            </div>
          </SectionCard>

          {/* Dados gerais */}
          <SectionCard title="Dados da empresa" icon={Building2} hue={270}>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Nome do salão *</label>
                <input value={nome} onChange={e => setNome(e.target.value)} required
                  placeholder="Ex: Studio Bella" className={inputCls} disabled={!isOwner}/>
              </div>
              <div>
                <label className={labelCls}>Segmento</label>
                <select
                  value={segmento}
                  onChange={e => setSegmento(e.target.value)}
                  disabled={!isOwner}
                  className={`${inputCls} cursor-pointer`}
                  style={{ appearance: 'auto' }}
                >
                  {['Estúdio', 'Clínica', 'Salão', 'Barbearia', 'Spa', 'Ateliê', 'Outro'].map(op => (
                    <option key={op} value={op}>{op}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>CNPJ</label>
                <div className="relative">
                  <input
                    value={cnpj}
                    onChange={e => { const m = maskCnpj(e.target.value); setCnpj(m); buscarCNPJ(m); }}
                    placeholder="00.000.000/0001-00" inputMode="numeric" maxLength={18}
                    className={inputCls} disabled={!isOwner}/>
                  {buscandoCnpj && <Loader2 size={14} className="absolute right-3 top-3 text-text-4 animate-spin"/>}
                </div>
              </div>
              <div>
                <label className={labelCls}>Telefone</label>
                <input value={telefone} onChange={e => setTelefone(maskPhone(e.target.value))}
                  placeholder="(11) 99999-9999" inputMode="numeric" maxLength={15}
                  className={inputCls} disabled={!isOwner}/>
              </div>
            </div>

            {/* CEP + Número na mesma linha */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>CEP</label>
                <div className="relative">
                  <input
                    value={cep}
                    onChange={e => {
                      const masked = e.target.value.replace(/\D/g, '').replace(/^(\d{5})(\d{0,3})$/, '$1-$2').replace(/-$/, '');
                      setCep(masked);
                      buscarCEP(masked);
                    }}
                    placeholder="00000-000" inputMode="numeric" maxLength={9}
                    className={inputCls} disabled={!isOwner}/>
                  {buscandoCep && <Loader2 size={14} className="absolute right-3 top-3 text-text-4 animate-spin"/>}
                </div>
              </div>
              <div>
                <label className={labelCls}>Número</label>
                <input value={numero} onChange={e => setNumero(e.target.value)}
                  placeholder="123" className={inputCls} disabled={!isOwner}/>
              </div>
            </div>

            <div>
              <label className={labelCls}>Logradouro</label>
              <input value={rua} onChange={e => setRua(e.target.value)}
                placeholder="Preenchido pelo CEP" className={inputCls} disabled={!isOwner}/>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Bairro</label>
                <input value={bairro} onChange={e => setBairro(e.target.value)}
                  placeholder="Preenchido pelo CEP" className={inputCls} disabled={!isOwner}/>
              </div>
              <div>
                <label className={labelCls}>Cidade / Estado</label>
                <input value={localidade} onChange={e => setLocalidade(e.target.value)}
                  placeholder="Preenchido pelo CEP" className={inputCls} disabled={!isOwner}/>
              </div>
            </div>
          </SectionCard>

          {/* Horários */}
          <SectionCard title="Horários de funcionamento" icon={Clock} hue={145}>
            <div className="flex flex-col gap-3">
              {DIAS.map(({ key, label }) => {
                const h = horarios[key];
                return (
                  <div key={key} className="flex items-center gap-4">
                    <button type="button"
                      onClick={() => isOwner && setHorarioDia(key, 'aberto', !h.aberto)}
                      disabled={!isOwner}
                      className={`relative w-10 h-5 rounded-full transition flex-shrink-0 ${h.aberto ? 'bg-primary' : 'bg-border'} ${!isOwner ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${h.aberto ? 'left-[22px]' : 'left-0.5'}`}/>
                    </button>
                    <span className={`text-sm w-32 flex-shrink-0 ${h.aberto ? 'text-text font-semibold' : 'text-text-4'}`}>{label}</span>
                    {h.aberto ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input type="time" value={h.inicio} onChange={e => setHorarioDia(key, 'inicio', e.target.value)}
                          disabled={!isOwner}
                          className="h-9 px-2.5 rounded-xl border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent transition disabled:opacity-60 disabled:cursor-not-allowed"/>
                        <span className="text-text-4 text-sm">até</span>
                        <input type="time" value={h.fim} onChange={e => setHorarioDia(key, 'fim', e.target.value)}
                          disabled={!isOwner}
                          className="h-9 px-2.5 rounded-xl border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent transition disabled:opacity-60 disabled:cursor-not-allowed"/>
                      </div>
                    ) : (
                      <span className="text-sm text-text-4 italic">Fechado</span>
                    )}
                  </div>
                );
              })}
            </div>
          </SectionCard>

          {erro && (
            <div className="flex items-center gap-2 bg-red-soft rounded-xl px-3 py-2.5 border border-red/20">
              <AlertCircle size={14} className="text-red flex-shrink-0"/>
              <p className="text-sm text-red">{erro}</p>
            </div>
          )}

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

      {/* ══ TAB: MEU PERFIL ══ */}
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
              <input value={perfilTelefone} onChange={e => setPerfilTelefone(maskPhone(e.target.value))}
                placeholder="(11) 99999-9999" inputMode="numeric" maxLength={15} className={inputCls}/>
            </div>
            <div>
              <label className={labelCls}>E-mail</label>
              <input value={perfilEmail} disabled
                className={`${inputCls} opacity-50 cursor-not-allowed`} placeholder="E-mail não disponível"/>
              <p className="text-xs text-text-4 mt-1">O e-mail é gerenciado pela autenticação e não pode ser alterado aqui.</p>
            </div>
          </SectionCard>

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
