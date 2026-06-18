'use client';

/**
 * @file estoque/page.tsx
 * Gestão de produtos e movimentações de estoque.
 *
 * ## Tabelas utilizadas
 * - `produtos`           — catálogo de produtos com estoque_atual e estoque_minimo
 * - `estoque_movimentos` — log de entradas/saídas (trigger no banco atualiza estoque_atual)
 *
 * ## Fluxo de movimentação
 * 1. Usuário clica no ícone RefreshCw de um produto → abre MovModal
 * 2. Seleciona Entrada ou Saída + informa quantidade
 * 3. Ao confirmar: INSERT em estoque_movimentos
 *    → trigger `trg_atualizar_estoque` atualiza produtos.estoque_atual automaticamente
 *    → UI é atualizada localmente sem novo fetch
 *
 * ## Receita de insumos (servico_produtos)
 * Produtos também são debitados automaticamente ao concluir agendamentos
 * via ConsumoModal na página de Agenda. Ver agenda/page.tsx.
 *
 * ## Unidades especiais (pct e cx)
 * Quando unidade = 'pct' ou 'cx', o campo `qtd_por_unidade` indica
 * quantas unidades há dentro de cada pacote/caixa.
 * A tabela exibe "3 pct (36 un)" quando qtd_por_unidade > 1.
 */

import { useState, useEffect, useMemo } from 'react';
import {
  Plus, Package2, AlertTriangle, DollarSign,
  Search, Edit3, X, ArrowUp, ArrowDown, RefreshCw,
  ChevronLeft, ChevronRight, List, CalendarDays, Check,
} from 'lucide-react';
import { ExportButton } from '@/components/ExportButton';
import { createClient } from '@/lib/supabase/client';
import { Sk } from '@/components/Skeleton';
import { SearchSelect } from '@/components/SearchSelect';
import {
  format, addMonths, subMonths, startOfMonth, endOfMonth, parseISO,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

const supabase = createClient();

// ── Types ─────────────────────────────────────────────────────

type Produto = {
  id: string;
  empresa_id: string;
  nome: string;
  categoria: string;
  unidade: string;
  qtd_por_unidade: number;   // unidades dentro de 1 pct (ex: 12 un/pct)
  estoque_atual: number;
  estoque_minimo: number;
  preco_custo: number;
  /** preco de revenda — relevante apenas para tipo = 'venda' */
  preco_venda: number;
  /** 'material' = insumo de atendimento | 'venda' = produto para revenda no PDV */
  tipo: 'material' | 'venda';
  ativo: boolean;
};

type MovItem = {
  id: string;
  tipo: 'entrada' | 'saida' | 'ajuste';
  quantidade: number;
  motivo: string | null;
  created_at: string;
  agendamento_id: string | null;
  produto: { nome: string; unidade: string };
};

// ── Constantes ────────────────────────────────────────────────

const CATS = [
  { key: 'cilios',       label: 'Cílios',       cor: '#4F46E5', bg: '#EEF2FF' },
  { key: 'sobrancelhas', label: 'Sobrancelhas',  cor: '#7C3AED', bg: '#F3EFFE' },
  { key: 'pele',         label: 'Pele',          cor: '#0D7E5F', bg: '#EAFAF5' },
  { key: 'unhas',        label: 'Unhas',         cor: '#B45309', bg: '#FEF3E2' },
  { key: 'depilacao',    label: 'Depilação',     cor: '#D4608A', bg: '#FDF0F5' },
  { key: 'ferramentas',  label: 'Ferramentas',   cor: '#0891B2', bg: '#ECFEFF' },
  { key: 'higiene',      label: 'Higiene',       cor: '#059669', bg: '#ECFDF5' },
  { key: 'materiais',    label: 'Materiais',     cor: '#92400E', bg: '#FEF3E2' },
  { key: 'outros',       label: 'Outros',        cor: '#6B7280', bg: '#F3F4F6' },
] as const;

type CatKey = typeof CATS[number]['key'];
const CAT_MAP = Object.fromEntries(CATS.map(c => [c.key, c])) as Record<string, typeof CATS[0]>;

const UNIDADES = ['un', 'pct', 'ml', 'g', 'kg', 'L', 'cx', 'pç', 'par'];

// ── Helpers ───────────────────────────────────────────────────

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 0,
  }).format(v);
}

type StatusKey = 'ok' | 'baixo' | 'critico';

function getStatus(p: Produto): StatusKey {
  if (p.estoque_atual <= 0) return 'critico';
  if (p.estoque_minimo > 0 && p.estoque_atual <= p.estoque_minimo) return 'baixo';
  return 'ok';
}

const STATUS_CFG: Record<StatusKey, { label: string; textClass: string; bgClass: string }> = {
  ok:      { label: 'OK',     textClass: 'text-green',       bgClass: 'bg-green/10'  },
  baixo:   { label: 'Baixo',  textClass: 'text-amber-600',   bgClass: 'bg-amber-50'  },
  critico: { label: 'Zerado', textClass: 'text-red',         bgClass: 'bg-red/10'    },
};

const inputClass  = "w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
const labelClass  = "block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5";

// ── Modal: Novo / Editar produto ──────────────────────────────

type ProdutoModalState = { modo: 'criar' } | { modo: 'editar'; produto: Produto };

function ProdutoModal({ empresaId, state, onClose, onSalvo }: {
  empresaId: string;
  state: ProdutoModalState;
  onClose: () => void;
  onSalvo: (p: Produto) => void;
}) {

  const ed = state.modo === 'editar' ? state.produto : null;

  const [nome,       setNome]       = useState(ed?.nome      ?? '');
  const [tipo,       setTipo]       = useState<'material' | 'venda'>(ed?.tipo ?? 'material');
  const [categoria,  setCategoria]  = useState<CatKey>((ed?.categoria as CatKey) ?? 'outros');
  const [unidade,    setUnidade]    = useState(ed?.unidade   ?? 'un');
  const [qtdPorUn,   setQtdPorUn]   = useState((ed?.qtd_por_unidade ?? 1) > 1 ? String(ed!.qtd_por_unidade) : '');
  const [estAtual,   setEstAtual]   = useState(ed ? String(ed.estoque_atual)  : '0');
  const [estMin,     setEstMin]     = useState(ed ? String(ed.estoque_minimo) : '0');
  const [custo,      setCusto]      = useState(ed && ed.preco_custo > 0 ? String(ed.preco_custo) : '');
  const [precoVenda, setPrecoVenda] = useState(ed && ed.preco_venda > 0 ? String(ed.preco_venda) : '');
  const [salvando,   setSalvando]   = useState(false);
  const [erro,       setErro]       = useState('');

  async function salvar() {
    if (!nome.trim()) return;
    setErro(''); setSalvando(true);

    const payload = {
      empresa_id:      empresaId,
      nome:            nome.trim(),
      tipo,
      categoria,
      unidade,
      qtd_por_unidade: (unidade === 'pct' || unidade === 'cx') ? (parseFloat(qtdPorUn.replace(',', '.')) || 1) : 1,
      estoque_atual:   parseFloat(estAtual.replace(',', '.'))  || 0,
      estoque_minimo:  parseFloat(estMin.replace(',', '.'))   || 0,
      preco_custo:     parseFloat(custo.replace(',', '.'))    || 0,
      preco_venda:     parseFloat(precoVenda.replace(',', '.')) || 0,
      ativo:           ed?.ativo ?? true,
    };

    if (ed) {
      const { data, error } = await supabase.from('produtos')
        .update(payload).eq('id', ed.id).select().single();
      setSalvando(false);
      if (error) { setErro(error.message); return; }
      onSalvo(data as Produto);
    } else {
      const { data, error } = await supabase.from('produtos')
        .insert(payload).select().single();
      setSalvando(false);
      if (error) { setErro(error.message); return; }
      onSalvo(data as Produto);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <h2 className="font-serif text-xl text-text">
            {ed ? 'Editar produto' : 'Novo produto'}
          </h2>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
            <X size={16}/>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">

          {/* Tipo de produto — Material ou Para venda */}
          <div>
            <label className={labelClass}>Tipo de produto *</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setTipo('material')}
                className={`h-14 rounded-xl flex flex-col items-center justify-center gap-1 border-2 transition text-sm font-semibold ${
                  tipo === 'material'
                    ? 'border-primary bg-primary-soft text-primary'
                    : 'border-border text-text-3 hover:border-accent bg-bg'
                }`}>
                <Package2 size={16} strokeWidth={2}/>
                Material / Insumo
                <span className="text-[10px] font-normal opacity-70">Usado em atendimentos</span>
              </button>
              <button type="button" onClick={() => setTipo('venda')}
                className={`h-14 rounded-xl flex flex-col items-center justify-center gap-1 border-2 transition text-sm font-semibold ${
                  tipo === 'venda'
                    ? 'border-green bg-green/10 text-green'
                    : 'border-border text-text-3 hover:border-accent bg-bg'
                }`}>
                <DollarSign size={16} strokeWidth={2}/>
                Para venda (PDV)
                <span className="text-[10px] font-normal opacity-70">Revenda para clientes</span>
              </button>
            </div>
          </div>

          {/* Nome */}
          <div>
            <label className={labelClass}>Nome do produto *</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              placeholder={tipo === 'venda' ? 'Ex: Água de Coco 350ml' : 'Ex: Cola para cílios 5ml'}
              className={inputClass}/>
          </div>

          {/* Categoria */}
          <div>
            <label className={labelClass}>Categoria</label>
            <div className="flex flex-wrap gap-2">
              {CATS.map(c => {
                const ativo = categoria === c.key;
                return (
                  <button key={c.key} type="button" onClick={() => setCategoria(c.key)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                      !ativo ? 'border-border text-text-3 hover:border-accent bg-bg' : ''
                    }`}
                    style={ativo ? { backgroundColor: c.bg, borderColor: c.cor, color: c.cor } : undefined}>
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Unidade */}
          <div>
            <label className={labelClass}>Unidade de medida</label>
            <div className="flex flex-wrap gap-2">
              {UNIDADES.map(u => (
                <button key={u} type="button" onClick={() => setUnidade(u)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition ${
                    unidade === u
                      ? 'bg-primary-soft border-primary/30 text-primary'
                      : 'bg-bg border-border text-text-3 hover:border-accent'
                  }`}>
                  {u}
                </button>
              ))}
            </div>
          </div>

          {/* Unidades por pacote/caixa — aparece quando unidade = pct ou cx */}
          {(unidade === 'pct' || unidade === 'cx') && (
            <div className="bg-primary-soft/40 border border-primary/20 rounded-xl p-3.5 flex items-center gap-3">
              <div className="flex-1">
                <label className={labelClass}>Unidades por {unidade === 'cx' ? 'caixa' : 'pacote'}</label>
                <div className="flex items-center gap-2">
                  <input
                    value={qtdPorUn}
                    onChange={e => setQtdPorUn(e.target.value)}
                    inputMode="decimal"
                    placeholder="Ex: 12"
                    className={inputClass}
                  />
                  <span className="text-sm text-text-3 whitespace-nowrap flex-shrink-0">
                    un / {unidade === 'cx' ? 'cx' : 'pct'}
                  </span>
                </div>
              </div>
              {qtdPorUn && parseFloat(qtdPorUn) > 0 && estAtual && parseFloat(estAtual) > 0 && (
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-text-4">Total</p>
                  <p className="text-sm font-bold text-primary">
                    {(parseFloat(estAtual.replace(',', '.')) * parseFloat(qtdPorUn.replace(',', '.'))).toFixed(0)} un
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Qtd atual + mínima */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Qtd. atual</label>
              <input value={estAtual} onChange={e => setEstAtual(e.target.value)}
                inputMode="decimal" placeholder="0" className={inputClass}/>
            </div>
            <div>
              <label className={labelClass}>Qtd. mínima</label>
              <input value={estMin} onChange={e => setEstMin(e.target.value)}
                inputMode="decimal" placeholder="0" className={inputClass}/>
              <p className="text-xs text-text-4 mt-1">Abaixo disso → alerta de reposição</p>
            </div>
          </div>

          {/* Custo unitário */}
          <div>
            <label className={labelClass}>
              Custo unitário <span className="text-text-4 normal-case font-normal">(opcional)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
              <input value={custo} onChange={e => setCusto(e.target.value)}
                inputMode="decimal" placeholder="0,00" className={`${inputClass} pl-9`}/>
            </div>
          </div>

          {/* Preço de venda — só para tipo = 'venda' */}
          {tipo === 'venda' && (
            <div>
              <label className={labelClass}>
                Preço de venda *
                <span className="ml-1 text-green font-normal normal-case">(exibido no PDV)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
                <input value={precoVenda} onChange={e => setPrecoVenda(e.target.value)}
                  inputMode="decimal" placeholder="0,00" className={`${inputClass} pl-9`}/>
              </div>
              {custo && precoVenda && parseFloat(custo.replace(',', '.')) > 0 && parseFloat(precoVenda.replace(',', '.')) > 0 && (
                <p className="text-xs text-text-4 mt-1">
                  Margem: {((parseFloat(precoVenda.replace(',', '.')) / parseFloat(custo.replace(',', '.')) - 1) * 100).toFixed(0)}%
                </p>
              )}
            </div>
          )}

          {erro && <p className="text-red text-sm">{erro}</p>}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-border flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
            Cancelar
          </button>
          <button onClick={salvar} disabled={!nome.trim() || salvando}
            className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-50">
            {salvando ? 'Salvando...' : ed ? 'Salvar alterações' : 'Cadastrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Movimentação de estoque ────────────────────────────

function MovModal({ produto, onClose, onSalvo }: {
  produto: Produto;
  onClose: () => void;
  onSalvo: (novoEstoque: number, tipo: 'entrada' | 'saida', qtd: number) => void;
}) {

  const [tipo,     setTipo]     = useState<'entrada' | 'saida'>('entrada');
  const [qtd,      setQtd]      = useState('');
  const [obs,      setObs]      = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro,     setErro]     = useState('');

  const qtdNum = parseFloat(qtd.replace(',', '.')) || 0;
  const novoEstoque = tipo === 'entrada'
    ? produto.estoque_atual + qtdNum
    : produto.estoque_atual - qtdNum;

  async function salvar() {
    if (qtdNum <= 0) { setErro('Informe uma quantidade válida.'); return; }
    if (tipo === 'saida' && qtdNum > produto.estoque_atual) {
      setErro(`Estoque insuficiente. Disponível: ${produto.estoque_atual} ${produto.unidade}`);
      return;
    }
    setErro(''); setSalvando(true);

    // Insere movimento — trigger `trg_atualizar_estoque` atualiza estoque_atual automaticamente
    const { error: errMov } = await supabase.from('estoque_movimentos').insert({
      produto_id: produto.id,
      empresa_id: produto.empresa_id,
      tipo,
      quantidade: qtdNum,
      motivo: obs.trim() || null,
    });
    setSalvando(false);
    if (errMov) { setErro(errMov.message); return; }

    // Atualiza UI localmente (o trigger já atualizou no banco)
    onSalvo(novoEstoque, tipo, qtdNum);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="font-serif text-xl text-text">Movimentar estoque</h2>
            <p className="text-xs text-text-3 mt-0.5 truncate max-w-[220px]">{produto.nome}</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
            <X size={16}/>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">

          {/* Tipo: entrada / saída */}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setTipo('entrada')}
              className={`h-12 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold border-2 transition ${
                tipo === 'entrada'
                  ? 'border-green bg-green/10 text-green'
                  : 'border-border text-text-3 hover:border-accent'
              }`}>
              <ArrowUp size={16} strokeWidth={2.5}/>
              Entrada
            </button>
            <button type="button" onClick={() => setTipo('saida')}
              className={`h-12 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold border-2 transition ${
                tipo === 'saida'
                  ? 'border-red bg-red/10 text-red'
                  : 'border-border text-text-3 hover:border-accent'
              }`}>
              <ArrowDown size={16} strokeWidth={2.5}/>
              Saída
            </button>
          </div>

          {/* Estoque atual */}
          <div className="bg-bg rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-text-3">Estoque atual</span>
            <span className="font-bold text-text">{produto.estoque_atual} {produto.unidade}</span>
          </div>

          {/* Quantidade */}
          <div>
            <label className={labelClass}>Quantidade *</label>
            <div className="relative">
              <input value={qtd} onChange={e => setQtd(e.target.value)}
                inputMode="decimal" placeholder="0" autoFocus className={inputClass}/>
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm">
                {produto.unidade}
              </span>
            </div>
          </div>

          {/* Preview novo estoque */}
          {qtdNum > 0 && (
            <div className={`rounded-xl px-4 py-3 flex items-center justify-between ${
              novoEstoque < 0 ? 'bg-red/10' : tipo === 'entrada' ? 'bg-green/10' : 'bg-bg'
            }`}>
              <span className="text-sm text-text-3">Novo estoque</span>
              <span className={`font-bold text-base ${
                novoEstoque < 0 ? 'text-red' : tipo === 'entrada' ? 'text-green' : 'text-text'
              }`}>
                {novoEstoque % 1 === 0 ? novoEstoque : novoEstoque.toFixed(2)} {produto.unidade}
              </span>
            </div>
          )}

          {/* Motivo */}
          <div>
            <label className={labelClass}>
              Motivo <span className="text-text-4 normal-case font-normal">(opcional)</span>
            </label>
            <input value={obs} onChange={e => setObs(e.target.value)}
              placeholder="Ex: compra fornecedor / uso em atendimento" className={inputClass}/>
          </div>

          {erro && <p className="text-red text-sm">{erro}</p>}

          <div className="flex gap-3 mt-1">
            <button onClick={onClose}
              className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
              Cancelar
            </button>
            <button onClick={salvar} disabled={qtdNum <= 0 || salvando}
              className={`flex-1 h-10 rounded-xl text-white text-sm font-bold transition disabled:opacity-50 ${
                tipo === 'entrada' ? 'bg-green hover:opacity-90' : 'bg-red hover:opacity-90'
              }`}>
              {salvando ? 'Salvando...' : tipo === 'entrada' ? 'Registrar entrada' : 'Registrar saída'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tela principal ────────────────────────────────────────────

export default function EstoquePage() {


  // ── Estado: aba ───────────────────────────────────────────────
  const [aba, setAba] = useState<'produtos' | 'movimentacoes'>('produtos');

  // ── Estado: produtos ──────────────────────────────────────────
  const [produtos,  setProdutos]  = useState<Produto[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [busca,        setBusca]        = useState('');
  const [filtroCat,    setFiltroCat]    = useState<string | null>(null);
  const [filtroSt,     setFiltroSt]     = useState<'todos' | 'alertas'>('todos');
  const [filtroPorTipo,setFiltroPorTipo]= useState<'todos' | 'material' | 'venda'>('todos');
  const [modalProd, setModalProd] = useState<ProdutoModalState | null>(null);
  const [modalMov,  setModalMov]  = useState<Produto | null>(null);

  // ── Estado: movimentações ─────────────────────────────────────
  const [movimentos,   setMovimentos]   = useState<MovItem[]>([]);
  const [loadingMov,   setLoadingMov]   = useState(false);
  const [movCarregado, setMovCarregado] = useState(false);
  const [mesMov,       setMesMov]       = useState(new Date());
  const [filtroTipo,   setFiltroTipo]   = useState<'todos' | 'entrada' | 'saida'>('todos');
  const [filtroProdId, setFiltroProdId] = useState('');
  const [toast,        setToast]        = useState('');

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000); }

  // ── Carga inicial ─────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membro } = await supabase.from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (!membro) return;
      setEmpresaId(membro.empresa_id);
      const { data: prods } = await supabase.from('produtos').select('*')
        .eq('empresa_id', membro.empresa_id).eq('ativo', true).order('categoria').order('nome');
      setProdutos((prods ?? []) as Produto[]);
      setLoading(false);
    })();
  }, []);

  // ── Busca movimentações (lazy — só ao abrir a aba) ────────────
  async function carregarMovimentos(empId: string, mes: Date) {
    setLoadingMov(true);
    const { data } = await supabase
      .from('estoque_movimentos')
      .select('id, tipo, quantidade, motivo, created_at, agendamento_id, produto:produtos(nome, unidade)')
      .eq('empresa_id', empId)
      .gte('created_at', startOfMonth(mes).toISOString())
      .lte('created_at', endOfMonth(mes).toISOString())
      .order('created_at', { ascending: false });
    setMovimentos((data ?? []) as unknown as MovItem[]);
    setLoadingMov(false);
    setMovCarregado(true);
  }

  function abrirAbaMovimentacoes() {
    setAba('movimentacoes');
    if (!movCarregado && empresaId) carregarMovimentos(empresaId, mesMov);
  }

  function navMes(dir: number) {
    const novo = dir > 0 ? addMonths(mesMov, 1) : subMonths(mesMov, 1);
    setMesMov(novo);
    setMovCarregado(false);
    if (empresaId) carregarMovimentos(empresaId, novo);
  }

  const alertas = useMemo(
    () => produtos.filter(p => getStatus(p) !== 'ok'),
    [produtos],
  );

  const valorTotal = useMemo(
    () => produtos.reduce((s, p) => s + Number(p.estoque_atual) * Number(p.preco_custo), 0),
    [produtos],
  );

  const filtrados = useMemo(() => {
    let r = produtos;
    if (busca.trim()) {
      const q = busca.toLowerCase();
      r = r.filter(p => p.nome.toLowerCase().includes(q));
    }
    if (filtroCat) r = r.filter(p => p.categoria === filtroCat);
    if (filtroSt === 'alertas') r = r.filter(p => getStatus(p) !== 'ok');
    if (filtroPorTipo !== 'todos') r = r.filter(p => p.tipo === filtroPorTipo);
    return r;
  }, [produtos, busca, filtroCat, filtroSt, filtroPorTipo]);

  // Categorias que têm ao menos 1 produto (para filtros)
  const catsComProduto = CATS.filter(c => produtos.some(p => p.categoria === c.key));

  function onProdutoSalvo(p: Produto) {
    setProdutos(prev => {
      const existe = prev.find(x => x.id === p.id);
      if (existe) return prev.map(x => x.id === p.id ? p : x);
      return [...prev, p].sort(
        (a, b) => a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome),
      );
    });
    setModalProd(null);
  }

  function onMovSalvo(produto: Produto, novoEstoque: number, tipo: 'entrada' | 'saida', qtd: number) {
    setProdutos(prev =>
      prev.map(p => p.id === produto.id ? { ...p, estoque_atual: novoEstoque } : p),
    );
    // Recarrega movimentos se a aba estiver visível
    if (aba === 'movimentacoes' && empresaId) {
      setMovCarregado(false);
      carregarMovimentos(empresaId, mesMov);
    }
    setModalMov(null);
    showToast(
      tipo === 'entrada'
        ? `+${qtd} ${produto.unidade} adicionados — ${produto.nome}`
        : `-${qtd} ${produto.unidade} retirados — ${produto.nome}`
    );
  }

  // ── Movimentos filtrados ──────────────────────────────────────
  const movFiltrados = useMemo(() => {
    let r = movimentos;
    if (filtroTipo !== 'todos') r = r.filter(m => m.tipo === filtroTipo);
    if (filtroProdId) r = r.filter(m => {
      // Compara pelo nome (produto é objeto aninhado)
      const prodNome = produtos.find(p => p.id === filtroProdId)?.nome ?? '';
      return m.produto.nome === prodNome;
    });
    return r;
  }, [movimentos, filtroTipo, filtroProdId, produtos]);

  const totalSaidas  = useMemo(() => movimentos.filter(m => m.tipo === 'saida').reduce((s, m) => s + Number(m.quantidade), 0), [movimentos]);
  const totalEntradas = useMemo(() => movimentos.filter(m => m.tipo === 'entrada').reduce((s, m) => s + Number(m.quantidade), 0), [movimentos]);

  return (
    <div>
      {/* Toast de feedback */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-green text-white px-5 py-3 rounded-2xl shadow-lg font-semibold text-sm pointer-events-none">
          <Check size={16} strokeWidth={2.5}/> {toast}
        </div>
      )}

      {/* Header Bellamore */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>Insumos & produtos</p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 30, fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>Estoque</h1>
        </div>
        <div className="flex gap-2 pt-1">
          {aba === 'produtos' && (
            <ExportButton
              filename="estoque-produtos"
              title="Estoque — Produtos"
              columns={[
                { header: 'Nome',          accessor: (p: Produto) => p.nome,                                    width: 30 },
                { header: 'Categoria',     accessor: (p: Produto) => CAT_MAP[p.categoria]?.label ?? p.categoria, width: 16 },
                { header: 'Unidade',       accessor: (p: Produto) => p.unidade,                                  width: 10 },
                { header: 'Estoque Atual', accessor: (p: Produto) => p.estoque_atual,                            width: 14 },
                { header: 'Estoque Mín.',  accessor: (p: Produto) => p.estoque_minimo,                           width: 14 },
                { header: 'Custo Unit.',   accessor: (p: Produto) => p.preco_custo > 0
                    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(p.preco_custo)
                    : '',                                                                                          width: 14 },
                { header: 'Status',        accessor: (p: Produto) => STATUS_CFG[getStatus(p)].label,             width: 10 },
              ]}
              getData={() => filtrados}
            />
          )}
          {aba === 'movimentacoes' && (
            <ExportButton
              filename="estoque-movimentacoes"
              title={`Movimentações — ${format(mesMov, 'MMMM yyyy', { locale: ptBR })}`}
              columns={[
                { header: 'Data',     accessor: (m: MovItem) => format(parseISO(m.created_at), 'dd/MM/yyyy HH:mm'), width: 18 },
                { header: 'Produto',  accessor: (m: MovItem) => m.produto.nome,                                      width: 28 },
                { header: 'Tipo',     accessor: (m: MovItem) => m.tipo,                                              width: 10 },
                { header: 'Qtd',      accessor: (m: MovItem) => `${m.quantidade} ${m.produto.unidade}`,              width: 10 },
                { header: 'Motivo',   accessor: (m: MovItem) => m.motivo ?? '',                                      width: 28 },
              ]}
              getData={() => movFiltrados}
            />
          )}
          {aba === 'produtos' && (
            <button onClick={() => setModalProd({ modo: 'criar' })} className="press flex items-center gap-2 px-4 h-10 rounded-2xl text-white text-sm font-bold"
              style={{ background: 'var(--color-primary)', boxShadow: '0 6px 20px rgba(44,23,80,0.18)', fontFamily: 'var(--font-sans)' }}>
              <Plus size={15} strokeWidth={2.5}/> Novo produto
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-6">
        {([
          { key: 'produtos',        label: 'Produtos',        icon: Package2    },
          { key: 'movimentacoes',   label: 'Movimentações',   icon: List        },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button key={key}
            onClick={() => key === 'movimentacoes' ? abrirAbaMovimentacoes() : setAba(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition ${
              aba === key
                ? 'border-primary text-primary'
                : 'border-transparent text-text-3 hover:text-text-2'
            }`}>
            <Icon size={14} strokeWidth={2}/>
            {label}
          </button>
        ))}
      </div>

      {/* ── ABA: PRODUTOS ──────────────────────────────────────── */}
      {/* Banner de alertas */}
      {aba === 'produtos' && !loading && alertas.length > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-5">
          <AlertTriangle size={18} className="text-amber-600 flex-shrink-0" strokeWidth={2}/>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800">
              {alertas.length} {alertas.length === 1 ? 'produto precisa' : 'produtos precisam'} de reposição
            </p>
            <p className="text-xs text-amber-600 mt-0.5 truncate">
              {alertas.slice(0, 3).map(p => p.nome).join(', ')}
              {alertas.length > 3 ? ` e mais ${alertas.length - 3}` : ''}
            </p>
          </div>
          <button onClick={() => { setFiltroSt('alertas'); setFiltroCat(null); }}
            className="text-xs font-semibold text-amber-700 hover:underline whitespace-nowrap flex-shrink-0">
            Ver todos
          </button>
        </div>
      )}

      {aba === 'produtos' && <>
      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-center gap-3">
              <Sk className="w-9 h-9 rounded-xl flex-shrink-0"/>
              <div className="flex flex-col gap-2 flex-1">
                <Sk className="h-5 w-10"/>
                <Sk className="h-3 w-24"/>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          {[
            { label: 'Materiais / Insumos', value: String(produtos.filter(p => p.tipo === 'material').length), sub: 'para atendimentos', icon: Package2, hue: 270 },
            { label: 'Para venda (PDV)', value: String(produtos.filter(p => p.tipo === 'venda').length), sub: 'para revenda', icon: DollarSign, hue: 145 },
            { label: 'Precisam de reposição', value: String(alertas.length), sub: alertas.length > 0 ? 'estoque baixo' : 'tudo OK', icon: AlertTriangle, hue: alertas.length > 0 ? 55 : 145 },
            { label: 'Valor total em estoque', value: fmtBRL(valorTotal), sub: 'custo de aquisição', icon: DollarSign, hue: 220 },
          ].map(({ label, value, sub, icon: Icon, hue }, idx) => (
            <div key={label} className="bm-stagger"
              style={{ '--bm-i': idx, '--bm-step': '55ms', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 20, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 12 } as React.CSSProperties}>
              <div style={{ width: 36, height: 36, borderRadius: 12, background: `linear-gradient(140deg, oklch(0.55 0.16 ${hue}), oklch(0.42 0.17 ${hue}))`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={16} color="white" strokeWidth={2}/>
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 20, fontWeight: 700, lineHeight: 1, color: 'var(--color-ink)', fontFamily: 'var(--font-sans)' }}>{value}</p>
                <p style={{ fontSize: 11.5, color: 'var(--color-ink3)', marginTop: 2, fontWeight: 500 }}>{label}</p>
                <p style={{ fontSize: 10, color: 'var(--color-ink4)', marginTop: 2 }} className="truncate">{sub}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filtro por tipo — Material vs Venda */}
      {!loading && (produtos.some(p => p.tipo === 'venda') || produtos.some(p => p.tipo === 'material')) && (
        <div className="flex items-center gap-2 mb-4">
          {([
            { key: 'todos',    label: 'Todos',              count: produtos.length },
            { key: 'material', label: 'Materiais / Insumos', count: produtos.filter(p => p.tipo === 'material').length },
            { key: 'venda',    label: 'Para venda (PDV)',    count: produtos.filter(p => p.tipo === 'venda').length },
          ] as const).map(({ key, label, count }) => (
            <button key={key} onClick={() => { setFiltroPorTipo(key); setFiltroCat(null); }}
              className={`flex items-center gap-2 h-9 px-4 rounded-xl text-xs font-semibold border transition ${
                filtroPorTipo === key
                  ? key === 'venda'
                    ? 'bg-green/10 border-green/30 text-green'
                    : 'bg-primary-soft border-primary/30 text-primary'
                  : 'bg-surface border-border text-text-3 hover:border-accent'
              }`}>
              {label}
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                filtroPorTipo === key ? 'bg-current/10' : 'bg-bg'
              }`}>{count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Busca + filtro status */}
      <div className="flex items-center gap-3 mb-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-4" strokeWidth={2}/>
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar produto..."
            className="w-full h-10 pl-10 pr-4 rounded-xl border border-border bg-surface text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"/>
        </div>

        {/* Toggle Todos / Alertas */}
        <div className="flex rounded-xl border border-border overflow-hidden bg-surface text-sm flex-shrink-0">
          <button onClick={() => setFiltroSt('todos')}
            className={`px-3.5 h-10 font-semibold transition ${
              filtroSt === 'todos' ? 'bg-primary text-white' : 'text-text-3 hover:text-text-2'
            }`}>
            Todos
          </button>
          <button onClick={() => setFiltroSt('alertas')}
            className={`px-3.5 h-10 font-semibold flex items-center gap-1.5 border-l border-border transition ${
              filtroSt === 'alertas' ? 'bg-amber-500 text-white' : 'text-text-3 hover:text-text-2'
            }`}>
            <AlertTriangle size={13} strokeWidth={2}/>
            Alertas
            {alertas.length > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold ${
                filtroSt === 'alertas' ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-700'
              }`}>
                {alertas.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Filtro por categoria */}
      {catsComProduto.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <button onClick={() => setFiltroCat(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
              !filtroCat
                ? 'bg-primary-soft border-primary/30 text-primary'
                : 'bg-bg border-border text-text-3 hover:border-accent'
            }`}>
            Todas
          </button>
          {catsComProduto.map(c => {
            const ativo = filtroCat === c.key;
            return (
              <button key={c.key} onClick={() => setFiltroCat(ativo ? null : c.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                  !ativo ? 'bg-bg border-border text-text-3 hover:border-accent' : ''
                }`}
                style={ativo ? { backgroundColor: c.bg, borderColor: c.cor, color: c.cor } : undefined}>
                {c.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Tabela */}
      {loading ? (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="grid grid-cols-12 px-5 py-2.5 border-b border-border bg-bg">
            {['col-span-4','col-span-2','col-span-2','col-span-2','col-span-2'].map((c, i) => (
              <div key={i} className={c}><Sk className="h-3 w-16"/></div>
            ))}
          </div>
          {[1,2,3,4,5].map(i => (
            <div key={i} className="grid grid-cols-12 items-center px-5 py-3.5 border-b border-border last:border-0">
              <div className="col-span-4 flex items-center gap-3">
                <Sk className="w-7 h-7 rounded-lg flex-shrink-0"/>
                <div className="flex flex-col gap-1.5">
                  <Sk className="h-4 w-32"/>
                  <Sk className="h-3 w-16"/>
                </div>
              </div>
              <div className="col-span-2"><Sk className="h-5 w-14 rounded-full"/></div>
              <div className="col-span-2"><Sk className="h-4 w-12"/></div>
              <div className="col-span-2"><Sk className="h-4 w-10"/></div>
              <div className="col-span-2 flex justify-end gap-2">
                <Sk className="w-8 h-8 rounded-lg"/>
                <Sk className="w-8 h-8 rounded-lg"/>
              </div>
            </div>
          ))}
        </div>
      ) : filtrados.length === 0 ? (
        <div className="text-center py-16 bg-surface border border-border rounded-2xl shadow-sm">
          <Package2 size={32} className="mx-auto mb-3 text-text-4" strokeWidth={1.5}/>
          <p className="text-text-3 text-sm mb-3">
            {busca || filtroCat || filtroSt === 'alertas'
              ? 'Nenhum produto encontrado com esses filtros.'
              : 'Nenhum produto cadastrado ainda.'}
          </p>
          {!busca && !filtroCat && filtroSt === 'todos' ? (
            <button onClick={() => setModalProd({ modo: 'criar' })}
              className="text-accent text-sm font-semibold hover:underline">
              + Cadastrar primeiro produto
            </button>
          ) : (
            <button
              onClick={() => { setBusca(''); setFiltroCat(null); setFiltroSt('todos'); }}
              className="text-accent text-sm font-semibold hover:underline">
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
          {/* Cabeçalho */}
          <div className="grid grid-cols-12 px-5 py-2.5 border-b border-border bg-bg text-xs font-semibold text-text-3 uppercase tracking-wide">
            <div className="col-span-4">Produto</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Estoque</div>
            <div className="col-span-2">Mínimo</div>
            <div className="col-span-2 text-right">Ações</div>
          </div>

          {/* Linhas */}
          {filtrados.map((p, idx) => {
            const status = getStatus(p);
            const cfg    = STATUS_CFG[status];
            const cat    = CAT_MAP[p.categoria] ?? CAT_MAP['outros'];
            return (
              <div key={p.id}
                className={`bm-stagger grid grid-cols-12 items-center px-5 py-3.5 ${
                  idx < filtrados.length - 1 ? 'border-b border-border' : ''
                }`}
                style={{ '--bm-i': idx, '--bm-step': '40ms' } as React.CSSProperties}>

                {/* Nome + categoria */}
                <div className="col-span-4 flex items-center gap-3 min-w-0">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: cat.bg }}>
                    <Package2 size={13} style={{ color: cat.cor }} strokeWidth={2}/>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text truncate">{p.nome}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <p className="text-xs text-text-4">{cat.label}</p>
                      {p.tipo === 'venda' && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green/10 text-green border border-green/20">
                          PDV
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Status badge */}
                <div className="col-span-2">
                  <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bgClass} ${cfg.textClass}`}>
                    {cfg.label}
                  </span>
                </div>

                {/* Estoque atual */}
                <div className="col-span-2">
                  <span className={`text-sm font-bold ${
                    status === 'critico' ? 'text-red' : status === 'baixo' ? 'text-amber-600' : 'text-text'
                  }`}>
                    {Number(p.estoque_atual) % 1 === 0
                      ? Number(p.estoque_atual)
                      : Number(p.estoque_atual).toFixed(2)}
                  </span>
                  <span className="text-xs text-text-4 ml-1">{p.unidade}</span>
                  {(p.unidade === 'pct' || p.unidade === 'cx') && p.qtd_por_unidade > 1 && (
                    <span className="text-xs text-text-4 ml-1">
                      ({Math.round(Number(p.estoque_atual) * p.qtd_por_unidade)} un)
                    </span>
                  )}
                </div>

                {/* Mínimo */}
                <div className="col-span-2">
                  <span className="text-sm text-text-3">
                    {p.estoque_minimo > 0 ? `${p.estoque_minimo} ${p.unidade}` : '—'}
                  </span>
                </div>

                {/* Ações */}
                <div className="col-span-2 flex items-center justify-end gap-2">
                  <button onClick={() => setModalMov(p)} title="Movimentar estoque"
                    className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-text-4 hover:bg-bg hover:text-text-2 transition">
                    <RefreshCw size={13} strokeWidth={2}/>
                  </button>
                  <button onClick={() => setModalProd({ modo: 'editar', produto: p })} title="Editar produto"
                    className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-text-4 hover:bg-bg hover:text-text-2 transition">
                    <Edit3 size={13} strokeWidth={2}/>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </>}

      {/* ── ABA: MOVIMENTAÇÕES ─────────────────────────────────── */}
      {aba === 'movimentacoes' && (
        <div>
          {/* Navegação de mês */}
          <div className="flex items-center justify-between mb-5">
            <button onClick={() => navMes(-1)}
              className="w-9 h-9 rounded-xl border border-border flex items-center justify-center text-text-3 hover:bg-bg transition">
              <ChevronLeft size={16}/>
            </button>
            <div className="flex items-center gap-2">
              <CalendarDays size={15} className="text-text-3" strokeWidth={2}/>
              <span className="text-sm font-semibold text-text-2 capitalize w-36 text-center">
                {format(mesMov, 'MMMM yyyy', { locale: ptBR })}
              </span>
            </div>
            <button onClick={() => navMes(1)}
              className="w-9 h-9 rounded-xl border border-border flex items-center justify-center text-text-3 hover:bg-bg transition">
              <ChevronRight size={16}/>
            </button>
          </div>

          {/* KPIs do mês */}
          {loadingMov ? (
            <div className="grid grid-cols-3 gap-4 mb-5">
              {[1,2,3].map(i => (
                <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-center gap-3">
                  <Sk className="w-9 h-9 rounded-xl flex-shrink-0"/>
                  <div className="flex flex-col gap-2 flex-1"><Sk className="h-5 w-10"/><Sk className="h-3 w-20"/></div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
              {[
                { label: 'Saídas no mês',  value: movimentos.filter(m => m.tipo === 'saida').length,   sub: `${totalSaidas.toFixed(1)} unid. total`,  icon: ArrowDown, hue: 0   },
                { label: 'Entradas no mês', value: movimentos.filter(m => m.tipo === 'entrada').length, sub: `${totalEntradas.toFixed(1)} unid. total`, icon: ArrowUp,   hue: 145 },
                { label: 'Total registros', value: movimentos.length,                                    sub: 'entradas + saídas',                       icon: List,      hue: 270 },
              ].map(({ label, value, sub, icon: Icon, hue }, idx) => (
                <div key={label} className="bm-stagger"
                  style={{ '--bm-i': idx, '--bm-step': '55ms', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 20, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 12 } as React.CSSProperties}>
                  <div style={{ width: 36, height: 36, borderRadius: 12, background: `linear-gradient(140deg, oklch(0.55 0.16 ${hue}), oklch(0.42 0.17 ${hue}))`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={16} color="white" strokeWidth={2}/>
                  </div>
                  <div>
                    <p style={{ fontSize: 20, fontWeight: 700, lineHeight: 1, color: 'var(--color-ink)', fontFamily: 'var(--font-sans)' }}>{value}</p>
                    <p style={{ fontSize: 11.5, color: 'var(--color-ink3)', marginTop: 2, fontWeight: 500 }}>{label}</p>
                    <p style={{ fontSize: 10, color: 'var(--color-ink4)', marginTop: 2 }}>{sub}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Filtros */}
          <div className="flex items-center gap-3 mb-5">
            {/* Toggle tipo */}
            <div className="flex rounded-xl border border-border overflow-hidden bg-surface text-sm flex-shrink-0">
              {([
                { key: 'todos',   label: 'Todos'    },
                { key: 'entrada', label: '↑ Entradas' },
                { key: 'saida',   label: '↓ Saídas'  },
              ] as const).map(({ key, label }, idx) => (
                <button key={key} onClick={() => setFiltroTipo(key)}
                  className={`px-3.5 h-10 font-semibold transition ${idx > 0 ? 'border-l border-border' : ''} ${
                    filtroTipo === key
                      ? key === 'entrada' ? 'bg-green text-white'
                      : key === 'saida'   ? 'bg-red text-white'
                      : 'bg-primary text-white'
                      : 'text-text-3 hover:text-text-2'
                  }`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Filtro por produto */}
            <div className="flex-1">
              <SearchSelect
                options={[
                  { value: '', label: 'Todos os produtos' },
                  ...produtos.map(p => ({ value: p.id, label: p.nome, sub: p.unidade })),
                ]}
                value={filtroProdId}
                onChange={setFiltroProdId}
                placeholder="Filtrar por produto..."
              />
            </div>
          </div>

          {/* Tabela de movimentações */}
          {loadingMov ? (
            <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
              <div className="grid grid-cols-12 px-5 py-2.5 border-b border-border bg-bg">
                {['col-span-2','col-span-3','col-span-2','col-span-2','col-span-2','col-span-1'].map((c, i) => (
                  <div key={i} className={c}><Sk className="h-3 w-16"/></div>
                ))}
              </div>
              {[1,2,3,4,5].map(i => (
                <div key={i} className="grid grid-cols-12 items-center px-5 py-3.5 border-b border-border last:border-0 gap-2">
                  <div className="col-span-2"><Sk className="h-4 w-20"/></div>
                  <div className="col-span-3"><Sk className="h-4 w-28"/></div>
                  <div className="col-span-2"><Sk className="h-5 w-16 rounded-full"/></div>
                  <div className="col-span-2"><Sk className="h-4 w-12"/></div>
                  <div className="col-span-2"><Sk className="h-4 w-24"/></div>
                  <div className="col-span-1"><Sk className="h-4 w-12"/></div>
                </div>
              ))}
            </div>
          ) : movFiltrados.length === 0 ? (
            <div className="text-center py-16 bg-surface border border-border rounded-2xl shadow-sm">
              <List size={32} className="mx-auto mb-3 text-text-4" strokeWidth={1.5}/>
              <p className="text-text-3 text-sm">
                {movimentos.length === 0
                  ? 'Nenhuma movimentação registrada neste mês.'
                  : 'Nenhuma movimentação encontrada com esses filtros.'}
              </p>
              {movimentos.length > 0 && (
                <button onClick={() => { setFiltroTipo('todos'); setFiltroProdId(''); }}
                  className="text-accent text-sm font-semibold hover:underline mt-2">
                  Limpar filtros
                </button>
              )}
            </div>
          ) : (
            <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
              {/* Cabeçalho */}
              <div className="grid grid-cols-12 px-5 py-2.5 border-b border-border bg-bg text-xs font-semibold text-text-3 uppercase tracking-wide">
                <div className="col-span-2">Data</div>
                <div className="col-span-3">Produto</div>
                <div className="col-span-2">Tipo</div>
                <div className="col-span-2">Quantidade</div>
                <div className="col-span-3">Motivo / Origem</div>
              </div>

              {/* Linhas */}
              {movFiltrados.map((m, idx) => {
                const isEntrada = m.tipo === 'entrada';
                const isAjuste  = m.tipo === 'ajuste';
                const data = parseISO(m.created_at);
                return (
                  <div key={m.id}
                    className={`grid grid-cols-12 items-center px-5 py-3.5 ${
                      idx < movFiltrados.length - 1 ? 'border-b border-border' : ''
                    }`}>

                    {/* Data */}
                    <div className="col-span-2">
                      <p className="text-sm font-semibold text-text">{format(data, 'dd/MM')}</p>
                      <p className="text-xs text-text-4">{format(data, 'HH:mm')}</p>
                    </div>

                    {/* Produto */}
                    <div className="col-span-3 min-w-0">
                      <p className="text-sm text-text font-medium truncate">{m.produto.nome}</p>
                    </div>

                    {/* Tipo badge */}
                    <div className="col-span-2">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        isEntrada ? 'bg-green/10 text-green'
                        : isAjuste ? 'bg-primary-soft text-primary'
                        : 'bg-red/10 text-red'
                      }`}>
                        {isEntrada ? <ArrowUp size={10} strokeWidth={2.5}/> : isAjuste ? <RefreshCw size={10} strokeWidth={2}/> : <ArrowDown size={10} strokeWidth={2.5}/>}
                        {isEntrada ? 'Entrada' : isAjuste ? 'Ajuste' : 'Saída'}
                      </span>
                    </div>

                    {/* Quantidade */}
                    <div className="col-span-2">
                      <span className={`text-sm font-bold ${
                        isEntrada ? 'text-green' : isAjuste ? 'text-primary' : 'text-red'
                      }`}>
                        {isEntrada ? '+' : isAjuste ? '=' : '−'}{Number(m.quantidade) % 1 === 0 ? Number(m.quantidade) : Number(m.quantidade).toFixed(2)}
                      </span>
                      <span className="text-xs text-text-4 ml-1">{m.produto.unidade}</span>
                    </div>

                    {/* Motivo / Origem */}
                    <div className="col-span-3 min-w-0">
                      {m.agendamento_id ? (
                        <span className="inline-flex items-center gap-1 text-xs text-primary bg-primary-soft px-2 py-0.5 rounded-lg font-semibold">
                          <CalendarDays size={10} strokeWidth={2}/>
                          Agendamento
                        </span>
                      ) : (
                        <span className="text-xs text-text-4 italic">
                          {m.motivo || 'Registro manual'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modais */}
      {modalProd && empresaId && (
        <ProdutoModal
          empresaId={empresaId}
          state={modalProd}
          onClose={() => setModalProd(null)}
          onSalvo={onProdutoSalvo}/>
      )}
      {modalMov && (
        <MovModal
          produto={modalMov}
          onClose={() => setModalMov(null)}
          onSalvo={(novoEst, tipo, qtd) => onMovSalvo(modalMov, novoEst, tipo, qtd)}/>
      )}
    </div>
  );
}
