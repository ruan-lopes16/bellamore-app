'use client';

/**
 * @file vendas/page.tsx
 * Módulo de Vendas Avulsas — PDV para produtos fora de agendamentos.
 *
 * ## Abas
 * - PDV       : carrinho + checkout (produtos → pagamento → finalizar)
 * - Histórico : lista das últimas 50 vendas com itens e formas de pagamento
 *
 * ## Fluxo de venda
 * 1. Busca e adiciona produtos ao carrinho
 * 2. Escolhe cliente (opcional) e desconto
 * 3. Seleciona método(s) de pagamento e preenche valores
 * 4. Clica "Finalizar" → INSERT vendas → INSERT venda_itens
 *    → INSERT estoque_movimentos (saída) → INSERT pagamentos
 *
 * ## Integrações automáticas
 * - estoque_atual decrementado via trigger trg_atualizar_estoque
 * - Sem N+1: todos os produtos carregados de uma vez, filtro local
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ShoppingCart, Search, Plus, Minus, X, Trash2,
  Banknote, Zap, CreditCard, Gift, Package,
  AlertCircle, Check, History,
} from 'lucide-react';
import { ExportButton } from '@/components/ExportButton';
import { createClient } from '@/lib/supabase/client';
import type { Cliente as ClienteBase } from '@/types';
import { Sk } from '@/components/Skeleton';
import { SearchSelect } from '@/components/SearchSelect';
import { SmoothTabs } from '@/components/SmoothTabs';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { calcTaxa, fmtTaxa, valorLiquido, OPCOES_PARCELAS } from '@/lib/taxas-cartao';

const supabase = createClient();

// ── Tipos ─────────────────────────────────────────────────────

type Produto = {
  id: string;
  nome: string;
  categoria: string | null;
  preco_venda: number;
  estoque_atual: number;
  unidade: string;
};

type CartItem = {
  produto_id: string;
  nome: string;
  preco_unitario: number;
  quantidade: number;
  estoque_atual: number;
  unidade: string;
};

type Split = { metodo: string; valor: string; bandeira?: string; parcelas?: number };

type Cliente = Pick<ClienteBase, 'id' | 'nome'>;

type VendaHistorico = {
  id: string;
  created_at: string;
  cliente: { nome: string } | null;
  valor_total: number;
  desconto: number;
  valor_final: number;
  itens: { produto: { nome: string } | null; quantidade: number; preco_unitario: number }[];
  pagamentos_venda: { metodo: string; valor: number }[];
};

// ── Constantes ────────────────────────────────────────────────

const METODOS_PAG = [
  { id: 'pix',      label: 'PIX',      icon: Zap        },
  { id: 'dinheiro', label: 'Dinheiro', icon: Banknote   },
  { id: 'credito',  label: 'Crédito',  icon: CreditCard },
  { id: 'debito',   label: 'Débito',   icon: CreditCard },
  { id: 'cortesia', label: 'Cortesia', icon: Gift       },
];

const BANDEIRAS = [
  { key: 'visa',       label: 'Visa'      },
  { key: 'mastercard', label: 'Master'    },
  { key: 'elo',        label: 'Elo'       },
  { key: 'amex',       label: 'Amex'      },
  { key: 'hipercard',  label: 'Hipercard' },
];

// ── Helpers ───────────────────────────────────────────────────

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
  }).format(v);
}

const inputCls = "w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
const labelCls = "block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5";

// ── Página principal ──────────────────────────────────────────

export default function VendasPage() {
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [aba, setAba]             = useState<'pdv' | 'historico'>('pdv');

  // Catálogo
  const [produtos,  setProdutos]  = useState<Produto[]>([]);
  const [clientes,  setClientes]  = useState<Cliente[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [busca,     setBusca]     = useState('');

  // Carrinho
  const [cart,       setCart]       = useState<CartItem[]>([]);
  const [clienteId,  setClienteId]  = useState('');
  const [descontoPct, setDescontoPct] = useState('');
  const [splits,     setSplits]     = useState<Split[]>([]);
  const [finalizando,setFinalizando]= useState(false);
  const [erro,       setErro]       = useState('');
  const [toast,      setToast]      = useState('');

  // Histórico
  const [vendas,        setVendas]        = useState<VendaHistorico[]>([]);
  const [loadingVendas, setLoadingVendas] = useState(false);

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

  // ── Carregar produtos + clientes
  const carregar = useCallback(async (empId: string) => {
    setLoading(true);
    const [rProdutos, rClientes] = await Promise.all([
      supabase.from('produtos')
        .select('id, nome, categoria, preco_venda, estoque_atual, unidade')
        .eq('empresa_id', empId).eq('ativo', true).eq('tipo', 'venda').order('nome'),
      supabase.from('clientes')
        .select('id, nome')
        .eq('empresa_id', empId).eq('ativo', true).order('nome'),
    ]);
    setProdutos((rProdutos.data ?? []) as Produto[]);
    setClientes((rClientes.data ?? []) as Cliente[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { if (empresaId) carregar(empresaId); }, [empresaId, carregar]);

  // ── Carregar histórico ao mudar de aba
  const carregarVendas = useCallback(async (empId: string) => {
    setLoadingVendas(true);
    const { data } = await supabase
      .from('vendas')
      .select(`
        id, created_at, valor_total, desconto, valor_final,
        cliente:clientes(nome),
        itens:venda_itens(quantidade, preco_unitario, produto:produtos(nome)),
        pagamentos_venda:pagamentos!pagamentos_venda_id_fkey(metodo, valor)
      `)
      .eq('empresa_id', empId)
      .order('created_at', { ascending: false })
      .limit(50);
    setVendas((data ?? []) as unknown as VendaHistorico[]);
    setLoadingVendas(false);
  }, [supabase]);

  useEffect(() => {
    if (aba === 'historico' && empresaId) carregarVendas(empresaId);
  }, [aba, empresaId, carregarVendas]);

  // ── Filtro de produtos (local)
  const produtosFiltrados = useMemo(() => {
    if (!busca.trim()) return produtos;
    const q = busca.toLowerCase();
    return produtos.filter(p =>
      p.nome.toLowerCase().includes(q) ||
      (p.categoria ?? '').toLowerCase().includes(q)
    );
  }, [produtos, busca]);

  // ── Cálculos do carrinho
  const subtotal  = useMemo(() => cart.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0), [cart]);
  const descontoPctN = parseFloat(descontoPct.replace(',', '.')) || 0;
  const descontoN    = subtotal * (descontoPctN / 100);
  const total        = Math.max(0, subtotal - descontoN);
  const totalPago = splits.reduce((s, sp) => s + (parseFloat(sp.valor.replace(',', '.')) || 0), 0);
  const restante  = total - totalPago;
  const troco     = totalPago - total;

  // ── Ações do carrinho
  function addToCart(p: Produto) {
    if (p.estoque_atual <= 0) return;
    setCart(prev => {
      const existing = prev.find(i => i.produto_id === p.id);
      if (existing) {
        if (existing.quantidade >= p.estoque_atual) return prev;
        return prev.map(i => i.produto_id === p.id ? { ...i, quantidade: i.quantidade + 1 } : i);
      }
      return [...prev, {
        produto_id: p.id, nome: p.nome,
        preco_unitario: p.preco_venda, quantidade: 1,
        estoque_atual: p.estoque_atual, unidade: p.unidade,
      }];
    });
  }

  function updateQtd(id: string, delta: number) {
    setCart(prev => prev.map(i => {
      if (i.produto_id !== id) return i;
      const q = i.quantidade + delta;
      if (q <= 0 || q > i.estoque_atual) return i;
      return { ...i, quantidade: q };
    }));
  }

  function removeFromCart(id: string) {
    setCart(prev => prev.filter(i => i.produto_id !== id));
  }

  // ── Pagamento
  function addSplit(metodo: string) {
    if (splits.find(s => s.metodo === metodo)) return;
    // Auto-preenche o valor restante ao adicionar o primeiro método
    const autoValor = splits.length === 0
      ? total.toFixed(2).replace('.', ',')
      : restante > 0 ? restante.toFixed(2).replace('.', ',') : '';
    setSplits(prev => [...prev, { metodo, valor: autoValor }]);
  }

  function removeSplit(metodo: string) {
    setSplits(prev => prev.filter(s => s.metodo !== metodo));
  }

  function updateSplitValor(metodo: string, valor: string) {
    setSplits(prev => prev.map(s => s.metodo === metodo ? { ...s, valor } : s));
  }

  function updateSplitBandeira(metodo: string, bandeira: string) {
    setSplits(prev => prev.map(s => s.metodo === metodo ? { ...s, bandeira } : s));
  }

  function updateSplitParcelas(metodo: string, parcelas: number) {
    setSplits(prev => prev.map(s => s.metodo === metodo ? { ...s, parcelas } : s));
  }

  // ── Finalizar venda
  async function finalizar() {
    if (cart.length === 0)     { setErro('Carrinho vazio'); return; }
    if (descontoPctN > 100)    { setErro('Desconto não pode ser maior que 100%'); return; }
    if (splits.length === 0)   { setErro('Selecione um método de pagamento'); return; }
    if (restante > 0.01)       { setErro(`Faltam ${fmtBRL(restante)} para cobrir o total`); return; }

    setFinalizando(true); setErro('');

    // 1. Criar venda
    const { data: venda, error: e1 } = await supabase.from('vendas').insert({
      empresa_id: empresaId,
      cliente_id: clienteId || null,
      valor_total: subtotal,
      desconto: descontoN,
    }).select('id').single();

    if (e1 || !venda) { setErro(e1?.message ?? 'Erro ao criar venda'); setFinalizando(false); return; }

    // 2. Itens da venda
    const { error: e2 } = await supabase.from('venda_itens').insert(
      cart.map(i => ({
        empresa_id:    empresaId,
        venda_id:      venda.id,
        produto_id:    i.produto_id,
        quantidade:    i.quantidade,
        preco_unitario: i.preco_unitario,
      }))
    );
    if (e2) { setErro(e2.message); setFinalizando(false); return; }

    // 3. Baixa no estoque (trigger trg_atualizar_estoque cuida do estoque_atual)
    const { error: e3 } = await supabase.from('estoque_movimentos').insert(
      cart.map(i => ({
        empresa_id: empresaId,
        produto_id: i.produto_id,
        tipo:       'saida',
        quantidade: i.quantidade,
        motivo:     `Venda avulsa`,
      }))
    );
    if (e3) { setErro(e3.message); setFinalizando(false); return; }

    // 4. Pagamentos
    const { error: e4 } = await supabase.from('pagamentos').insert(
      splits.map(sp => {
        const v    = parseFloat(sp.valor.replace(',', '.')) || 0;
        const parc = sp.metodo === 'credito' ? (sp.parcelas ?? 1) : 1;
        const taxa = calcTaxa(sp.metodo, parc);
        return {
          empresa_id:    empresaId,
          venda_id:      venda.id,
          valor:         v,
          metodo:        sp.metodo,
          bandeira:      (sp.metodo === 'credito' || sp.metodo === 'debito') ? (sp.bandeira ?? null) : null,
          parcelas:      parc,
          taxa_perc:     taxa > 0 ? taxa : null,
          valor_liquido: taxa > 0 ? valorLiquido(v, taxa) : null,
          status:        'pago',
        };
      })
    );
    if (e4) { setErro(e4.message); setFinalizando(false); return; }

    // 5. Reset + feedback
    setCart([]); setClienteId(''); setDescontoPct(''); setSplits([]);
    setFinalizando(false);
    setToast(`Venda de ${fmtBRL(total)} finalizada!`);
    setTimeout(() => setToast(''), 3500);
    if (empresaId) carregar(empresaId); // atualiza estoque nos cards
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="bm-page">
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-green text-white px-5 py-3 rounded-2xl shadow-lg font-semibold text-sm animate-in fade-in slide-in-from-top-2">
          <Check size={16} strokeWidth={2.5}/> {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>Ponto de Venda</p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>Vendas</h1>
        </div>
      </div>

      {/* Tabs */}
      <SmoothTabs
        variant="underline"
        className="mb-6"
        tabs={[{ key: 'pdv', label: 'PDV' }, { key: 'historico', label: 'Histórico' }]}
        active={aba}
        onChange={key => setAba(key as 'pdv' | 'historico')}
      />

      {/* ══════════ TAB: PDV ══════════ */}
      {aba === 'pdv' && (
        <div className="flex flex-col md:flex-row gap-6 md:h-[calc(100vh-220px)]">

          {/* ── Coluna esquerda: produtos ── */}
          <div className="w-full md:w-[300px] md:flex-shrink-0 flex flex-col gap-3 max-h-[50vh] md:max-h-none overflow-y-auto md:overflow-visible">
            {/* Busca */}
            <div className="relative">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-4 pointer-events-none"/>
              <input
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar produto..."
                className={`${inputCls} pl-9`}
              />
            </div>

            {/* Lista de produtos */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1 min-h-0">
              {loading ? (
                [1,2,3,4,5].map(i => <Sk key={i} className="h-16 rounded-xl flex-shrink-0"/>)
              ) : produtosFiltrados.length === 0 ? (
                <div className="text-center py-12">
                  <Package size={28} className="mx-auto mb-2 text-text-4"/>
                  <p className="text-sm text-text-4">
                    {busca ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado'}
                  </p>
                </div>
              ) : produtosFiltrados.map(p => {
                const noCart = cart.find(i => i.produto_id === p.id);
                const semEstoque = p.estoque_atual <= 0;
                return (
                  <button key={p.id} onClick={() => addToCart(p)}
                    disabled={semEstoque}
                    className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border text-left transition flex-shrink-0 ${
                      semEstoque
                        ? 'border-border bg-bg opacity-50 cursor-not-allowed'
                        : noCart
                          ? 'border-accent bg-accent/5'
                          : 'border-border bg-surface hover:border-accent/50 hover:bg-accent/5 active:scale-[0.98]'
                    }`}>
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Package size={15} className="text-primary"/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text truncate">{p.nome}</p>
                      <p className="text-xs text-text-4">
                        {semEstoque ? 'Sem estoque' : `${p.estoque_atual} ${p.unidade}`}
                        {noCart && ` · ${noCart.quantidade} no carrinho`}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-text flex-shrink-0">{fmtBRL(p.preco_venda)}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Coluna direita: carrinho + checkout ── */}
          <div className="flex-1 flex flex-col gap-4 overflow-y-auto min-w-0">

            {/* Carrinho */}
            <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-text flex items-center gap-2">
                  <ShoppingCart size={15}/>
                  Carrinho
                  {cart.length > 0 && (
                    <span className="text-xs font-bold bg-primary text-white px-2 py-0.5 rounded-full">
                      {cart.length}
                    </span>
                  )}
                </h3>
                {cart.length > 0 && (
                  <button onClick={() => setCart([])}
                    className="text-xs text-text-4 hover:text-red transition">
                    Limpar
                  </button>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="py-6 text-center">
                  <ShoppingCart size={24} className="mx-auto mb-2 text-text-4"/>
                  <p className="text-sm text-text-4">Clique nos produtos à esquerda para adicionar</p>
                </div>
              ) : (
                <div className="flex flex-col">
                  {cart.map((item, idx) => (
                    <div key={item.produto_id}
                      className={`flex items-center gap-3 py-2.5 ${idx < cart.length - 1 ? 'border-b border-border' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-text truncate">{item.nome}</p>
                        <p className="text-xs text-text-3">{fmtBRL(item.preco_unitario)} / {item.unidade}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => item.quantidade > 1 ? updateQtd(item.produto_id, -1) : removeFromCart(item.produto_id)}
                          className="w-7 h-7 rounded-lg border border-border text-text-2 flex items-center justify-center hover:bg-bg transition">
                          {item.quantidade > 1 ? <Minus size={11}/> : <Trash2 size={11}/>}
                        </button>
                        <span className="w-7 text-center text-sm font-bold text-text">{item.quantidade}</span>
                        <button
                          onClick={() => updateQtd(item.produto_id, 1)}
                          disabled={item.quantidade >= item.estoque_atual}
                          className="w-7 h-7 rounded-lg border border-border text-text-2 flex items-center justify-center hover:bg-bg transition disabled:opacity-30">
                          <Plus size={11}/>
                        </button>
                      </div>
                      <p className="text-sm font-bold text-text w-16 text-right flex-shrink-0">
                        {fmtBRL(item.preco_unitario * item.quantidade)}
                      </p>
                      <button onClick={() => removeFromCart(item.produto_id)}
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition">
                        <X size={12}/>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Cliente + Desconto */}
            <div className="bg-surface border border-border rounded-2xl p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Cliente (opcional)</label>
                  <SearchSelect
                    options={clientes.map(c => ({ value: c.id, label: c.nome }))}
                    value={clienteId} onChange={setClienteId}
                    placeholder="Sem cliente"
                  />
                </div>
                <div>
                  <label className={labelCls}>Desconto (%)</label>
                  <div className="relative">
                    <input value={descontoPct} onChange={e => setDescontoPct(e.target.value)}
                      inputMode="decimal" placeholder="0"
                      className={`${inputCls} pr-9`}/>
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Pagamento */}
            <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-4">
              <h3 className="font-semibold text-text">Pagamento</h3>

              {/* Chips de método */}
              <div className="flex gap-2 flex-wrap">
                {METODOS_PAG.map(({ id, label, icon: Icon }) => {
                  const ativo = !!splits.find(s => s.metodo === id);
                  return (
                    <button key={id} onClick={() => ativo ? removeSplit(id) : addSplit(id)}
                      className={`flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-semibold border transition ${
                        ativo
                          ? 'bg-primary text-white border-primary'
                          : 'bg-surface border-border text-text-2 hover:border-accent/60'
                      }`}>
                      <Icon size={12}/> {label}
                    </button>
                  );
                })}
              </div>

              {/* Inputs de valor por método */}
              {splits.length > 0 && (
                <div className="flex flex-col gap-2">
                  {splits.map(sp => {
                    const m      = METODOS_PAG.find(x => x.id === sp.metodo)!;
                    const Icon   = m.icon;
                    const isCard = sp.metodo === 'credito' || sp.metodo === 'debito';
                    const taxa   = calcTaxa(sp.metodo, sp.parcelas ?? 1);
                    const valorN = parseFloat(sp.valor.replace(',', '.')) || 0;
                    return (
                      <div key={sp.metodo} className="flex flex-col gap-2 rounded-xl px-3 py-2.5 border border-border bg-bg">
                        <div className="flex items-center gap-2">
                          <Icon size={13} className="text-text-3 flex-shrink-0"/>
                          <span className="text-xs font-semibold text-text-2 flex-1">{m.label}</span>
                          <span className="text-xs text-text-3">R$</span>
                          <input
                            value={sp.valor}
                            onChange={e => updateSplitValor(sp.metodo, e.target.value)}
                            inputMode="decimal" placeholder="0,00"
                            className="w-24 h-8 px-2 text-sm text-right rounded-lg border border-border bg-surface text-text focus:outline-none focus:border-accent transition font-semibold"
                          />
                          <button onClick={() => removeSplit(sp.metodo)}
                            className="w-6 h-6 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition flex-shrink-0">
                            <X size={12}/>
                          </button>
                        </div>
                        {isCard && (
                          <div className="flex gap-1.5 flex-wrap">
                            {BANDEIRAS.map(b => (
                              <button key={b.key} type="button" onClick={() => updateSplitBandeira(sp.metodo, b.key)}
                                className={`px-2 py-0.5 rounded-lg text-xs font-semibold border transition ${
                                  sp.bandeira === b.key
                                    ? 'bg-accent/10 border-accent text-accent'
                                    : 'border-border/60 text-text-3 hover:border-accent/50 hover:text-text-2'
                                }`}>
                                {b.label}
                              </button>
                            ))}
                          </div>
                        )}
                        {sp.metodo === 'credito' && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-text-3 flex-shrink-0">Parcelas:</span>
                            <select
                              value={sp.parcelas ?? 1}
                              onChange={e => updateSplitParcelas(sp.metodo, Number(e.target.value))}
                              className="h-7 px-2 rounded-lg border border-border/60 bg-surface text-xs font-semibold text-text-2 focus:outline-none focus:border-accent transition">
                              {OPCOES_PARCELAS.map(n => (
                                <option key={n} value={n}>{n}x{n === 1 ? ' (à vista)' : ''}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        {isCard && valorN > 0 && (
                          <div className="flex items-center justify-between text-xs text-text-3">
                            <span>Taxa {fmtTaxa(taxa)}</span>
                            <span>Líquido {fmtBRL(valorLiquido(valorN, taxa))}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Totais */}
              <div className="border-t border-border pt-3 flex flex-col gap-1.5">
                {descontoN > 0 && (
                  <>
                    <div className="flex items-center justify-between text-xs text-text-3">
                      <span>Subtotal</span><span>{fmtBRL(subtotal)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-green font-semibold">
                      <span>Desconto ({descontoPctN}%)</span><span>− {fmtBRL(descontoN)}</span>
                    </div>
                  </>
                )}
                <div className="flex items-center justify-between">
                  <span className="font-bold text-text">Total</span>
                  <span className="font-bold text-2xl text-text">{fmtBRL(total)}</span>
                </div>
                {splits.length > 0 && Math.abs(restante) > 0.01 && (
                  <div className={`flex items-center justify-between text-sm font-bold ${restante > 0 ? 'text-red' : 'text-green'}`}>
                    <span>{restante > 0 ? 'Falta cobrir' : 'Troco'}</span>
                    <span>{fmtBRL(Math.abs(restante))}</span>
                  </div>
                )}
                {splits.length > 0 && troco > 0.01 && (
                  <p className="text-xs text-text-4">O troco não é registrado automaticamente.</p>
                )}
              </div>
            </div>

            {/* Erro */}
            {erro && (
              <div className="flex items-center gap-2 bg-red-soft rounded-xl px-3 py-2.5 border border-red/20">
                <AlertCircle size={14} className="text-red flex-shrink-0"/>
                <p className="text-sm text-red">{erro}</p>
              </div>
            )}

            {/* Botão finalizar */}
            <button
              onClick={finalizar}
              disabled={finalizando || cart.length === 0 || !empresaId}
              className="w-full h-12 rounded-2xl bg-primary text-white font-bold text-base hover:opacity-90 transition disabled:opacity-40 flex items-center justify-center gap-2 flex-shrink-0">
              {finalizando ? 'Finalizando...' : (
                <><Check size={18} strokeWidth={2.5}/> Finalizar venda · {fmtBRL(total)}</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ══════════ TAB: HISTÓRICO ══════════ */}
      {aba === 'historico' && (
        <div>
          {vendas.length > 0 && (
            <div className="flex justify-end mb-4">
              <ExportButton
                filename="vendas-historico"
                title="Histórico de Vendas"
                columns={[
                  { header: 'Data',       accessor: (v: VendaHistorico) => format(parseISO(v.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }), width: 18 },
                  { header: 'Cliente',    accessor: (v: VendaHistorico) => v.cliente ? (v.cliente as any).nome : 'Avulso', width: 24 },
                  { header: 'Itens',      accessor: (v: VendaHistorico) => v.itens.map(i => `${i.produto?.nome ?? '?'} ×${i.quantidade}`).join(', '), width: 40 },
                  { header: 'Total',      accessor: (v: VendaHistorico) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(v.valor_final), width: 14 },
                  { header: 'Pagamentos', accessor: (v: VendaHistorico) => v.pagamentos_venda.map(p => `${METODOS_PAG.find(m => m.id === p.metodo)?.label ?? p.metodo} ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(p.valor)}`).join(' + '), width: 30 },
                ]}
                getData={() => vendas}
              />
            </div>
          )}
          {loadingVendas ? (
            <div className="flex flex-col gap-3">
              {[1,2,3,4].map(i => <Sk key={i} className="h-20 rounded-2xl"/>)}
            </div>
          ) : vendas.length === 0 ? (
            <div className="text-center py-16">
              <History size={36} className="mx-auto mb-3 text-text-4"/>
              <p className="text-text-3 text-sm">Nenhuma venda registrada ainda.</p>
              <button onClick={() => setAba('pdv')}
                className="mt-4 px-5 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:opacity-90 transition">
                Ir para o PDV
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {vendas.map(v => (
                <div key={v.id} className="bg-surface border border-border rounded-2xl p-4 flex items-start gap-4 hover:border-border/70 transition">
                  <div className="flex-1 min-w-0">
                    {/* Cliente + data */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="text-sm font-bold text-text">
                        {v.cliente ? (v.cliente as any).nome : 'Venda avulsa'}
                      </p>
                      <span className="text-text-4">·</span>
                      <p className="text-xs text-text-4">
                        {format(parseISO(v.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                      </p>
                    </div>

                    {/* Itens */}
                    <p className="text-xs text-text-3 truncate mb-2">
                      {v.itens.map(i => `${i.produto?.nome ?? '?'} × ${i.quantidade}`).join('  ·  ')}
                    </p>

                    {/* Formas de pagamento */}
                    <div className="flex gap-1.5 flex-wrap">
                      {v.pagamentos_venda.map(p => (
                        <span key={p.metodo}
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-bg border border-border text-text-3">
                          {METODOS_PAG.find(m => m.id === p.metodo)?.label ?? p.metodo} {fmtBRL(p.valor)}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Valor */}
                  <div className="text-right flex-shrink-0">
                    {v.desconto > 0 && (
                      <p className="text-xs text-text-4 line-through">{fmtBRL(v.valor_total)}</p>
                    )}
                    <p className="text-xl font-bold text-text">{fmtBRL(v.valor_final)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
