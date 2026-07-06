'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, Clock, Edit3, X, Trash2, Package2, Layers, Zap, EyeOff, ChevronDown } from 'lucide-react';
import {
  IconCilios, IconSobrancelhas, IconDepilacao, IconUnhas,
  IconPele, IconDermaplaning, IconMaquiagem, IconOutros,
} from '@/components/CategoriaIcon';
import { createClient } from '@/lib/supabase/client';
import { Sk } from '@/components/Skeleton';
import { SearchSelect } from '@/components/SearchSelect';
import { ExportButton } from '@/components/ExportButton';

const supabase = createClient();

// ── Tipos ─────────────────────────────────────────────────────

type CategoriaKey =
  | 'cilios' | 'sobrancelhas' | 'depilacao' | 'unhas'
  | 'pele' | 'dermaplaning' | 'maquiagem' | 'outros';

type Servico = {
  id: string; empresa_id: string; nome: string; descricao?: string;
  categoria: CategoriaKey; preco: number; custo: number;
  duracao_minutos: number; ativo: boolean;
};

// ── Configuração de categoria ─────────────────────────────────

const CATEGORIAS: { key: CategoriaKey; label: string; icon: React.ElementType; cor: string; bg: string }[] = [
  { key: 'cilios',        label: 'Cílios',        icon: IconCilios,       cor: '#4F46E5', bg: '#EEF2FF' },
  { key: 'sobrancelhas',  label: 'Sobrancelhas',  icon: IconSobrancelhas, cor: '#7C3AED', bg: '#F3EFFE' },
  { key: 'depilacao',     label: 'Depilação',     icon: IconDepilacao,    cor: '#D4608A', bg: '#FDF0F5' },
  { key: 'unhas',         label: 'Unhas',         icon: IconUnhas,        cor: '#B45309', bg: '#FEF3E2' },
  { key: 'pele',          label: 'Pele',          icon: IconPele,         cor: '#0D7E5F', bg: '#EAFAF5' },
  { key: 'dermaplaning',  label: 'Dermaplaning',  icon: IconDermaplaning, cor: '#0891B2', bg: '#ECFEFF' },
  { key: 'maquiagem',     label: 'Maquiagem',     icon: IconMaquiagem,    cor: '#C026D3', bg: '#FDF4FF' },
  { key: 'outros',        label: 'Outros',        icon: IconOutros,       cor: '#6B7280', bg: '#F3F4F6' },
];

const CAT_MAP = Object.fromEntries(CATEGORIAS.map(c => [c.key, c])) as Record<CategoriaKey, typeof CATEGORIAS[0]>;

const DURACOES = [
  { label: '30 min', valor: 30  },
  { label: '45 min', valor: 45  },
  { label: '1h',     valor: 60  },
  { label: '1h30',   valor: 90  },
  { label: '2h',     valor: 120 },
  { label: '3h',     valor: 180 },
];

function fmtDuracao(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${m}` : `${h}h`;
}

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 0,
  }).format(v);
}

// ── Inputs ────────────────────────────────────────────────────

const inputClass = "w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
const labelClass = "block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5";

// ── Modal criar / editar ──────────────────────────────────────

type ModalState =
  | { modo: 'criar'; categoria?: CategoriaKey }
  | { modo: 'editar'; servico: Servico };

type InsumoItem = {
  produto_id: string;
  nome: string;
  unidade: string;
  quantidade: string; // string p/ input controlado
};

function ServicoModal({ empresaId, state, onClose, onSalvo }: {
  empresaId: string;
  state: ModalState;
  onClose: () => void;
  onSalvo: (s: Servico) => void;
}) {
  const editando = state.modo === 'editar' ? state.servico : null;
  const catInicial: CategoriaKey = editando?.categoria ?? (state.modo === 'criar' ? (state.categoria ?? 'outros') : 'outros');

  const [nome,        setNome]        = useState(editando?.nome      ?? '');
  const [descricao,   setDescricao]   = useState(editando?.descricao ?? '');
  const [categoria,   setCategoria]   = useState<CategoriaKey>(catInicial);
  const [preco,       setPreco]       = useState(editando ? String(editando.preco) : '');
  const [custo,       setCusto]       = useState(editando && editando.custo > 0 ? String(editando.custo) : '');
  const duracaoInicial = editando?.duracao_minutos ?? 60;
  const duracaoEhPreset = DURACOES.some(d => d.valor === duracaoInicial);
  const [duracao,           setDuracao]           = useState(duracaoInicial);
  const [duracaoPersonal,   setDuracaoPersonal]   = useState(!duracaoEhPreset);
  const [horasInput,        setHorasInput]        = useState(String(Math.floor(duracaoInicial / 60)));
  const [minutosInput,      setMinutosInput]      = useState(String(duracaoInicial % 60));
  const [salvando,  setSalvando]  = useState(false);
  const [erro,      setErro]      = useState('');

  // ── Insumos ────────────────────────────────────────────────
  const [produtos,    setProdutos]    = useState<{ id: string; nome: string; unidade: string }[]>([]);
  const [insumos,     setInsumos]     = useState<InsumoItem[]>([]);
  const [addProdId,   setAddProdId]   = useState('');

  useEffect(() => {
    (async () => {
      // Busca produtos da empresa para o select
      const { data: prods } = await supabase.from('produtos').select('id, nome, unidade')
        .eq('empresa_id', empresaId).eq('ativo', true).order('nome');
      setProdutos((prods ?? []) as { id: string; nome: string; unidade: string }[]);

      // Busca insumos já vinculados (só no modo editar)
      if (editando) {
        const { data: ins } = await supabase.from('servico_produtos')
          .select('produto_id, quantidade, produto:produtos(nome, unidade)')
          .eq('servico_id', editando.id);
        setInsumos(((ins ?? []) as any[]).map(r => ({
          produto_id: r.produto_id,
          nome:       r.produto.nome,
          unidade:    r.produto.unidade,
          quantidade: String(r.quantidade),
        })));
      }
    })();
  }, [empresaId, editando?.id]);

  function adicionarInsumo(prodId: string) {
    if (!prodId || insumos.find(i => i.produto_id === prodId)) return;
    const prod = produtos.find(p => p.id === prodId);
    if (!prod) return;
    setInsumos(prev => [...prev, { produto_id: prodId, nome: prod.nome, unidade: prod.unidade, quantidade: '1' }]);
    setAddProdId('');
  }

  function removerInsumo(prodId: string) {
    setInsumos(prev => prev.filter(i => i.produto_id !== prodId));
  }

  function atualizarQtd(prodId: string, qtd: string) {
    setInsumos(prev => prev.map(i => i.produto_id === prodId ? { ...i, quantidade: qtd } : i));
  }

  async function sincronizarInsumos(servicoId: string) {
    // Apaga os existentes e reinsere
    await supabase.from('servico_produtos').delete().eq('servico_id', servicoId);
    const validos = insumos.filter(i => parseFloat(i.quantidade.replace(',', '.')) > 0);
    if (validos.length === 0) return;
    await supabase.from('servico_produtos').insert(
      validos.map(i => ({
        servico_id: servicoId,
        produto_id: i.produto_id,
        quantidade: parseFloat(i.quantidade.replace(',', '.')) || 1,
      })),
    );
  }

  const podeSalvar = nome.trim().length > 0 && parseFloat(preco.replace(',', '.')) > 0;

  function parseValor(v: string) { return parseFloat(v.replace(',', '.')) || 0; }

  async function salvar() {
    if (!podeSalvar) return;
    setErro(''); setSalvando(true);

    const payload = {
      empresa_id:      empresaId,
      nome:            nome.trim(),
      descricao:       descricao.trim() || null,
      categoria,
      preco:           parseValor(preco),
      custo:           parseValor(custo),
      duracao_minutos: duracao,
      ativo:           editando?.ativo ?? true,
    };

    if (editando) {
      const { data, error } = await supabase
        .from('servicos').update(payload).eq('id', editando.id).select().single();
      if (error) { setSalvando(false); setErro(error.message); return; }
      await sincronizarInsumos(editando.id);
      setSalvando(false);
      onSalvo(data as Servico);
    } else {
      const { data, error } = await supabase
        .from('servicos').insert(payload).select().single();
      if (error) { setSalvando(false); setErro(error.message); return; }
      await sincronizarInsumos((data as Servico).id);
      setSalvando(false);
      onSalvo(data as Servico);
    }
  }

  const catAtual = CAT_MAP[categoria];

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <h2 className="font-serif text-xl text-text">
            {editando ? 'Editar serviço' : 'Novo serviço'}
          </h2>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
            <X size={16}/>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">

          {/* Nome */}
          <div>
            <label className={labelClass}>Nome do serviço *</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              placeholder="Ex: Design de Sobrancelha" className={inputClass}/>
          </div>

          {/* Descrição */}
          <div>
            <label className={labelClass}>Descrição <span className="text-text-4 normal-case font-normal">(opcional)</span></label>
            <textarea value={descricao} onChange={e => setDescricao(e.target.value)}
              rows={2} placeholder="Detalhes do serviço..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition resize-none"/>
          </div>

          {/* Categoria */}
          <div>
            <label className={labelClass}>Categoria</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIAS.map(({ key, label, icon: Icon, cor, bg }) => {
                const ativo = categoria === key;
                return (
                  <button key={key} type="button" onClick={() => setCategoria(key)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition"
                    style={{
                      backgroundColor: ativo ? bg : undefined,
                      borderColor: ativo ? cor : undefined,
                      color: ativo ? cor : undefined,
                    }}
                    data-inactive={!ativo || undefined}>
                    <Icon size={12} strokeWidth={2}
                      style={{ color: ativo ? cor : undefined }}
                      className={!ativo ? 'text-text-4' : ''}/>
                    <span className={!ativo ? 'text-text-3' : ''}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preço e Custo */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Preço cobrado *</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
                <input value={preco} onChange={e => setPreco(e.target.value)}
                  inputMode="decimal" placeholder="0,00"
                  className={`${inputClass} pl-9`}/>
              </div>
            </div>
            <div>
              <label className={labelClass}>Custo <span className="text-text-4 normal-case font-normal">(opcional)</span></label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
                <input value={custo} onChange={e => setCusto(e.target.value)}
                  inputMode="decimal" placeholder="0,00"
                  className={`${inputClass} pl-9`}/>
              </div>
            </div>
          </div>

          {/* Duração */}
          <div>
            <label className={labelClass}>Duração</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {DURACOES.map(({ label, valor }) => {
                const ativo = !duracaoPersonal && duracao === valor;
                return (
                  <button key={valor} type="button"
                    onClick={() => {
                      setDuracao(valor);
                      setDuracaoPersonal(false);
                      setHorasInput(String(Math.floor(valor / 60)));
                      setMinutosInput(String(valor % 60));
                    }}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition ${
                      ativo
                        ? 'bg-primary-soft border-primary/30 text-primary'
                        : 'bg-bg border-border text-text-3 hover:border-accent'
                    }`}>
                    <Clock size={11} strokeWidth={2}/>
                    {label}
                  </button>
                );
              })}
              <button type="button"
                onClick={() => setDuracaoPersonal(true)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition ${
                  duracaoPersonal
                    ? 'bg-primary-soft border-primary/30 text-primary'
                    : 'bg-bg border-border text-text-3 hover:border-accent'
                }`}>
                <Clock size={11} strokeWidth={2}/>
                Personalizado
              </button>
            </div>
            {duracaoPersonal && (
              <div className="rounded-xl p-3 flex items-center gap-3 flex-wrap" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border-soft)' }}>
                <div className="flex items-center gap-2">
                  <input
                    value={horasInput}
                    onChange={e => {
                      const txt = e.target.value.replace(/\D/g, '').slice(0, 2);
                      setHorasInput(txt);
                      const h = parseInt(txt, 10) || 0;
                      const m = parseInt(minutosInput, 10) || 0;
                      const total = h * 60 + Math.min(m, 59);
                      if (total > 0) setDuracao(total);
                    }}
                    onBlur={() => { if (horasInput === '') setHorasInput('0'); }}
                    inputMode="numeric"
                    placeholder="0"
                    aria-label="Horas"
                    className={`${inputClass} w-16 text-center`}
                  />
                  <span className="text-xs font-semibold text-text-3">h</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={minutosInput}
                    onChange={e => {
                      const txt = e.target.value.replace(/\D/g, '').slice(0, 2);
                      setMinutosInput(txt);
                      const m = Math.min(parseInt(txt, 10) || 0, 59);
                      const h = parseInt(horasInput, 10) || 0;
                      const total = h * 60 + m;
                      if (total > 0) setDuracao(total);
                    }}
                    onBlur={() => {
                      const m = parseInt(minutosInput, 10);
                      if (isNaN(m)) { setMinutosInput('0'); return; }
                      const clamped = Math.min(Math.max(m, 0), 59);
                      setMinutosInput(String(clamped));
                    }}
                    inputMode="numeric"
                    placeholder="0"
                    aria-label="Minutos"
                    className={`${inputClass} w-16 text-center`}
                  />
                  <span className="text-xs font-semibold text-text-3">min</span>
                </div>
                <span className="text-xs text-text-4 ml-auto">= {fmtDuracao(duracao)}</span>
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="rounded-xl p-3.5 flex items-center gap-3 border"
            style={{ backgroundColor: catAtual.bg, borderColor: `${catAtual.cor}30` }}>
            <catAtual.icon size={28} strokeWidth={1.5} style={{ color: catAtual.cor, flexShrink: 0 }}/>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text truncate">{nome || 'Nome do serviço'}</p>
              <p className="text-xs text-text-3 mt-0.5">
                {fmtDuracao(duracao)} · {preco ? fmtBRL(parseValor(preco)) : 'Preço não definido'}
              </p>
            </div>
          </div>

          {/* Insumos */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Package2 size={14} className="text-text-3" strokeWidth={2}/>
              <label className={labelClass} style={{ marginBottom: 0 }}>Insumos consumidos</label>
              <span className="text-xs text-text-4 font-normal normal-case">(opcional)</span>
            </div>
            <p className="text-xs text-text-4 mb-3">
              Produtos debitados do estoque ao concluir um agendamento deste serviço.
            </p>

            {/* Lista de insumos */}
            {insumos.length > 0 && (
              <div className="flex flex-col gap-2 mb-3">
                {insumos.map(ins => (
                  <div key={ins.produto_id} className="flex items-center gap-2 bg-bg rounded-xl px-3 py-2">
                    <span className="flex-1 text-sm text-text truncate">{ins.nome}</span>
                    <input
                      value={ins.quantidade}
                      onChange={e => atualizarQtd(ins.produto_id, e.target.value)}
                      inputMode="decimal"
                      className="w-16 h-8 px-2 text-sm text-center rounded-lg border border-border bg-surface focus:outline-none focus:border-accent transition"
                    />
                    <span className="text-xs text-text-4 w-6 flex-shrink-0">{ins.unidade}</span>
                    <button type="button" onClick={() => removerInsumo(ins.produto_id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition flex-shrink-0">
                      <Trash2 size={12} strokeWidth={2}/>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Adicionar produto */}
            <SearchSelect
              options={produtos
                .filter(p => !insumos.find(i => i.produto_id === p.id))
                .map(p => ({ value: p.id, label: p.nome, sub: p.unidade }))}
              value={addProdId}
              onChange={id => { setAddProdId(id); adicionarInsumo(id); }}
              placeholder="+ Adicionar insumo..."
            />
          </div>

          {erro && <p className="text-red text-sm">{erro}</p>}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-border flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
            Cancelar
          </button>
          <button onClick={salvar} disabled={!podeSalvar || salvando}
            className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-50">
            {salvando ? 'Salvando...' : editando ? 'Salvar alterações' : 'Criar serviço'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Card de serviço ───────────────────────────────────────────

function ServicoCard({ servico, onToggle, onEdit, onDelete, onCancelDelete, excluindo }: {
  servico: Servico;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  excluindo: boolean;
}) {
  const cat = CAT_MAP[servico.categoria] ?? CAT_MAP.outros;
  const Icon = cat.icon;

  let hue = 0;
  for (let i = 0; i < cat.key.length; i++) hue = (hue * 31 + cat.key.charCodeAt(i)) % 360;

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 20, padding: 14, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', opacity: servico.ativo ? 1 : 0.5, transition: 'opacity 0.2s' }}>
      {/* Linha 1: ícone + nome/descrição + preço */}
      <div className="flex items-start gap-3">
        {/* Ícone categoria */}
        <div style={{ width: 36, height: 36, borderRadius: 12, background: `linear-gradient(140deg, oklch(0.55 0.16 ${hue}), oklch(0.42 0.17 ${hue}))`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={15} strokeWidth={2} color="white"/>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-ink)', fontFamily: 'var(--font-sans)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{servico.nome}</p>
          {servico.descricao && (
            <p style={{ fontSize: 11.5, color: 'var(--color-ink3)', marginTop: 2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>{servico.descricao}</p>
          )}
        </div>

        {/* Preço */}
        <span className="flex-shrink-0" style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-primary)', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' }}>
          {fmtBRL(servico.preco)}
        </span>
      </div>

      {/* Linha 2: metadados + ações */}
      <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border-soft)' }}>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="flex items-center gap-1" style={{ fontSize: 11.5, color: 'var(--color-ink4)', whiteSpace: 'nowrap' }}>
            <Clock size={11} strokeWidth={2}/> {fmtDuracao(servico.duracao_minutos)}
          </span>
          {servico.custo > 0 && (
            <span style={{ fontSize: 11.5, color: 'var(--color-ink4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Custo {fmtBRL(servico.custo)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {excluindo ? (
            <>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-rose)', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' }}>Excluir?</span>
              <button onClick={onDelete} aria-label="Confirmar exclusão"
                className="w-8 h-8 rounded-lg flex items-center justify-center transition"
                style={{ background: 'var(--color-rose)', color: '#fff' }}>
                <Trash2 size={13} strokeWidth={2.5}/>
              </button>
              <button onClick={onCancelDelete} aria-label="Cancelar"
                className="w-8 h-8 rounded-lg border border-border text-text-4 hover:bg-bg flex items-center justify-center transition">
                <X size={13} strokeWidth={2.5}/>
              </button>
            </>
          ) : (
            <>
              <button onClick={onEdit} aria-label="Editar serviço"
                className="w-8 h-8 rounded-lg border border-border text-text-4 hover:bg-bg hover:text-text-2 flex items-center justify-center transition">
                <Edit3 size={13} strokeWidth={2}/>
              </button>
              <button onClick={onDelete} aria-label="Excluir serviço"
                className="w-8 h-8 rounded-lg border border-border text-text-4 hover:bg-rose-soft hover:text-rose flex items-center justify-center transition">
                <Trash2 size={13} strokeWidth={2}/>
              </button>
              <button
                onClick={onToggle}
                aria-label={servico.ativo ? 'Desativar serviço' : 'Ativar serviço'}
                title={servico.ativo ? 'Desativar' : 'Ativar'}
                className={`relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ml-1 ${
                  servico.ativo ? 'bg-green' : 'bg-border'
                }`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-200 ${
                  servico.ativo ? 'left-[18px]' : 'left-0.5'
                }`}/>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tela principal ────────────────────────────────────────────

export default function ServicosPage() {
  const [servicos,    setServicos]    = useState<Servico[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [empresaId,   setEmpresaId]   = useState<string | null>(null);
  const [modal,       setModal]       = useState<ModalState | null>(null);
  const [colapsos,    setColapsos]    = useState<Set<CategoriaKey>>(new Set());
  const [excluindoId,   setExcluindoId]   = useState<string | null>(null);
  const [toastErro,     setToastErro]     = useState('');
  const [toastSucesso,  setToastSucesso]  = useState('');

  function toggleColapso(key: CategoriaKey) {
    setColapsos(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membro } = await supabase.from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (!membro) return;
      setEmpresaId(membro.empresa_id);
      const { data } = await supabase.from('servicos').select('*')
        .eq('empresa_id', membro.empresa_id).order('categoria').order('nome');
      setServicos((data ?? []) as Servico[]);
      setLoading(false);
    })();
  }, []);

  async function excluirServico(s: Servico) {
    setExcluindoId(null);
    const { error } = await supabase.from('servicos').delete().eq('id', s.id);
    if (error) {
      setToastErro('Serviço possui atendimentos vinculados — desative-o em vez de excluir.');
      setTimeout(() => setToastErro(''), 4500);
      return;
    }
    setServicos(prev => prev.filter(x => x.id !== s.id));
    setToastSucesso(`Serviço "${s.nome}" excluído.`);
    setTimeout(() => setToastSucesso(''), 3500);
  }

  async function toggleAtivo(s: Servico) {
    await supabase.from('servicos').update({ ativo: !s.ativo }).eq('id', s.id);
    setServicos(prev => prev.map(x => x.id === s.id ? { ...x, ativo: !x.ativo } : x));
  }

  function onSalvo(novo: Servico) {
    setServicos(prev => {
      const existe = prev.find(x => x.id === novo.id);
      if (existe) return prev.map(x => x.id === novo.id ? novo : x)
        .sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome));
      return [...prev, novo]
        .sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome));
    });
    setModal(null);
  }

  const total  = servicos.length;
  const ativos = servicos.filter(s => s.ativo).length;

  // Agrupa por categoria na ordem definida
  const porCategoria = CATEGORIAS.map(cat => ({
    cat,
    items: servicos.filter(s => s.categoria === cat.key),
  })).filter(g => g.items.length > 0);

  return (
    <div className="bm-page">
      {/* Toasts */}
      {toastErro && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-5 py-3 rounded-2xl shadow-lg font-semibold text-sm pointer-events-none"
          style={{ background: 'var(--color-rose)', color: '#fff', fontFamily: 'var(--font-sans)' }}>
          {toastErro}
        </div>
      )}
      {toastSucesso && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-5 py-3 rounded-2xl shadow-lg font-semibold text-sm pointer-events-none"
          style={{ background: 'var(--color-green)', color: '#fff', fontFamily: 'var(--font-sans)' }}>
          {toastSucesso}
        </div>
      )}

      {/* Header Bellamore */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>Catálogo</p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>Serviços</h1>
        </div>
        <div className="flex gap-2 pt-1">
          <ExportButton
            filename="servicos"
            title="Catálogo de Serviços"
            columns={[
              { header: 'Nome',      accessor: (s: Servico) => s.nome,                                                                                     width: 28 },
              { header: 'Categoria', accessor: (s: Servico) => CAT_MAP[s.categoria]?.label ?? s.categoria,                                                   width: 16 },
              { header: 'Duração',   accessor: (s: Servico) => fmtDuracao(s.duracao_minutos),                                                                width: 12 },
              { header: 'Preço',     accessor: (s: Servico) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(s.preco),       width: 14 },
              { header: 'Custo',     accessor: (s: Servico) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(s.custo),       width: 14 },
              { header: 'Status',    accessor: (s: Servico) => s.ativo ? 'Ativo' : 'Inativo',                                                                width: 10 },
            ]}
            getData={() => servicos}
          />
          <button onClick={() => setModal({ modo: 'criar' })} className="press flex items-center gap-2 px-4 h-10 rounded-2xl text-white text-sm font-bold"
            style={{ background: 'var(--color-primary)', boxShadow: '0 6px 20px rgba(44,23,80,0.18)', fontFamily: 'var(--font-sans)' }}>
            <Plus size={15} strokeWidth={2.5}/> Novo serviço
          </button>
        </div>
      </div>

      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
          {[1,2,3].map(i => <div key={i} className="rounded-2xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}><Sk className="h-7 w-12 mb-2"/><Sk className="h-3 w-16"/></div>)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total',    value: total,          color: 'var(--color-primary)', bg: 'var(--color-primary-soft)', icon: Layers  },
            { label: 'Ativos',   value: ativos,         color: 'var(--color-green)',   bg: 'var(--color-green-soft)',   icon: Zap     },
            { label: 'Inativos', value: total - ativos, color: 'var(--color-ink3)',    bg: 'var(--color-bg2)',          icon: EyeOff  },
          ].map(({ label, value, color, bg, icon: Icon }, i) => (
            <div key={label} className="bm-stagger rounded-2xl p-4 flex items-center gap-3"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 2px 6px rgba(44,23,80,0.06)', '--bm-i': i, '--bm-step': '55ms' } as React.CSSProperties}>
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
                <Icon size={18} style={{ color }} strokeWidth={1.8}/>
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
        <div className="flex flex-col gap-8">
          {[1,2].map(group => (
            <div key={group}>
              {/* Cabeçalho da categoria */}
              <div className="flex items-center gap-2.5 mb-3 rounded-2xl px-2.5 py-2 border border-border">
                <Sk className="w-9 h-9 rounded-xl flex-shrink-0"/>
                <Sk className="h-3.5 w-20"/>
                <Sk className="h-3 w-14 ml-auto"/>
              </div>
              {/* Cards */}
              <div className="flex flex-col gap-2">
                {[1,2,3].map(i => (
                  <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-center gap-4">
                    <Sk className="w-9 h-9 rounded-xl flex-shrink-0"/>
                    <div className="flex-1 flex flex-col gap-2">
                      <Sk className="h-4 w-36"/>
                      <Sk className="h-3 w-52"/>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Sk className="h-4 w-16"/>
                      <Sk className="h-3 w-10"/>
                    </div>
                    <Sk className="w-8 h-[18px] rounded-full flex-shrink-0"/>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : servicos.length === 0 ? (
        <div className="text-center py-16 rounded-2xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <IconOutros size={32} style={{ margin: '0 auto 12px', color: 'var(--color-ink4)' }} strokeWidth={1.5}/>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--color-ink3)', marginBottom: 12 }}>Nenhum serviço cadastrado ainda.</p>
          <button onClick={() => setModal({ modo: 'criar' })} style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, color: 'var(--color-accent)' }}>
            + Cadastrar primeiro serviço
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {porCategoria.map(({ cat, items }) => {
            const Icon = cat.icon;
            const colapsado = colapsos.has(cat.key);
            return (
              <div key={cat.key}>
                {/* Header da categoria */}
                <div className="flex items-center gap-2.5 mb-3 rounded-2xl pl-2.5 pr-2 py-2"
                  style={{ background: cat.bg, border: `1px solid ${cat.cor}30` }}>
                  <button
                    onClick={() => toggleColapso(cat.key)}
                    className="flex items-center gap-2.5 flex-1 min-w-0 group"
                    title={colapsado ? 'Expandir' : 'Colapsar'}>
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm" style={{ background: cat.cor }}>
                      <Icon size={17} strokeWidth={2} style={{ color: '#fff' }}/>
                    </div>
                    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 800, letterSpacing: '0.02em', color: cat.cor }}>
                      {cat.label}
                    </span>
                    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11.5, fontWeight: 600, color: 'var(--color-ink3)' }}>
                      {items.length} {items.length === 1 ? 'serviço' : 'serviços'}
                    </span>
                    <ChevronDown
                      size={15} strokeWidth={2.5}
                      style={{ color: cat.cor, transition: 'transform 0.2s', transform: colapsado ? 'rotate(-90deg)' : 'rotate(0deg)', flexShrink: 0 }}/>
                  </button>
                  <button
                    onClick={() => setModal({ modo: 'criar', categoria: cat.key })}
                    title={`Novo serviço em ${cat.label}`}
                    className="w-7 h-7 rounded-xl flex items-center justify-center border transition flex-shrink-0"
                    style={{ borderColor: `${cat.cor}40`, color: cat.cor, background: 'var(--color-surface)' }}>
                    <Plus size={13} strokeWidth={2.5}/>
                  </button>
                </div>

                {/* Cards — colapsa com animação suave */}
                <div style={{ display: 'grid', gridTemplateRows: colapsado ? '0fr' : '1fr', transition: 'grid-template-rows 0.22s ease' }}>
                  <div className="overflow-hidden">
                    <div className="flex flex-col gap-2 pt-0">
                      {items.map((s, i) => (
                        <div key={s.id} className="bm-stagger" style={{ '--bm-i': i, '--bm-step': '55ms' } as React.CSSProperties}>
                          <ServicoCard
                            servico={s}
                            onToggle={() => toggleAtivo(s)}
                            onEdit={() => setModal({ modo: 'editar', servico: s })}
                            excluindo={excluindoId === s.id}
                            onDelete={() => excluindoId === s.id ? excluirServico(s) : setExcluindoId(s.id)}
                            onCancelDelete={() => setExcluindoId(null)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {modal && empresaId && (
        <ServicoModal
          empresaId={empresaId}
          state={modal}
          onClose={() => setModal(null)}
          onSalvo={onSalvo}/>
      )}
    </div>
  );
}
