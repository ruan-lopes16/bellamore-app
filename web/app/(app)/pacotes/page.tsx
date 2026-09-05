'use client';

/**
 * @file pacotes/page.tsx
 * Módulo de Pacotes — catálogo e controle de vendas por cliente.
 *
 * ## Abas
 * - Catálogo : criação/edição de pacotes com lista de serviços e quantidades
 * - Vendidos  : pacotes atribuídos a clientes, progresso de sessões, histórico
 *
 * ## Fluxo de venda
 * 1. Gestor clica "Vender" num pacote → VenderModal
 * 2. Seleciona cliente, data início e valor cobrado
 * 3. INSERT em pacote_clientes (data_validade = data_inicio + validade_dias)
 *
 * ## Controle de sessões
 * - Total sessões = Σ pacote_servicos.quantidade do pacote
 * - Usadas = COUNT(pacote_uso) para aquele pacote_cliente
 * - Restantes = total − usadas
 * - Status auto: expirado se data_validade < hoje; concluido se usadas >= total
 *
 * ## Queries
 * - pacotes com pacote_servicos + servicos (join)
 * - pacote_clientes com pacote + cliente + pacote_uso count
 * Nenhuma query N+1 — joins resolvem no Supabase.
 */

import { useState, useEffect, useMemo } from 'react';
import {
  Plus, X, Trash2, Edit3, Check, Gift, Users,
  AlertCircle, Tag, Clock,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useScrollLock } from '@/lib/useScrollLock';
import type { Cliente as ClienteBase, Servico as ServicoBase } from '@/types';
import { ExportButton } from '@/components/ExportButton';
import { Sk } from '@/components/Skeleton';
import { SearchSelect } from '@/components/SearchSelect';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SmoothTabs } from '@/components/SmoothTabs';
import { format, addDays, parseISO, isPast } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const supabase = createClient();

// ── Tipos ─────────────────────────────────────────────────────

/** quantidade null = sessões ilimitadas para este serviço */
type ServicoItem = { servico_id: string; nome: string; quantidade: number | null };

type Pacote = {
  id: string; nome: string; preco: number;
  validade_dias: number | null; ativo: boolean;
  /** false = combo — agrupa serviços sem rastrear sessões restantes */
  controla_sessoes: boolean;
  servicos: ServicoItem[];
};

type PacoteCliente = {
  id: string;
  pacote:  { id: string; nome: string; preco: number; validade_dias: number | null; controla_sessoes: boolean; servicos: ServicoItem[] };
  cliente: { id: string; nome: string };
  data_inicio:   string;
  data_validade: string | null;
  valor_pago:    number | null;
  status:        string;
  observacao:    string | null;
  total_sessoes: number | null;   // calculado; null = ilimitado (combo não usa este campo)
  usadas:        number;          // calculado de pacote_uso
};

type Servico = Pick<ServicoBase, 'id' | 'nome' | 'preco'>;
type Cliente = Pick<ClienteBase, 'id' | 'nome'>;

// ── Helpers ───────────────────────────────────────────────────

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);
}
function fmtData(d: string) {
  return format(parseISO(d), 'dd/MM/yyyy');
}
function fmtValidade(d: string | null) {
  return d ? fmtData(d) : 'Sem validade';
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  ativo:     { label: 'Ativo',     cls: 'bg-green-soft text-green'     },
  concluido: { label: 'Concluído', cls: 'bg-primary-soft text-primary' },
  expirado:  { label: 'Expirado',  cls: 'bg-red-soft text-red'         },
  cancelado: { label: 'Cancelado', cls: 'bg-bg text-text-3'            },
};

const inputCls = "w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
const labelCls = "block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5";

// ── Modal: criar/editar pacote ────────────────────────────────

function PacoteModal({
  pacote, jaVendido = false, servicos, empresaId, onClose, onSalvo,
}: {
  pacote:    Pacote | null;
  jaVendido?: boolean;
  servicos:  Servico[];
  empresaId: string;
  onClose:   () => void;
  onSalvo:   () => void;
}) {
  // Pacote com venda registrada: composição (serviços/quantidades/modo) travada —
  // as sessões vendidas são do pacote como está cadastrado. Nome/preço/validade
  // seguem editáveis (valem para vendas futuras).
  const servicosTravados = !!pacote && jaVendido;
  useScrollLock();
  const [nome,          setNome]          = useState(pacote?.nome ?? '');
  const [preco,         setPreco]         = useState(pacote?.preco.toFixed(2).replace('.', ',') ?? '');
  const [validade,      setValidade]      = useState(pacote ? (pacote.validade_dias != null ? String(pacote.validade_dias) : '') : '90');
  const [controlaSessoes, setControlaSessoes] = useState(pacote?.controla_sessoes ?? true);
  const [itensList,     setItensList]     = useState<ServicoItem[]>(pacote?.servicos ?? []);
  const [addServId,     setAddServId]     = useState('');
  const [addindoServico,setAddindoServico]= useState(false);
  const [salvando,      setSalvando]      = useState(false);
  const [erro,          setErro]          = useState('');

  function adicionarServico(id: string) {
    if (!id || itensList.find(i => i.servico_id === id)) return;
    const s = servicos.find(x => x.id === id);
    if (!s) return;
    setItensList(prev => [...prev, { servico_id: id, nome: s.nome, quantidade: 1 }]);
    setAddServId('');
  }
  function atualizarQtd(id: string, qtd: number) {
    setItensList(prev => prev.map(i => i.servico_id === id ? { ...i, quantidade: Math.max(1, qtd) } : i));
  }
  function toggleIlimitado(id: string) {
    setItensList(prev => prev.map(i => i.servico_id === id ? { ...i, quantidade: i.quantidade == null ? 1 : null } : i));
  }
  function removerItem(id: string) {
    setItensList(prev => prev.filter(i => i.servico_id !== id));
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setSalvando(true); setErro('');

    const precoN    = parseFloat(preco.replace(',', '.')) || 0;
    const validadeN = validade.trim() === '' ? null : (parseInt(validade, 10) || null);

    let pacoteId: string;

    if (pacote) {
      // Atualizar dados do pacote. Se já foi vendido, não mexe em modo/serviços.
      const { error: e1 } = await supabase.from('pacotes').update(
        servicosTravados
          ? { nome: nome.trim(), preco: precoN, validade_dias: validadeN }
          : { nome: nome.trim(), preco: precoN, validade_dias: validadeN, controla_sessoes: controlaSessoes },
      ).eq('id', pacote.id).eq('empresa_id', empresaId);
      if (e1) { setErro(e1.message); setSalvando(false); return; }
      pacoteId = pacote.id;

      if (servicosTravados) { setSalvando(false); onSalvo(); return; }
    } else {
      // Criar novo pacote
      const { data: novo, error: e1 } = await supabase.from('pacotes').insert({
        empresa_id: empresaId, nome: nome.trim(),
        preco: precoN, validade_dias: validadeN, controla_sessoes: controlaSessoes,
      }).select('id').single();
      if (e1 || !novo) { setErro(e1?.message ?? 'Erro ao criar pacote'); setSalvando(false); return; }
      pacoteId = novo.id;
    }

    // Sincronizar serviços via upsert (evita duplicate key mesmo se delete falhar por RLS)
    if (pacote) {
      // Remove apenas os que saíram da lista
      const idsNovos = itensList.map(i => i.servico_id);
      const idsAntigos = (pacote.servicos ?? []).map(s => s.servico_id);
      const aRemover = idsAntigos.filter(id => !idsNovos.includes(id));
      if (aRemover.length > 0) {
        await supabase.from('pacote_servicos')
          .delete().eq('pacote_id', pacoteId).in('servico_id', aRemover);
      }
    }

    if (itensList.length > 0) {
      // Combo não tem conceito de sessão ilimitada — força quantidade concreta
      const itensSalvar = controlaSessoes ? itensList : itensList.map(i => ({ ...i, quantidade: i.quantidade ?? 1 }));
      // Upsert: insere ou atualiza quantidade se já existir
      const { error: e2 } = await supabase.from('pacote_servicos').upsert(
        itensSalvar.map(i => ({ pacote_id: pacoteId, servico_id: i.servico_id, quantidade: i.quantidade })),
        { onConflict: 'pacote_id,servico_id' }
      );
      if (e2) { setErro(e2.message); setSalvando(false); return; }
    }

    setSalvando(false);
    onSalvo();
  }

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className={`relative bg-surface rounded-2xl shadow-xl w-full flex flex-col transition-all duration-200 ${addindoServico ? 'max-w-lg max-h-[94dvh]' : 'max-w-md max-h-[90dvh]'}`}>
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <h2 className="font-serif text-xl text-text">{pacote ? 'Editar pacote' : 'Novo pacote'}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition"><X size={16}/></button>
        </div>

        <form onSubmit={salvar} className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
          <div>
            <label className={labelCls}>Nome *</label>
            <input value={nome} onChange={e => setNome(e.target.value)} required placeholder="Ex: Pacote Escova Mensal" className={inputCls}/>
          </div>

          {servicosTravados && (
            <div className="flex items-center gap-2 bg-amber-soft rounded-xl px-3 py-2 border border-amber/20">
              <AlertCircle size={14} className="text-amber flex-shrink-0"/>
              <p className="text-xs text-amber">Pacote já vendido — o tipo, os serviços e as quantidades não podem ser alterados.</p>
            </div>
          )}

          <div>
            <label className={labelCls}>Tipo de pacote</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={servicosTravados} onClick={() => setControlaSessoes(true)}
                className={`h-10 rounded-xl text-xs font-semibold border transition disabled:opacity-50 disabled:cursor-not-allowed ${controlaSessoes ? 'bg-primary text-white border-primary' : 'bg-bg border-border text-text-3 hover:border-accent'}`}>
                Com sessões
              </button>
              <button type="button" disabled={servicosTravados} onClick={() => setControlaSessoes(false)}
                className={`h-10 rounded-xl text-xs font-semibold border transition disabled:opacity-50 disabled:cursor-not-allowed ${!controlaSessoes ? 'bg-primary text-white border-primary' : 'bg-bg border-border text-text-3 hover:border-accent'}`}>
                Combo
              </button>
            </div>
            <p className="text-[11px] text-text-4 mt-1">
              {controlaSessoes
                ? 'Rastreia sessões restantes por atendimento (ex: 10 sessões de manicure)'
                : 'Só agrupa serviços para um mesmo atendimento, sem controle de sessões (ex: spa dos lábios + design + buço)'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Preço *</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
                <input value={preco} onChange={e => setPreco(e.target.value)} inputMode="decimal" placeholder="0,00" required className={`${inputCls} pl-9`}/>
              </div>
            </div>
            <div>
              <label className={labelCls}>Validade (dias)</label>
              <input value={validade} onChange={e => setValidade(e.target.value)} inputMode="numeric" placeholder="Sem validade" className={inputCls}/>
              <p className="text-[11px] text-text-4 mt-1">Deixe em branco para pacote sem validade</p>
            </div>
          </div>

          {/* Serviços do pacote — scroll interno limitado a 4 itens */}
          <div>
            <label className={labelCls}>Serviços incluídos</label>
            <div className={`flex flex-col gap-2 mb-2 overflow-y-auto pr-0.5 transition-all duration-200 ${addindoServico ? 'max-h-64' : 'max-h-48'}`}>
              {itensList.map(item => (
                <div key={item.servico_id} className="flex flex-col gap-2 bg-bg rounded-xl px-3 py-2 sm:flex-row sm:items-center">
                  <span className="text-sm text-text break-words sm:flex-1 sm:truncate">{item.nome}</span>
                  <div className="flex items-center gap-2 flex-wrap justify-end sm:flex-shrink-0">
                    {controlaSessoes && item.quantidade == null ? (
                      <span className="text-xs font-semibold text-primary">Ilimitado</span>
                    ) : servicosTravados ? (
                      <span className="text-sm font-semibold text-text">{item.quantidade ?? 1} <span className="text-xs font-normal text-text-4">{controlaSessoes ? 'sessões' : '×'}</span></span>
                    ) : (
                      <>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => atualizarQtd(item.servico_id, (item.quantidade ?? 1) - 1)}
                            className="w-6 h-6 rounded-lg bg-surface border border-border text-text-2 text-xs flex items-center justify-center hover:bg-border transition">−</button>
                          <span className="w-8 text-center text-sm font-semibold text-text">{item.quantidade ?? 1}</span>
                          <button type="button" onClick={() => atualizarQtd(item.servico_id, (item.quantidade ?? 1) + 1)}
                            className="w-6 h-6 rounded-lg bg-surface border border-border text-text-2 text-xs flex items-center justify-center hover:bg-border transition">+</button>
                        </div>
                        <span className="text-xs text-text-4">{controlaSessoes ? 'sessões' : '×'}</span>
                      </>
                    )}
                    {controlaSessoes && !servicosTravados && (
                      <button type="button" onClick={() => toggleIlimitado(item.servico_id)}
                        title={item.quantidade == null ? 'Definir quantidade' : 'Tornar ilimitado'}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center transition ${item.quantidade == null ? 'text-primary bg-primary-soft' : 'text-text-4 hover:text-primary hover:bg-primary-soft'}`}>
                        ∞
                      </button>
                    )}
                    {!servicosTravados && (
                      <button type="button" onClick={() => removerItem(item.servico_id)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition">
                        <Trash2 size={12}/>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {!servicosTravados && (
              <SearchSelect
                options={servicos
                  .filter(s => !itensList.find(i => i.servico_id === s.id))
                  .map(s => ({ value: s.id, label: s.nome, sub: fmtBRL(s.preco) }))}
                value={addServId}
                onChange={id => { setAddServId(id); adicionarServico(id); }}
                onOpenChange={setAddindoServico}
                placeholder="+ Adicionar serviço..."
              />
            )}
          </div>

          {erro && (
            <div className="flex items-center gap-2 bg-red-soft rounded-xl px-3 py-2 border border-red/20">
              <AlertCircle size={14} className="text-red flex-shrink-0"/>
              <p className="text-sm text-red">{erro}</p>
            </div>
          )}
        </form>

        <div className="p-5 border-t border-border flex-shrink-0 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">Cancelar</button>
          <button onClick={e => salvar(e as any)} disabled={salvando}
            className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:opacity-90 transition disabled:opacity-50">
            {salvando ? 'Salvando...' : pacote ? 'Salvar' : 'Criar pacote'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: vender pacote para cliente ─────────────────────────

function VenderModal({
  pacote, clientes, empresaId, onClose, onSalvo,
}: {
  pacote:    Pacote;
  clientes:  Cliente[];
  empresaId: string;
  onClose:   () => void;
  onSalvo:   () => void;
}) {
  useScrollLock();
  const [clienteId,  setClienteId]  = useState('');
  const [dataInicio, setDataInicio] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [valorPago,  setValorPago]  = useState(pacote.preco.toFixed(2).replace('.', ','));
  const [obs,        setObs]        = useState('');
  const [salvando,   setSalvando]   = useState(false);
  const [erro,       setErro]       = useState('');
  const [sucesso,    setSucesso]    = useState<{ clienteNome: string; validade: string | null } | null>(null);

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setSalvando(true); setErro('');
    if (!clienteId) { setErro('Selecione um cliente'); setSalvando(false); return; }

    const inicio    = parseISO(dataInicio);
    const validade  = pacote.validade_dias != null
      ? format(addDays(inicio, pacote.validade_dias), 'yyyy-MM-dd')
      : null;
    const valorN    = parseFloat(valorPago.replace(',', '.')) || 0;

    const { error } = await supabase.from('pacote_clientes').insert({
      empresa_id:    empresaId,
      pacote_id:     pacote.id,
      cliente_id:    clienteId,
      data_inicio:   dataInicio,
      data_validade: validade,
      valor_pago:    valorN,
      status:        'ativo',
      observacao:    obs.trim() || null,
    });

    setSalvando(false);
    if (error) { setErro(error.message); return; }
    setSucesso({
      clienteNome: clientes.find(c => c.id === clienteId)?.nome ?? 'Cliente',
      validade: validade ? format(parseISO(validade), 'dd/MM/yyyy') : null,
    });
  }

  useEffect(() => {
    if (!sucesso) return;
    const t = setTimeout(onSalvo, 1300);
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
          <p className="font-serif text-lg text-text">Pacote vendido!</p>
          <p className="text-sm text-text-2 truncate max-w-full">{pacote.nome} · {sucesso.clienteNome}</p>
          <p className="text-xs text-text-4">
            {sucesso.validade ? `Válido até ${sucesso.validade}` : 'Sem validade — vale enquanto houver sessões'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="font-serif text-xl text-text">Vender pacote</h2>
            <p className="text-xs text-text-3 mt-0.5">{pacote.nome} · {fmtBRL(pacote.preco)}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition"><X size={16}/></button>
        </div>

        <form onSubmit={salvar} className="p-5 flex flex-col gap-4">
          <div>
            <label className={labelCls}>Cliente *</label>
            <SearchSelect
              options={clientes.map(c => ({ value: c.id, label: c.nome }))}
              value={clienteId} onChange={setClienteId}
              placeholder="Buscar cliente..." required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className={labelCls}>Data de início</label>
              <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} className={inputCls}/>
            </div>
            <div className="min-w-0">
              <label className={labelCls}>Valor cobrado</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
                <input value={valorPago} onChange={e => setValorPago(e.target.value)} inputMode="decimal" className={`${inputCls} pl-9`}/>
              </div>
            </div>
          </div>

          <div>
            <label className={labelCls}>Observação</label>
            <input value={obs} onChange={e => setObs(e.target.value)} placeholder="Ex: pagamento parcelado" className={inputCls}/>
          </div>

          {/* Preview validade */}
          <div className="bg-bg rounded-xl px-4 py-3 flex items-center gap-2 border border-border">
            <Clock size={14} className="text-text-3 flex-shrink-0"/>
            <span className="text-xs text-text-3">
              {pacote.validade_dias != null ? (
                <>
                  Válido até <strong className="text-text">
                    {format(addDays(parseISO(dataInicio || format(new Date(), 'yyyy-MM-dd')), pacote.validade_dias), 'dd/MM/yyyy')}
                  </strong> · {pacote.validade_dias} dias
                </>
              ) : (
                <>Pacote <strong className="text-text">sem validade</strong> — vale enquanto houver sessões</>
              )}
            </span>
          </div>

          {erro && (
            <div className="flex items-center gap-2 bg-red-soft rounded-xl px-3 py-2 border border-red/20">
              <AlertCircle size={14} className="text-red flex-shrink-0"/>
              <p className="text-sm text-red">{erro}</p>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">Cancelar</button>
            <button type="submit" disabled={salvando}
              className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:opacity-90 transition disabled:opacity-50">
              {salvando ? 'Salvando...' : 'Confirmar venda'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Modal: gerenciar sessões de um pacote vendido ────────────

type PacoteUsoRow = {
  id: string;
  servico_id: string | null;
  agendamento_id: string | null;
  observacao: string | null;
  created_at: string;
  servico?: { nome: string } | null;
};
type AgConcluido = {
  id: string; data_hora_inicio: string; servico_id: string | null;
  servico?: { nome: string } | null;
};

function SessoesModal({
  pc, empresaId, onChanged, onClose,
}: {
  pc:        PacoteCliente;
  empresaId: string;
  onChanged: () => void;   // recarrega a página; NÃO fecha o modal
  onClose:   () => void;
}) {
  useScrollLock();
  const servicosPac = pc.pacote.servicos;
  const servUnicoId = servicosPac.length === 1 ? servicosPac[0].servico_id : '';
  const opcServico = servicosPac.map(s => ({ value: s.servico_id, label: s.nome }));

  const [sessoes,   setSessoes]   = useState<PacoteUsoRow[]>([]);
  const [candidatos, setCandidatos] = useState<AgConcluido[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [erro,      setErro]      = useState('');
  const [busy,      setBusy]      = useState(false);

  // adicionar avulsa
  const [addOpen,  setAddOpen]  = useState(false);
  const [novoServ, setNovoServ] = useState(servUnicoId);
  const [novaData, setNovaData] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [novaObs,  setNovaObs]  = useState('');

  // vincular atendimento
  const [vincOpen, setVincOpen] = useState(false);
  const [vincAg,   setVincAg]   = useState('');

  // edição de sessão
  const [editId,  setEditId]  = useState<string | null>(null);
  const [edServ,  setEdServ]  = useState('');
  const [edData,  setEdData]  = useState('');
  const [edObs,   setEdObs]   = useState('');

  async function carregar() {
    setLoading(true); setErro('');
    const [rUso, rAg, rLink] = await Promise.all([
      supabase.from('pacote_uso')
        .select('id, servico_id, agendamento_id, observacao, created_at, servico:servicos(nome)')
        .eq('pacote_cliente_id', pc.id).order('created_at', { ascending: false }),
      supabase.from('agendamentos')
        .select('id, data_hora_inicio, servico_id, servico:servicos(nome)')
        .eq('empresa_id', empresaId).eq('cliente_id', pc.cliente.id).eq('status', 'concluido')
        .order('data_hora_inicio', { ascending: false }).limit(100),
      supabase.from('pacote_uso').select('agendamento_id')
        .eq('empresa_id', empresaId).not('agendamento_id', 'is', null),
    ]);
    setSessoes((rUso.data ?? []) as unknown as PacoteUsoRow[]);
    const linkados = new Set(((rLink.data ?? []) as { agendamento_id: string }[]).map(x => x.agendamento_id));
    setCandidatos(((rAg.data ?? []) as unknown as AgConcluido[]).filter(a => !linkados.has(a.id)));
    setLoading(false);
  }
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, []);

  const refresh = async () => { await carregar(); onChanged(); };

  async function addAvulsa() {
    if (opcServico.length > 1 && !novoServ) { setErro('Escolha o serviço da sessão.'); return; }
    setBusy(true); setErro('');
    const { error } = await supabase.from('pacote_uso').insert({
      empresa_id:        empresaId,
      pacote_cliente_id: pc.id,
      servico_id:        novoServ || servUnicoId || null,
      observacao:        novaObs.trim() || null,
      created_at:        `${novaData}T12:00:00`,
    });
    setBusy(false);
    if (error) { setErro(error.message); return; }
    setAddOpen(false); setNovaObs(''); setNovoServ(servUnicoId); setNovaData(format(new Date(), 'yyyy-MM-dd'));
    refresh();
  }

  async function vincularAtendimento() {
    if (!vincAg) { setErro('Escolha o atendimento.'); return; }
    const ag = candidatos.find(a => a.id === vincAg);
    if (!ag) return;
    setBusy(true); setErro('');
    const { error: e1 } = await supabase.from('pacote_uso').insert({
      empresa_id:        empresaId,
      pacote_cliente_id: pc.id,
      servico_id:        ag.servico_id,
      agendamento_id:    ag.id,
      created_at:        ag.data_hora_inicio,
    });
    if (e1) { setBusy(false); setErro(e1.message); return; }
    // Vincula o agendamento ao pacote (para de contar como faturamento, igual às automáticas)
    await supabase.from('agendamentos').update({ pacote_cliente_id: pc.id }).eq('id', ag.id).eq('empresa_id', empresaId);
    setBusy(false); setVincOpen(false); setVincAg('');
    refresh();
  }

  function abrirEdicao(s: PacoteUsoRow) {
    setEditId(s.id);
    setEdServ(s.servico_id ?? '');
    setEdData(format(parseISO(s.created_at), 'yyyy-MM-dd'));
    setEdObs(s.observacao ?? '');
  }
  async function salvarEdicao() {
    if (!editId) return;
    setBusy(true); setErro('');
    const { error } = await supabase.from('pacote_uso').update({
      servico_id: edServ || null,
      observacao: edObs.trim() || null,
      created_at: `${edData}T12:00:00`,
    }).eq('id', editId);
    setBusy(false);
    if (error) { setErro(error.message); return; }
    setEditId(null);
    refresh();
  }
  async function excluirSessao(id: string) {
    setBusy(true); setErro('');
    const { error } = await supabase.from('pacote_uso').delete().eq('id', id);
    setBusy(false);
    if (error) { setErro(error.message); return; }
    refresh();
  }

  const total    = pc.total_sessoes;
  const usadas   = sessoes.length;
  const esgotado = total != null && usadas >= total;

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-serif text-xl text-text">Sessões</h2>
            <p className="text-xs text-text-3 mt-0.5">{pc.cliente.nome} · {pc.pacote.nome}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition"><X size={16}/></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
          <div className="bg-bg rounded-xl p-3 flex items-center justify-between border border-border">
            <span className="text-sm text-text-2">Usadas</span>
            <span className="text-lg font-bold text-text">{usadas}{total != null ? ` / ${total}` : ' (ilimitado)'}</span>
          </div>

          {loading ? (
            <div className="flex flex-col gap-2">{[1,2,3].map(i => <Sk key={i} className="h-12 rounded-xl"/>)}</div>
          ) : sessoes.length === 0 ? (
            <p className="text-sm text-text-4 text-center py-2">Nenhuma sessão registrada.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {sessoes.map(s => editId === s.id ? (
                <div key={s.id} className="bg-bg rounded-xl p-3 flex flex-col gap-2 border border-primary/30">
                  {opcServico.length > 1 && (
                    <SearchSelect options={opcServico} value={edServ} onChange={setEdServ} placeholder="Serviço" />
                  )}
                  <input type="date" value={edData} onChange={e => setEdData(e.target.value)} className={inputCls}/>
                  <input value={edObs} onChange={e => setEdObs(e.target.value)} placeholder="Observação" className={inputCls}/>
                  <div className="flex gap-2">
                    <button onClick={() => setEditId(null)} className="flex-1 h-8 rounded-lg border border-border text-text-2 text-xs font-semibold hover:bg-surface transition">Cancelar</button>
                    <button onClick={salvarEdicao} disabled={busy} className="flex-1 h-8 rounded-lg bg-primary text-white text-xs font-bold hover:opacity-90 transition disabled:opacity-50">Salvar</button>
                  </div>
                </div>
              ) : (
                <div key={s.id} className="bg-bg rounded-xl p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text truncate">{s.servico?.nome ?? 'Sem serviço'}</p>
                    <p className="text-[11px] text-text-4">
                      {format(parseISO(s.created_at), 'dd/MM/yyyy')}
                      {' · '}{s.agendamento_id ? 'via agendamento' : 'avulsa'}
                      {s.observacao ? ` · ${s.observacao}` : ''}
                    </p>
                  </div>
                  <button onClick={() => abrirEdicao(s)} className="w-7 h-7 rounded-lg flex items-center justify-center text-text-4 hover:text-primary hover:bg-primary-soft transition"><Edit3 size={13}/></button>
                  <button onClick={() => excluirSessao(s.id)} disabled={busy} className="w-7 h-7 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition"><Trash2 size={13}/></button>
                </div>
              ))}
            </div>
          )}

          {erro && <p className="text-sm text-red">{erro}</p>}

          {/* Adicionar avulsa */}
          {addOpen ? (
            <div className="bg-bg rounded-xl p-3 flex flex-col gap-2 border border-border">
              <p className="text-xs font-semibold text-text-2">Nova sessão avulsa</p>
              {opcServico.length > 1 && (
                <SearchSelect options={opcServico} value={novoServ} onChange={setNovoServ} placeholder="Serviço" />
              )}
              <input type="date" value={novaData} onChange={e => setNovaData(e.target.value)} className={inputCls}/>
              <input value={novaObs} onChange={e => setNovaObs(e.target.value)} placeholder="Observação (opcional)" className={inputCls}/>
              <div className="flex gap-2">
                <button onClick={() => setAddOpen(false)} className="flex-1 h-8 rounded-lg border border-border text-text-2 text-xs font-semibold hover:bg-surface transition">Cancelar</button>
                <button onClick={addAvulsa} disabled={busy} className="flex-1 h-8 rounded-lg bg-green text-white text-xs font-bold hover:opacity-90 transition disabled:opacity-50">Adicionar</button>
              </div>
            </div>
          ) : (
            <button onClick={() => { setErro(''); setAddOpen(true); setVincOpen(false); }}
              className="w-full h-9 rounded-xl border border-border text-text-3 text-xs font-semibold hover:bg-bg transition">
              + Sessão avulsa {esgotado ? '(pacote já esgotado)' : ''}
            </button>
          )}

          {/* Vincular atendimento já realizado */}
          {vincOpen ? (
            <div className="bg-bg rounded-xl p-3 flex flex-col gap-2 border border-border">
              <p className="text-xs font-semibold text-text-2">Vincular atendimento concluído</p>
              {candidatos.length === 0 ? (
                <p className="text-xs text-text-4">Nenhum atendimento concluído do cliente sem vínculo.</p>
              ) : (
                <SearchSelect
                  options={candidatos.map(a => ({
                    value: a.id,
                    label: `${format(parseISO(a.data_hora_inicio), 'dd/MM/yyyy')} · ${a.servico?.nome ?? 'Serviço'}`,
                  }))}
                  value={vincAg} onChange={setVincAg}
                  placeholder="Escolher atendimento"
                />
              )}
              <div className="flex gap-2">
                <button onClick={() => setVincOpen(false)} className="flex-1 h-8 rounded-lg border border-border text-text-2 text-xs font-semibold hover:bg-surface transition">Cancelar</button>
                <button onClick={vincularAtendimento} disabled={busy || candidatos.length === 0} className="flex-1 h-8 rounded-lg bg-primary text-white text-xs font-bold hover:opacity-90 transition disabled:opacity-50">Vincular</button>
              </div>
            </div>
          ) : (
            <button onClick={() => { setErro(''); setVincOpen(true); setAddOpen(false); }}
              className="w-full h-9 rounded-xl border border-border text-text-3 text-xs font-semibold hover:bg-bg transition">
              Vincular atendimento já realizado
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────

export default function PacotesPage() {
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [aba,       setAba]       = useState<'catalogo' | 'vendidos' | 'relatorio'>('catalogo');

  // Dados
  const [pacotes,   setPacotes]   = useState<Pacote[]>([]);
  const [vendidos,  setVendidos]  = useState<PacoteCliente[]>([]);
  const [servicos,  setServicos]  = useState<Servico[]>([]);
  const [clientes,  setClientes]  = useState<Cliente[]>([]);

  // Filtro "vendidos"
  const [filtroStatus, setFiltroStatus] = useState<string>('todos');

  // Modais
  const [modalPacote,  setModalPacote]  = useState<Pacote | 'novo' | null>(null);
  const modalPacoteAberto = modalPacote !== null;
  const [modalVender,  setModalVender]  = useState<Pacote | null>(null);
  const [modalSessao,  setModalSessao]  = useState<PacoteCliente | null>(null);
  const [confirmExcluir, setConfirmExcluir] = useState<Pacote | null>(null);
  const [confirmExcluirVenda, setConfirmExcluirVenda] = useState<PacoteCliente | null>(null);
  const [excluindo,      setExcluindo]      = useState(false);

  // Toast de feedback
  const [toast, setToast] = useState<{ msg: string; tone: 'green' | 'rose' } | null>(null);
  function showToast(msg: string, tone: 'green' | 'rose' = 'green') {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 3500);
  }

  // ── Carregar empresa
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

  // ── Carregar dados
  async function carregar(empId: string) {
    setLoading(true);
    const [rPacotes, rVendidos, rServicos, rClientes] = await Promise.all([
      // Pacotes com serviços
      supabase.from('pacotes')
        .select(`id, nome, preco, validade_dias, ativo, controla_sessoes,
          servicos:pacote_servicos(servico_id, quantidade, servico:servicos(nome))`)
        .eq('empresa_id', empId).order('nome'),

      // Pacotes vendidos com uso
      supabase.from('pacote_clientes')
        .select(`id, data_inicio, data_validade, valor_pago, status, observacao,
          pacote:pacotes(id, nome, preco, validade_dias, controla_sessoes),
          cliente:clientes(id, nome),
          uso:pacote_uso(id)`)
        .eq('empresa_id', empId)
        .order('created_at', { ascending: false }),

      supabase.from('servicos').select('id, nome, preco').eq('empresa_id', empId).eq('ativo', true).order('nome'),
      supabase.from('clientes').select('id, nome').eq('empresa_id', empId).eq('ativo', true).order('nome'),
    ]);

    // Mapear pacotes
    setPacotes(((rPacotes.data ?? []) as any[]).map(p => ({
      id: p.id, nome: p.nome, preco: p.preco,
      validade_dias: p.validade_dias, ativo: p.ativo,
      controla_sessoes: p.controla_sessoes ?? true,
      servicos: (p.servicos ?? []).map((s: any) => ({
        servico_id: s.servico_id,
        nome:       s.servico?.nome ?? 'Serviço',
        quantidade: s.quantidade,
      })),
    })));

    // Mapear vendidos — calcular total_sessoes dinamicamente
    const pacotesMap: Record<string, Pacote> = {};
    for (const p of ((rPacotes.data ?? []) as any[])) {
      pacotesMap[p.id] = {
        id: p.id, nome: p.nome, preco: p.preco,
        validade_dias: p.validade_dias, ativo: p.ativo,
        controla_sessoes: p.controla_sessoes ?? true,
        servicos: (p.servicos ?? []).map((s: any) => ({
          servico_id: s.servico_id, nome: s.servico?.nome ?? '', quantidade: s.quantidade,
        })),
      };
    }

    setVendidos(((rVendidos.data ?? []) as any[]).map(v => {
      const pac = pacotesMap[v.pacote?.id] ?? v.pacote;
      const controlaSessoesPac = pac?.controla_sessoes ?? true;
      const servicosPac = (pac?.servicos ?? []) as ServicoItem[];
      const temIlimitado = servicosPac.some(i => i.quantidade == null);
      const totalSessoes = !controlaSessoesPac || temIlimitado ? null : servicosPac.reduce((s: number, i) => s + (i.quantidade ?? 0), 0);
      const usadas = (v.uso ?? []).length;
      // Auto-status (combo não conclui por sessão — só por vencimento ou ação manual)
      let status = v.status;
      if (status === 'ativo') {
        if (controlaSessoesPac && totalSessoes !== null && usadas >= totalSessoes && totalSessoes > 0) status = 'concluido';
        else if (v.data_validade && isPast(parseISO(v.data_validade))) status = 'expirado';
      }
      return {
        id:            v.id,
        pacote:        {
          id: v.pacote?.id, nome: v.pacote?.nome ?? '—', preco: v.pacote?.preco ?? 0,
          validade_dias: v.pacote?.validade_dias ?? 0, controla_sessoes: controlaSessoesPac,
          servicos: servicosPac,
        },
        cliente:       { id: v.cliente?.id, nome: v.cliente?.nome ?? '—' },
        data_inicio:   v.data_inicio,
        data_validade: v.data_validade,
        valor_pago:    v.valor_pago,
        status,
        observacao:    v.observacao,
        total_sessoes: totalSessoes,
        usadas,
      };
    }));

    setServicos((rServicos.data ?? []) as Servico[]);
    setClientes((rClientes.data ?? []) as Cliente[]);
    setLoading(false);
  }

  useEffect(() => { if (empresaId) carregar(empresaId); }, [empresaId]);

  // ── Stats
  const totalAtivos  = pacotes.filter(p => p.ativo).length;
  const totalVendidos = vendidos.length;
  const totalAtivos2 = vendidos.filter(v => v.status === 'ativo').length;

  // ── Vendidos filtrados
  const vendidosFiltrados = useMemo(() =>
    filtroStatus === 'todos' ? vendidos : vendidos.filter(v => v.status === filtroStatus),
    [vendidos, filtroStatus]
  );

  // ── Relatório de utilização
  const relatorio = useMemo(() => {
    if (vendidos.length === 0) return null;
    const totalSessoes   = vendidos.reduce((s, v) => s + (v.total_sessoes ?? 0), 0);
    const sessoesUsadas  = vendidos.reduce((s, v) => s + v.usadas, 0);
    const aproveitamento = totalSessoes > 0 ? Math.round((sessoesUsadas / totalSessoes) * 100) : 0;
    const receitaTotal   = vendidos.reduce((s, v) => s + (v.valor_pago ?? v.pacote.preco), 0);

    const porPacote: Record<string, { nome: string; vendas: number; totalSessoes: number; sessoesUsadas: number; receita: number; combo: boolean }> = {};
    vendidos.forEach(v => {
      const id = v.pacote.id;
      if (!porPacote[id]) porPacote[id] = { nome: v.pacote.nome, vendas: 0, totalSessoes: 0, sessoesUsadas: 0, receita: 0, combo: !v.pacote.controla_sessoes };
      porPacote[id].vendas++;
      porPacote[id].totalSessoes  += v.total_sessoes ?? 0;
      porPacote[id].sessoesUsadas += v.usadas;
      porPacote[id].receita       += v.valor_pago ?? v.pacote.preco;
    });

    return {
      totalSessoes, sessoesUsadas, aproveitamento, receitaTotal,
      porPacote: Object.values(porPacote).sort((a, b) => b.receita - a.receita),
    };
  }, [vendidos]);

  // ── Toggle ativo/inativo de pacote
  async function toggleAtivo(p: Pacote) {
    if (!empresaId) return;
    await supabase.from('pacotes').update({ ativo: !p.ativo }).eq('id', p.id).eq('empresa_id', empresaId);
    if (empresaId) carregar(empresaId);
  }

  // ── Excluir pacote do catálogo
  function pedirExclusao(p: Pacote) {
    const jaVendido = vendidos.some(v => v.pacote.id === p.id);
    if (jaVendido) {
      showToast('Pacote já foi vendido — desative em vez de excluir.', 'rose');
      return;
    }
    setConfirmExcluir(p);
  }
  async function excluirPacote() {
    if (!empresaId || !confirmExcluir) return;
    setExcluindo(true);
    const { error } = await supabase.from('pacotes')
      .delete().eq('id', confirmExcluir.id).eq('empresa_id', empresaId);
    setExcluindo(false);
    setConfirmExcluir(null);
    if (error) { showToast(`Erro ao excluir: ${error.message}`, 'rose'); return; }
    showToast('Pacote excluído.');
    carregar(empresaId);
  }

  // ── Excluir venda (pacote_clientes) — apaga de vez, junto com as sessões
  async function excluirVenda() {
    if (!empresaId || !confirmExcluirVenda) return;
    const pcId = confirmExcluirVenda.id;
    setExcluindo(true);
    // Desvincula agendamentos que apontam para esta venda (FK sem ON DELETE)
    await supabase.from('agendamentos').update({ pacote_cliente_id: null })
      .eq('pacote_cliente_id', pcId).eq('empresa_id', empresaId);
    const { error } = await supabase.from('pacote_clientes')
      .delete().eq('id', pcId).eq('empresa_id', empresaId);
    setExcluindo(false);
    setConfirmExcluirVenda(null);
    if (error) { showToast(`Erro ao excluir: ${error.message}`, 'rose'); return; }
    showToast('Venda excluída.');
    carregar(empresaId);
  }

  // ── Marcar combo como utilizado (sem controle de sessão, então é ação manual)
  async function marcarComboUtilizado(pcId: string) {
    if (!empresaId) return;
    setVendidos(prev => prev.map(v => v.id === pcId ? { ...v, status: 'concluido' } : v));
    const { error } = await supabase.from('pacote_clientes')
      .update({ status: 'concluido' }).eq('id', pcId).eq('empresa_id', empresaId);
    if (error) { showToast(`Erro ao atualizar: ${error.message}`, 'rose'); carregar(empresaId); }
  }

  // ── Render
  return (
    <div className="bm-page">
      {/* Toast de feedback */}
      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 text-white px-5 py-3 rounded-2xl shadow-lg font-semibold text-sm pointer-events-none ${toast.tone === 'green' ? 'bg-green' : 'bg-red'}`}>
          {toast.tone === 'green' ? <Check size={16} strokeWidth={2.5}/> : <AlertCircle size={16} strokeWidth={2.5}/>} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6 bm-mobile-page-header">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>Fidelização</p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>Pacotes</h1>
        </div>
        <div className="flex items-center gap-2 bm-mobile-page-actions">
          {aba === 'catalogo' && (
            <ExportButton
              variant="mobileHeader"
              className="bm-mobile-header-export"
              filename="pacotes-catalogo"
              title="Catálogo de Pacotes"
              columns={[
                { header: 'Nome',            accessor: (p: Pacote) => p.nome,                                                                                      width: 28 },
                { header: 'Preço',           accessor: (p: Pacote) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.preco),      width: 14 },
                { header: 'Validade (dias)', accessor: (p: Pacote) => p.validade_dias ?? 'Sem validade',                                                            width: 14 },
                { header: 'Serviços',        accessor: (p: Pacote) => p.servicos.map(s => `${s.nome} ×${s.quantidade ?? '∞'}`).join(', '),                          width: 40 },
                { header: 'Status',          accessor: (p: Pacote) => p.ativo ? 'Ativo' : 'Inativo',                                                               width: 10 },
              ]}
              getData={() => pacotes}
            />
          )}
          {aba === 'vendidos' && (
            <ExportButton
              variant="mobileHeader"
              className="bm-mobile-header-export"
              filename="pacotes-vendidos"
              title="Pacotes Vendidos"
              columns={[
                { header: 'Cliente',          accessor: (v: PacoteCliente) => v.cliente.nome,                                                                           width: 26 },
                { header: 'Pacote',           accessor: (v: PacoteCliente) => v.pacote.nome,                                                                            width: 26 },
                { header: 'Sessões usadas',   accessor: (v: PacoteCliente) => `${v.usadas}/${v.total_sessoes ?? '∞'}`,                                                    width: 14 },
                { header: 'Valor pago',       accessor: (v: PacoteCliente) => v.valor_pago != null ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v.valor_pago) : '—', width: 14 },
                { header: 'Início',           accessor: (v: PacoteCliente) => fmtData(v.data_inicio),                                                                   width: 12 },
                { header: 'Válido até',       accessor: (v: PacoteCliente) => fmtValidade(v.data_validade),                                                              width: 12 },
                { header: 'Status',           accessor: (v: PacoteCliente) => STATUS_CFG[v.status]?.label ?? v.status,                                                   width: 12 },
              ]}
              getData={() => vendidosFiltrados}
            />
          )}
          {aba === 'relatorio' && relatorio && (
            <ExportButton
              variant="mobileHeader"
              className="bm-mobile-header-export"
              filename="pacotes-relatorio"
              title="Relatório de Utilização de Pacotes"
              columns={[
                { header: 'Pacote',           accessor: (p: typeof relatorio.porPacote[0]) => p.nome,                                                                    width: 28 },
                { header: 'Vendas',           accessor: (p: typeof relatorio.porPacote[0]) => p.vendas,                                                                  width: 10 },
                { header: 'Sessões totais',   accessor: (p: typeof relatorio.porPacote[0]) => p.totalSessoes,                                                            width: 14 },
                { header: 'Sessões usadas',   accessor: (p: typeof relatorio.porPacote[0]) => p.sessoesUsadas,                                                           width: 14 },
                { header: 'Aproveitamento',   accessor: (p: typeof relatorio.porPacote[0]) => `${p.totalSessoes > 0 ? Math.round((p.sessoesUsadas / p.totalSessoes) * 100) : 0}%`, width: 14 },
                { header: 'Receita',          accessor: (p: typeof relatorio.porPacote[0]) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.receita), width: 16 },
              ]}
              getData={() => relatorio?.porPacote ?? []}
            />
          )}
          <button onClick={() => setModalPacote('novo')}
            className="flex items-center gap-2 h-10 px-4 rounded-xl bg-primary text-white text-sm font-semibold hover:opacity-90 transition shadow-sm">
            <Plus size={16}/> Novo pacote
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {loading ? [1,2,3].map(i => (
          <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-center gap-3">
            <Sk className="w-9 h-9 rounded-xl flex-shrink-0"/><div className="flex flex-col gap-2 flex-1"><Sk className="h-5 w-12"/><Sk className="h-3 w-24"/></div>
          </div>
        )) : [
          { icon: Gift,  label: 'Pacotes ativos',    v: totalAtivos,   color: 'var(--color-primary)', bg: 'var(--color-primary-soft)' },
          { icon: Users, label: 'Vendas realizadas', v: totalVendidos, color: 'var(--color-green)',   bg: 'var(--color-green-soft)'   },
          { icon: Check, label: 'Em andamento',      v: totalAtivos2,  color: 'var(--color-accent)',  bg: 'var(--color-accent-soft)'  },
        ].map(({ icon: Icon, label, v, color, bg }, idx) => (
          <div key={label} className="bm-stagger"
            style={{ '--bm-i': idx, '--bm-step': '55ms', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 20, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 12 } as React.CSSProperties}>
            <div style={{ width: 36, height: 36, borderRadius: 12, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon size={16} style={{ color }} strokeWidth={2}/>
            </div>
            <div>
              <p style={{ fontSize: 20, fontWeight: 700, lineHeight: 1, color: 'var(--color-ink)', fontFamily: 'var(--font-sans)' }}>{v}</p>
              <p style={{ fontSize: 11.5, color: 'var(--color-ink3)', marginTop: 2, fontWeight: 500 }}>{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Abas */}
      <SmoothTabs
        variant="underline"
        className="mb-6"
        tabs={[
          { key: 'catalogo',  label: 'Catálogo' },
          { key: 'vendidos',  label: `Vendidos (${totalVendidos})` },
          { key: 'relatorio', label: 'Relatório' },
        ]}
        active={aba}
        onChange={key => setAba(key as typeof aba)}
      />

      {/* ══════════ TAB: CATÁLOGO ══════════ */}
      {aba === 'catalogo' && (
        loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3].map(i => <Sk key={i} className="h-48 rounded-2xl"/>)}
          </div>
        ) : pacotes.length === 0 ? (
          <div className="text-center py-16">
            <Gift size={36} className="mx-auto mb-3 text-text-4"/>
            <p className="text-text-3 text-sm">Nenhum pacote criado ainda.</p>
            <button onClick={() => setModalPacote('novo')}
              className="mt-4 px-5 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:opacity-90 transition">
              Criar primeiro pacote
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pacotes.map((p, idx) => {
              const temIlimitado = p.servicos.some(i => i.quantidade == null);
              const totalSessoes = p.servicos.reduce((s, i) => s + (i.quantidade ?? 0), 0);
              return (
                <div key={p.id} className={`bm-stagger bg-surface border rounded-2xl p-5 shadow-sm flex flex-col gap-3 transition ${!p.ativo ? 'opacity-60 border-border' : 'border-border hover:border-accent/40'}`}
                  style={{ '--bm-i': idx, '--bm-step': '60ms' } as React.CSSProperties}>
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-text">{p.nome}</h3>
                      <p className="text-xs text-text-3 mt-0.5">{p.validade_dias != null ? `${p.validade_dias} dias de validade` : 'Sem validade'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.ativo ? 'bg-green-soft text-green' : 'bg-bg text-text-4'}`}>
                        {p.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                      {!p.controla_sessoes && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent-soft text-accent">Combo</span>
                      )}
                    </div>
                  </div>

                  {/* Preço */}
                  <p className="text-2xl font-bold text-text" style={{ letterSpacing: '-0.02em' }}>{fmtBRL(p.preco)}</p>

                  {/* Serviços */}
                  <div className="flex flex-col gap-1 flex-1">
                    {p.servicos.length === 0 ? (
                      <p className="text-xs text-text-4">Nenhum serviço vinculado</p>
                    ) : p.servicos.map(s => (
                      <div key={s.servico_id} className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0"/>
                        <span className="text-xs text-text-2 truncate">{s.nome}</span>
                        <span className="text-xs text-text-4 ml-auto flex-shrink-0">{s.quantidade ?? '∞'}×</span>
                      </div>
                    ))}
                    {!p.controla_sessoes ? null : temIlimitado ? (
                      <p className="text-xs font-semibold text-primary mt-1">Sessões ilimitadas</p>
                    ) : totalSessoes > 0 && (
                      <p className="text-xs font-semibold text-text-3 mt-1">{totalSessoes} sessões no total</p>
                    )}
                  </div>

                  {/* Ações */}
                  <div className="flex gap-2 pt-2 border-t border-border">
                    <button
                      onClick={() => p.ativo && p.servicos.length > 0 && setModalVender(p)}
                      disabled={!p.ativo || p.servicos.length === 0}
                      title={p.servicos.length === 0 ? 'Adicione serviços antes de vender' : ''}
                      className="flex-1 h-8 rounded-lg bg-primary text-white text-xs font-semibold hover:opacity-90 transition disabled:opacity-40">
                      {p.servicos.length === 0 ? '⚠ Sem serviços' : 'Vender'}
                    </button>
                    <button onClick={() => setModalPacote(p)}
                      className="w-8 h-8 rounded-lg border border-border hover:bg-bg flex items-center justify-center text-text-3 transition">
                      <Edit3 size={13}/>
                    </button>
                    <button onClick={() => toggleAtivo(p)}
                      title={p.ativo ? 'Desativar' : 'Reativar'}
                      className="w-8 h-8 rounded-lg border border-border hover:bg-bg flex items-center justify-center text-text-3 transition">
                      {p.ativo ? <X size={13}/> : <Check size={13}/>}
                    </button>
                    <button onClick={() => pedirExclusao(p)}
                      title="Excluir pacote"
                      className="w-8 h-8 rounded-lg border border-border hover:bg-red-soft hover:border-red/30 flex items-center justify-center text-text-3 hover:text-red transition">
                      <Trash2 size={13}/>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ══════════ TAB: VENDIDOS ══════════ */}
      {aba === 'vendidos' && (
        <div>
          {/* Filtros */}
          <div className="overflow-x-auto mb-4 -mx-1 px-1">
            <SmoothTabs
              variant="pill"
              tabs={[
                { key: 'todos',     label: `Todos (${vendidos.length})`                                           },
                { key: 'ativo',     label: `Ativos (${vendidos.filter(v => v.status === 'ativo').length})`         },
                { key: 'concluido', label: `Concluídos (${vendidos.filter(v => v.status === 'concluido').length})` },
                { key: 'expirado',  label: `Expirados (${vendidos.filter(v => v.status === 'expirado').length})`   },
              ]}
              active={filtroStatus}
              onChange={setFiltroStatus}
            />
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[1,2,3,4].map(i => <Sk key={i} className="h-52 rounded-2xl"/>)}
            </div>
          ) : vendidosFiltrados.length === 0 ? (
            <div className="text-center py-12">
              <Tag size={28} className="mx-auto mb-2 text-text-4"/>
              <p className="text-sm text-text-3">
                {filtroStatus !== 'todos' ? `Nenhuma venda com status "${filtroStatus}"` : 'Nenhuma venda registrada ainda'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {vendidosFiltrados.map((v, idx) => {
                const ilimitado = v.total_sessoes === null;
                const pct       = v.total_sessoes != null && v.total_sessoes > 0 ? (v.usadas / v.total_sessoes) * 100 : 0;
                const statusCfg = STATUS_CFG[v.status] ?? STATUS_CFG.cancelado;
                const restantes = v.total_sessoes != null ? v.total_sessoes - v.usadas : null;
                const corBarra  = pct >= 100 ? '#16A34A' : pct >= 70 ? '#D97706' : '#7C3AED';

                return (
                  <div key={v.id} className="bm-stagger bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col gap-4"
                    style={{ '--bm-i': idx, '--bm-step': '60ms' } as React.CSSProperties}>
                    {/* Header: cliente + status */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-text truncate">{v.cliente.nome}</p>
                        <p className="text-xs text-text-3 mt-0.5 truncate">{v.pacote.nome}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${statusCfg.cls}`}>
                          {statusCfg.label}
                        </span>
                        <button onClick={() => setConfirmExcluirVenda(v)}
                          title="Excluir venda"
                          className="w-7 h-7 rounded-lg border border-border hover:bg-red-soft hover:border-red/30 flex items-center justify-center text-text-3 hover:text-red transition">
                          <Trash2 size={12}/>
                        </button>
                      </div>
                    </div>

                    {/* Combo: lista de serviços inclusos (sem progresso de sessão) */}
                    {!v.pacote.controla_sessoes ? (
                      <div className="flex flex-col gap-1">
                        <span className="inline-flex self-start text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent-soft text-accent mb-1">Combo</span>
                        {v.pacote.servicos.length === 0 ? (
                          <p className="text-xs text-text-4">Nenhum serviço vinculado</p>
                        ) : v.pacote.servicos.map(s => (
                          <div key={s.servico_id} className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0"/>
                            <span className="text-xs text-text-2 truncate">{s.nome}</span>
                            <span className="text-xs text-text-4 ml-auto flex-shrink-0">{s.quantidade ?? '∞'}×</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      /* Progresso de sessões */
                      <div>
                        <div className="flex items-end justify-between mb-2">
                          <div>
                            <span className="text-3xl font-bold text-text">{v.usadas}</span>
                            <span className="text-lg text-text-3">/{ilimitado ? '∞' : v.total_sessoes}</span>
                            <span className="text-xs text-text-3 ml-1.5">sessões</span>
                          </div>
                          {ilimitado && v.status === 'ativo' && (
                            <span className="text-xs font-semibold text-primary">Ilimitado</span>
                          )}
                          {restantes !== null && restantes > 0 && v.status === 'ativo' && (
                            <span className="text-xs font-semibold text-text-3">
                              {restantes} restante{restantes !== 1 ? 's' : ''}
                            </span>
                          )}
                          {!ilimitado && pct >= 100 && (
                            <span className="text-xs font-bold text-green flex items-center gap-1">
                              <Check size={11} strokeWidth={3}/>Concluído
                            </span>
                          )}
                        </div>
                        {ilimitado ? (
                          <div className="h-2.5 rounded-full" style={{ background: 'var(--color-primary-soft)' }}/>
                        ) : v.total_sessoes! > 0 ? (
                          <div className="h-2.5 bg-bg rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${Math.min(pct, 100)}%`, background: corBarra }}/>
                          </div>
                        ) : (
                          <div className="h-2.5 bg-bg rounded-full"/>
                        )}
                      </div>
                    )}

                    {/* Info: datas + valor */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-bg rounded-xl p-3">
                        <p className="text-[10px] text-text-3 uppercase tracking-wide mb-0.5">Válido até</p>
                        <p className="text-sm font-semibold text-text">{fmtValidade(v.data_validade)}</p>
                      </div>
                      <div className="bg-bg rounded-xl p-3">
                        <p className="text-[10px] text-text-3 uppercase tracking-wide mb-0.5">Valor pago</p>
                        <p className="text-sm font-semibold text-text">{v.valor_pago ? fmtBRL(v.valor_pago) : '—'}</p>
                      </div>
                    </div>

                    {/* Ação */}
                    {v.status === 'ativo' && !v.pacote.controla_sessoes && (
                      <button onClick={() => marcarComboUtilizado(v.id)}
                        className="w-full h-9 rounded-xl bg-green text-white text-xs font-bold hover:opacity-90 transition">
                        Marcar como utilizado
                      </button>
                    )}
                    {v.pacote.controla_sessoes && (
                      <div className="flex flex-col gap-1.5">
                        <p className="text-[10px] text-text-4 text-center">
                          Sessões são registradas automaticamente ao concluir agendamentos.
                        </p>
                        <button onClick={() => setModalSessao(v)}
                          className="w-full h-8 rounded-xl border border-border text-text-3 text-xs font-semibold hover:bg-bg transition">
                          Gerenciar sessões
                        </button>
                      </div>
                    )}
                    {v.observacao && (
                      <p className="text-xs text-text-4 italic -mt-2">"{v.observacao}"</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════ TAB: RELATÓRIO ══════════ */}
      {aba === 'relatorio' && (
        loading ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[1,2,3,4].map(i => <Sk key={i} className="h-20 rounded-2xl"/>)}
            </div>
            <Sk className="h-48 rounded-2xl"/>
          </div>
        ) : !relatorio ? (
          <div className="text-center py-16">
            <AlertCircle size={36} className="mx-auto mb-3 text-text-4"/>
            <p className="text-text-3 text-sm">Nenhum pacote vendido para gerar relatório.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Total de sessões',     value: String(relatorio.totalSessoes),  sub: 'incluindo todos os pacotes' },
                { label: 'Sessões realizadas',   value: String(relatorio.sessoesUsadas), sub: `${relatorio.aproveitamento}% de aproveitamento` },
                { label: 'Sessões restantes',    value: String(vendidos.filter(v => v.status === 'ativo').reduce((s, v) => s + (v.total_sessoes != null ? v.total_sessoes - v.usadas : 0), 0)), sub: 'em pacotes ativos' },
                { label: 'Receita com pacotes',  value: fmtBRL(relatorio.receitaTotal),  sub: `${totalVendidos} venda${totalVendidos !== 1 ? 's' : ''}` },
              ].map(({ label, value, sub }) => (
                <div key={label} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
                  <p className="text-xs text-text-4 uppercase tracking-wide font-semibold mb-2">{label}</p>
                  <p className="text-2xl font-bold text-text mb-1">{value}</p>
                  <p className="text-[11px] text-text-4">{sub}</p>
                </div>
              ))}
            </div>

            {/* Barra de aproveitamento global */}
            <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="font-serif text-lg text-text">Aproveitamento global</p>
                <span className="text-sm font-bold text-text">{relatorio.aproveitamento}%</span>
              </div>
              <div className="h-3 bg-bg rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${relatorio.aproveitamento}%`,
                    background: relatorio.aproveitamento >= 80 ? '#16A34A' : relatorio.aproveitamento >= 50 ? '#D97706' : '#7C3AED',
                  }}/>
              </div>
              <div className="flex justify-between mt-2 text-xs text-text-4">
                <span>{relatorio.sessoesUsadas} realizadas</span>
                <span>{relatorio.totalSessoes - relatorio.sessoesUsadas} restantes</span>
              </div>
            </div>

            {/* Utilização por pacote */}
            <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
              <p className="font-serif text-lg text-text px-5 pt-5 pb-4 border-b border-border">Utilização por pacote</p>
              <div className="divide-y divide-border">
                {relatorio.porPacote.map((p, i) => {
                  const pct = p.totalSessoes > 0 ? Math.round((p.sessoesUsadas / p.totalSessoes) * 100) : 0;
                  return (
                    <div key={i} className="px-5 py-4 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <p className="text-sm font-semibold text-text truncate">{p.nome}</p>
                          <span className="text-xs font-bold text-text-2 flex-shrink-0">{fmtBRL(p.receita)}</span>
                        </div>
                        {!p.combo && (
                          <div className="h-2 bg-bg rounded-full overflow-hidden mb-1.5">
                            <div className="h-full rounded-full transition-all"
                              style={{
                                width: `${pct}%`,
                                background: pct >= 80 ? '#16A34A' : pct >= 50 ? '#D97706' : '#7C3AED',
                              }}/>
                          </div>
                        )}
                        <div className="flex items-center justify-between text-[10px] text-text-4">
                          <span>{p.combo ? 'Combo · sem controle de sessões' : `${p.sessoesUsadas}/${p.totalSessoes} sessões · ${pct}% aproveitamento`}</span>
                          <span>{p.vendas} venda{p.vendas !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )
      )}

      {/* ── Modais ── */}
      {modalPacoteAberto && (
        <PacoteModal
          pacote={modalPacote === 'novo' ? null : modalPacote}
          jaVendido={modalPacote !== 'novo' && modalPacote !== null
            && vendidos.some(v => v.pacote.id === modalPacote.id)}
          servicos={servicos}
          empresaId={empresaId!}
          onClose={() => setModalPacote(null)}
          onSalvo={() => { setModalPacote(null); if (empresaId) carregar(empresaId); }}
        />
      )}

      {modalVender && (
        <VenderModal
          pacote={modalVender}
          clientes={clientes}
          empresaId={empresaId!}
          onClose={() => setModalVender(null)}
          onSalvo={() => { setModalVender(null); if (empresaId) carregar(empresaId); setAba('vendidos'); }}
        />
      )}

      {modalSessao && (
        <SessoesModal
          pc={modalSessao}
          empresaId={empresaId!}
          onChanged={() => { if (empresaId) carregar(empresaId); }}
          onClose={() => setModalSessao(null)}
        />
      )}

      <ConfirmDialog
        open={confirmExcluir !== null}
        title="Excluir pacote?"
        message={`"${confirmExcluir?.nome}" será removido permanentemente do catálogo. Essa ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        variant="danger"
        loading={excluindo}
        onConfirm={excluirPacote}
        onCancel={() => setConfirmExcluir(null)}
      />

      <ConfirmDialog
        open={confirmExcluirVenda !== null}
        title="Excluir venda?"
        message={`A venda de "${confirmExcluirVenda?.pacote.nome}" para ${confirmExcluirVenda?.cliente.nome} será apagada, junto com as sessões registradas. Agendamentos vinculados serão desvinculados. Sem volta.`}
        confirmLabel="Excluir venda"
        variant="danger"
        loading={excluindo}
        onConfirm={excluirVenda}
        onCancel={() => setConfirmExcluirVenda(null)}
      />
    </div>
  );
}
