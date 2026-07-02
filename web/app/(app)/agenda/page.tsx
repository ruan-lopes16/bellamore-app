'use client';

/**
 * @file agenda/page.tsx
 * Agenda interativa com visão semanal e mensal.
 *
 * ## Componentes internos
 * - `AgCard`        — card de agendamento com dropdown de status
 * - `NovoAgModal`   — modal de criação/edição de agendamento
 * - `ListaDia`      — lista de agendamentos do dia selecionado
 * - `MesView`       — calendário mensal com dots indicadores
 *
 * ## Otimistic UI
 * Mudanças de status são aplicadas na UI antes da confirmação do banco.
 * Se o banco retornar erro, o estado é revertido e um alert é exibido.
 *
 * ## Busca de dados
 * - `fetchDia()`: busca agendamentos do dia selecionado (dispara a cada mudança de data)
 * - `fetchMes()`: busca contagem por dia para o calendário mensal (só quando view = 'mes')
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  format, addDays, addMonths, subMonths,
  startOfDay, endOfDay, startOfMonth, endOfMonth,
  startOfWeek, eachDayOfInterval,
  isSameDay, isSameMonth, isToday, addMinutes, parseISO, isPast,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ChevronLeft, ChevronRight, Plus, Clock, User, X,
  CalendarPlus, AlertTriangle, Pencil, Star, Ban, Trash2,
} from 'lucide-react';
import { ExportButton } from '@/components/ExportButton';
import { createClient } from '@/lib/supabase/client';
import { Sk } from '@/components/Skeleton';
import { SearchSelect } from '@/components/SearchSelect';

const supabase = createClient();

// ── Tipos ─────────────────────────────────────────────────────

type AgServico = { servico_id: string; servico: { id: string; nome: string } | null; valor: number; duracao_minutos: number; ordem: number };
type Ag = {
  id: string; data_hora_inicio: string; data_hora_fim: string;
  status: string; valor: number; observacao?: string;
  pacote_cliente_id?: string | null;
  cliente: { id: string; nome: string; telefone?: string } | null;
  profissional: { id: string; nome: string } | null;
  servico: { id: string; nome: string; duracao_minutos: number } | null;
  agendamento_servicos: AgServico[];
};
type PacoteClienteOpt = { id: string; nome: string; restantes: number | null };
type ClienteOpt = { id: string; nome: string; telefone?: string };
type Servico    = { id: string; nome: string; preco: number; duracao_minutos: number };
type Bloqueio   = {
  id: string;
  profissional_id: string | null;
  titulo: string;
  data_inicio: string;
  data_fim: string;
};

const STATUS: Record<string, { label: string; bg: string; text: string; bdr: string }> = {
  agendado:   { label: 'Agendado',   bg: 'bg-amber-soft',   text: 'text-amber',   bdr: 'rgba(166,90,27,0.35)'   },
  confirmado: { label: 'Confirmado', bg: 'bg-primary-soft', text: 'text-primary', bdr: 'rgba(44,23,80,0.25)'    },
  concluido:  { label: 'Concluído',  bg: 'bg-green-soft',   text: 'text-green',   bdr: 'rgba(21,122,91,0.35)'   },
  cancelado:  { label: 'Cancelado',  bg: 'bg-red-soft',     text: 'text-red',     bdr: 'rgba(201,82,127,0.35)'  },
  faltou:     { label: 'Faltou',     bg: 'bg-red-soft',     text: 'text-red',     bdr: 'rgba(201,82,127,0.35)'  },
};
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function iniciais(nome?: string | null) {
  return (nome ?? '?').split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}
function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);
}

// ── Card de agendamento ───────────────────────────────────────

const STATUS_OPCOES = [
  { key: 'agendado',   label: 'Agendado',   cor: 'text-amber'   },
  { key: 'confirmado', label: 'Confirmado', cor: 'text-primary' },
  { key: 'concluido',  label: 'Concluído',  cor: 'text-green'   },
  { key: 'cancelado',  label: 'Cancelado',  cor: 'text-red'     },
  { key: 'faltou',     label: 'Faltou',     cor: 'text-red'     },
];

function AgCard({ ag, empresaId, onStatus, onEditar }: {
  ag: Ag;
  empresaId: string;
  onStatus: (id: string, s: string) => void;
  onEditar?: (ag: Ag) => void;
}) {
  const [menuAberto, setMenuAberto] = useState(false);
  const inicio = format(parseISO(ag.data_hora_inicio), 'HH:mm');
  const fim    = format(parseISO(ag.data_hora_fim), 'HH:mm');
  const st     = STATUS[ag.status] ?? { label: ag.status, bg: 'bg-bg', text: 'text-text-3' };

  function selecionarStatus(s: string) {
    setMenuAberto(false);
    if (s === ag.status) return;
    onStatus(ag.id, s);
  }

  const clienteNome = ag.cliente?.nome ?? '';
  let hue = 0;
  for (let i = 0; i < clienteNome.length; i++) hue = (hue * 31 + clienteNome.charCodeAt(i)) % 360;
  const initsAg = clienteNome.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase() || '?';

  return (
    <>
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 20, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}
      className="hover:border-accent/40 transition-colors">
      <div className="flex items-start gap-3">
        <div style={{ width: 36, height: 36, borderRadius: 12, background: `linear-gradient(140deg, oklch(0.55 0.16 ${hue}), oklch(0.42 0.17 ${hue}))`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 12, fontFamily: 'var(--font-sans)' }}>{initsAg}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <p className="font-semibold text-text text-sm truncate">{ag.cliente?.nome ?? '—'}</p>
            <div className="flex items-center gap-1 flex-shrink-0">
              {onEditar && (
                <button onClick={() => onEditar(ag)}
                  className="w-6 h-6 rounded-lg flex items-center justify-center text-text-4 hover:text-accent hover:bg-accent/10 transition">
                  <Pencil size={11} strokeWidth={2.5}/>
                </button>
              )}
              {/* Badge de status clicável */}
              <div className="relative">
              <button
                onClick={() => setMenuAberto(v => !v)}
                className={`text-xs font-semibold px-2 py-0.5 rounded-lg transition hover:opacity-80 ${st.bg} ${st.text}`}>
                {st.label} ▾
              </button>
              {menuAberto && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuAberto(false)}/>
                  <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-border rounded-xl shadow-lg py-1 min-w-[130px]">
                    {STATUS_OPCOES.map(({ key, label, cor }) => (
                      <button key={key} onClick={() => selecionarStatus(key)}
                        className={`w-full text-left px-3 py-2 text-xs font-semibold hover:bg-bg transition flex items-center gap-2 ${
                          ag.status === key ? 'opacity-40 cursor-default' : cor
                        }`}>
                        {ag.status === key && <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0"/>}
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              </div>{/* /relative (status) */}
            </div>{/* /flex gap-1 */}
          </div>{/* /justify-between */}
          <p className="text-text-3 text-xs mb-1.5 truncate">
            {(ag.agendamento_servicos ?? []).length > 0
              ? [...(ag.agendamento_servicos ?? [])].sort((a, b) => a.ordem - b.ordem).map(s => s.servico?.nome).filter(Boolean).join(' + ')
              : ag.servico?.nome ?? '—'}
          </p>
          {ag.observacao && (
            <p className="text-xs text-text-4 italic mb-1.5 truncate">{ag.observacao}</p>
          )}
          <div className="flex items-center gap-3 text-xs text-text-3">
            <span className="flex items-center gap-1"><Clock size={10} strokeWidth={2}/>{inicio}–{fim}</span>
            {ag.profissional && <span className="flex items-center gap-1"><User size={10} strokeWidth={2}/>{ag.profissional.nome.split(' ')[0]}</span>}
            <span className="ml-auto font-semibold text-text-2">{fmtBRL(ag.valor)}</span>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

// ── Modal de novo agendamento ─────────────────────────────────

type ServicoLinha = { uid: string; servico_id: string; duracao: number; valor: number };
type ConflitoDet  = { inicio: string; fim: string; cliente: string; servico: string };

function NovoAgModal({
  data, empresaId, onClose, onSalvo, agEditar, horaInicial, profIdInicial,
}: {
  data: Date; empresaId: string;
  onClose: () => void; onSalvo: () => void;
  agEditar?: Ag;
  horaInicial?: string;
  profIdInicial?: string;
}) {
  const [clientes,      setClientes]      = useState<ClienteOpt[]>([]);
  const [profissionais, setProfissionais] = useState<{ id: string; nome: string }[]>([]);
  const [servicos,      setServicos]      = useState<Servico[]>([]);

  const [dataSel,   setDataSel]   = useState(() => agEditar ? parseISO(agEditar.data_hora_inicio) : data);
  const [clienteId, setClienteId] = useState(() => agEditar?.cliente?.id ?? '');
  const [profId,    setProfId]    = useState(() => agEditar?.profissional?.id ?? (profIdInicial ?? ''));
  const [hora,      setHora]      = useState(() => agEditar ? format(parseISO(agEditar.data_hora_inicio), 'HH:mm') : (horaInicial ?? '09:00'));
  const [obs,       setObs]       = useState(() => agEditar?.observacao ?? '');
  const [salvando,  setSalvando]  = useState(false);
  const [erro,      setErro]      = useState('');

  // Pacote do cliente a consumir neste agendamento (opcional)
  const [pacotesCliente,  setPacotesCliente]  = useState<PacoteClienteOpt[]>([]);
  const [pacoteClienteId, setPacoteClienteId] = useState(() => agEditar?.pacote_cliente_id ?? '');

  const [linhas, setLinhas] = useState<ServicoLinha[]>(() => {
    if (agEditar && (agEditar.agendamento_servicos ?? []).length > 0) {
      return [...(agEditar.agendamento_servicos ?? [])]
        .sort((a, b) => a.ordem - b.ordem)
        .map(s => ({ uid: crypto.randomUUID(), servico_id: s.servico_id, duracao: s.duracao_minutos, valor: s.valor }));
    }
    return [{ uid: crypto.randomUUID(), servico_id: '', duracao: 60, valor: 0 }];
  });

  // Conflito de horário detectado
  const [conflitos,  setConflitos]  = useState<ConflitoDet[]>([]);
  const [pendInicio, setPendInicio] = useState<Date | null>(null);
  const [pendFim,    setPendFim]    = useState<Date | null>(null);

  const totalDuracao = linhas.reduce((s, l) => s + (l.duracao || 0), 0);
  const totalValor   = linhas.reduce((s, l) => s + (l.valor  || 0), 0);

  useEffect(() => {
    Promise.all([
      supabase.from('clientes').select('id, nome, telefone')
        .eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      supabase.from('empresa_membros').select('user_id, user:users(id, nome)')
        .eq('empresa_id', empresaId).in('role', ['owner', 'gestor', 'profissional']).eq('ativo', true),
      supabase.from('servicos').select('id, nome, preco, duracao_minutos')
        .eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
    ]).then(([c, p, s]) => {
      setClientes((c.data ?? []) as ClienteOpt[]);
      setProfissionais((p.data ?? []).map((m: any) => ({ id: m.user.id, nome: m.user.nome })));
      setServicos((s.data ?? []) as Servico[]);
    });
  }, [empresaId]);

  // Pacotes ativos do cliente selecionado (para vincular ao agendamento)
  useEffect(() => {
    if (!clienteId) { setPacotesCliente([]); return; }
    supabase.from('pacote_clientes')
      .select('id, data_validade, pacote:pacotes(nome, controla_sessoes, servicos:pacote_servicos(quantidade)), uso:pacote_uso(id)')
      .eq('empresa_id', empresaId)
      .eq('cliente_id', clienteId)
      .eq('status', 'ativo')
      .then((res: { data: any[] | null }) => {
        const opts = ((res.data ?? []) as any[])
          .filter(pc => (pc.pacote?.controla_sessoes ?? true) && (!pc.data_validade || !isPast(parseISO(pc.data_validade))))
          .map(pc => {
            const servicosPac = (pc.pacote?.servicos ?? []) as { quantidade: number | null }[];
            const ilimitado = servicosPac.some(s => s.quantidade == null);
            const total = ilimitado ? null : servicosPac.reduce((s, x) => s + (x.quantidade ?? 0), 0);
            const restantes = total != null ? total - (pc.uso ?? []).length : null;
            return { id: pc.id, nome: pc.pacote?.nome ?? 'Pacote', restantes };
          })
          .filter(p => p.restantes === null || p.restantes > 0);
        setPacotesCliente(opts);
        setPacoteClienteId(prev => opts.some(o => o.id === prev) ? prev : '');
      });
  }, [empresaId, clienteId]);

  function onServicoChange(uid: string, id: string) {
    const s = servicos.find(x => x.id === id);
    setLinhas(prev => prev.map(l =>
      l.uid === uid
        ? { ...l, servico_id: id, duracao: s?.duracao_minutos ?? 60, valor: s?.preco ?? 0 }
        : l
    ));
  }

  function addLinha() {
    setLinhas(prev => [...prev, { uid: crypto.randomUUID(), servico_id: '', duracao: 60, valor: 0 }]);
  }

  function removeLinha(uid: string) {
    setLinhas(prev => prev.length > 1 ? prev.filter(l => l.uid !== uid) : prev);
  }

  async function executarSalvar(inicio: Date, fim: Date) {
    setSalvando(true);
    const filled = linhas.filter(l => l.servico_id);
    let agId = '';

    if (agEditar) {
      const { error } = await supabase.from('agendamentos').update({
        cliente_id:        clienteId,
        profissional_id:   profId,
        servico_id:        filled[0]?.servico_id ?? null,
        data_hora_inicio:  inicio.toISOString(),
        data_hora_fim:     fim.toISOString(),
        valor:             filled.reduce((s, l) => s + l.valor, 0),
        observacao:        obs.trim() || null,
        pacote_cliente_id: pacoteClienteId || null,
      }).eq('id', agEditar.id);
      if (error) { setSalvando(false); setErro(error.message); return; }
      await supabase.from('agendamento_servicos').delete().eq('agendamento_id', agEditar.id);
      agId = agEditar.id;
    } else {
      const { data: ag, error } = await supabase.from('agendamentos').insert({
        empresa_id:        empresaId,
        cliente_id:        clienteId,
        profissional_id:   profId,
        servico_id:        filled[0].servico_id,
        data_hora_inicio:  inicio.toISOString(),
        data_hora_fim:     fim.toISOString(),
        status:            'agendado',
        valor:             filled.reduce((s, l) => s + l.valor, 0),
        observacao:        obs.trim() || null,
        pacote_cliente_id: pacoteClienteId || null,
      }).select().single();
      if (error || !ag) { setSalvando(false); setErro(error?.message ?? 'Erro'); return; }
      agId = ag.id;
    }

    await supabase.from('agendamento_servicos').insert(
      filled.map((l, i) => ({
        agendamento_id:  agId,
        servico_id:      l.servico_id,
        valor:           l.valor,
        duracao_minutos: l.duracao,
        ordem:           i,
        empresa_id:      empresaId,
      }))
    );
    setSalvando(false);
    onSalvo();
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setConflitos([]);
    const filled = linhas.filter(l => l.servico_id);
    if (!clienteId || filled.length === 0 || !profId) {
      setErro('Preencha cliente, pelo menos um serviço e profissional.');
      return;
    }
    const [h, m] = hora.split(':').map(Number);
    const inicio = new Date(dataSel); inicio.setHours(h, m, 0, 0);
    const fim    = addMinutes(inicio, totalDuracao || 60);

    let confQuery = supabase
      .from('agendamentos')
      .select(`id,data_hora_inicio,data_hora_fim,
        cliente:clientes!agendamentos_cliente_id_fkey(nome),
        servico:servicos(nome)`)
      .eq('empresa_id', empresaId)
      .eq('profissional_id', profId)
      .not('status', 'in', '("cancelado","faltou")')
      .lt('data_hora_inicio', fim.toISOString())
      .gt('data_hora_fim', inicio.toISOString());
    if (agEditar) confQuery = confQuery.neq('id', agEditar.id);
    const { data: conf } = await confQuery;

    if (conf && conf.length > 0) {
      setPendInicio(inicio);
      setPendFim(fim);
      setConflitos(conf.map((c: any) => ({
        inicio:  format(parseISO(c.data_hora_inicio), 'HH:mm'),
        fim:     format(parseISO(c.data_hora_fim),    'HH:mm'),
        cliente: c.cliente?.nome ?? '—',
        servico: c.servico?.nome  ?? '—',
      })));
      return;
    }
    await executarSalvar(inicio, fim);
  }

  const inputClass = "w-full h-10 px-3 rounded-xl border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
  const clienteOpts = clientes.map(c => ({ value: c.id, label: c.nome, sub: c.telefone }));
  const profOpts    = profissionais.map(p => ({ value: p.id, label: p.nome }));
  const servicoOpts = servicos.map(s => ({ value: s.id, label: s.nome }));

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="font-serif text-xl text-text">{agEditar ? 'Editar agendamento' : 'Novo agendamento'}</h2>
            <p className="text-text-3 text-xs mt-0.5 capitalize">
              {format(dataSel, "EEEE, dd 'de' MMMM", { locale: ptBR })}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
            <X size={16} />
          </button>
        </div>

        {/* Aviso de conflito de horário */}
        {conflitos.length > 0 && (
          <div className="mx-5 mt-5 rounded-2xl overflow-hidden border border-amber/30" style={{ background: 'var(--color-amber-soft)' }}>
            <div className="flex items-center gap-2 px-4 pt-4 pb-2">
              <AlertTriangle size={15} className="text-amber flex-shrink-0" strokeWidth={2.5}/>
              <p className="text-sm font-bold text-amber">Conflito de horário</p>
            </div>
            <p className="text-xs text-text-2 px-4 pb-2">Este profissional já tem agendamento(s) nesse intervalo:</p>
            <div className="px-4 pb-3 flex flex-col gap-1">
              {conflitos.map((c, i) => (
                <p key={i} className="text-xs text-text-2">• {c.inicio}–{c.fim} · {c.cliente} ({c.servico})</p>
              ))}
            </div>
            <div className="flex gap-2 px-4 pb-4">
              <button type="button" onClick={() => setConflitos([])}
                className="flex-1 h-9 rounded-xl border border-border text-xs font-semibold text-text-2 hover:bg-bg transition bg-surface">
                Cancelar
              </button>
              <button type="button" disabled={salvando}
                onClick={() => pendInicio && pendFim && executarSalvar(pendInicio, pendFim)}
                className="flex-1 h-9 rounded-xl text-white text-xs font-bold transition disabled:opacity-60"
                style={{ background: 'var(--color-amber)' }}>
                {salvando ? 'Salvando...' : agEditar ? 'Salvar assim mesmo' : 'Agendar mesmo assim'}
              </button>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={salvar} className="p-5 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Cliente</label>
            <SearchSelect options={clienteOpts} value={clienteId} onChange={setClienteId} placeholder="Buscar cliente..." required />
          </div>

          {clienteId && pacotesCliente.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">
                Pacote <span className="text-text-4 normal-case font-normal">(opcional — consome 1 sessão ao concluir)</span>
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <SearchSelect
                    options={pacotesCliente.map(p => ({ value: p.id, label: p.nome, sub: p.restantes == null ? 'ilimitado' : `${p.restantes} restante${p.restantes !== 1 ? 's' : ''}` }))}
                    value={pacoteClienteId}
                    onChange={setPacoteClienteId}
                    placeholder="Pagar avulso (sem pacote)"
                  />
                </div>
                {pacoteClienteId && (
                  <button type="button" onClick={() => setPacoteClienteId('')}
                    title="Não usar pacote"
                    className="w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition">
                    <X size={13} strokeWidth={2.5}/>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Lista de serviços (multi) */}
          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Serviços</label>
            <div className="flex flex-col gap-2">
              {linhas.map((l) => (
                <div key={l.uid} className="flex flex-col gap-2 rounded-xl p-3" style={{ background: 'var(--color-bg)' }}>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <SearchSelect
                        options={servicoOpts}
                        value={l.servico_id}
                        onChange={id => onServicoChange(l.uid, id)}
                        placeholder="Buscar serviço..."
                      />
                    </div>
                    {linhas.length > 1 && (
                      <button type="button" onClick={() => removeLinha(l.uid)}
                        className="w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition">
                        <X size={13} strokeWidth={2.5}/>
                      </button>
                    )}
                  </div>
                  {l.servico_id && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] font-semibold text-text-3 uppercase tracking-wide mb-1">Duração (min)</p>
                        <input type="number" value={l.duracao} min={5} step={5}
                          onChange={e => setLinhas(prev => prev.map(x => x.uid === l.uid ? { ...x, duracao: Number(e.target.value) } : x))}
                          className={inputClass} />
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-text-3 uppercase tracking-wide mb-1">Valor (R$)</p>
                        <input type="number" value={l.valor} min={0} step={0.01} placeholder="0,00"
                          onChange={e => setLinhas(prev => prev.map(x => x.uid === l.uid ? { ...x, valor: Number(e.target.value) } : x))}
                          className={inputClass} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <button type="button" onClick={addLinha}
                className="flex items-center justify-center gap-1.5 h-9 rounded-xl border border-dashed border-border text-xs font-semibold text-text-3 hover:border-accent hover:text-accent transition">
                <Plus size={12} strokeWidth={2.5}/> Adicionar serviço
              </button>
            </div>
            {linhas.filter(l => l.servico_id).length > 1 && (
              <p className="text-xs text-text-3 mt-1.5">
                Total: {totalDuracao} min · {fmtBRL(totalValor)}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Profissional</label>
            <SearchSelect options={profOpts} value={profId} onChange={setProfId} placeholder="Selecionar profissional..." required />
          </div>

          {agEditar && (
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Data</label>
              <input type="date" value={format(dataSel, 'yyyy-MM-dd')}
                onChange={e => { if (e.target.value) setDataSel(new Date(e.target.value + 'T00:00:00')); }}
                className={inputClass} />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Horário de início</label>
            <input type="time" value={hora} onChange={e => setHora(e.target.value)} required className={inputClass} />
            {totalDuracao > 0 && (() => {
              const [h, m] = hora.split(':').map(Number);
              const fim = addMinutes(new Date(new Date(dataSel).setHours(h, m, 0, 0)), totalDuracao);
              return <p className="text-xs text-text-3 mt-1">Término previsto: {format(fim, 'HH:mm')}</p>;
            })()}
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Observação <span className="text-text-4 normal-case font-normal">(opcional)</span></label>
            <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2} placeholder="Notas sobre o atendimento..."
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition resize-none" />
          </div>

          {erro && <p className="text-red text-sm text-center">{erro}</p>}

          <div className="flex gap-3 mt-1">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">Cancelar</button>
            <button type="submit" disabled={salvando} className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-60">
              {salvando ? 'Salvando...' : agEditar ? 'Salvar alterações' : 'Agendar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Timeline do dia ───────────────────────────────────────────

/** Pixels por hora na timeline */
const TL_HOUR_H  = 72;
const TL_MIN_H   = TL_HOUR_H / 60;
const TL_H_START = 7;
const TL_H_END   = 22;
const TL_HOURS   = Array.from({ length: TL_H_END - TL_H_START + 1 }, (_, i) => TL_H_START + i);
const TL_TOTAL_H = (TL_H_END - TL_H_START) * TL_HOUR_H;

/** Posição vertical (px) de um agendamento na timeline */
function tlTop(ag: Ag): number {
  const d = parseISO(ag.data_hora_inicio);
  return ((d.getHours() - TL_H_START) * 60 + d.getMinutes()) * TL_MIN_H;
}

/** Altura (px) proporcional à duração; mínimo 26px */
function tlHeight(ag: Ag): number {
  const ms = parseISO(ag.data_hora_fim).getTime() - parseISO(ag.data_hora_inicio).getTime();
  return Math.max((ms / 60000) * TL_MIN_H, 26);
}

/** Posição vertical (px) para um ISO string de hora */
function tlTopISO(iso: string): number {
  const d = parseISO(iso);
  return Math.max(0, ((d.getHours() - TL_H_START) * 60 + d.getMinutes()) * TL_MIN_H);
}

/** Altura (px) entre dois ISO strings; mínimo 20px */
function tlHeightISO(ini: string, fim: string): number {
  const ms = parseISO(fim).getTime() - parseISO(ini).getTime();
  return Math.max((ms / 60000) * TL_MIN_H, 20);
}

/** Verifica se dois agendamentos se sobrepõem no tempo */
function sobrepoem(a: Ag, b: Ag): boolean {
  return a.data_hora_inicio < b.data_hora_fim && a.data_hora_fim > b.data_hora_inicio;
}

/**
 * Atribui lanes (faixas verticais internas) para agendamentos de uma coluna.
 * Ex: dois agendamentos simultâneos ficam em lane 0 e lane 1.
 */
function computeLanes(colAgs: Ag[]): Map<string, { lane: number; totalLanes: number }> {
  const sorted = [...colAgs].sort((a, b) =>
    a.data_hora_inicio.localeCompare(b.data_hora_inicio)
  );
  const result  = new Map<string, { lane: number; totalLanes: number }>();
  const laneEnd: string[] = []; // fim do último ag em cada lane

  for (const ag of sorted) {
    let lane = laneEnd.findIndex(end => end <= ag.data_hora_inicio);
    if (lane === -1) lane = laneEnd.length;
    laneEnd[lane] = ag.data_hora_fim;
    result.set(ag.id, { lane, totalLanes: 1 });
  }

  // Segunda passagem: ajusta totalLanes para o grupo de sobreposição
  for (const ag of sorted) {
    const group = sorted.filter(o => sobrepoem(ag, o));
    const maxLane = group.reduce((m, o) => Math.max(m, result.get(o.id)!.lane), 0);
    const tl = maxLane + 1;
    for (const o of group) {
      const entry = result.get(o.id)!;
      if (tl > entry.totalLanes) entry.totalLanes = tl;
    }
  }

  return result;
}

// ── Modal de bloqueio ─────────────────────────────────────────

function NovoBloqueioModal({ data, empresaId, profissionais, onClose, onSalvo }: {
  data: Date;
  empresaId: string;
  profissionais: { id: string; nome: string }[];
  onClose: () => void;
  onSalvo: (b: Bloqueio) => void;
}) {
  const [titulo,   setTitulo]   = useState('');
  const [profId,   setProfId]   = useState('');
  const [horaIni,  setHoraIni]  = useState('08:00');
  const [horaFim,  setHoraFim]  = useState('09:00');
  const [dataBl,   setDataBl]   = useState(format(data, 'yyyy-MM-dd'));
  const [salvando, setSalvando] = useState(false);
  const [erro,     setErro]     = useState('');

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(''); setSalvando(true);

    const dataInicio = new Date(`${dataBl}T${horaIni}:00`);
    const dataFim    = new Date(`${dataBl}T${horaFim}:00`);
    if (dataFim <= dataInicio) {
      setErro('O horário de fim deve ser após o início.'); setSalvando(false); return;
    }

    const { data: row, error } = await supabase
      .from('agenda_bloqueios')
      .insert({
        empresa_id:      empresaId,
        profissional_id: profId || null,
        titulo:          titulo.trim() || 'Bloqueio',
        data_inicio:     dataInicio.toISOString(),
        data_fim:        dataFim.toISOString(),
      })
      .select('id, profissional_id, titulo, data_inicio, data_fim')
      .single();

    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo(row as Bloqueio);
  }

  const inputCls = "w-full h-10 px-3 rounded-xl border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
  const labelCls = "block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1";

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <Ban size={16} style={{ color: 'var(--color-rose)' }} strokeWidth={2}/>
            <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: 'var(--color-ink)' }}>
              Bloquear horário
            </h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
            <X size={16}/>
          </button>
        </div>

        <form onSubmit={salvar} className="p-5 flex flex-col gap-3">
          <div>
            <label className={labelCls}>Título (opcional)</label>
            <input value={titulo} onChange={e => setTitulo(e.target.value)}
              placeholder="Ex: Folga, Reunião, Almoço..." className={inputCls}/>
          </div>

          <div>
            <label className={labelCls}>Profissional</label>
            <select value={profId} onChange={e => setProfId(e.target.value)} className={inputCls}>
              <option value="">Todos os profissionais</option>
              {profissionais.map(p => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Data</label>
            <input type="date" value={dataBl} onChange={e => setDataBl(e.target.value)} className={inputCls}/>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Início</label>
              <input type="time" value={horaIni} onChange={e => setHoraIni(e.target.value)} className={inputCls}/>
            </div>
            <div>
              <label className={labelCls}>Fim</label>
              <input type="time" value={horaFim} onChange={e => setHoraFim(e.target.value)} className={inputCls}/>
            </div>
          </div>

          {erro && <p className="text-sm" style={{ color: 'var(--color-rose)' }}>{erro}</p>}

          <div className="flex gap-3 mt-1">
            <button type="button" onClick={onClose}
              className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
              Cancelar
            </button>
            <button type="submit" disabled={salvando}
              className="flex-1 h-10 rounded-xl text-white text-sm font-bold transition disabled:opacity-60"
              style={{ background: 'var(--color-rose)' }}>
              {salvando ? 'Salvando...' : 'Bloquear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * TimelineView — Visão por hora dos agendamentos do dia.
 *
 * Exibe uma coluna por profissional. Agendamentos são blocos
 * posicionados proporcionalmente ao horário e duração.
 * Sobreposições são detectadas e exibidas lado a lado.
 * Clicar num bloco abre o AgCard no painel lateral.
 */
/** Snap Y para o horário mais próximo de 15 em 15 min e retorna "HH:mm" */
function calcHoraTimeline(y: number): string {
  const totalMins = Math.floor(y / TL_MIN_H);
  const absM = TL_H_START * 60 + totalMins;
  let h = Math.floor(absM / 60);
  let m = Math.round((absM % 60) / 15) * 15;
  if (m === 60) { m = 0; h += 1; }
  h = Math.min(Math.max(h, TL_H_START), TL_H_END - 1);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function TimelineView({
  ags, bloqueios, loading, empresaId, onStatus, dataSel, onEditar, onNovo, onDeletarBloqueio,
}: {
  ags: Ag[]; bloqueios: Bloqueio[]; loading: boolean; empresaId: string;
  onStatus: (id: string, s: string) => void;
  dataSel: Date;
  onEditar?: (ag: Ag) => void;
  onNovo: (params: { hora: string; profId: string }) => void;
  onDeletarBloqueio: (id: string) => void;
}) {
  const [agSel,     setAgSel]     = useState<Ag | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ profId: string; y: number; horaStr: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Rola até o horário atual ao montar
  useEffect(() => {
    if (!scrollRef.current) return;
    const now = new Date();
    const top = ((now.getHours() - TL_H_START) * 60 + now.getMinutes()) * TL_MIN_H;
    scrollRef.current.scrollTop = Math.max(0, top - 100);
  }, []);

  // Sincroniza agSel quando o ag sofre atualização de status (optimistic)
  useEffect(() => {
    if (!agSel) return;
    const atualizado = ags.find(a => a.id === agSel.id);
    if (atualizado) setAgSel(atualizado);
  }, [ags]);

  // Profissionais únicos do dia, mantendo ordem de aparição
  const profissionais = useMemo(() => {
    const map = new Map<string, string>();
    for (const ag of ags) {
      if (ag.profissional) map.set(ag.profissional.id, ag.profissional.nome);
    }
    return Array.from(map.entries()).map(([id, nome]) => ({ id, nome }));
  }, [ags]);

  // Agendamentos agrupados por profissional
  const agsByProf = useMemo(() => {
    const map = new Map<string, Ag[]>();
    for (const { id } of profissionais) map.set(id, []);
    for (const ag of ags) {
      const pid = ag.profissional?.id;
      if (pid) map.get(pid)?.push(ag);
    }
    return map;
  }, [ags, profissionais]);

  // Linha de "agora"
  const agora       = new Date();
  const ehHoje      = isSameDay(dataSel, agora);
  const agoraTop    = ((agora.getHours() - TL_H_START) * 60 + agora.getMinutes()) * TL_MIN_H;
  const agoraVis    = agora.getHours() >= TL_H_START && agora.getHours() < TL_H_END;

  if (loading) {
    return (
      <div className="bm-page flex flex-col gap-3">
        {[1, 2, 3].map(i => <Sk key={i} className="h-28 rounded-2xl"/>)}
      </div>
    );
  }

  if (profissionais.length === 0) {
    return (
      <div className="flex items-center gap-3 py-4 px-1 text-text-3 text-sm">
        <span>Nenhum agendamento para este dia.</span>
      </div>
    );
  }

  return (
    <div className="flex gap-4 items-start min-w-0">

      {/* ── Grid de timeline ── */}
      <div className="flex-1 border border-border rounded-2xl overflow-x-auto bg-surface min-w-0 w-full">

        {/* Cabeçalho com nomes dos profissionais */}
        <div className="flex border-b border-border bg-bg">
          <div className="w-12 flex-shrink-0 border-r border-border" />
          {profissionais.map(prof => {
            const partes = prof.nome.trim().split(/\s+/);
            const exibir = partes.length > 1
              ? `${partes[0]} ${partes[partes.length - 1][0]}.`
              : partes[0];
            return (
              <div key={prof.id}
                className="flex-1 min-w-[80px] md:min-w-[130px] border-r border-border last:border-r-0 px-2 py-3 text-center"
                title={prof.nome}>
                <p className="text-xs font-bold text-text-2 truncate leading-none">{exibir}</p>
              </div>
            );
          })}
        </div>

        {/* Área scrollável */}
        <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: '62vh' }}>
          <div className="flex">

            {/* Coluna de horas */}
            <div
              className="w-12 flex-shrink-0 border-r border-border relative bg-bg/60"
              style={{ height: TL_TOTAL_H }}>
              {TL_HOURS.map(h => (
                <div key={h}
                  style={{ top: (h - TL_H_START) * TL_HOUR_H }}
                  className="absolute inset-x-0 flex justify-center">
                  <span className="text-[10px] text-text-4 font-medium mt-0.5">
                    {String(h).padStart(2, '0')}h
                  </span>
                </div>
              ))}
            </div>

            {/* Colunas por profissional */}
            {profissionais.map(prof => {
              const colAgs  = agsByProf.get(prof.id) ?? [];
              const laneMap = computeLanes(colAgs);

              return (
                <div key={prof.id}
                  className="flex-1 min-w-[80px] md:min-w-[130px] border-r border-border last:border-r-0 relative cursor-crosshair"
                  style={{ height: TL_TOTAL_H }}
                  onClick={e => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    onNovo({ hora: calcHoraTimeline(e.clientY - rect.top), profId: prof.id });
                  }}
                  onMouseMove={e => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const y = e.clientY - rect.top;
                    setHoverInfo({ profId: prof.id, y, horaStr: calcHoraTimeline(y) });
                  }}
                  onMouseLeave={() => setHoverInfo(null)}>

                  {/* Linhas de hora */}
                  {TL_HOURS.map(h => (
                    <div key={h}
                      style={{ top: (h - TL_H_START) * TL_HOUR_H }}
                      className="absolute inset-x-0 border-t border-border/40" />
                  ))}

                  {/* Linhas de meia hora */}
                  {TL_HOURS.slice(0, -1).map(h => (
                    <div key={`${h}h30`}
                      style={{ top: (h - TL_H_START) * TL_HOUR_H + TL_HOUR_H / 2 }}
                      className="absolute inset-x-0 border-t border-dashed border-border/25" />
                  ))}

                  {/* Linha de agora */}
                  {ehHoje && agoraVis && (
                    <div style={{ top: agoraTop }}
                      className="absolute inset-x-0 z-20 pointer-events-none">
                      <div className="border-t-2 border-red">
                        <div className="w-2.5 h-2.5 rounded-full bg-red absolute -left-1.5 -top-[5px]" />
                      </div>
                    </div>
                  )}

                  {/* Hover guide */}
                  {hoverInfo?.profId === prof.id && (
                    <div className="absolute inset-x-0 pointer-events-none z-30" style={{ top: hoverInfo.y }}>
                      <div className="absolute inset-x-0 border-t border-dashed border-accent/60" />
                      <span className="absolute right-1.5 -top-4 text-[9px] font-bold text-accent bg-surface/95 px-1.5 py-0.5 rounded-md border border-accent/25 whitespace-nowrap shadow-sm">
                        {hoverInfo.horaStr}
                      </span>
                    </div>
                  )}

                  {/* Bloqueios de horário */}
                  {bloqueios
                    .filter(b => b.profissional_id === null || b.profissional_id === prof.id)
                    .map(bl => {
                      const topBl = tlTopISO(bl.data_inicio);
                      const hBl   = tlHeightISO(bl.data_inicio, bl.data_fim);
                      return (
                        <div key={bl.id}
                          className="absolute overflow-hidden z-5 flex flex-col"
                          style={{
                            top: topBl, height: hBl, left: 2, right: 2,
                            borderRadius: 5,
                            background: 'repeating-linear-gradient(-45deg, rgba(220,38,38,0.07), rgba(220,38,38,0.07) 5px, rgba(220,38,38,0.03) 5px, rgba(220,38,38,0.03) 10px)',
                            border: '1px solid rgba(220,38,38,0.22)',
                          }}>
                          <div className="flex items-center justify-between px-1.5 py-0.5 gap-1">
                            <span className="text-[9px] font-semibold truncate" style={{ color: 'var(--color-rose)' }}>
                              {bl.titulo || 'Bloqueio'}
                            </span>
                            <button
                              onClick={e => { e.stopPropagation(); onDeletarBloqueio(bl.id); }}
                              className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-rose-soft transition"
                              title="Remover bloqueio">
                              <X size={9} strokeWidth={2.5} style={{ color: 'var(--color-rose)' }}/>
                            </button>
                          </div>
                        </div>
                      );
                    })}

                  {/* Blocos de agendamento */}
                  {colAgs.map(ag => {
                    const { lane, totalLanes } = laneMap.get(ag.id) ?? { lane: 0, totalLanes: 1 };
                    const pct      = 100 / totalLanes;
                    const top      = tlTop(ag);
                    const h        = tlHeight(ag);
                    const st       = STATUS[ag.status] ?? STATUS.agendado;
                    const selecionado = agSel?.id === ag.id;

                    return (
                      <button
                        key={ag.id}
                        onClick={e => { e.stopPropagation(); setAgSel(selecionado ? null : ag); }}
                        style={{
                          top:         top + 2,
                          height:      h - 4,
                          left:        `calc(${lane * pct}% + 3px)`,
                          width:       `calc(${pct}% - 6px)`,
                          borderRadius: 5,
                          borderColor:  st.bdr,
                        }}
                        className={`absolute overflow-hidden text-left border transition-all
                          ${selecionado
                            ? 'ring-2 ring-accent shadow-lg z-10'
                            : 'hover:shadow-sm hover:brightness-95 z-0'
                          } ${st.bg}`}
                      >
                        <div className="px-1.5 py-1 h-full flex flex-col justify-start">
                          <p className={`text-[11px] font-bold leading-tight truncate ${st.text}`}>
                            {ag.cliente?.nome ?? '—'}
                          </p>
                          {h >= 38 && (
                            <p className="text-[10px] text-text-3 leading-tight truncate mt-0.5">
                              {ag.servico?.nome ?? '—'}
                            </p>
                          )}
                          {h >= 54 && (
                            <p className="text-[10px] text-text-4 leading-tight mt-0.5">
                              {format(parseISO(ag.data_hora_inicio), 'HH:mm')}–{format(parseISO(ag.data_hora_fim), 'HH:mm')}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}

          </div>
        </div>
      </div>

      {/* ── Painel lateral — detalhes do agendamento ── */}
      {agSel && (
        <>
          {/* Mobile: backdrop + bottom sheet ancorado acima do bottom nav */}
          <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setAgSel(null)} />
          <div className="md:hidden fixed left-3 right-3 z-50 bg-surface border border-border rounded-2xl shadow-xl"
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 76px)' }}>
            <div className="flex items-center justify-between p-3 border-b border-border">
              <p className="text-xs font-semibold text-text-3 uppercase tracking-widest">Detalhes</p>
              <button onClick={() => setAgSel(null)}
                className="w-7 h-7 rounded-lg hover:bg-bg flex items-center justify-center text-text-4 transition">
                <X size={14} />
              </button>
            </div>
            <div className="p-3 max-h-[50vh] overflow-y-auto">
              <AgCard ag={agSel} empresaId={empresaId}
                onStatus={(id, s) => { setAgSel(null); onStatus(id, s); }}
                onEditar={onEditar ? ag => { setAgSel(null); onEditar(ag); } : undefined}/>
            </div>
          </div>

          {/* Desktop: painel lateral */}
          <div className="hidden md:block w-72 flex-shrink-0">
            <div className="sticky top-4">
              <div className="flex items-center justify-between mb-2 px-1">
                <p className="text-xs font-semibold text-text-3 uppercase tracking-widest">Detalhes</p>
                <button onClick={() => setAgSel(null)}
                  className="w-6 h-6 rounded-lg hover:bg-surface flex items-center justify-center text-text-4 transition">
                  <X size={12} />
                </button>
              </div>
              <AgCard ag={agSel} empresaId={empresaId}
                onStatus={(id, s) => { setAgSel(null); onStatus(id, s); }}
                onEditar={onEditar ? ag => { setAgSel(null); onEditar(ag); } : undefined}/>
            </div>
          </div>
        </>
      )}

    </div>
  );
}

// ── Lista do dia ─────────────────────────────────────────────

function ListaDia({ ags, loading, dataSel, empresaId, onNovo, onStatus, onEditar }: {
  ags: Ag[]; loading: boolean; dataSel: Date; empresaId: string;
  onNovo: () => void; onStatus: (id: string, s: string) => void;
  onEditar?: (ag: Ag) => void;
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-text-2 mb-3">
        {isToday(dataSel) ? 'Hoje' : format(dataSel, "EEEE, dd 'de' MMMM", { locale: ptBR })}
        {!loading && (
          <span className="ml-2 text-text-4 font-normal">
            {ags.length} {ags.length === 1 ? 'agendamento' : 'agendamentos'}
          </span>
        )}
      </p>
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1,2,3].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-start gap-3">
              <Sk className="w-9 h-9 rounded-xl flex-shrink-0"/>
              <div className="flex-1 min-w-0 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Sk className="h-4 w-1/2 max-w-[140px]"/>
                  <Sk className="h-5 w-16 rounded-lg flex-shrink-0"/>
                </div>
                <Sk className="h-3 w-2/3 max-w-[180px]"/>
                <Sk className="h-3 w-1/3 max-w-[100px]"/>
              </div>
            </div>
          ))}
        </div>
      ) : ags.length > 0 ? (
        <div className="flex flex-col gap-3">
          {ags.map((ag, idx) => (
            <div key={ag.id} className="bm-stagger" style={{ '--bm-i': idx, '--bm-step': '60ms' } as React.CSSProperties}>
              <AgCard ag={ag} empresaId={empresaId} onStatus={onStatus} onEditar={onEditar}/>
            </div>
          ))}
          {/* Slot livre */}
          <button onClick={onNovo} className="press bm-stagger"
            style={{
              '--bm-i': ags.length, '--bm-step': '60ms',
              border: '2px dashed var(--color-border)',
              borderRadius: 20, padding: '14px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: 'transparent', width: '100%',
            } as React.CSSProperties}>
            <CalendarPlus size={16} style={{ color: 'var(--color-accent)' }} strokeWidth={2}/>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, color: 'var(--color-accent)' }}>
              Horário livre — agendar
            </span>
          </button>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 py-4 px-1 text-text-3 text-sm">
          <span>Nenhum agendamento para este dia.</span>
          <button onClick={onNovo} className="text-accent font-semibold hover:underline self-start whitespace-nowrap">+ Criar agendamento</button>
        </div>
      )}
    </div>
  );
}

// ── Visão mensal ──────────────────────────────────────────────

function MesView({
  mes, agsPorDia, diaSel, onDiaClick,
}: {
  mes: Date;
  agsPorDia: Map<string, number>;
  diaSel: Date;
  onDiaClick: (d: Date) => void;
}) {
  const gridStart = startOfWeek(startOfMonth(mes), { weekStartsOn: 0 });
  const gridEnd   = new Date(gridStart); gridEnd.setDate(gridEnd.getDate() + 41);
  const dias      = eachDayOfInterval({ start: gridStart, end: gridEnd });

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DIAS.map(d => (
          <div key={d} className="text-center text-[10px] font-semibold text-text-4 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {dias.map(d => {
          const key     = format(d, 'yyyy-MM-dd');
          const count   = agsPorDia.get(key) ?? 0;
          const selDia  = isSameDay(d, diaSel);
          const hojeDia = isToday(d);
          const dMes    = isSameMonth(d, mes);
          return (
            <div key={key} className="relative group">
              <button
                onClick={() => onDiaClick(d)}
                className={`w-full aspect-square flex items-center justify-center rounded-lg text-sm font-bold transition
                  ${selDia  ? 'bg-primary text-white'
                  : hojeDia ? 'bg-primary-soft text-primary'
                  : dMes    ? 'hover:bg-bg text-text-2'
                  :           'text-text-4 hover:bg-bg'}`}
              >
                {format(d, 'd')}
                {/* dot indicator */}
                {count > 0 && !selDia && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent" />
                )}
              </button>
              {/* tooltip no hover */}
              {count > 0 && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-10
                  opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity
                  bg-text text-white text-[10px] font-semibold px-2 py-1 rounded-lg whitespace-nowrap shadow-lg">
                  {count} {count === 1 ? 'agendamento' : 'agendamentos'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tela principal ────────────────────────────────────────────

export default function AgendaPage() {


  const [view,      setView]      = useState<'semana' | 'mes' | 'timeline'>('semana');
  const [dataSel,   setDataSel]   = useState(new Date());
  const [semana,    setSemana]    = useState(() =>
    Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(new Date(), { weekStartsOn: 0 }), i))
  );
  const [ags,        setAgs]       = useState<Ag[]>([]);
  const [bloqueios,  setBloqueios] = useState<Bloqueio[]>([]);
  const [agsMes,     setAgsMes]    = useState<Map<string, number>>(new Map());
  const [loading,    setLoading]   = useState(true);
  const [empresaId,  setEmpresaId] = useState<string | null>(null);
  const [modal,       setModal]      = useState(false);
  const [modalBloq,   setModalBloq]  = useState(false);
  const [modalParams, setModalParams] = useState<{ hora?: string; profId?: string }>({});
  const [agEditar,   setAgEditar]  = useState<Ag | null>(null);
  const [toastErro,    setToastErro]   = useState('');
  const [avaliacaoAg,  setAvaliacaoAg] = useState<{ agId: string; clienteNome: string; clienteId: string; profissionalId: string | null } | null>(null);

  function showErro(msg: string) {
    setToastErro(msg);
    setTimeout(() => setToastErro(''), 4000);
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membro } = await supabase.from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      setEmpresaId(membro?.empresa_id ?? null);
    })();
  }, []);

  // Busca agendamentos + bloqueios do dia selecionado
  const fetchDia = useCallback(async (data: Date, empId: string) => {
    setLoading(true);
    const iniDia = startOfDay(data).toISOString();
    const fimDia = endOfDay(data).toISOString();

    const [{ data: rows }, { data: blRows }] = await Promise.all([
      supabase
        .from('agendamentos')
        .select(`id,data_hora_inicio,data_hora_fim,status,valor,observacao,pacote_cliente_id,
          cliente:clientes!agendamentos_cliente_id_fkey(id,nome,telefone),
          profissional:users!agendamentos_profissional_id_fkey(id,nome),
          servico:servicos(id,nome,duracao_minutos),
          agendamento_servicos(servico_id,valor,duracao_minutos,ordem,servico:servicos(id,nome))`)
        .eq('empresa_id', empId)
        .gte('data_hora_inicio', iniDia)
        .lte('data_hora_inicio', fimDia)
        .order('data_hora_inicio'),
      supabase
        .from('agenda_bloqueios')
        .select('id, profissional_id, titulo, data_inicio, data_fim')
        .eq('empresa_id', empId)
        .lte('data_inicio', fimDia)
        .gte('data_fim',    iniDia),
    ]);

    setAgs((rows ?? []) as unknown as Ag[]);
    setBloqueios((blRows ?? []) as Bloqueio[]);
    setLoading(false);
  }, []);

  // Busca contagem por dia para visão mensal
  const fetchMes = useCallback(async (mes: Date, empId: string) => {
    const { data: rows } = await supabase
      .from('agendamentos')
      .select('data_hora_inicio')
      .eq('empresa_id', empId)
      .gte('data_hora_inicio', startOfMonth(mes).toISOString())
      .lte('data_hora_inicio', endOfMonth(mes).toISOString());
    const map = new Map<string, number>();
    ((rows ?? []) as { data_hora_inicio: string }[]).forEach(r => {
      const k = format(parseISO(r.data_hora_inicio), 'yyyy-MM-dd');
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    setAgsMes(map);
  }, []);

  useEffect(() => {
    if (!empresaId) return;
    fetchDia(dataSel, empresaId);
    if (view === 'mes') fetchMes(dataSel, empresaId);
  }, [dataSel, empresaId, view]);

  function navSemana(dir: number) {
    setSemana(s => s.map(d => addDays(d, dir * 7)));
    setDataSel(d => addDays(d, dir * 7));
  }

  function navMes(dir: number) {
    setDataSel(d => dir > 0 ? addMonths(d, 1) : subMonths(d, 1));
  }

  function selecionarDia(d: Date) {
    setDataSel(d);
    if (!semana.some(s => isSameDay(s, d)))
      setSemana(Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(d, { weekStartsOn: 0 }), i)));
  }

  async function mudarStatus(id: string, status: string) {
    // Salva o status original ANTES de atualizar (necessário para revert)
    const ag = ags.find(a => a.id === id);
    const statusOriginal = ag?.status ?? '';
    // Otimista: atualiza local imediatamente
    setAgs(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    const { error } = await supabase
      .from('agendamentos')
      .update({ status })
      .eq('id', id);
    if (error) {
      setAgs(prev => prev.map(a => a.id === id ? { ...a, status: statusOriginal } : a));
      showErro(`Erro ao salvar status: ${error.message}`);
      return;
    }
    if (status === 'concluido' && ag?.cliente) {
      setAvaliacaoAg({
        agId: id,
        clienteNome: ag.cliente.nome,
        clienteId: ag.cliente.id,
        profissionalId: ag.profissional?.id ?? null,
      });
    }
  }

  async function deletarBloqueio(id: string) {
    setBloqueios(prev => prev.filter(b => b.id !== id));
    const { error } = await supabase.from('agenda_bloqueios').delete().eq('id', id);
    if (error) {
      if (empresaId) fetchDia(dataSel, empresaId);
      showErro(`Erro ao remover bloqueio: ${error.message}`);
    }
  }

  return (
    <div className="bm-page">
      {/* Toast de erro */}
      {toastErro && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-red text-white px-5 py-3 rounded-2xl shadow-lg font-semibold text-sm pointer-events-none">
          {toastErro}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }} className="capitalize">
            {format(dataSel, 'MMMM yyyy', { locale: ptBR })}
          </p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>Agenda</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:pt-1">
          {/* Toggle view */}
          <div style={{ display: 'flex', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 14, overflow: 'hidden' }}>
            {([
              { key: 'semana',   label: 'Semana'   },
              { key: 'mes',      label: 'Mês'      },
              { key: 'timeline', label: 'Timeline' },
            ] as const).map(({ key, label }) => (
              <button key={key} onClick={() => setView(key)}
                style={view === key
                  ? { background: 'var(--color-primary)', color: '#fff', fontWeight: 700, fontFamily: 'var(--font-sans)', fontSize: 12, padding: '8px 14px' }
                  : { color: 'var(--color-ink3)', fontWeight: 600, fontFamily: 'var(--font-sans)', fontSize: 12, padding: '8px 14px' }}
                className="transition">{label}</button>
            ))}
          </div>
          <ExportButton
            filename={`agenda-${format(dataSel, 'yyyy-MM-dd')}`}
            title={`Agenda — ${format(dataSel, "dd 'de' MMMM yyyy", { locale: ptBR })}`}
            columns={[
              { header: 'Horário',      accessor: (a: Ag) => format(parseISO(a.data_hora_inicio), 'HH:mm'), width: 10 },
              { header: 'Cliente',      accessor: (a: Ag) => a.cliente?.nome ?? '—',                        width: 26 },
              { header: 'Serviço',      accessor: (a: Ag) => a.servico?.nome ?? '—',                        width: 26 },
              { header: 'Profissional', accessor: (a: Ag) => a.profissional?.nome ?? '—',                   width: 20 },
              { header: 'Valor',        accessor: (a: Ag) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(a.valor), width: 14 },
              { header: 'Status',       accessor: (a: Ag) => STATUS[a.status]?.label ?? a.status,           width: 12 },
            ]}
            getData={() => ags}
          />
          <button onClick={() => setModalBloq(true)}
            className="press flex items-center gap-2 px-3 h-10 rounded-2xl text-sm font-bold border border-border transition hover:bg-bg"
            style={{ fontFamily: 'var(--font-sans)', color: 'var(--color-rose)' }}
            title="Bloquear horário">
            <Ban size={14} strokeWidth={2}/><span className="hidden sm:inline">Bloquear</span>
          </button>
          <button onClick={() => { setModalParams({}); setModal(true); }} className="press flex items-center gap-2 px-4 h-10 rounded-2xl text-white text-sm font-bold"
            style={{ background: 'var(--color-primary)', boxShadow: '0 6px 20px rgba(44,23,80,0.18)', fontFamily: 'var(--font-sans)' }}>
            <Plus size={15} strokeWidth={2.5}/>Novo
          </button>
        </div>
      </div>

      {/* Navegador de semana — visível em Semana e Timeline */}
      {(view === 'semana' || view === 'timeline') && (
        <div className="flex justify-center mb-6">
          <div className="bg-surface border border-border rounded-[20px] py-3 px-2 sm:px-4 max-w-full overflow-x-auto">
            <div className="flex items-center gap-1 sm:gap-1.5">
              <button onClick={() => navSemana(-1)}
                className="w-8 h-8 rounded-[10px] flex items-center justify-center text-text-3 hover:bg-bg transition flex-shrink-0">
                <ChevronLeft size={16}/>
              </button>
              <div className="flex gap-0.5 sm:gap-1">
                {semana.map((d, i) => {
                  const sel = isSameDay(d, dataSel);
                  const hj  = isToday(d);
                  return (
                    <button key={d.toISOString()} onClick={() => selecionarDia(d)} className="bm-stagger press flex flex-col items-center rounded-[14px] py-2.5 w-9 sm:w-11 flex-shrink-0"
                      style={{
                        '--bm-i': i, '--bm-step': '35ms',
                        background: sel ? 'var(--color-primary)' : 'transparent',
                        transition: 'all 0.15s',
                      } as React.CSSProperties}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4, fontFamily: 'var(--font-sans)', color: sel ? 'rgba(255,255,255,0.7)' : 'var(--color-ink4)' }}>{DIAS[d.getDay()]}</span>
                      <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-sans)', color: sel ? '#fff' : hj ? 'var(--color-accent)' : 'var(--color-ink2)' }}>{format(d, 'd')}</span>
                    </button>
                  );
                })}
              </div>
              <button onClick={() => navSemana(1)}
                className="w-8 h-8 rounded-[10px] flex items-center justify-center text-text-3 hover:bg-bg transition flex-shrink-0">
                <ChevronRight size={16}/>
              </button>
            </div>
          </div>
        </div>
      )}

      {view === 'semana' ? (
        <ListaDia ags={ags} loading={loading} dataSel={dataSel} empresaId={empresaId ?? ''} onNovo={() => setModal(true)} onStatus={mudarStatus} onEditar={ag => setAgEditar(ag)}/>
      ) : view === 'timeline' ? (
        <TimelineView
          ags={ags}
          bloqueios={bloqueios}
          loading={loading}
          empresaId={empresaId ?? ''}
          onStatus={mudarStatus}
          dataSel={dataSel}
          onEditar={ag => setAgEditar(ag)}
          onNovo={({ hora, profId }) => { setModalParams({ hora, profId }); setModal(true); }}
          onDeletarBloqueio={deletarBloqueio}
        />
      ) : (
        <>
          {/* Mês: calendário centralizado + lista abaixo */}
          <div className="flex justify-center mb-6">
          <div className="bg-surface border border-border rounded-2xl p-4 sm:p-5 w-full max-w-md">
            <div className="flex items-center justify-center gap-3 mb-4">
              <button onClick={() => navMes(-1)} className="w-8 h-8 rounded-lg hover:bg-bg flex items-center justify-center text-text-3 transition">
                <ChevronLeft size={16}/>
              </button>
              <span className="text-sm font-semibold text-text-2 capitalize w-36 text-center">
                {format(dataSel, 'MMMM yyyy', { locale: ptBR })}
              </span>
              <button onClick={() => navMes(1)} className="w-8 h-8 rounded-lg hover:bg-bg flex items-center justify-center text-text-3 transition">
                <ChevronRight size={16}/>
              </button>
            </div>
            <MesView mes={dataSel} agsPorDia={agsMes} diaSel={dataSel} onDiaClick={selecionarDia}/>
          </div>
          </div>
          <ListaDia ags={ags} loading={loading} dataSel={dataSel} empresaId={empresaId ?? ''} onNovo={() => setModal(true)} onStatus={mudarStatus} onEditar={ag => setAgEditar(ag)}/>
        </>
      )}

      {/* Modal novo/editar agendamento */}
      {(modal || agEditar) && empresaId && (
        <NovoAgModal
          data={agEditar ? parseISO(agEditar.data_hora_inicio) : dataSel}
          empresaId={empresaId}
          horaInicial={modalParams.hora}
          profIdInicial={modalParams.profId}
          onClose={() => { setModal(false); setAgEditar(null); setModalParams({}); }}
          onSalvo={() => {
            setModal(false);
            setAgEditar(null);
            setModalParams({});
            fetchDia(dataSel, empresaId);
            if (view === 'mes') fetchMes(dataSel, empresaId);
          }}
          agEditar={agEditar ?? undefined}
        />
      )}

      {/* Modal de bloqueio */}
      {modalBloq && empresaId && (() => {
        const profsUnicos = Array.from(
          new Map(ags.filter(a => a.profissional).map(a => [a.profissional!.id, a.profissional!])).entries()
        ).map(([, p]) => p);
        return (
          <NovoBloqueioModal
            data={dataSel}
            empresaId={empresaId}
            profissionais={profsUnicos}
            onClose={() => setModalBloq(false)}
            onSalvo={b => {
              setBloqueios(prev => [...prev, b]);
              setModalBloq(false);
            }}
          />
        );
      })()}

      {/* Modal de avaliação pós-atendimento */}
      {avaliacaoAg && empresaId && (
        <AvaliacaoModal
          clienteNome={avaliacaoAg.clienteNome}
          onClose={() => setAvaliacaoAg(null)}
          onSalvar={async (nota, comentario) => {
            await supabase.from('avaliacoes').insert({
              empresa_id:      empresaId,
              agendamento_id:  avaliacaoAg.agId,
              cliente_id:      avaliacaoAg.clienteId,
              profissional_id: avaliacaoAg.profissionalId,
              nota,
              comentario: comentario || null,
            });
            setAvaliacaoAg(null);
          }}
        />
      )}
    </div>
  );
}

// ── Modal de Avaliação ─────────────────────────────────────────

function AvaliacaoModal({ clienteNome, onClose, onSalvar }: {
  clienteNome: string;
  onClose: () => void;
  onSalvar: (nota: number, comentario: string) => Promise<void>;
}) {
  const [nota,       setNota]       = useState(0);
  const [hover,      setHover]      = useState(0);
  const [comentario, setComentario] = useState('');
  const [salvando,   setSalvando]   = useState(false);

  async function salvar() {
    if (nota === 0) return;
    setSalvando(true);
    await onSalvar(nota, comentario);
  }

  const estrelaAtiva = hover || nota;

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-5"
        style={{ animation: 'bm-screen .3s cubic-bezier(.2,.85,.3,1)' }}>

        <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3">
          <X size={15}/>
        </button>

        <div className="text-center">
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>
            Atendimento concluído
          </p>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600, color: 'var(--color-ink)' }}>
            Como foi com {clienteNome.split(' ')[0]}?
          </h2>
        </div>

        <div className="flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map(i => (
            <button key={i} type="button"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setNota(i)}
              className="transition-transform hover:scale-110 active:scale-95">
              <Star
                size={36}
                strokeWidth={1.5}
                fill={i <= estrelaAtiva ? 'var(--color-amber)' : 'none'}
                style={{ color: i <= estrelaAtiva ? 'var(--color-amber)' : 'var(--color-border)' }}
              />
            </button>
          ))}
        </div>

        {nota > 0 && (
          <div>
            <textarea
              value={comentario}
              onChange={e => setComentario(e.target.value)}
              placeholder="Comentário opcional..."
              rows={2}
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition resize-none"
            />
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
            Pular
          </button>
          <button onClick={salvar} disabled={nota === 0 || salvando}
            className="flex-1 h-10 rounded-xl text-white text-sm font-bold transition disabled:opacity-40"
            style={{ background: 'var(--color-amber)', boxShadow: '0 4px 14px rgba(166,90,27,0.25)' }}>
            {salvando ? 'Salvando...' : 'Salvar avaliação'}
          </button>
        </div>
      </div>
    </div>
  );
}
