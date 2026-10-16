'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Plus, X, Phone, Edit3, PowerOff, Power, Percent, UserCog, ChevronDown, CheckCircle2,
  Eye, EyeOff, Copy, Check, Sparkles, Shield,
} from 'lucide-react';
import { ExportButton } from '@/components/ExportButton';
import { definicaoEquipe } from '@shared/exportacao/equipe';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { createClient } from '@/lib/supabase/client';
import { useScrollLock } from '@/lib/useScrollLock';
import Link from 'next/link';
import { chaveMesBRT, rotuloMesAno } from '@shared/periodos';
import { MENSAGEM_PAGAMENTO_PARCIAL } from '@shared/comissoes';
import { carregarEquipe, alterarAtivo, alterarPapel, type MembroEquipe } from '@shared/equipe-consultas';
import { rotuloContrato, normalizarComissao, numerosVisiveis, type TipoContrato } from '@shared/equipe';
import { pagarComissoes } from '@shared/comissoes-consultas';
import { carregarConfigPermissoes } from '@shared/permissoes-consultas';
import { usePermissoes } from '@/components/PermissoesProvider';
import { configVazia, contarExcecoes, podeGerenciarMembro, type ConfigPermissoes } from '@shared/permissoes';
import { Sk } from '@/components/Skeleton';
import { SmoothTabs } from '@/components/SmoothTabs';
import { mensagemCadastroEquipe } from '@/lib/convites-web';
import {
  carregarConvitesPendentes, cancelarConvite, carregarHistoricoEquipe, podeCancelarConvite,
  type ConvitePendente,
} from '@shared/convites-consultas';
import {
  descreverHistoricoEquipe, quandoHistoricoEquipe, rotuloPapelEquipe, type LinhaHistoricoEquipe,
} from '@shared/equipe';
import { Secret, PrivacyToggle } from '@/components/privacy';
import { maskPhone } from '@/lib/masks';
import { avancarComEnter } from '@/lib/formNav';
import { formatarMoeda as fmtBRL } from '@shared/moeda';

const supabase = createClient();

// ── Tipos ─────────────────────────────────────────────────────

type Profissional = MembroEquipe;

// ── Helpers ───────────────────────────────────────────────────

const AVATAR_CORES = [
  ['#7C3AED', '#A855F7'], ['#D4608A', '#F472B6'],
  ['#0D7E5F', '#34D399'], ['#B45309', '#F59E0B'],
  ['#1D4ED8', '#60A5FA'], ['#7C2D12', '#EA580C'],
] as const;

function avatarCor(nome: string) {
  return AVATAR_CORES[(nome?.charCodeAt(0) ?? 0) % AVATAR_CORES.length];
}
function iniciais(nome: string) {
  return nome.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}
function roleBadge(role: 'owner' | 'gestor' | 'profissional') {
  if (role === 'owner')  return { label: 'Dono(a)',     bg: 'var(--color-primary-soft)', color: 'var(--color-primary)' };
  if (role === 'gestor') return { label: 'Gestor(a)',   bg: 'rgba(59,130,246,0.12)',     color: 'rgb(59,130,246)' };
  return                        { label: 'Profissional', bg: 'var(--color-bg2)',          color: 'var(--color-ink3)' };
}
const inputClass = "w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
const labelClass = "block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5";

function gerarSenha() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ── Modal adicionar profissional ──────────────────────────────

function NovoProfModal({ empresaId, isOwner, onClose, onSalvo, onConvitePendente }: {
  empresaId: string;
  /** Só a dona cria gestora (mesma regra das APIs de convite e de cadastro). */
  isOwner: boolean;
  onClose: () => void;
  onSalvo: (p: Profissional, mensagem?: string) => void;
  /** Conta já existente fora da equipe: nasce um convite pendente, sem vínculo. */
  onConvitePendente: (convite: ConvitePendente | null, mensagem: string) => void;
}) {
  useScrollLock();
  const [nome,          setNome]          = useState('');
  const [telefone,      setTelefone]      = useState('');
  const [email,         setEmail]         = useState('');
  const [modoAcesso,    setModoAcesso]    = useState<'convite' | 'senha'>('convite');
  const [senha,         setSenha]         = useState('');
  const [verSenha,      setVerSenha]      = useState(false);
  const [comissao,      setComissao]      = useState('');
  const [role,          setRole]          = useState<'gestor' | 'profissional'>('profissional');
  const [tipoContrato,  setTipoContrato]  = useState<TipoContrato | ''>('');
  const [salvando,      setSalvando]      = useState(false);
  const [erro,          setErro]          = useState('');
  const [credenciais,   setCredenciais]   = useState<{ email: string; senha: string } | null>(null);
  const [copiado,       setCopiado]       = useState(false);
  const [membroPendente, setMembroPendente] = useState<Profissional | null>(null);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');

    if (modoAcesso === 'senha' && senha.length < 6) {
      setErro('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    setSalvando(true);
    const usarConvite = modoAcesso === 'convite';
    const res = await fetch(usarConvite ? '/api/convites' : '/api/profissionais', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empresaId,
        nome:                 nome.trim(),
        telefone:             telefone.trim() || null,
        email:                email.trim(),
        senha:                usarConvite ? undefined : senha,
        // Só vai o que foi preenchido: readicionar alguém da equipe nunca zera comissão/contrato.
        percentual_comissao:  comissao.trim() !== '' ? comissao.trim() : undefined,
        tipo_contrato:        tipoContrato || undefined,
        role,
      }),
    });

    const json = await res.json().catch(() => ({}));
    setSalvando(false);

    if (!res.ok) { setErro(json.error ?? 'Erro ao salvar.'); return; }

    if (json.status === 'convite_pendente') {
      onConvitePendente((json.convite as ConvitePendente | undefined) ?? null, mensagemCadastroEquipe('convite_pendente', nome.trim())!);
      return;
    }

    const membro: Profissional = {
      ...json.membro,
      total_mes: 0, atendimentos_mes: 0,
      comissao_pendente: 0, comissao_pendente_anterior: 0, ids_pendentes_mes: [],
    };

    if (!usarConvite && json.status === 'criado') {
      // Senha definida agora numa conta nova — mostra pra copiar antes de fechar.
      setMembroPendente(membro);
      setCredenciais({ email: email.trim(), senha });
      return;
    }

    onSalvo(membro, mensagemCadastroEquipe(json.status, nome.trim()));
  }

  function copiarCredenciais() {
    if (!credenciais) return;
    navigator.clipboard.writeText(`E-mail: ${credenciais.email}\nSenha: ${credenciais.senha}`);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  if (credenciais && membroPendente) {
    return (
      <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"/>
        <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[90dvh] overflow-y-auto">
          <div className="p-5 border-b border-border">
            <h2 className="font-serif text-xl text-text">Conta criada!</h2>
          </div>
          <div className="p-5 flex flex-col gap-4">
            <p className="text-sm text-text-2">
              Repasse esses dados para {nome.trim()} acessar o app. Eles só aparecem aqui, uma vez —
              não ficam salvos em nenhum outro lugar.
            </p>
            <div className="rounded-xl border border-border bg-bg p-3.5 flex flex-col gap-2.5">
              <div>
                <span className="text-xs font-semibold text-text-3 uppercase tracking-wide">E-mail</span>
                <p className="text-sm text-text font-medium font-mono">{credenciais.email}</p>
              </div>
              <div>
                <span className="text-xs font-semibold text-text-3 uppercase tracking-wide">Senha</span>
                <p className="text-sm text-text font-medium font-mono">{credenciais.senha}</p>
              </div>
            </div>
            <button type="button" onClick={copiarCredenciais}
              className="h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition flex items-center justify-center gap-2">
              {copiado ? <Check size={15}/> : <Copy size={15}/>}
              {copiado ? 'Copiado!' : 'Copiar e-mail e senha'}
            </button>
            <button type="button" onClick={() => onSalvo(membroPendente)}
              className="h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition">
              Concluir
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-serif text-xl text-text">Nova profissional</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
            <X size={16}/>
          </button>
        </div>
        <form onSubmit={salvar} onKeyDown={avancarComEnter} className="p-5 flex flex-col gap-4">
          <div>
            <label className={labelClass}>Nome *</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              placeholder="Nome completo" required className={inputClass}/>
          </div>
          <div>
            <label className={labelClass}>Telefone</label>
            <input value={telefone} onChange={e => setTelefone(maskPhone(e.target.value))}
              placeholder="(11) 99999-9999" type="tel" maxLength={15} className={inputClass}/>
          </div>
          <div>
            <label className={labelClass}>E-mail *</label>
            <input value={email} onChange={e => setEmail(e.target.value)}
              placeholder="email@exemplo.com" type="email" required className={inputClass}/>
          </div>
          <div>
            <label className={labelClass}>Como dar acesso</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setModoAcesso('convite')}
                className="flex-1 h-10 rounded-xl border text-xs font-semibold transition px-2"
                style={{
                  borderColor: modoAcesso === 'convite' ? 'var(--color-primary)' : 'var(--color-border)',
                  background:  modoAcesso === 'convite' ? 'var(--color-primary-soft)' : 'transparent',
                  color:       modoAcesso === 'convite' ? 'var(--color-primary)' : 'var(--color-text-2)',
                }}>
                Enviar convite por e-mail
              </button>
              <button type="button" onClick={() => setModoAcesso('senha')}
                className="flex-1 h-10 rounded-xl border text-xs font-semibold transition px-2"
                style={{
                  borderColor: modoAcesso === 'senha' ? 'var(--color-primary)' : 'var(--color-border)',
                  background:  modoAcesso === 'senha' ? 'var(--color-primary-soft)' : 'transparent',
                  color:       modoAcesso === 'senha' ? 'var(--color-primary)' : 'var(--color-text-2)',
                }}>
                Definir senha agora
              </button>
            </div>
            <p className="text-xs text-text-3 mt-1.5 leading-snug">
              {modoAcesso === 'convite'
                ? 'Ela recebe um e-mail e cria a própria senha.'
                : 'Você define a senha agora e repassa pra ela por fora (WhatsApp, pessoalmente).'}
            </p>
          </div>
          {modoAcesso === 'senha' && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={`${labelClass} !mb-0`}>Senha *</label>
                <button type="button" onClick={() => { setSenha(gerarSenha()); setVerSenha(true); }}
                  className="text-xs font-semibold text-accent hover:underline flex items-center gap-1">
                  <Sparkles size={12}/> Gerar senha
                </button>
              </div>
              <div className="relative">
                <input
                  type={verSenha ? 'text' : 'password'}
                  value={senha} onChange={e => setSenha(e.target.value)}
                  placeholder="mínimo 6 caracteres" required minLength={6}
                  className={`${inputClass} pr-11 font-mono`}/>
                <button type="button" onClick={() => setVerSenha(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-2 transition">
                  {verSenha ? <EyeOff size={15}/> : <Eye size={15}/>}
                </button>
              </div>
            </div>
          )}
          {isOwner && (
            <div>
              <label className={labelClass}>Papel</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setRole('profissional')}
                  className="flex-1 h-10 rounded-xl border text-sm font-semibold transition"
                  style={{
                    borderColor: role === 'profissional' ? 'var(--color-primary)' : 'var(--color-border)',
                    background:  role === 'profissional' ? 'var(--color-primary-soft)' : 'transparent',
                    color:       role === 'profissional' ? 'var(--color-primary)' : 'var(--color-text-2)',
                  }}>
                  Profissional
                </button>
                <button type="button" onClick={() => setRole('gestor')}
                  className="flex-1 h-10 rounded-xl border text-sm font-semibold transition"
                  style={{
                    borderColor: role === 'gestor' ? 'var(--color-primary)' : 'var(--color-border)',
                    background:  role === 'gestor' ? 'var(--color-primary-soft)' : 'transparent',
                    color:       role === 'gestor' ? 'var(--color-primary)' : 'var(--color-text-2)',
                  }}>
                  Gestora
                </button>
              </div>
            </div>
          )}
          <div>
            <label className={labelClass}>Comissão por atendimento (%)</label>
            <div className="relative">
              <input value={comissao} onChange={e => setComissao(e.target.value)}
                inputMode="decimal" placeholder="0" min="0" max="100"
                className={`${inputClass} pr-8`}/>
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">%</span>
            </div>
          </div>
          <div>
            <label className={labelClass}>Tipo de contrato</label>
            <select value={tipoContrato} onChange={e => setTipoContrato(e.target.value as TipoContrato | '')}
              className={inputClass}>
              <option value="">Sem informar</option>
              <option value="pj">{rotuloContrato('pj')}</option>
              <option value="clt">{rotuloContrato('clt')}</option>
            </select>
          </div>
          {erro && <p className="text-red text-sm">{erro}</p>}
          <div className="flex gap-3 mt-1">
            <button type="button" onClick={onClose}
              className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
              Cancelar
            </button>
            <button type="submit" disabled={salvando || !nome.trim() || !email.trim()}
              className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-50">
              {salvando
                ? (modoAcesso === 'convite' ? 'Enviando convite...' : 'Salvando...')
                : (modoAcesso === 'convite' ? 'Enviar convite' : 'Adicionar')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Modal editar informações ──────────────────────────────────

/**
 * Corpo do PATCH: empresaId/userId/membroId/nome/telefone sempre; e-mail, comissão e tipo de contrato
 * só quando mudaram em relação ao que foi carregado (conta antiga com e-mail divergente responderia
 * 409 a qualquer edição se o e-mail fosse sempre enviado).
 */
function camposAlterados(prof: Profissional, empresaId: string, v: {
  nome: string; telefone: string | null; emailNovo: string; emailAntigo: string; comissao: string; tipoContrato: TipoContrato | '';
}) {
  const corpo: Record<string, unknown> = {
    empresaId, userId: prof.user_id, membroId: prof.id, nome: v.nome, telefone: v.telefone,
  };
  if (v.emailNovo !== v.emailAntigo) corpo.email = v.emailNovo || null;
  // Texto cru: a API valida (0 a 100) e devolve a mensagem de erro; inválido nunca vira 0 em silêncio.
  if (normalizarComissao(v.comissao.trim()) !== prof.percentual_comissao) corpo.percentual_comissao = v.comissao.trim();
  if ((v.tipoContrato || null) !== prof.tipo_contrato) corpo.tipo_contrato = v.tipoContrato || null;
  return corpo;
}

function EditInfoModal({ prof, empresaId, onClose, onSalvo, onParcial }: {
  prof: Profissional;
  empresaId: string;
  onClose: () => void;
  onSalvo: (dados: { nome: string; telefone: string; email: string; comissao: number; tipoContrato: TipoContrato | null }) => void;
  /** Salvamento parcial: nome/contato gravados, comissão/contrato não. */
  onParcial: (dados: { nome: string; telefone: string; email: string | null }) => void;
}) {
  useScrollLock();
  const [nome,     setNome]     = useState(prof.user.nome);
  const [telefone, setTelefone] = useState(prof.user.telefone ?? '');
  const [email,    setEmail]    = useState(prof.user.email ?? '');
  const [comissao, setComissao] = useState(String(prof.percentual_comissao));
  const [tipoContrato, setTipoContrato] = useState<TipoContrato | ''>(prof.tipo_contrato ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro,     setErro]     = useState('');
  const [erroEmail, setErroEmail] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setErro(''); setErroEmail(false); setSalvando(true);

    const emailNovo = email.trim();
    const emailAntigo = (prof.user.email ?? '').trim();
    const res = await fetch('/api/profissionais', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(camposAlterados(prof, empresaId, {
        nome: nome.trim(), telefone: telefone.trim() || null, emailNovo, emailAntigo, comissao, tipoContrato,
      })),
    });
    const json = await res.json().catch(() => ({}));
    setSalvando(false);
    if (!res.ok) {
      const msg: string = json.error ?? 'Erro ao salvar.';
      setErro(msg);
      setErroEmail(res.status === 409);
      // Salvamento parcial (400): nome e contato já foram gravados; a lista local acompanha.
      if (res.status === 400 && /salvos?, mas/.test(msg)) {
        const trocouEmail = /e-mail de login/.test(msg);
        onParcial({ nome: nome.trim(), telefone: telefone.trim(), email: trocouEmail ? emailNovo.toLowerCase() : null });
      }
      return;
    }

    onSalvo({
      nome: nome.trim(), telefone: telefone.trim(),
      email: (emailNovo || emailAntigo).toLowerCase(),
      comissao: normalizarComissao(comissao.trim()) ?? prof.percentual_comissao,
      tipoContrato: tipoContrato || null,
    });
  }

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-serif text-xl text-text">Editar profissional</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
            <X size={16}/>
          </button>
        </div>
        <form onSubmit={salvar} onKeyDown={avancarComEnter} className="p-5 flex flex-col gap-4">
          <div>
            <label className={labelClass}>Nome *</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              placeholder="Nome completo" required autoFocus className={inputClass}/>
          </div>
          <div>
            <label className={labelClass}>Telefone</label>
            <input value={telefone} onChange={e => setTelefone(maskPhone(e.target.value))}
              placeholder="(11) 99999-9999" type="tel" maxLength={15} className={inputClass}/>
          </div>
          <div>
            <label className={labelClass}>E-mail</label>
            <input value={email} onChange={e => setEmail(e.target.value)}
              placeholder="email@exemplo.com" type="email" className={inputClass}/>
            <p className="text-xs text-text-3 mt-1.5 leading-snug">Trocar o e-mail troca também o login dela no app.</p>
            {erro && erroEmail && <p className="text-red text-xs mt-1.5">{erro}</p>}
          </div>
          <div>
            <label className={labelClass}>Comissão por atendimento (%)</label>
            <div className="relative">
              <input value={comissao} onChange={e => setComissao(e.target.value)}
                inputMode="decimal" placeholder="0" min="0" max="100"
                className={`${inputClass} pr-8`}/>
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">%</span>
            </div>
          </div>
          <div>
            <label className={labelClass}>Tipo de contrato</label>
            <select value={tipoContrato} onChange={e => setTipoContrato(e.target.value as 'pj' | 'clt' | '')}
              className={inputClass}>
              <option value="">Sem informar</option>
              <option value="pj">{rotuloContrato('pj')}</option>
              <option value="clt">{rotuloContrato('clt')}</option>
            </select>
          </div>
          {erro && !erroEmail && <p className="text-red text-sm">{erro}</p>}
          <div className="flex gap-3 mt-1">
            <button type="button" onClick={onClose}
              className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
              Cancelar
            </button>
            <button type="submit" disabled={salvando || !nome.trim()}
              className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-50">
              {salvando ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Card profissional ─────────────────────────────────────────

function ProfCard({ prof, excecoes, visiveis, podeAlterarRole, podeGerenciar, onEditInfo, onToggle, onPagar, onAlterarRole }: {
  prof: Profissional;
  /** Números que a pessoa logada pode ver (`numerosVisiveis`): sem a chave, "—" em vez de zeros falsos. */
  visiveis: { producao: boolean; comissao: boolean };
  /** Quantidade de exceções individuais de permissão desta pessoa. */
  excecoes: number;
  podeAlterarRole: boolean;
  /** Editar dados/comissão e ativar/desativar — mesma regra da policy de UPDATE de empresa_membros. */
  podeGerenciar: boolean;
  onEditInfo: () => void;
  onToggle: () => void;
  onPagar: () => void;
  onAlterarRole: () => void;
}) {
  const [expandido, setExpandido] = useState(false);
  const [pagando,   setPagando]   = useState(false);
  // O UPDATE de `comissoes` no banco exige `comissoes.pagar`.
  const podePagar = usePermissoes().pode('comissoes.pagar');

  let hue = 0;
  for (let i = 0; i < prof.user.nome.length; i++) hue = (hue * 31 + prof.user.nome.charCodeAt(i)) % 360;

  const temPendente = visiveis.comissao && prof.comissao_pendente > 0;
  const pagandoRef = useRef(false);

  async function handlePagar() {
    // Ref (não só estado): dois cliques no mesmo frame nunca disparam dois pagamentos.
    if (pagandoRef.current) return;
    pagandoRef.current = true;
    setPagando(true);
    try { await onPagar(); } finally { pagandoRef.current = false; setPagando(false); }
  }

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', opacity: prof.ativo ? 1 : 0.6, transition: 'opacity 0.2s' }}>

      {/* ── Cabeçalho (sempre visível, clicável para expandir) */}
      <button onClick={() => setExpandido(v => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: 20, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        {/* Avatar */}
        <div style={{ width: 48, height: 48, borderRadius: 16, background: prof.ativo ? `linear-gradient(140deg, oklch(0.55 0.16 ${hue}), oklch(0.42 0.17 ${hue}))` : 'linear-gradient(140deg, #9CA3AF, #6B7280)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 15, fontFamily: 'var(--font-sans)' }}>{iniciais(prof.user.nome)}</span>
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <p style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--color-ink)', fontFamily: 'var(--font-sans)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prof.user.nome}</p>
            {podeGerenciar && (
              <button onClick={e => { e.stopPropagation(); onEditInfo(); }} title="Editar informações"
                style={{ width: 20, height: 20, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-ink4)', background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0 }}
                className="hover:text-accent transition">
                <Edit3 size={11} strokeWidth={2}/>
              </button>
            )}
          </div>
          {prof.user.telefone && (
            <a href={`tel:${prof.user.telefone}`} onClick={e => e.stopPropagation()}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--color-ink3)', textDecoration: 'none', marginTop: 2 }}
              className="hover:text-primary transition">
              <Phone size={10} strokeWidth={2}/>{prof.user.telefone}
            </a>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 6, background: prof.ativo ? 'var(--color-green-soft)' : 'var(--color-bg)', color: prof.ativo ? 'var(--color-green)' : 'var(--color-ink4)' }}>
              {prof.ativo ? 'Ativa' : 'Inativa'}
            </span>
            <span style={{ display: 'inline-flex', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 6, background: roleBadge(prof.role).bg, color: roleBadge(prof.role).color }}>
              {roleBadge(prof.role).label}
            </span>
            {prof.role !== 'owner' && excecoes > 0 && (
              <Link href={`/configuracoes?aba=permissoes&membro=${prof.user_id}`}
                className="press inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
                <Shield size={11}/> {excecoes} {excecoes === 1 ? 'exceção' : 'exceções'}
              </Link>
            )}
            {temPendente && !expandido && (
              <span style={{ display: 'inline-flex', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 6, background: 'rgba(217,119,6,0.12)', color: '#B45309' }}>
                <Secret>{fmtBRL(prof.comissao_pendente)}</Secret> pendente no mês
              </span>
            )}
          </div>
        </div>

        {/* Chevron */}
        <ChevronDown size={16} strokeWidth={2}
          style={{ color: 'var(--color-ink4)', flexShrink: 0, transition: 'transform 0.2s', transform: expandido ? 'rotate(180deg)' : 'rotate(0deg)' }}/>
      </button>

      {/* ── Conteúdo expandido */}
      {expandido && (
        <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--color-border)' }}>

          {/* Stats do mês */}
          {prof.ativo && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14, marginTop: 16 }}>
              <div style={{ background: 'var(--color-bg)', borderRadius: 14, padding: '10px 12px', textAlign: 'center' }}>
                <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-primary)', lineHeight: 1, fontFamily: 'var(--font-sans)' }}>{visiveis.producao ? <Secret>{prof.atendimentos_mes}</Secret> : '—'}</p>
                <p style={{ fontSize: 9.5, color: 'var(--color-ink4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>Atendimentos</p>
              </div>
              <div style={{ background: 'var(--color-bg)', borderRadius: 14, padding: '10px 12px', textAlign: 'center' }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-green)', lineHeight: 1, fontFamily: 'var(--font-sans)' }}>{visiveis.producao ? <Secret>{fmtBRL(prof.total_mes)}</Secret> : '—'}</p>
                <p style={{ fontSize: 9.5, color: 'var(--color-ink4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>Faturado no mês</p>
              </div>
            </div>
          )}

          {/* Comissão % */}
          {prof.ativo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 14, background: 'var(--color-primary-soft)', marginBottom: 12 }}>
              <Percent size={14} strokeWidth={2} style={{ color: 'var(--color-primary)', flexShrink: 0 }}/>
              <span style={{ fontSize: 11.5, color: 'var(--color-ink3)', flex: 1 }}>Comissão por atendimento</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-primary)', fontFamily: 'var(--font-sans)' }}><Secret>{prof.percentual_comissao}%</Secret></span>
            </div>
          )}

          {/* Tipo de contrato */}
          {prof.tipo_contrato && (
            <div style={{ marginBottom: 12 }}>
              <span className="text-[11px] text-text-4 font-medium">
                {rotuloContrato(prof.tipo_contrato)}
              </span>
            </div>
          )}

          {/* Pagar comissão */}
          {prof.ativo && temPendente && podePagar && (
            <button onClick={handlePagar} disabled={pagando}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 40, borderRadius: 14, fontSize: 12, fontWeight: 700, cursor: pagando ? 'default' : 'pointer', transition: 'all 0.15s', border: 'none', background: pagando ? 'var(--color-bg2)' : '#B45309', color: pagando ? 'var(--color-ink4)' : '#fff', fontFamily: 'var(--font-sans)', marginBottom: 10, opacity: pagando ? 0.7 : 1 }}>
              <CheckCircle2 size={14} strokeWidth={2.5}/>
              {pagando ? 'Registrando...' : <>Pagar <Secret>{fmtBRL(prof.comissao_pendente)}</Secret> do mês</>}
            </button>
          )}

          {prof.ativo && visiveis.comissao && prof.comissao_pendente_anterior > 0 && (
            <Link href="/comissoes" style={{ display: 'block', fontSize: 11, color: '#B45309', marginBottom: 10, fontFamily: 'var(--font-sans)' }}>
              + <Secret>{fmtBRL(prof.comissao_pendente_anterior)}</Secret> de meses anteriores — pague em Comissões
            </Link>
          )}

          {/* Comissão em dia */}
          {/* Sem comissoes.ver_todas a RLS esconde as comissões da colega: nunca "Comissão em dia" falso. */}
          {prof.ativo && !visiveis.comissao && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 14, background: 'var(--color-bg)', marginBottom: 12, fontSize: 11.5, color: 'var(--color-ink3)', fontWeight: 600 }}>
              Comissão pendente: —
            </div>
          )}

          {prof.ativo && visiveis.comissao && !temPendente && prof.comissao_pendente_anterior === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 14, background: 'var(--color-green-soft)', marginBottom: 12, fontSize: 11.5, color: 'var(--color-green)', fontWeight: 600 }}>
              <CheckCircle2 size={13} strokeWidth={2.5}/>
              Comissão em dia
            </div>
          )}

          {/* Ativar / desativar */}
          {podeGerenciar && (
          <button onClick={onToggle}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 36, borderRadius: 14, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', border: prof.ativo ? '1px solid rgba(201,82,127,0.3)' : '1px solid rgba(21,122,91,0.3)', background: 'transparent', color: prof.ativo ? 'var(--color-rose)' : 'var(--color-green)', fontFamily: 'var(--font-sans)' }}
            className={prof.ativo ? 'hover:bg-red-soft' : 'hover:bg-green-soft'}>
            {prof.ativo
              ? <><PowerOff size={13} strokeWidth={2}/> Desativar profissional</>
              : <><Power     size={13} strokeWidth={2}/> Reativar profissional</>
            }
          </button>
          )}

          {/* Promover / rebaixar */}
          {podeAlterarRole && prof.role !== 'owner' && (
            <button onClick={onAlterarRole}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 36, borderRadius: 14, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-ink3)', fontFamily: 'var(--font-sans)', marginTop: 8 }}>
              <UserCog size={13} strokeWidth={2}/>
              {prof.role === 'gestor' ? 'Rebaixar para profissional' : 'Promover a gestora'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tela principal ────────────────────────────────────────────

/** Seção "Convites pendentes": convidadas que ainda não aceitaram (conta existente, sem vínculo). */
function ConvitesPendentesSecao({ convites, podeCancelar, onCancelar }: {
  convites: ConvitePendente[];
  /** Convite de gestora só a dona cancela. */
  podeCancelar: (c: ConvitePendente) => boolean;
  onCancelar: (c: ConvitePendente) => void;
}) {
  return (
    <section className="mb-6">
      <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, color: 'var(--color-ink4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
        Convites pendentes ({convites.length})
      </p>
      <div className="flex flex-col gap-2">
        {convites.map(c => (
          <div key={c.id} className="flex items-center gap-3 rounded-2xl px-4 py-3"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text truncate">{c.nome || c.email}</p>
              <p className="text-xs text-text-3 truncate">
                {c.email} · {rotuloPapelEquipe(c.role)} · {quandoHistoricoEquipe(c.criado_em)}
              </p>
            </div>
            {podeCancelar(c) && (
              <button type="button" onClick={() => onCancelar(c)}
                className="shrink-0 h-9 px-3 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
                Cancelar
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Aba "Histórico": convites, desativações e mudanças de papel, comissão e contrato, paginada. */
function HistoricoEquipePainel({ linhas, profs, carregando, erro, temMais, onMais, onTentar }: {
  linhas: LinhaHistoricoEquipe[];
  profs: Profissional[];
  carregando: boolean;
  erro: string;
  temMais: boolean;
  onMais: () => void;
  onTentar: () => void;
}) {
  const nomes: Record<string, string> = {};
  for (const p of profs) if (p.user.nome) nomes[p.user_id] = p.user.nome;
  return (
    <div>
      {erro && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm" style={{ background: 'var(--color-rose-soft)', color: 'var(--color-rose)' }}>
          <span>{erro}</span>
          <button onClick={onTentar} className="font-bold underline shrink-0">Tentar de novo</button>
        </div>
      )}
      {carregando && linhas.length === 0 ? (
        <div className="flex flex-col gap-2">{[1,2,3,4].map(i => <Sk key={i} className="h-14 rounded-2xl"/>)}</div>
      ) : linhas.length === 0 && !erro ? (
        <p className="text-center py-12 text-sm text-text-3">Nada no histórico ainda.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {linhas.map(l => (
            <div key={l.id} className="rounded-2xl px-4 py-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <p className="text-sm text-text">{descreverHistoricoEquipe(l, nomes)}</p>
              <p className="text-xs text-text-3 mt-0.5">{quandoHistoricoEquipe(l.criado_em)}</p>
            </div>
          ))}
        </div>
      )}
      {temMais && (
        <button type="button" disabled={carregando} onClick={onMais}
          className="mt-4 w-full h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition disabled:opacity-50">
          {carregando ? 'Carregando...' : 'Mostrar mais'}
        </button>
      )}
    </div>
  );
}

export default function EquipePage() {
  const [profs,     setProfs]     = useState<Profissional[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [modal,          setModal]          = useState(false);
  const [editandoInfo,   setEditandoInfo]   = useState<Profissional | null>(null);
  const [confirmDesativar, setConfirmDesativar] = useState<Profissional | null>(null);
  const [meuUserId, setMeuUserId] = useState<string | null>(null);
  const [meuRole,   setMeuRole]   = useState<'owner' | 'gestor' | 'profissional'>('profissional');
  const [toast,     setToast]     = useState('');
  const [erroCarga, setErroCarga] = useState('');
  const [erroAcao,  setErroAcao]  = useState('');
  const reqRef = useRef(0);
  const [aba, setAba] = useState<'equipe' | 'historico'>('equipe');
  const [convites, setConvites] = useState<ConvitePendente[]>([]);
  const [cancelando, setCancelando] = useState<ConvitePendente | null>(null);
  const [cancelandoOcupado, setCancelandoOcupado] = useState(false);
  const cancelandoRef = useRef(false);
  const [historico, setHistorico] = useState<LinhaHistoricoEquipe[]>([]);
  const [histPagina, setHistPagina] = useState(0);
  const [histTemMais, setHistTemMais] = useState(false);
  const [histDisponivel, setHistDisponivel] = useState(true);
  const [histCarregando, setHistCarregando] = useState(false);
  const [histErro, setHistErro] = useState('');
  const histReq = useRef(0);
  const [cfgPerms,  setCfgPerms]  = useState<ConfigPermissoes>(configVazia());
  const { isOwner, papel, pode } = usePermissoes();
  // O selo leva à aba Permissões, que só dona/gestora enxergam (igual ao app).
  const veSeloExcecoes = isOwner || papel === 'gestor';
  const podeEquipe = pode('equipe.gerenciar');
  /** Convites pendentes e histórico: `equipe.gerenciar`; o histórico também é da dona. */
  const veConvites = podeEquipe;
  const veHistorico = (podeEquipe || isOwner) && histDisponivel;

  /** Uma página do histórico (0 = recarrega do início); só a última requisição aplica o resultado. */
  async function carregarHistorico(empId: string, pagina: number) {
    const minha = ++histReq.current;
    setHistCarregando(true); setHistErro('');
    try {
      const r = await carregarHistoricoEquipe(supabase, empId, pagina);
      if (minha !== histReq.current) return;
      setHistDisponivel(r.disponivel);
      setHistPagina(pagina);
      setHistTemMais(r.temMais);
      setHistorico(prev => pagina === 0 ? r.linhas : [...prev, ...r.linhas]);
    } catch (e) {
      if (minha !== histReq.current) return;
      setHistErro(e instanceof Error ? e.message : 'Não foi possível carregar o histórico.');
    }
    if (minha === histReq.current) setHistCarregando(false);
  }

  async function carregarConvites(empId: string) {
    try { setConvites(await carregarConvitesPendentes(supabase, empId)); }
    catch (e) { setErroAcao(e instanceof Error ? e.message : 'Não foi possível carregar os convites pendentes.'); }
  }

  async function confirmarCancelarConvite() {
    const c = cancelando;
    if (!c || !empresaId || cancelandoRef.current) return;
    cancelandoRef.current = true;
    setCancelandoOcupado(true);
    try {
      await cancelarConvite(supabase, empresaId, c.id);
      setErroAcao('');
      setConvites(prev => prev.filter(x => x.id !== c.id));
      if (veHistorico) carregarHistorico(empresaId, 0);
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Não foi possível cancelar o convite.');
      await carregarConvites(empresaId);
    }
    cancelandoRef.current = false;
    setCancelandoOcupado(false);
    setCancelando(null);
  }

  function onConvitePendente(convite: ConvitePendente | null, mensagem: string) {
    setModal(false);
    showToast(mensagem);
    if (!empresaId) return;
    if (convite) setConvites(prev => [convite, ...prev.filter(c => c.id !== convite.id)]);
    else carregarConvites(empresaId);
    if (veHistorico) carregarHistorico(empresaId, 0);
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 4000); }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: membro } = await supabase.from('empresa_membros').select('empresa_id, role')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (!membro) { setLoading(false); return; }
      setEmpresaId(membro.empresa_id);
      setMeuUserId(user.id);
      setMeuRole(membro.role as 'owner' | 'gestor' | 'profissional');
      await recarregar(membro.empresa_id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Carrega a equipe do mês atual (Brasília); só a última requisição aplica o resultado. */
  async function recarregar(empId: string) {
    const minha = ++reqRef.current;
    setLoading(true);
    setErroCarga('');
    try {
      const [lista, cfg] = await Promise.all([
        carregarEquipe(supabase, empId, chaveMesBRT(new Date())),
        // Se a migration 083 ainda não rodou, a Equipe segue funcionando sem o selo.
        carregarConfigPermissoes(supabase, empId).catch(() => configVazia()),
      ]);
      if (minha !== reqRef.current) return;
      setProfs(lista);
      setCfgPerms(cfg);
    } catch (e) {
      if (minha !== reqRef.current) return;
      setErroCarga(e instanceof Error ? e.message : 'Não foi possível carregar a equipe.');
    }
    if (minha === reqRef.current) setLoading(false);
    if (minha === reqRef.current && veConvites) carregarConvites(empId);
    if (minha === reqRef.current && (podeEquipe || isOwner)) carregarHistorico(empId, 0);
  }

  /** Grava ativo/inativo; a lista local só muda depois do sucesso. */
  async function gravarAtivo(prof: Profissional, ativo: boolean): Promise<boolean> {
    if (!empresaId) return false;
    try {
      await alterarAtivo(supabase, empresaId, prof.id, ativo);
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Não foi possível salvar.');
      return false;
    }
    setErroAcao('');
    setProfs(prev => prev.map(p => p.id === prof.id ? { ...p, ativo } : p));
    return true;
  }

  async function toggleAtivo(prof: Profissional) {
    if (prof.ativo) {
      setConfirmDesativar(prof);
      return;
    }
    await gravarAtivo(prof, true);
  }

  async function confirmarDesativar() {
    if (!confirmDesativar) return;
    await gravarAtivo(confirmDesativar, false);
    setConfirmDesativar(null);
  }

  async function alterarRole(prof: Profissional) {
    if (!empresaId || prof.role === 'owner') return;
    const novoRole = prof.role === 'gestor' ? 'profissional' : 'gestor';
    try {
      await alterarPapel(supabase, empresaId, prof.id, novoRole);
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Não foi possível trocar o papel.');
      return;
    }
    setErroAcao('');
    setProfs(prev => prev.map(p => p.id === prof.id ? { ...p, role: novoRole } : p));
  }

  /** Salvamento parcial: atualiza só nome/contato (e e-mail, se o login trocou) na lista e no modal aberto. */
  function salvarParcial(prof: Profissional, d: { nome: string; telefone: string; email: string | null }) {
    const atualiza = (p: Profissional): Profissional => ({
      ...p, user: { ...p.user, nome: d.nome, telefone: d.telefone || null, email: d.email ?? p.user.email },
    });
    setProfs(prev => prev.map(p => p.id === prof.id ? atualiza(p) : p));
    setEditandoInfo(p => p && p.id === prof.id ? atualiza(p) : p);
  }

  function salvarInfo(prof: Profissional, dados: { nome: string; telefone: string; email: string; comissao: number; tipoContrato: TipoContrato | null }) {
    setProfs(prev => prev.map(p =>
      p.id === prof.id ? {
        ...p,
        percentual_comissao: dados.comissao,
        tipo_contrato: dados.tipoContrato,
        user: { ...p.user, nome: dados.nome, telefone: dados.telefone || null, email: dados.email || null },
      } : p
    ));
    setEditandoInfo(null);
  }

  /** Pagar = só as pendentes do MÊS ATUAL (decisão do dono); as anteriores ficam para a tela Comissões. */
  async function pagarComissoesDoMes(prof: Profissional) {
    if (!empresaId || prof.ids_pendentes_mes.length === 0) return;
    const r = await pagarComissoes(supabase, empresaId, prof.ids_pendentes_mes);
    if (r.naoConfirmados.length > 0) {
      setErroAcao(r.erro ? `Erro ao registrar o pagamento: ${r.erro}` : MENSAGEM_PAGAMENTO_PARCIAL);
    }
    await recarregar(empresaId);
  }

  /** Readicionar quem já estava na lista mantém os números dela (faturado, pendentes) em vez de zerar. */
  function onProfSalva(nova: Profissional, mensagem?: string) {
    setProfs(prev => {
      const existe = prev.find(p => p.id === nova.id);
      if (!existe) return [...prev, nova];
      return prev.map(p => p.id === nova.id ? {
        ...nova,
        total_mes: existe.total_mes, atendimentos_mes: existe.atendimentos_mes,
        comissao_pendente: existe.comissao_pendente, comissao_pendente_anterior: existe.comissao_pendente_anterior,
        ids_pendentes_mes: existe.ids_pendentes_mes,
      } : p);
    });
    setModal(false);
    if (mensagem) showToast(mensagem);
  }

  const ativos   = profs.filter(p => p.ativo).length;
  const inativos = profs.length - ativos;
  const mesChave = chaveMesBRT(new Date());
  const mes      = rotuloMesAno(mesChave);

  return (
    <div className="bm-page">
      {/* Toast de feedback */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-green text-white px-5 py-3 rounded-2xl shadow-lg font-semibold text-sm pointer-events-none">
          <CheckCircle2 size={16} strokeWidth={2.5}/> {toast}
        </div>
      )}

      {erroCarga && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm" style={{ background: 'var(--color-rose-soft)', color: 'var(--color-rose)' }}>
          <span>{erroCarga}</span>
          <button onClick={() => empresaId && recarregar(empresaId)} className="font-bold underline shrink-0">Tentar de novo</button>
        </div>
      )}
      {erroAcao && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm" style={{ background: 'var(--color-rose-soft)', color: 'var(--color-rose)' }}>
          <span>{erroAcao}</span>
          <button onClick={() => setErroAcao('')} aria-label="Fechar aviso" className="shrink-0"><X size={14}/></button>
        </div>
      )}

      {/* Header Bellamore */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6 bm-mobile-page-header">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>Gestão</p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>Equipe</h1>
          <PrivacyToggle />
        </div>
        <div className="flex gap-2 pt-1 bm-mobile-page-actions">
          <ExportButton
            variant="mobileHeader"
            className="bm-mobile-header-export"
            definicao={definicaoEquipe(mesChave)}
            getLinhas={() => profs.map(p => {
              const v = numerosVisiveis(meuUserId, p.user_id, pode);
              return { nome: p.user.nome, telefone: p.user.telefone ?? null, percentual: p.percentual_comissao,
                atendimentosMes: v.producao ? p.atendimentos_mes : null, totalMes: v.producao ? p.total_mes : null, ativo: p.ativo };
            })}
          />
          <button onClick={() => setModal(true)} className="press flex items-center gap-2 px-4 h-10 rounded-2xl text-white text-sm font-bold"
            style={{ background: 'var(--color-primary)', boxShadow: '0 6px 20px rgba(44,23,80,0.18)', fontFamily: 'var(--font-sans)' }}>
            <Plus size={15} strokeWidth={2.5}/> Nova profissional
          </button>
        </div>
      </div>

      {veHistorico && (
        <SmoothTabs variant="underline" className="mb-5" active={aba} onChange={k => setAba(k as 'equipe' | 'historico')}
          tabs={[{ key: 'equipe', label: 'Equipe' }, { key: 'historico', label: 'Histórico' }]}/>
      )}

      {aba === 'historico' && veHistorico ? (
        <HistoricoEquipePainel
          linhas={historico} profs={profs} carregando={histCarregando} erro={histErro} temMais={histTemMais}
          onMais={() => empresaId && carregarHistorico(empresaId, histPagina + 1)}
          onTentar={() => empresaId && carregarHistorico(empresaId, 0)}/>
      ) : (<>
      {veConvites && convites.length > 0 && (
        <ConvitesPendentesSecao convites={convites} podeCancelar={(c) => podeCancelarConvite(c.role, isOwner)} onCancelar={setCancelando}/>
      )}

      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
          {[1,2,3].map(i => (
            <div key={i} className="rounded-2xl p-4 flex items-center gap-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <Sk className="w-10 h-10 rounded-2xl flex-shrink-0"/>
              <div className="flex flex-col gap-2"><Sk className="h-6 w-10"/><Sk className="h-3 w-16"/></div>
            </div>
          ))}
        </div>
      ) : erroCarga && profs.length === 0 ? null : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total',    value: profs.length, color: 'var(--color-primary)', bg: 'var(--color-primary-soft)' },
            { label: 'Ativas',   value: ativos,       color: 'var(--color-green)',   bg: 'var(--color-green-soft)' },
            { label: 'Inativas', value: inativos,     color: 'var(--color-ink3)',    bg: 'var(--color-bg2)' },
          ].map(({ label, value, color, bg }, i) => (
            <div key={label} className="bm-stagger rounded-2xl p-4 flex items-center gap-3"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)', '--bm-i': i, '--bm-step': '55ms' } as React.CSSProperties}>
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
                <UserCog size={18} style={{ color }} strokeWidth={1.8}/>
              </div>
              <div>
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: 22, fontWeight: 700, lineHeight: 1, color }}>{value}</p>
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-ink3)', marginTop: 2 }}>{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-3 mb-4"><Sk className="w-12 h-12 rounded-xl flex-shrink-0"/><div className="flex-1 flex flex-col gap-2"><Sk className="h-4 w-28"/><Sk className="h-3 w-20"/></div></div>
              <div className="grid grid-cols-2 gap-2 mb-3"><Sk className="h-16 rounded-xl"/><Sk className="h-16 rounded-xl"/></div>
              <Sk className="h-11 rounded-xl"/>
            </div>
          ))}
        </div>
      ) : erroCarga && profs.length === 0 ? null : profs.length === 0 ? (
        <div className="text-center py-16 rounded-2xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <UserCog size={32} style={{ margin: '0 auto 12px', color: 'var(--color-ink4)' }} strokeWidth={1.5}/>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--color-ink3)', marginBottom: 12 }}>Nenhuma profissional na equipe ainda.</p>
          <button onClick={() => setModal(true)} style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, color: 'var(--color-accent)' }}>
            + Adicionar primeira profissional
          </button>
        </div>
      ) : (
        <>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, color: 'var(--color-ink4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }} className="capitalize">
            {mes} · {ativos} {ativos === 1 ? 'profissional ativa' : 'profissionais ativas'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {profs.map((p, i) => (
              <div key={p.id} className="bm-stagger"
                style={{ '--bm-i': i, '--bm-step': '60ms' } as React.CSSProperties}>
                <ProfCard
                  prof={p}
                  excecoes={veSeloExcecoes ? contarExcecoes(cfgPerms, p.user_id) : 0}
                  visiveis={numerosVisiveis(meuUserId, p.user_id, pode)}
                  podeAlterarRole={meuRole === 'owner' && p.user_id !== meuUserId}
                  podeGerenciar={podeGerenciarMembro({ isOwner, userId: meuUserId ?? '' }, podeEquipe, { role: p.role, userId: p.user_id })}
                  onEditInfo={() => setEditandoInfo(p)}
                  onToggle={() => toggleAtivo(p)}
                  onPagar={() => pagarComissoesDoMes(p)}
                  onAlterarRole={() => alterarRole(p)}
                />
              </div>
            ))}
          </div>
        </>
      )}

      </>)}

      {modal && empresaId && (
        <NovoProfModal empresaId={empresaId} isOwner={isOwner} onClose={() => setModal(false)} onSalvo={onProfSalva}
          onConvitePendente={onConvitePendente}/>
      )}

      <ConfirmDialog
        open={!!cancelando}
        title="Cancelar convite"
        message={`O convite para "${cancelando?.nome || cancelando?.email}" será cancelado e ela não poderá mais aceitá-lo.`}
        confirmLabel="Cancelar convite"
        variant="warning"
        loading={cancelandoOcupado}
        onConfirm={confirmarCancelarConvite}
        onCancel={() => { if (!cancelandoRef.current) setCancelando(null); }}
      />

      {editandoInfo && empresaId && (
        <EditInfoModal
          prof={editandoInfo}
          empresaId={empresaId}
          onClose={() => setEditandoInfo(null)}
          onSalvo={dados => salvarInfo(editandoInfo, dados)}
          onParcial={dados => salvarParcial(editandoInfo, dados)}/>
      )}

      <ConfirmDialog
        open={!!confirmDesativar}
        title="Desativar profissional"
        message={`"${confirmDesativar?.user.nome}" não aparecerá em novos agendamentos. Esta ação pode ser desfeita reativando o perfil.`}
        confirmLabel="Desativar"
        variant="warning"
        onConfirm={confirmarDesativar}
        onCancel={() => setConfirmDesativar(null)}
      />

    </div>
  );
}
