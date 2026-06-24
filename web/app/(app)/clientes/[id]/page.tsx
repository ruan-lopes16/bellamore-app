'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, Phone, Mail, Calendar, Edit3, Trash2, ShieldCheck, MapPin, X, Clock, CheckCircle2, XCircle, AlertCircle, ShoppingBag, MessageCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Cliente } from '@/types';
import { format, differenceInYears, addMinutes, parseISO } from 'date-fns';
import { maskPhone, toWhatsApp } from '@/lib/masks';
import { ptBR } from 'date-fns/locale';
import { Sk } from '@/components/Skeleton';
import { SearchSelect } from '@/components/SearchSelect';
import { ConfirmDialog } from '@/components/ConfirmDialog';

const supabase = createClient();

type Endereco = { logradouro: string; numero: string; bairro: string; complemento: string };

function iniciais(nome: string) {
  return nome.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

function parseEndereco(raw?: string): Endereco {
  if (!raw) return { logradouro: '', numero: '', bairro: '', complemento: '' };
  try {
    const p = JSON.parse(raw);
    if (p.logradouro !== undefined) return { complemento: '', ...p };
  } catch {}
  return { logradouro: raw, numero: '', bairro: '', complemento: '' };
}

function DisplayRow({ label, value, placeholder = '—' }: {
  label: string; value?: string; placeholder?: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-sm ${value ? 'text-text' : 'text-text-4 italic'}`}>{value || placeholder}</p>
    </div>
  );
}

// ── Tipos auxiliares ──────────────────────────────────────────

type HistAg = {
  id: string; data_hora_inicio: string; data_hora_fim: string;
  status: string; valor: number; observacao?: string;
  servico: { nome: string } | null;
  profissional: { nome: string } | null;
};

type HistVenda = {
  id: string; created_at: string; valor_final: number; observacao?: string;
  venda_itens: { quantidade: number; preco_unitario: number; produto: { nome: string } | null }[];
};

type ServicoOpt = { id: string; nome: string; preco: number; duracao_minutos: number };

// ── Modal: novo agendamento com cliente pré-selecionado ───────

const STATUS_CFG: Record<string, { label: string; bg: string; text: string; icon: React.ElementType }> = {
  agendado:   { label: 'Agendado',   bg: 'bg-amber-soft',   text: 'text-amber',   icon: Clock        },
  confirmado: { label: 'Confirmado', bg: 'bg-primary-soft', text: 'text-primary', icon: CheckCircle2 },
  concluido:  { label: 'Concluído',  bg: 'bg-green-soft',   text: 'text-green',   icon: CheckCircle2 },
  cancelado:  { label: 'Cancelado',  bg: 'bg-red-soft',     text: 'text-red',     icon: XCircle      },
  faltou:     { label: 'Faltou',     bg: 'bg-red-soft',     text: 'text-red',     icon: AlertCircle  },
};

function NovoAgModal({ empresaId, clienteId, clienteNome, onClose, onSalvo }: {
  empresaId: string; clienteId: string; clienteNome: string;
  onClose: () => void; onSalvo: () => void;
}) {
  const [profissionais, setProfissionais] = useState<{ id: string; nome: string }[]>([]);
  const [servicos,      setServicos]      = useState<ServicoOpt[]>([]);
  const [servicoId,  setServicoId]  = useState('');
  const [profId,     setProfId]     = useState('');
  const [data,       setData]       = useState(format(new Date(), 'yyyy-MM-dd'));
  const [hora,       setHora]       = useState('09:00');
  const [duracao,    setDuracao]    = useState(60);
  const [valor,      setValor]      = useState('');
  const [obs,        setObs]        = useState('');
  const [salvando,   setSalvando]   = useState(false);
  const [erro,       setErro]       = useState('');

  const inputCls = "w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";

  useEffect(() => {
    Promise.all([
      supabase.from('empresa_membros').select('user_id, user:users(id, nome)')
        .eq('empresa_id', empresaId).eq('role', 'profissional').eq('ativo', true),
      supabase.from('servicos').select('id, nome, preco, duracao_minutos')
        .eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
    ]).then(([p, s]) => {
      setProfissionais((p.data ?? []).map((m: any) => ({ id: m.user.id, nome: m.user.nome })));
      setServicos((s.data ?? []) as ServicoOpt[]);
    });
  }, [empresaId]);

  function onServicoChange(id: string) {
    setServicoId(id);
    const s = servicos.find(sv => sv.id === id);
    if (s) { setDuracao(s.duracao_minutos); setValor(String(s.preco)); }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setSalvando(true);
    const [h, m] = hora.split(':').map(Number);
    const inicio = new Date(`${data}T00:00:00`); inicio.setHours(h, m, 0, 0);
    const fim    = addMinutes(inicio, duracao);
    const { error } = await supabase.from('agendamentos').insert({
      empresa_id: empresaId, cliente_id: clienteId, profissional_id: profId,
      servico_id: servicoId, data_hora_inicio: inicio.toISOString(),
      data_hora_fim: fim.toISOString(), status: 'agendado',
      valor: parseFloat(valor) || 0, observacao: obs.trim() || null,
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo();
  }

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="font-serif text-xl text-text">Novo agendamento</h2>
            <p className="text-xs text-text-3 mt-0.5">Cliente: <span className="font-semibold text-text-2">{clienteNome}</span></p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition"><X size={16}/></button>
        </div>
        <form onSubmit={salvar} className="p-5 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Serviço</label>
            <SearchSelect
              options={servicos.map(s => ({ value: s.id, label: s.nome }))}
              value={servicoId}
              onChange={onServicoChange}
              placeholder="Buscar serviço..."
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Profissional</label>
            <SearchSelect
              options={profissionais.map(p => ({ value: p.id, label: p.nome }))}
              value={profId}
              onChange={setProfId}
              placeholder="Selecionar profissional..."
              required
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Data</label>
              <input type="date" value={data} onChange={e => setData(e.target.value)} required className={inputCls}/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Horário</label>
              <input type="time" value={hora} onChange={e => setHora(e.target.value)} required className={inputCls}/>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Duração (min)</label>
              <input type="number" value={duracao} onChange={e => setDuracao(Number(e.target.value))} min={15} step={15} required className={inputCls}/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Valor (R$)</label>
              <input type="number" value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00" step="0.01" min="0" className={inputCls}/>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Observação <span className="text-text-4 normal-case font-normal">(opcional)</span></label>
            <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2} placeholder="Notas sobre o atendimento..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition resize-none"/>
          </div>
          {erro && <p className="text-red text-sm text-center">{erro}</p>}
          <div className="flex gap-3 mt-1">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">Cancelar</button>
            <button type="submit" disabled={salvando || !servicoId || !profId} className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-60">
              {salvando ? 'Salvando...' : 'Agendar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputClass = "w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
const labelClass = "block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5";

// ── Tela ─────────────────────────────────────────────────────

export default function ClientePerfilPage() {
  const router       = useRouter();
  const { id }       = useParams<{ id: string }>();
  const searchParams = useSearchParams();

  const [cliente,  setCliente]  = useState<Cliente | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [abaAtiva, setAbaAtiva] = useState<'info' | 'historico' | 'anamnese'>(
    searchParams.get('aba') === 'anamnese' ? 'anamnese' : 'info'
  );

  // ── Info edit ──────────────────────────────────────────────
  type InfoRascunho = { nome: string; telefone: string; email: string; data_nascimento: string } & Endereco;
  const [editInfo,      setEditInfo]      = useState(false);
  const [rascunhoInfo,  setRascunhoInfo]  = useState<InfoRascunho>({
    nome: '', telefone: '', email: '', data_nascimento: '',
    logradouro: '', numero: '', bairro: '', complemento: '',
  });
  const [salvandoInfo, setSalvandoInfo] = useState(false);

  // ── Anamnese ────────────────────────────────────────────────
  type AnamneseItem = { resposta: 'sim' | 'nao' | ''; detalhe: string };
  type Anamnese = {
    alergias: AnamneseItem; problemas_saude: AnamneseItem;
    medicamentos: AnamneseItem; gravida_amamentando: AnamneseItem;
    info_adicionais: string; declaracao_aceita: boolean; salvo_em?: string;
  };
  const ITEM: AnamneseItem = { resposta: '', detalhe: '' };
  const VAZIA: Anamnese = {
    alergias: { ...ITEM }, problemas_saude: { ...ITEM },
    medicamentos: { ...ITEM }, gravida_amamentando: { ...ITEM },
    info_adicionais: '', declaracao_aceita: false,
  };
  const [anamnese,   setAnamnese]   = useState<Anamnese>(VAZIA);
  const [editAn,     setEditAn]     = useState(searchParams.get('editar') === '1' && searchParams.get('aba') === 'anamnese');
  const [rascunho,   setRascunho]   = useState<Anamnese>(VAZIA);
  const [salvandoAn, setSalvandoAn] = useState(false);

  // ── Histórico ───────────────────────────────────────────────
  const [historico,     setHistorico]     = useState<HistAg[]>([]);
  const [vendas,        setVendas]        = useState<HistVenda[]>([]);
  const [loadingHist,   setLoadingHist]   = useState(false);
  const [histCarregado, setHistCarregado] = useState(false);

  // ── Modal novo agendamento ──────────────────────────────────
  const [empresaId,       setEmpresaId]       = useState<string | null>(null);
  const [modalAg,         setModalAg]         = useState(false);
  const [confirmArquivar, setConfirmArquivar] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: clienteData } = await supabase.from('clientes').select('*').eq('id', id).single();
      setCliente(clienteData as Cliente);
      setLoading(false);
      // Busca empresa do usuário logado para o modal de agendamento
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membro } = await supabase.from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (membro) setEmpresaId(membro.empresa_id);
    })();
  }, [id]);

  useEffect(() => {
    if (!cliente) return;
    // anamnese
    try {
      const p = JSON.parse(cliente.observacoes ?? '{}');
      if (p.alergias !== undefined) {
        setAnamnese({ ...VAZIA, ...p });
        setRascunho({ ...VAZIA, ...p });
      }
    } catch {}
    // rascunho de info
    const end = parseEndereco(cliente.endereco);
    setRascunhoInfo({
      nome: cliente.nome, telefone: cliente.telefone ?? '',
      email: cliente.email ?? '', data_nascimento: cliente.data_nascimento ?? '',
      logradouro: end.logradouro, numero: end.numero,
      bairro: end.bairro, complemento: end.complemento,
    });
  }, [cliente]);

  function resetRascunhoInfo(c: Cliente) {
    const end = parseEndereco(c.endereco);
    setRascunhoInfo({
      nome: c.nome, telefone: c.telefone ?? '',
      email: c.email ?? '', data_nascimento: c.data_nascimento ?? '',
      logradouro: end.logradouro, numero: end.numero,
      bairro: end.bairro, complemento: end.complemento,
    });
  }

  async function carregarHistorico() {
    if (histCarregado) return;
    setLoadingHist(true);
    const [{ data: ags }, { data: vds }] = await Promise.all([
      supabase
        .from('agendamentos')
        .select(`id, data_hora_inicio, data_hora_fim, status, valor, observacao,
          servico:servicos(nome),
          profissional:users!agendamentos_profissional_id_fkey(nome)`)
        .eq('cliente_id', id)
        .order('data_hora_inicio', { ascending: false }),
      supabase
        .from('vendas')
        .select(`id, created_at, valor_final, observacao,
          venda_itens(quantidade, preco_unitario, produto:produtos(nome))`)
        .eq('cliente_id', id)
        .order('created_at', { ascending: false }),
    ]);
    setHistorico((ags ?? []) as unknown as HistAg[]);
    setVendas((vds ?? []) as unknown as HistVenda[]);
    setLoadingHist(false);
    setHistCarregado(true);
  }

  useEffect(() => {
    if (abaAtiva === 'historico') carregarHistorico();
  }, [abaAtiva]);

  async function salvarInfo() {
    if (!rascunhoInfo.nome.trim()) return;
    setSalvandoInfo(true);
    const temEndereco = rascunhoInfo.logradouro || rascunhoInfo.numero || rascunhoInfo.bairro;
    const enderecoJson = temEndereco
      ? JSON.stringify({
          logradouro: rascunhoInfo.logradouro,
          numero: rascunhoInfo.numero,
          bairro: rascunhoInfo.bairro,
          complemento: rascunhoInfo.complemento,
        })
      : null;
    await supabase.from('clientes').update({
      nome: rascunhoInfo.nome.trim(),
      telefone: rascunhoInfo.telefone.trim() || null,
      email: rascunhoInfo.email.trim() || null,
      data_nascimento: rascunhoInfo.data_nascimento || null,
      endereco: enderecoJson,
    }).eq('id', id);
    setCliente(prev => prev ? {
      ...prev,
      nome: rascunhoInfo.nome.trim(),
      telefone: rascunhoInfo.telefone.trim() || undefined,
      email: rascunhoInfo.email.trim() || undefined,
      data_nascimento: rascunhoInfo.data_nascimento || undefined,
      endereco: enderecoJson ?? undefined,
    } : prev);
    setSalvandoInfo(false);
    setEditInfo(false);
  }

  async function desativar() {
    setConfirmArquivar(true);
  }

  async function confirmarArquivar() {
    await supabase.from('clientes').update({ ativo: false }).eq('id', id);
    setConfirmArquivar(false);
    router.push('/clientes');
  }

  if (loading) return (
    <div>
      <Sk className="h-4 w-20 mb-4" />
      {/* Hero gradient (avatar + nome + ações + 3 KPIs) */}
      <div className="rounded-2xl p-5 mb-6"
        style={{ background: 'linear-gradient(135deg, #2C1750 0%, #4A2A86 100%)' }}>
        <div className="flex items-start gap-4 mb-5">
          <div className="w-14 h-14 rounded-2xl flex-shrink-0 bg-white/10" />
          <div className="flex-1 min-w-0 flex flex-col gap-2 pt-1">
            <div className="h-6 w-3/4 max-w-[200px] rounded bg-white/15" />
            <div className="h-3.5 w-1/2 max-w-[140px] rounded bg-white/10" />
          </div>
          <div className="w-8 h-8 rounded-[10px] bg-white/10 flex-shrink-0" />
        </div>
        {/* Action buttons */}
        <div className="flex gap-2 mb-5">
          <div className="flex-1 h-10 rounded-xl bg-white/90" />
          <div className="flex-1 h-10 rounded-xl bg-white/10" />
          <div className="flex-1 h-10 rounded-xl bg-white/10" />
        </div>
        {/* KPIs hero */}
        <div className="flex gap-2">
          {[1,2,3].map(i => (
            <div key={i} className="flex-1 rounded-[14px] p-3 bg-white/8" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div className="h-5 w-12 rounded bg-white/15 mb-1.5" />
              <div className="h-3 w-3/4 rounded bg-white/10" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* coluna principal */}
        <div className="flex-1 min-w-0 w-full">
          {/* Tabs */}
          <div className="flex gap-1 bg-surface border border-border rounded-xl p-1 mb-5 w-fit">
            {[80, 90, 80].map((w, i) => (
              <Sk key={i} className="h-8 rounded-lg" style={{ width: `${w}px` }} />
            ))}
          </div>
          {/* Bloco info */}
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <Sk className="h-4 w-32" />
              <Sk className="h-4 w-12" />
            </div>
            {[1,2,3,4].map(i => (
              <div key={i}>
                <Sk className="h-3 w-16 mb-2" />
                <Sk className="h-4 w-full max-w-xs" />
              </div>
            ))}
          </div>
        </div>
        {/* Sidebar */}
        <div className="w-full lg:w-72 lg:flex-shrink-0 flex flex-col gap-4">
          {/* Ações rápidas */}
          <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm">
            <Sk className="h-3 w-24 mb-3" />
            <Sk className="h-9 w-full rounded-xl" />
          </div>
          {/* Informações */}
          <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex flex-col gap-3">
            <Sk className="h-3 w-24 mb-1" />
            {[1,2,3].map(i => (
              <div key={i}>
                <Sk className="h-3 w-14 mb-1.5" />
                <Sk className="h-4 w-28" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
  if (!cliente) return <div className="text-center py-16 text-text-3">Cliente não encontrado.</div>;

  const idade = cliente.data_nascimento
    ? differenceInYears(new Date(), new Date(cliente.data_nascimento + 'T00:00:00'))
    : null;

  const enderecoAtual = parseEndereco(cliente.endereco);
  const temEndereco   = !!(enderecoAtual.logradouro || enderecoAtual.bairro);

  const PERGUNTAS = [
    { key: 'alergias'            as const, label: 'Possui alguma alergia?',       ph: 'Ex: látex, parabenos...'      },
    { key: 'problemas_saude'     as const, label: 'Tem algum problema de saúde?', ph: 'Ex: hipertensão, diabetes...' },
    { key: 'medicamentos'        as const, label: 'Faz uso de medicamentos?',     ph: 'Ex: anticoagulantes...'       },
    { key: 'gravida_amamentando' as const, label: 'Está grávida ou amamentando?', ph: 'Informações adicionais...'    },
  ];

  return (
    <div>
      {/* Hero plum */}
      {(() => {
        let hue = 0;
        for (let i = 0; i < cliente.nome.length; i++) hue = (hue * 31 + cliente.nome.charCodeAt(i)) % 360;
        const totalVisitas = historico.length;
        const totalGasto = historico.reduce((s, a) => s + (a.valor ?? 0), 0);
        const ticketMedio = totalVisitas > 0 ? totalGasto / totalVisitas : 0;
        return (
          <div style={{ background: 'linear-gradient(135deg, #2C1750 0%, #4A2A86 100%)', borderRadius: 24, padding: '28px 28px 20px', marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
            <button onClick={() => router.push('/clientes')}
              className="press flex items-center gap-1.5 mb-5"
              style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)' }}>
              <ChevronLeft size={15} strokeWidth={2}/> Clientes
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              <div style={{ width: 64, height: 64, borderRadius: 64 * 0.32, flexShrink: 0, background: `linear-gradient(140deg, oklch(0.55 0.16 ${hue}), oklch(0.42 0.17 ${hue}))`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 22, boxShadow: '0 0 0 3px rgba(255,255,255,0.15), 0 0 0 7px rgba(139,92,240,0.2)' }}>
                {iniciais(cliente.nome)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(20px, 5vw, 26px)', fontWeight: 600, color: '#fff', lineHeight: 1.1 }}>{cliente.nome}</h1>
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
                  Cliente desde {format(new Date(cliente.created_at), "MMMM 'de' yyyy", { locale: ptBR })}
                  {idade !== null && ` · ${idade} anos`}
                </p>
                {cliente.telefone && (
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12.5, color: 'rgba(255,255,255,0.7)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Phone size={12} strokeWidth={2}/>{cliente.telefone}
                  </p>
                )}
              </div>
              <button onClick={desativar}
                className="press"
                style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', border: 'none', flexShrink: 0 }}>
                <Trash2 size={14} strokeWidth={2}/>
              </button>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <button onClick={() => setModalAg(true)} className="press"
                style={{ flex: 1, height: 38, borderRadius: 12, background: '#fff', color: 'var(--color-primary)', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: 'none' }}>
                <Calendar size={14} strokeWidth={2.5}/>Agendar
              </button>
              {cliente.telefone && (
                <a href={`https://wa.me/${toWhatsApp(cliente.telefone)}`} target="_blank" rel="noopener noreferrer" className="press"
                  style={{ flex: 1, height: 38, borderRadius: 12, background: 'rgba(255,255,255,0.12)', color: '#fff', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1px solid rgba(255,255,255,0.1)', textDecoration: 'none' }}>
                  <MessageCircle size={14} strokeWidth={2.5}/>WhatsApp
                </a>
              )}
              {cliente.telefone && (
                <a href={`tel:${cliente.telefone}`} className="press"
                  style={{ flex: 1, height: 38, borderRadius: 12, background: 'rgba(255,255,255,0.12)', color: '#fff', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1px solid rgba(255,255,255,0.1)', textDecoration: 'none' }}>
                  <Phone size={14} strokeWidth={2.5}/>Ligar
                </a>
              )}
            </div>

            {/* KPIs */}
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { label: 'Visitas', value: String(totalVisitas) },
                { label: 'Total gasto', value: `R$ ${totalGasto.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}` },
                { label: 'Ticket médio', value: `R$ ${ticketMedio.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}` },
              ].map((kpi, i) => (
                <div key={kpi.label} className="bm-stagger"
                  style={{ flex: 1, background: 'rgba(255,255,255,0.08)', borderRadius: 14, padding: '12px 14px', '--bm-i': i, '--bm-step': '55ms' } as React.CSSProperties}>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 18, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{kpi.value}</p>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, color: 'rgba(255,255,255,0.45)', marginTop: 4, fontWeight: 600 }}>{kpi.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* ── Coluna esquerda ── */}
        <div className="flex-1 min-w-0 w-full">

          {/* Abas */}
          <div className="flex gap-1 bg-surface border border-border rounded-xl p-1 mb-5 w-fit">
            {([
              { key: 'info',      label: 'Informações' },
              { key: 'historico', label: 'Histórico'   },
              { key: 'anamnese',  label: 'Anamnese'    },
            ] as const).map(({ key, label }) => (
              <button key={key} onClick={() => setAbaAtiva(key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
                  abaAtiva === key ? 'bg-primary text-white' : 'text-text-3 hover:text-text-2'
                }`}>{label}</button>
            ))}
          </div>

          {/* Aba: Informações */}
          {abaAtiva === 'info' && (
            <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <p className="font-semibold text-text text-sm">Dados cadastrais</p>
                {!editInfo && (
                  <button onClick={() => setEditInfo(true)}
                    className="flex items-center gap-1.5 text-xs text-accent font-semibold hover:underline">
                    <Edit3 size={12}/> Editar
                  </button>
                )}
              </div>

              <div className="p-5 flex flex-col gap-5">
                {editInfo ? (
                  <>
                    <div>
                      <label className={labelClass}>Nome completo *</label>
                      <input value={rascunhoInfo.nome}
                        onChange={e => setRascunhoInfo(r => ({ ...r, nome: e.target.value }))}
                        placeholder="Nome completo" className={inputClass}/>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass}>Telefone</label>
                        <input value={rascunhoInfo.telefone} type="tel"
                          onChange={e => setRascunhoInfo(r => ({ ...r, telefone: maskPhone(e.target.value) }))}
                          placeholder="(11) 99999-9999" maxLength={15} className={inputClass}/>
                      </div>
                      <div>
                        <label className={labelClass}>Data de nascimento</label>
                        <input value={rascunhoInfo.data_nascimento} type="date"
                          onChange={e => setRascunhoInfo(r => ({ ...r, data_nascimento: e.target.value }))}
                          className={inputClass}/>
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>E-mail</label>
                      <input value={rascunhoInfo.email} type="email"
                        onChange={e => setRascunhoInfo(r => ({ ...r, email: e.target.value }))}
                        placeholder="opcional" className={inputClass}/>
                    </div>

                    <div className="border-t border-border pt-5">
                      <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                        <MapPin size={12} strokeWidth={2}/> Endereço
                      </p>
                      <div className="flex flex-col gap-3">
                        <div>
                          <label className={labelClass}>Logradouro</label>
                          <input value={rascunhoInfo.logradouro}
                            onChange={e => setRascunhoInfo(r => ({ ...r, logradouro: e.target.value }))}
                            placeholder="Rua, avenida, estrada..." className={inputClass}/>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className={labelClass}>Número</label>
                            <input value={rascunhoInfo.numero}
                              onChange={e => setRascunhoInfo(r => ({ ...r, numero: e.target.value }))}
                              placeholder="Ex: 123" className={inputClass}/>
                          </div>
                          <div>
                            <label className={labelClass}>Bairro</label>
                            <input value={rascunhoInfo.bairro}
                              onChange={e => setRascunhoInfo(r => ({ ...r, bairro: e.target.value }))}
                              placeholder="Ex: Centro" className={inputClass}/>
                          </div>
                        </div>
                        <div>
                          <label className={labelClass}>
                            Complemento{' '}
                            <span className="text-text-4 normal-case font-normal">(opcional)</span>
                          </label>
                          <input value={rascunhoInfo.complemento}
                            onChange={e => setRascunhoInfo(r => ({ ...r, complemento: e.target.value }))}
                            placeholder="Ap. 12, Bloco B..." className={inputClass}/>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-3 pt-1">
                      <button onClick={() => { resetRascunhoInfo(cliente); setEditInfo(false); }}
                        className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
                        Cancelar
                      </button>
                      <button onClick={salvarInfo} disabled={salvandoInfo || !rascunhoInfo.nome.trim()}
                        className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-60">
                        {salvandoInfo ? 'Salvando...' : 'Salvar'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <DisplayRow label="Nome completo" value={cliente.nome}/>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <DisplayRow label="Telefone" value={cliente.telefone} placeholder="Não informado"/>
                      <DisplayRow label="Data de nascimento"
                        value={cliente.data_nascimento
                          ? format(new Date(cliente.data_nascimento + 'T00:00:00'), 'dd/MM/yyyy')
                          : undefined}
                        placeholder="Não informada"/>
                    </div>
                    <DisplayRow label="E-mail" value={cliente.email} placeholder="Não informado"/>

                    <div className="border-t border-border pt-5">
                      <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                        <MapPin size={12} strokeWidth={2}/> Endereço
                      </p>
                      {temEndereco ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                          <DisplayRow label="Logradouro" value={enderecoAtual.logradouro}/>
                          <DisplayRow label="Número" value={enderecoAtual.numero} placeholder="—"/>
                          <DisplayRow label="Bairro" value={enderecoAtual.bairro}/>
                          {enderecoAtual.complemento && (
                            <DisplayRow label="Complemento" value={enderecoAtual.complemento}/>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-text-4 italic">Não informado</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Aba: Histórico */}
          {abaAtiva === 'historico' && (
            <div className="flex flex-col gap-5">
            <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <p className="font-semibold text-text text-sm">Atendimentos</p>
                {!loadingHist && (
                  <span className="text-xs text-text-4">{historico.length} {historico.length === 1 ? 'atendimento' : 'atendimentos'}</span>
                )}
              </div>

              {loadingHist ? (
                <div className="p-4 flex flex-col gap-3">
                  {[1,2,3].map(i => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-bg border border-border">
                      <Sk className="w-10 h-10 rounded-xl flex-shrink-0"/>
                      <div className="flex-1 flex flex-col gap-2">
                        <Sk className="h-3.5 w-32"/><Sk className="h-3 w-20"/>
                      </div>
                      <Sk className="h-5 w-20 rounded-lg"/>
                    </div>
                  ))}
                </div>
              ) : historico.length === 0 ? (
                <div className="text-center py-10 text-text-4 text-sm">
                  <Calendar size={24} className="mx-auto mb-3 text-text-4" strokeWidth={1.5}/>
                  Nenhum atendimento registrado ainda.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {historico.map(ag => {
                    const cfg = STATUS_CFG[ag.status] ?? STATUS_CFG.agendado;
                    const Icon = cfg.icon;
                    const dataFmt = format(parseISO(ag.data_hora_inicio), "dd/MM/yyyy 'às' HH:mm");
                    const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);
                    return (
                      <div key={ag.id} className="flex items-start gap-3 px-5 py-4 hover:bg-bg transition">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
                          <Icon size={14} strokeWidth={2} className={cfg.text}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-text truncate">
                            {(ag.servico as any)?.nome ?? '—'}
                          </p>
                          <p className="text-xs text-text-3 mt-0.5">{dataFmt}</p>
                          {ag.profissional && (
                            <p className="text-xs text-text-4 mt-0.5">
                              Com {(ag.profissional as any)?.nome?.split(' ')[0]}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                          <span className="text-xs font-bold text-text-2">{fmtBRL(ag.valor)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Vendas avulsas ── */}
            <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <p className="font-semibold text-text text-sm">Vendas avulsas</p>
                {!loadingHist && (
                  <span className="text-xs text-text-4">{vendas.length} {vendas.length === 1 ? 'venda' : 'vendas'}</span>
                )}
              </div>

              {loadingHist ? (
                <div className="p-4 flex flex-col gap-3">
                  {[1,2].map(i => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-bg border border-border">
                      <Sk className="w-9 h-9 rounded-xl flex-shrink-0"/>
                      <div className="flex-1 flex flex-col gap-2">
                        <Sk className="h-3.5 w-40"/><Sk className="h-3 w-24"/>
                      </div>
                      <Sk className="h-5 w-16 rounded-lg"/>
                    </div>
                  ))}
                </div>
              ) : vendas.length === 0 ? (
                <div className="text-center py-10 text-text-4 text-sm">
                  <ShoppingBag size={24} className="mx-auto mb-3 text-text-4" strokeWidth={1.5}/>
                  Nenhuma venda avulsa registrada.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {vendas.map(v => {
                    const fmtBRL = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(n);
                    const dataFmt = format(parseISO(v.created_at), "dd/MM/yyyy 'às' HH:mm");
                    const itensDesc = v.venda_itens
                      .map(vi => `${vi.quantidade}× ${(vi.produto as any)?.nome ?? '—'}`)
                      .join(', ');
                    return (
                      <div key={v.id} className="flex items-start gap-3 px-5 py-4 hover:bg-bg transition">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-accent-soft">
                          <ShoppingBag size={14} strokeWidth={2} className="text-accent"/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-text truncate">
                            {itensDesc || 'Venda avulsa'}
                          </p>
                          <p className="text-xs text-text-3 mt-0.5">{dataFmt}</p>
                          {v.observacao && (
                            <p className="text-xs text-text-4 mt-0.5 truncate">{v.observacao}</p>
                          )}
                        </div>
                        <span className="text-xs font-bold text-text-2 flex-shrink-0">{fmtBRL(v.valor_final)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            </div>
          )}

          {/* Aba: Anamnese */}
          {abaAtiva === 'anamnese' && (
            <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div>
                  <p className="font-semibold text-text text-sm">Ficha de anamnese</p>
                  {anamnese.salvo_em && (
                    <p className="text-xs text-text-4 mt-0.5">
                      Preenchida em {format(new Date(anamnese.salvo_em), 'dd/MM/yyyy')}
                    </p>
                  )}
                </div>
                {!editAn && (
                  <button onClick={() => { setRascunho({ ...anamnese }); setEditAn(true); }}
                    className="flex items-center gap-1.5 text-xs text-accent font-semibold hover:underline">
                    <Edit3 size={12}/> Editar
                  </button>
                )}
              </div>

              <div className="p-5 flex flex-col gap-5">
                {editAn ? (
                  <>
                    {PERGUNTAS.map(({ key, label, ph }) => (
                      <div key={key} className="flex flex-col gap-2">
                        <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide">{label}</label>
                        <div className="flex gap-2">
                          {(['sim', 'nao'] as const).map(v => (
                            <button key={v} type="button"
                              onClick={() => setRascunho(r => ({ ...r, [key]: { ...r[key], resposta: v } }))}
                              className={`px-5 py-1.5 rounded-lg text-sm font-medium border transition ${
                                rascunho[key].resposta === v
                                  ? v === 'sim' ? 'bg-red-soft border-red/30 text-red' : 'bg-green-soft border-green/30 text-green'
                                  : 'bg-bg border-border text-text-3 hover:border-accent'
                              }`}>
                              {v === 'sim' ? 'Sim' : 'Não'}
                            </button>
                          ))}
                        </div>
                        {rascunho[key].resposta === 'sim' && (
                          <textarea value={rascunho[key].detalhe}
                            onChange={e => setRascunho(r => ({ ...r, [key]: { ...r[key], detalhe: e.target.value } }))}
                            rows={2} placeholder={ph}
                            className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition resize-none"/>
                        )}
                      </div>
                    ))}

                    <div>
                      <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Informações adicionais</label>
                      <textarea value={rascunho.info_adicionais}
                        onChange={e => setRascunho(r => ({ ...r, info_adicionais: e.target.value }))}
                        rows={3} placeholder="Outras informações relevantes..."
                        className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition resize-none"/>
                    </div>

                    <div className="bg-primary-soft border border-primary/10 rounded-xl p-4">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input type="checkbox" checked={rascunho.declaracao_aceita}
                          onChange={e => setRascunho(r => ({ ...r, declaracao_aceita: e.target.checked }))}
                          className="mt-0.5 accent-primary flex-shrink-0 w-4 h-4"/>
                        <span className="text-xs text-text-2 leading-relaxed">
                          Declaro que as informações acima são verdadeiras e autorizo seu uso para fins da realização do procedimento estético.
                        </span>
                      </label>
                    </div>

                    <div className="flex gap-3">
                      <button onClick={() => setEditAn(false)}
                        className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
                        Cancelar
                      </button>
                      <button disabled={salvandoAn || !rascunho.declaracao_aceita}
                        title={!rascunho.declaracao_aceita ? 'Cliente precisa aceitar a declaração antes de salvar' : undefined}
                        onClick={async () => {
                          setSalvandoAn(true);
                          const dados = { ...rascunho, salvo_em: new Date().toISOString() };
                          await supabase.from('clientes').update({ observacoes: JSON.stringify(dados) }).eq('id', id);
                          setCliente(prev => prev ? { ...prev, observacoes: JSON.stringify(dados) } : prev);
                          setAnamnese(dados);
                          setSalvandoAn(false);
                          setEditAn(false);
                        }}
                        className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-60">
                        {salvandoAn ? 'Salvando...' : 'Salvar ficha'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {PERGUNTAS.map(({ key, label }) => {
                      const item = anamnese[key];
                      return (
                        <div key={key} className="flex flex-col gap-1">
                          <p className="text-xs font-semibold text-text-3 uppercase tracking-wide">{label}</p>
                          {item.resposta === '' ? (
                            <p className="text-sm text-text-4 italic">Não respondido</p>
                          ) : (
                            <>
                              <span className={`text-sm font-semibold w-fit px-2.5 py-0.5 rounded-lg ${
                                item.resposta === 'sim' ? 'bg-red-soft text-red' : 'bg-green-soft text-green'
                              }`}>
                                {item.resposta === 'sim' ? 'Sim' : 'Não'}
                              </span>
                              {item.resposta === 'sim' && item.detalhe && (
                                <p className="text-sm text-text-2 leading-relaxed mt-0.5">{item.detalhe}</p>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}

                    {anamnese.info_adicionais && (
                      <div>
                        <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-1">Informações adicionais</p>
                        <p className="text-sm text-text-2 leading-relaxed">{anamnese.info_adicionais}</p>
                      </div>
                    )}

                    <div className={`flex items-start gap-3 rounded-xl p-4 border ${
                      anamnese.declaracao_aceita ? 'bg-green-soft border-green/20' : 'bg-bg border-border'
                    }`}>
                      <ShieldCheck size={16} className={`flex-shrink-0 mt-0.5 ${anamnese.declaracao_aceita ? 'text-green' : 'text-text-4'}`} strokeWidth={2}/>
                      <div>
                        <p className="text-xs leading-relaxed text-text-2">
                          Declaro que as informações acima são verdadeiras e autorizo seu uso para fins da realização do procedimento estético.
                        </p>
                        <p className={`text-xs mt-1 font-semibold ${anamnese.declaracao_aceita ? 'text-green' : 'text-text-4'}`}>
                          {anamnese.declaracao_aceita ? '✓ Declaração aceita' : 'Declaração não aceita'}
                        </p>
                      </div>
                    </div>

                    {!anamnese.salvo_em && (
                      <button onClick={() => { setRascunho({ ...anamnese }); setEditAn(true); }}
                        className="text-accent text-sm font-semibold hover:underline self-start">
                        + Preencher ficha
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

        </div>{/* fim col esquerda */}

        {/* ── Coluna direita ── */}
        <div className="w-full lg:w-72 lg:flex-shrink-0 flex flex-col gap-4">

          {/* Ações rápidas */}
          <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm">
            <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-3">Ações rápidas</p>
            <button
              onClick={() => setModalAg(true)}
              className="w-full h-9 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition flex items-center justify-center gap-2">
              <Calendar size={14} strokeWidth={2}/> Novo agendamento
            </button>
          </div>

          {/* Resumo */}
          <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm">
            <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-3">Informações</p>
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-xs text-text-4 mb-0.5">Cadastrado em</p>
                <p className="text-sm font-medium text-text-2">{format(new Date(cliente.created_at), 'dd/MM/yyyy')}</p>
              </div>
              {cliente.data_nascimento && (
                <div>
                  <p className="text-xs text-text-4 mb-0.5">Nascimento</p>
                  <p className="text-sm font-medium text-text-2">
                    {format(new Date(cliente.data_nascimento + 'T00:00:00'), 'dd/MM/yyyy')}
                    {idade !== null && <span className="text-text-4 ml-1">({idade} anos)</span>}
                  </p>
                </div>
              )}
              {cliente.telefone && (
                <div>
                  <p className="text-xs text-text-4 mb-0.5">Telefone</p>
                  <a href={`tel:${cliente.telefone}`} className="text-sm font-medium text-primary hover:underline">{cliente.telefone}</a>
                </div>
              )}
              {cliente.email && (
                <div>
                  <p className="text-xs text-text-4 mb-0.5">E-mail</p>
                  <a href={`mailto:${cliente.email}`} className="text-sm font-medium text-primary hover:underline truncate block">{cliente.email}</a>
                </div>
              )}
              {temEndereco && (
                <div>
                  <p className="text-xs text-text-4 mb-0.5">Endereço</p>
                  <p className="text-sm font-medium text-text-2 leading-snug">
                    {[enderecoAtual.logradouro, enderecoAtual.numero].filter(Boolean).join(', ')}
                    {enderecoAtual.bairro && (
                      <><br/><span className="text-text-3">{enderecoAtual.bairro}</span></>
                    )}
                    {enderecoAtual.complemento && (
                      <><br/><span className="text-text-3">{enderecoAtual.complemento}</span></>
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Status anamnese */}
          <div className={`border rounded-2xl p-4 shadow-sm ${anamnese.salvo_em ? 'bg-green-soft border-green/20' : 'bg-amber-soft border-amber/20'}`}>
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck size={14} className={anamnese.salvo_em ? 'text-green' : 'text-amber'} strokeWidth={2}/>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: anamnese.salvo_em ? '#0D7E5F' : '#B45309' }}>
                Anamnese
              </p>
            </div>
            <p className="text-xs" style={{ color: anamnese.salvo_em ? '#065F46' : '#92400E' }}>
              {anamnese.salvo_em
                ? `Preenchida em ${format(new Date(anamnese.salvo_em), 'dd/MM/yyyy')}`
                : 'Ficha ainda não preenchida'}
            </p>
            {!anamnese.salvo_em && (
              <button onClick={() => { setAbaAtiva('anamnese'); setRascunho({ ...anamnese }); setEditAn(true); }}
                className="text-xs font-semibold text-amber mt-2 hover:underline">
                Preencher agora →
              </button>
            )}
          </div>

        </div>{/* fim col direita */}

      </div>{/* fim flex */}

      {/* Modal novo agendamento */}
      {modalAg && empresaId && cliente && (
        <NovoAgModal
          empresaId={empresaId}
          clienteId={cliente.id}
          clienteNome={cliente.nome}
          onClose={() => setModalAg(false)}
          onSalvo={() => {
            setModalAg(false);
            // Recarrega histórico se estiver na aba
            if (abaAtiva === 'historico') {
              setHistCarregado(false);
              carregarHistorico();
            }
          }}
        />
      )}

      <ConfirmDialog
        open={confirmArquivar}
        title="Arquivar cliente"
        message={`"${cliente?.nome}" será arquivado e não aparecerá nas listas. O histórico é mantido.`}
        confirmLabel="Arquivar"
        variant="danger"
        onConfirm={confirmarArquivar}
        onCancel={() => setConfirmArquivar(false)}
      />
    </div>
  );
}
