'use client';

/**
 * @file agenda/page.tsx
 * Agenda interativa com visão semanal e mensal.
 *
 * ## Componentes internos
 * - `ConsumoModal`  — modal de insumos consumidos ao concluir agendamento
 * - `AgCard`        — card de agendamento com dropdown de status
 * - `NovoAgModal`   — modal de criação de agendamento
 * - `ListaDia`      — lista de agendamentos do dia selecionado
 * - `MesView`       — calendário mensal com dots indicadores
 *
 * ## Fluxo de conclusão de agendamento (2 etapas)
 * 1. Usuário clica em "Concluído" no dropdown do AgCard
 * 2. AgCard abre ConsumoModal — etapa 1: Insumos
 * 3. ConsumoModal busca servico_produtos (receita padrão) para pré-preencher
 * 4. Usuário ajusta quantidades e clica "Próximo: Pagamento"
 * 5. Etapa 2: Pagamento — usuário adiciona formas de pagamento (PIX, dinheiro, etc.)
 *    Pode dividir o valor em múltiplos métodos; resumo mostra restante/troco
 * 6. "Confirmar e concluir" → INSERT estoque_movimentos + INSERT pagamentos + status='concluido'
 * 7. Links de escape: "Concluir sem insumos/pagamento" em cada etapa
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
  format, addDays, subDays, addMonths, subMonths,
  startOfDay, endOfDay, startOfMonth, endOfMonth,
  startOfWeek, eachDayOfInterval,
  isSameDay, isSameMonth, isToday, addMinutes, parseISO,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ChevronLeft, ChevronRight, Plus, Clock, User, X, Package2, Trash2,
  Banknote, Zap, CreditCard, Gift, Check, CalendarPlus, AlertTriangle,
} from 'lucide-react';
import { ExportButton } from '@/components/ExportButton';
import { createClient } from '@/lib/supabase/client';
import { Sk } from '@/components/Skeleton';
import { SearchSelect } from '@/components/SearchSelect';

const supabase = createClient();

// ── Tipos ─────────────────────────────────────────────────────

type AgServico = { servico: { id: string; nome: string } | null; valor: number; duracao_minutos: number; ordem: number };
type Ag = {
  id: string; data_hora_inicio: string; data_hora_fim: string;
  status: string; valor: number; observacao?: string;
  cliente: { id: string; nome: string; telefone?: string } | null;
  profissional: { id: string; nome: string } | null;
  servico: { id: string; nome: string; duracao_minutos: number } | null;
  agendamento_servicos: AgServico[];
};
type ClienteOpt = { id: string; nome: string; telefone?: string };
type Servico = { id: string; nome: string; preco: number; duracao_minutos: number };

const STATUS: Record<string, { label: string; bg: string; text: string }> = {
  agendado:   { label: 'Agendado',   bg: 'bg-amber-soft',   text: 'text-amber'   },
  confirmado: { label: 'Confirmado', bg: 'bg-primary-soft', text: 'text-primary' },
  concluido:  { label: 'Concluído',  bg: 'bg-green-soft',   text: 'text-green'   },
  cancelado:  { label: 'Cancelado',  bg: 'bg-red-soft',     text: 'text-red'     },
  faltou:     { label: 'Faltou',     bg: 'bg-red-soft',     text: 'text-red'     },
};
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function iniciais(nome?: string | null) {
  return (nome ?? '?').split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}
function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);
}

// ── Modal: conclusão de atendimento (Insumos → Pagamento) ────

type ConsumoItem = { produto_id: string; nome: string; unidade: string; quantidade: string };
type Split       = { metodo: string; valor: string };

/** Configuração visual de cada forma de pagamento */
const METODOS_PAG = [
  { key: 'dinheiro', label: 'Dinheiro', icon: Banknote,    cor: '#16A34A', bg: '#F0FDF4' },
  { key: 'pix',      label: 'PIX',      icon: Zap,         cor: '#4F46E5', bg: '#EEF2FF' },
  { key: 'credito',  label: 'Crédito',  icon: CreditCard,  cor: '#D97706', bg: '#FEF3C7' },
  { key: 'debito',   label: 'Débito',   icon: CreditCard,  cor: '#9D174D', bg: '#FDF2F8' },
  { key: 'cortesia', label: 'Cortesia', icon: Gift,         cor: '#6B7280', bg: '#F9FAFB' },
] as const;

/**
 * Modal de conclusão de agendamento em 2 etapas:
 * 1. Insumos — ajuste das quantidades consumidas (receita padrão + extras)
 * 2. Pagamento — divisão do valor em múltiplas formas de pagamento
 *
 * Nenhuma escrita no banco ocorre até o usuário confirmar na etapa 2.
 * Ambas as etapas são opcionais via links de escape.
 */
function ConsumoModal({ ag, empresaId, onClose, onConfirmar }: {
  ag: Ag; empresaId: string; onClose: () => void; onConfirmar: () => void;
}) {


  // ── Etapa atual
  const [etapa, setEtapa] = useState<'insumos' | 'pagamento'>('insumos');

  // ── Estado — insumos
  const [itens,    setItens]    = useState<ConsumoItem[]>([]);
  const [produtos, setProdutos] = useState<{ id: string; nome: string; unidade: string }[]>([]);
  const [addId,    setAddId]    = useState('');
  const [loading,  setLoading]  = useState(true);

  // ── Estado — pagamento
  const [splits,   setSplits]   = useState<Split[]>([]);

  // ── Compartilhado
  const [salvando, setSalvando] = useState(false);
  const [erro,     setErro]     = useState('');

  // Busca receitas de todos os serviços + catálogo de produtos ao montar
  useEffect(() => {
    const servicoIds = (ag.agendamento_servicos ?? []).length > 0
      ? (ag.agendamento_servicos ?? []).map(s => s.servico?.id).filter((id): id is string => !!id)
      : [ag.servico?.id ?? ''].filter(Boolean);

    Promise.all([
      supabase.from('servico_produtos')
        .select('produto_id, quantidade, produto:produtos(nome, unidade)')
        .in('servico_id', servicoIds),
      supabase.from('produtos').select('id, nome, unidade')
        .eq('empresa_id', empresaId).eq('ativo', true).eq('tipo', 'material').order('nome'),
    ]).then(([recipe, prods]) => {
      // Mescla receitas de múltiplos serviços somando quantidades do mesmo produto
      const merged: Record<string, ConsumoItem> = {};
      for (const r of (recipe.data ?? []) as any[]) {
        if (!merged[r.produto_id]) {
          merged[r.produto_id] = {
            produto_id: r.produto_id, nome: r.produto.nome,
            unidade: r.produto.unidade, quantidade: String(r.quantidade),
          };
        } else {
          merged[r.produto_id].quantidade = String(
            parseFloat(merged[r.produto_id].quantidade) + r.quantidade
          );
        }
      }
      setItens(Object.values(merged));
      setProdutos((prods.data ?? []) as { id: string; nome: string; unidade: string }[]);
      setSplits([]);
      setLoading(false);
    });
  }, [ag.id, empresaId]);

  // ── Helpers: insumos
  function adicionarProduto(id: string) {
    if (!id || itens.find(i => i.produto_id === id)) return;
    const p = produtos.find(x => x.id === id);
    if (!p) return;
    setItens(prev => [...prev, { produto_id: id, nome: p.nome, unidade: p.unidade, quantidade: '1' }]);
    setAddId('');
  }
  function atualizarQtd(id: string, qtd: string) {
    setItens(prev => prev.map(i => i.produto_id === id ? { ...i, quantidade: qtd } : i));
  }
  function removerItem(id: string) {
    setItens(prev => prev.filter(i => i.produto_id !== id));
  }

  // ── Helpers: pagamento
  /** Adiciona um split com o valor restante pré-preenchido */
  function adicionarSplit(metodo: string) {
    const recebido   = splits.reduce((s, x) => s + (parseFloat(x.valor.replace(',', '.')) || 0), 0);
    const restante   = Math.max(ag.valor - recebido, 0);
    const valorPre   = restante > 0 ? restante.toFixed(2).replace('.', ',') : '';
    setSplits(prev => [...prev, { metodo, valor: valorPre }]);
  }
  function atualizarSplit(idx: number, valor: string) {
    setSplits(prev => prev.map((s, i) => i === idx ? { ...s, valor } : s));
  }
  function removerSplit(idx: number) {
    setSplits(prev => prev.filter((_, i) => i !== idx));
  }

  // ── Cálculo de totais do pagamento
  const recebido = splits.reduce((s, x) => s + (parseFloat(x.valor.replace(',', '.')) || 0), 0);
  const restante = ag.valor - recebido;

  // ── Confirmar: insere insumos + pagamentos + conclui
  async function confirmar(semInsumos = false, semPagamento = false) {
    setSalvando(true); setErro('');

    // 1. Insumos (se não foi pulado)
    if (!semInsumos) {
      const validos = itens.filter(i => parseFloat(i.quantidade.replace(',', '.')) > 0);
      if (validos.length > 0) {
        const { error } = await supabase.from('estoque_movimentos').insert(
          validos.map(i => ({
            produto_id:     i.produto_id,
            empresa_id:     empresaId,
            tipo:           'saida',
            quantidade:     parseFloat(i.quantidade.replace(',', '.')) || 0,
            motivo:         `Agendamento concluído — ${ag.servico?.nome ?? ''}`,
            agendamento_id: ag.id,
          })),
        );
        if (error) { setSalvando(false); setErro(error.message); return; }
      }
    }

    // 2. Pagamentos (se não foi pulado)
    if (!semPagamento) {
      const splitsValidos = splits.filter(s => parseFloat(s.valor.replace(',', '.')) > 0);
      if (splitsValidos.length > 0) {
        const { error } = await supabase.from('pagamentos').insert(
          splitsValidos.map(s => ({
            empresa_id:     empresaId,
            agendamento_id: ag.id,
            valor:          parseFloat(s.valor.replace(',', '.')),
            metodo:         s.metodo,
            status:         'pago',
          })),
        );
        if (error) { setSalvando(false); setErro(error.message); return; }
      }
    }

    setSalvando(false);
    onConfirmar();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] flex flex-col">

        {/* Header com indicador de etapa */}
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            {etapa === 'pagamento' && (
              <button onClick={() => setEtapa('insumos')}
                className="w-7 h-7 rounded-lg hover:bg-bg flex items-center justify-center text-text-3 transition flex-shrink-0">
                <ChevronLeft size={16}/>
              </button>
            )}
            <div>
              {/* Dots de progresso */}
              <div className="flex items-center gap-1.5 mb-1">
                <div className={`h-1.5 w-6 rounded-full transition-colors ${etapa === 'insumos' ? 'bg-accent' : 'bg-green'}`}/>
                <div className={`h-1.5 w-6 rounded-full transition-colors ${etapa === 'pagamento' ? 'bg-accent' : 'bg-border'}`}/>
                <span className="text-[10px] text-text-4 ml-1">
                  {etapa === 'insumos' ? '1/2' : '2/2'}
                </span>
              </div>
              <h2 className="font-serif text-xl text-text">
                {etapa === 'insumos' ? 'Insumos consumidos' : 'Forma de pagamento'}
              </h2>
              <p className="text-xs text-text-3 mt-0.5 truncate max-w-[220px]">
                {(ag.agendamento_servicos ?? []).length > 0
                  ? [...(ag.agendamento_servicos ?? [])].sort((a, b) => a.ordem - b.ordem).map(s => s.servico?.nome).filter(Boolean).join(' + ')
                  : ag.servico?.nome} · {ag.cliente?.nome}
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition flex-shrink-0">
            <X size={16}/>
          </button>
        </div>

        {/* ── Etapa 1: Insumos ── */}
        {etapa === 'insumos' && (
          <>
            <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-3">
              {loading ? (
                <div className="flex flex-col gap-2">
                  {[1, 2].map(i => <Sk key={i} className="h-10 rounded-xl"/>)}
                </div>
              ) : (
                <>
                  {itens.length === 0 && (
                    <p className="text-sm text-text-4 text-center py-2">
                      Nenhum insumo vinculado a este serviço.
                    </p>
                  )}
                  {itens.map(ins => (
                    <div key={ins.produto_id} className="flex items-center gap-2 bg-bg rounded-xl px-3 py-2">
                      <Package2 size={13} className="text-text-4 flex-shrink-0" strokeWidth={2}/>
                      <span className="flex-1 text-sm text-text truncate">{ins.nome}</span>
                      <input
                        value={ins.quantidade}
                        onChange={e => atualizarQtd(ins.produto_id, e.target.value)}
                        inputMode="decimal"
                        className="w-16 h-8 px-2 text-sm text-center rounded-lg border border-border bg-surface focus:outline-none focus:border-accent transition"
                      />
                      <span className="text-xs text-text-4 w-6 flex-shrink-0">{ins.unidade}</span>
                      <button type="button" onClick={() => removerItem(ins.produto_id)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition flex-shrink-0">
                        <Trash2 size={12} strokeWidth={2}/>
                      </button>
                    </div>
                  ))}
                  <SearchSelect
                    options={produtos
                      .filter(p => !itens.find(i => i.produto_id === p.id))
                      .map(p => ({ value: p.id, label: p.nome, sub: p.unidade }))}
                    value={addId}
                    onChange={id => { setAddId(id); adicionarProduto(id); }}
                    placeholder="+ Adicionar produto extra..."
                  />
                </>
              )}
            </div>
            <div className="flex flex-col gap-2 p-5 border-t border-border flex-shrink-0">
              <button onClick={() => setEtapa('pagamento')} disabled={loading}
                className="w-full h-10 rounded-xl bg-accent text-white text-sm font-bold hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2">
                Próximo: Pagamento <ChevronRight size={16}/>
              </button>
              <button onClick={() => confirmar(true, true)} disabled={salvando}
                className="w-full h-9 rounded-xl text-text-3 text-xs font-semibold hover:bg-bg transition">
                Concluir sem registrar insumos nem pagamento
              </button>
            </div>
          </>
        )}

        {/* ── Etapa 2: Pagamento ── */}
        {etapa === 'pagamento' && (
          <>
            <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
              {/* Total do atendimento */}
              <div className="bg-bg rounded-xl p-4 text-center">
                <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-1">
                  Total do atendimento
                </p>
                <p className="text-3xl font-bold text-text" style={{ letterSpacing: '-0.02em' }}>{fmtBRL(ag.valor)}</p>
              </div>

              {/* Chips de método */}
              <div>
                <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-2">
                  Adicionar forma de pagamento
                </p>
                <div className="flex flex-wrap gap-2">
                  {METODOS_PAG.map(({ key, label, icon: Icon, cor, bg }) => (
                    <button key={key} onClick={() => adicionarSplit(key)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-sm font-semibold transition hover:border-accent"
                      style={{ background: bg, color: cor }}>
                      <Icon size={14} strokeWidth={2}/>{label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Lista de splits */}
              {splits.length > 0 && (
                <div className="flex flex-col gap-2">
                  {splits.map((s, i) => {
                    const m = METODOS_PAG.find(x => x.key === s.metodo) ?? METODOS_PAG[0];
                    const IconM = m.icon;
                    return (
                      <div key={i} className="flex items-center gap-2 rounded-xl px-3 py-2.5 border border-border"
                        style={{ background: m.bg }}>
                        <IconM size={15} strokeWidth={2} style={{ color: m.cor }} className="flex-shrink-0"/>
                        <span className="text-sm font-semibold flex-1" style={{ color: m.cor }}>
                          {m.label}
                        </span>
                        <span className="text-xs text-text-3">R$</span>
                        <input
                          value={s.valor}
                          onChange={e => atualizarSplit(i, e.target.value)}
                          inputMode="decimal"
                          placeholder="0,00"
                          className="w-24 h-8 px-2 text-sm text-right rounded-lg border border-border bg-surface focus:outline-none focus:border-accent transition font-semibold"
                        />
                        <button onClick={() => removerSplit(i)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition flex-shrink-0">
                          <X size={13}/>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Resumo recebido / restante */}
              {splits.length > 0 && (
                <div className={`rounded-xl p-3 border ${
                  Math.abs(restante) < 0.01
                    ? 'bg-green-soft border-green/20'
                    : restante > 0
                    ? 'bg-amber-soft border-amber/20'
                    : 'bg-primary-soft border-primary/20'
                }`}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-2">Recebido</span>
                    <span className="font-bold text-text">{fmtBRL(recebido)}</span>
                  </div>
                  {restante > 0.01 && (
                    <div className="flex items-center justify-between text-sm mt-1.5">
                      <span className="text-amber font-semibold">Falta</span>
                      <span className="text-amber font-bold">{fmtBRL(restante)}</span>
                    </div>
                  )}
                  {restante < -0.01 && (
                    <div className="flex items-center justify-between text-sm mt-1.5">
                      <span className="text-primary font-semibold">Troco</span>
                      <span className="text-primary font-bold">{fmtBRL(-restante)}</span>
                    </div>
                  )}
                  {Math.abs(restante) < 0.01 && (
                    <div className="flex items-center justify-center gap-1 mt-1.5">
                      <Check size={12} className="text-green" strokeWidth={3}/>
                      <span className="text-green text-xs font-bold">Valor quitado</span>
                    </div>
                  )}
                </div>
              )}

              {erro && <p className="text-red text-sm">{erro}</p>}
            </div>

            <div className="flex flex-col gap-2 p-5 border-t border-border flex-shrink-0">
              <button onClick={() => confirmar(false, false)} disabled={salvando}
                className="w-full h-10 rounded-xl bg-green text-white text-sm font-bold hover:opacity-90 transition disabled:opacity-50">
                {salvando ? 'Salvando...' : 'Confirmar e concluir'}
              </button>
              <button onClick={() => confirmar(false, true)} disabled={salvando}
                className="w-full h-9 rounded-xl text-text-3 text-xs font-semibold hover:bg-bg transition">
                Concluir sem registrar pagamento
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Card de agendamento ───────────────────────────────────────

const STATUS_OPCOES = [
  { key: 'agendado',   label: 'Agendado',   cor: 'text-amber'   },
  { key: 'confirmado', label: 'Confirmado', cor: 'text-primary' },
  { key: 'concluido',  label: 'Concluído',  cor: 'text-green'   },
  { key: 'cancelado',  label: 'Cancelado',  cor: 'text-red'     },
  { key: 'faltou',     label: 'Faltou',     cor: 'text-red'     },
];

function AgCard({ ag, empresaId, onStatus }: {
  ag: Ag;
  empresaId: string;
  onStatus: (id: string, s: string) => void;
}) {
  const [menuAberto,   setMenuAberto]   = useState(false);
  const [modalConsumo, setModalConsumo] = useState(false);
  const inicio = format(parseISO(ag.data_hora_inicio), 'HH:mm');
  const fim    = format(parseISO(ag.data_hora_fim), 'HH:mm');
  const st     = STATUS[ag.status] ?? { label: ag.status, bg: 'bg-bg', text: 'text-text-3' };

  function selecionarStatus(s: string) {
    setMenuAberto(false);
    if (s === ag.status) return;
    if (s === 'concluido') {
      // Intercept: primeiro mostra modal de insumos
      setModalConsumo(true);
    } else {
      onStatus(ag.id, s);
    }
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

            {/* Badge de status clicável */}
            <div className="relative flex-shrink-0">
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
            </div>
          </div>
          <p className="text-text-3 text-xs mb-2 truncate">
            {(ag.agendamento_servicos ?? []).length > 0
              ? [...(ag.agendamento_servicos ?? [])].sort((a, b) => a.ordem - b.ordem).map(s => s.servico?.nome).filter(Boolean).join(' + ')
              : ag.servico?.nome ?? '—'}
          </p>
          <div className="flex items-center gap-3 text-xs text-text-3">
            <span className="flex items-center gap-1"><Clock size={10} strokeWidth={2}/>{inicio}–{fim}</span>
            {ag.profissional && <span className="flex items-center gap-1"><User size={10} strokeWidth={2}/>{ag.profissional.nome.split(' ')[0]}</span>}
            <span className="ml-auto font-semibold text-text-2">{fmtBRL(ag.valor)}</span>
          </div>
        </div>
      </div>
    </div>
    {modalConsumo && (
      <ConsumoModal
        ag={ag}
        empresaId={empresaId}
        onClose={() => setModalConsumo(false)}
        onConfirmar={() => {
          setModalConsumo(false);
          onStatus(ag.id, 'concluido');
        }}
      />
    )}
    </>
  );
}

// ── Modal de novo agendamento ─────────────────────────────────

type ServicoLinha = { uid: string; servico_id: string; duracao: number; valor: number };
type ConflitoDet  = { inicio: string; fim: string; cliente: string; servico: string };

function NovoAgModal({
  data, empresaId, onClose, onSalvo,
}: {
  data: Date; empresaId: string;
  onClose: () => void; onSalvo: () => void;
}) {
  const [clientes,      setClientes]      = useState<ClienteOpt[]>([]);
  const [profissionais, setProfissionais] = useState<{ id: string; nome: string }[]>([]);
  const [servicos,      setServicos]      = useState<Servico[]>([]);

  const [clienteId, setClienteId] = useState('');
  const [profId,    setProfId]    = useState('');
  const [hora,      setHora]      = useState('09:00');
  const [obs,       setObs]       = useState('');
  const [salvando,  setSalvando]  = useState(false);
  const [erro,      setErro]      = useState('');

  const [linhas, setLinhas] = useState<ServicoLinha[]>([
    { uid: crypto.randomUUID(), servico_id: '', duracao: 60, valor: 0 },
  ]);

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
        .eq('empresa_id', empresaId).eq('role', 'profissional').eq('ativo', true),
      supabase.from('servicos').select('id, nome, preco, duracao_minutos')
        .eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
    ]).then(([c, p, s]) => {
      setClientes((c.data ?? []) as ClienteOpt[]);
      setProfissionais((p.data ?? []).map((m: any) => ({ id: m.user.id, nome: m.user.nome })));
      setServicos((s.data ?? []) as Servico[]);
    });
  }, [empresaId]);

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
    const { data: ag, error } = await supabase.from('agendamentos').insert({
      empresa_id:       empresaId,
      cliente_id:       clienteId,
      profissional_id:  profId,
      servico_id:       filled[0].servico_id,
      data_hora_inicio: inicio.toISOString(),
      data_hora_fim:    fim.toISOString(),
      status:           'agendado',
      valor:            filled.reduce((s, l) => s + l.valor, 0),
      observacao:       obs.trim() || null,
    }).select().single();
    if (error) { setSalvando(false); setErro(error.message); return; }
    await supabase.from('agendamento_servicos').insert(
      filled.map((l, i) => ({
        agendamento_id:  ag.id,
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
    const inicio = new Date(data); inicio.setHours(h, m, 0, 0);
    const fim    = addMinutes(inicio, totalDuracao || 60);

    const { data: conf } = await supabase
      .from('agendamentos')
      .select(`id,data_hora_inicio,data_hora_fim,
        cliente:clientes!agendamentos_cliente_id_fkey(nome),
        servico:servicos(nome)`)
      .eq('empresa_id', empresaId)
      .eq('profissional_id', profId)
      .not('status', 'in', '("cancelado","faltou")')
      .lt('data_hora_inicio', fim.toISOString())
      .gt('data_hora_fim', inicio.toISOString());

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
            <h2 className="font-serif text-xl text-text">Novo agendamento</h2>
            <p className="text-text-3 text-xs mt-0.5 capitalize">
              {format(data, "EEEE, dd 'de' MMMM", { locale: ptBR })}
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
                {salvando ? 'Salvando...' : 'Agendar mesmo assim'}
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

          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Horário de início</label>
            <input type="time" value={hora} onChange={e => setHora(e.target.value)} required className={inputClass} />
            {totalDuracao > 0 && (() => {
              const [h, m] = hora.split(':').map(Number);
              const fim = addMinutes(new Date(new Date(data).setHours(h, m, 0, 0)), totalDuracao);
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
              {salvando ? 'Salvando...' : 'Agendar'}
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

/**
 * TimelineView — Visão por hora dos agendamentos do dia.
 *
 * Exibe uma coluna por profissional. Agendamentos são blocos
 * posicionados proporcionalmente ao horário e duração.
 * Sobreposições são detectadas e exibidas lado a lado.
 * Clicar num bloco abre o AgCard no painel lateral.
 */
function TimelineView({
  ags, loading, empresaId, onStatus, dataSel,
}: {
  ags: Ag[]; loading: boolean; empresaId: string;
  onStatus: (id: string, s: string) => void;
  dataSel: Date;
}) {
  const [agSel,   setAgSel]   = useState<Ag | null>(null);
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
      <div className="flex flex-col gap-3">
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
          {profissionais.map(prof => (
            <div key={prof.id}
              className="flex-1 min-w-[80px] md:min-w-[130px] border-r border-border last:border-r-0 px-2 py-2 text-center">
              <p className="text-xs font-bold text-text-2 truncate">
                {prof.nome.split(' ')[0]}
              </p>
              {prof.nome.split(' ').length > 1 && (
                <p className="text-[10px] text-text-4 truncate">
                  {prof.nome.split(' ').slice(1).join(' ')}
                </p>
              )}
            </div>
          ))}
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
                  className="flex-1 min-w-[80px] md:min-w-[130px] border-r border-border last:border-r-0 relative"
                  style={{ height: TL_TOTAL_H }}>

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
                        onClick={() => setAgSel(selecionado ? null : ag)}
                        style={{
                          top:    top + 2,
                          height: h - 4,
                          left:   `calc(${lane * pct}% + 3px)`,
                          width:  `calc(${pct}% - 6px)`,
                        }}
                        className={`absolute rounded-lg overflow-hidden text-left border transition-all
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
          <div className="md:hidden fixed left-3 right-3 z-50 bg-surface border border-border rounded-2xl shadow-xl overflow-hidden"
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 76px)' }}>
            <div className="flex items-center justify-between p-3 border-b border-border">
              <p className="text-xs font-semibold text-text-3 uppercase tracking-widest">Detalhes</p>
              <button onClick={() => setAgSel(null)}
                className="w-7 h-7 rounded-lg hover:bg-bg flex items-center justify-center text-text-4 transition">
                <X size={14} />
              </button>
            </div>
            <div className="p-3 max-h-[50vh] overflow-y-auto">
              <AgCard ag={agSel} empresaId={empresaId} onStatus={(id, s) => { setAgSel(null); onStatus(id, s); }}/>
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
              <AgCard ag={agSel} empresaId={empresaId} onStatus={(id, s) => { setAgSel(null); onStatus(id, s); }}/>
            </div>
          </div>
        </>
      )}

    </div>
  );
}

// ── Lista do dia ─────────────────────────────────────────────

function ListaDia({ ags, loading, dataSel, empresaId, onNovo, onStatus }: {
  ags: Ag[]; loading: boolean; dataSel: Date; empresaId: string;
  onNovo: () => void; onStatus: (id: string, s: string) => void;
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
              <AgCard ag={ag} empresaId={empresaId} onStatus={onStatus}/>
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
    Array.from({ length: 7 }, (_, i) => addDays(subDays(new Date(), 3), i))
  );
  const [ags,        setAgs]       = useState<Ag[]>([]);
  const [agsMes,     setAgsMes]    = useState<Map<string, number>>(new Map());
  const [loading,    setLoading]   = useState(true);
  const [empresaId,  setEmpresaId] = useState<string | null>(null);
  const [modal,      setModal]     = useState(false);
  const [toastErro,  setToastErro] = useState('');

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

  // Busca agendamentos do dia selecionado
  const fetchDia = useCallback(async (data: Date, empId: string) => {
    setLoading(true);
    const { data: rows } = await supabase
      .from('agendamentos')
      .select(`id,data_hora_inicio,data_hora_fim,status,valor,observacao,
        cliente:clientes!agendamentos_cliente_id_fkey(id,nome,telefone),
        profissional:users!agendamentos_profissional_id_fkey(id,nome),
        servico:servicos(id,nome,duracao_minutos),
        agendamento_servicos(servico_id,valor,duracao_minutos,ordem,servico:servicos(id,nome))`)
      .eq('empresa_id', empId)
      .gte('data_hora_inicio', startOfDay(data).toISOString())
      .lte('data_hora_inicio', endOfDay(data).toISOString())
      .order('data_hora_inicio');
    setAgs((rows ?? []) as unknown as Ag[]);
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
      setSemana(Array.from({ length: 7 }, (_, i) => addDays(subDays(d, 3), i)));
  }

  async function mudarStatus(id: string, status: string) {
    // Salva o status original ANTES de atualizar (necessário para revert)
    const statusOriginal = ags.find(a => a.id === id)?.status ?? '';
    // Otimista: atualiza local imediatamente
    setAgs(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    const { error } = await supabase
      .from('agendamentos')
      .update({ status })
      .eq('id', id);
    if (error) {
      setAgs(prev => prev.map(a => a.id === id ? { ...a, status: statusOriginal } : a));
      showErro(`Erro ao salvar status: ${error.message}`);
    }
  }

  return (
    <div>
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
          <button onClick={() => setModal(true)} className="press flex items-center gap-2 px-4 h-10 rounded-2xl text-white text-sm font-bold"
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
        <ListaDia ags={ags} loading={loading} dataSel={dataSel} empresaId={empresaId ?? ''} onNovo={() => setModal(true)} onStatus={mudarStatus}/>
      ) : view === 'timeline' ? (
        <TimelineView
          ags={ags}
          loading={loading}
          empresaId={empresaId ?? ''}
          onStatus={mudarStatus}
          dataSel={dataSel}
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
          <ListaDia ags={ags} loading={loading} dataSel={dataSel} empresaId={empresaId ?? ''} onNovo={() => setModal(true)} onStatus={mudarStatus}/>
        </>
      )}

      {/* Modal */}
      {modal && empresaId && (
        <NovoAgModal
          data={dataSel}
          empresaId={empresaId}
          onClose={() => setModal(false)}
          onSalvo={() => {
            setModal(false);
            fetchDia(dataSel, empresaId);
            if (view === 'mes') fetchMes(dataSel, empresaId);
          }}
        />
      )}
    </div>
  );
}
