'use client';

/**
 * @file financeiro/page.tsx
 * Módulo financeiro completo com KPIs, evolução e gestão de despesas.
 *
 * ## KPIs calculados
 * Todos os valores são calculados a partir de agendamentos (status = 'concluido'),
 * NÃO da tabela `comissoes` ou `pagamentos`.
 *
 * - Faturamento Bruto  = soma de agendamentos.valor + vendas.valor_final + taxas_cancelamento pagas no mês
 * - Comissões          = Σ (valor × percentual_comissao / 100) por profissional
 * - Faturamento Líquido = Bruto − Comissões
 * - Gastos             = soma de despesas do mês
 * - Lucro Real         = Líquido − Gastos
 *
 * ## Comparativo mês anterior
 * Cada KPI exibe o delta percentual vs. mês anterior.
 * `delta(atual, anterior)` retorna null se anterior = 0 (evita divisão por zero).
 *
 * ## Gráfico de evolução
 * Busca agendamentos dos últimos 12 meses em UMA query só (range de datas),
 * depois agrupa por mês no client usando `isSameMonth` do date-fns.
 * Evita 6 queries paralelas.
 *
 * ## Despesas
 * - Listagem do mês com status pendente/pago
 * - Modal de nova despesa com suporte a recorrentes
 * - Modal de marcar como pago (registra data e forma de pagamento)
 *
 * ## Taxas de cancelamento
 * - Listagem do mês (pendente/pago) com ação "marcar como paga"
 * - Taxas pagas no mês entram no Faturamento Bruto
 */

import { useState, useEffect, useMemo } from 'react';
import {
  Plus, TrendingUp, TrendingDown,
  CheckCircle2, AlertTriangle, Ban, X, Layers, Banknote, CreditCard, Gift,
  RefreshCw, Check, Pencil, Trash2,
} from 'lucide-react';
import { ExportButton } from '@/components/ExportButton';
import { FinanceMonthCalendar } from '@/components/FinanceMonthCalendar';
import { createClient } from '@/lib/supabase/client';
import { useScrollLock } from '@/lib/useScrollLock';
import { Sk } from '@/components/Skeleton';
import {
  format, addMonths, subMonths, isSameMonth,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { buildDespesaPagamentoUpdate, formatValorMonetarioInput, diasParaVencimento, progressoVencimento, templatesRecorrentesParaLancar, calcularRecorrenciaAtePorParcelas, clampParcelaAtual, proximaParcelaAtual, calcularParcelaDerivada, dividirValorCompra } from '@shared/despesas';
import {
  type FinanceiroFechamentoRow,
  getFechamentoForMonth,
  resolveFinanceiroKpis,
} from '@/lib/financeiro/fechamentos-mensais';
import { getMonthQueryBounds } from '@/lib/financeiro/periodo-mensal';
import type { TaxaCancelamento, TaxaReserva } from '@/types';

const supabase = createClient();

// ── Tipos ─────────────────────────────────────────────────────

type Despesa = {
  id: string; descricao: string; categoria?: string;
  valor: number; recorrente: boolean; periodicidade?: string;
  data_vencimento?: string; data_pagamento?: string; recorrencia_ate?: string;
  parcela_atual?: number; total_parcelas?: number; valor_total_compra?: number;
  created_at?: string;
  status: 'pendente' | 'pago';
};
type TopServico = { nome: string; quantidade: number; receita: number; percentual: number };
type MetodoPag  = { metodo: string; valor: number; quantidade: number; percentual: number };
type RecorrenteTemplate = { descricao: string; categoria?: string; valor: number; periodicidade?: string; data_vencimento?: string; recorrencia_ate?: string; parcela_atual?: number; total_parcelas?: number; valor_total_compra?: number };

/** Uma linha do painel de detalhamento (histórico) aberto ao clicar num KPI ou forma de pagamento. */
type LedgerItem = { data: string; descricao: string; valor: number; sinal: 1 | -1; categoria: string };

/** Cor fixa para as categorias de transação já conhecidas — nomes (ex.: de profissional) caem no hash abaixo. */
const CATEGORIA_CORES: Record<string, string> = {
  'Serviço':               'var(--color-green)',
  'Venda':                 'var(--color-primary)',
  'Taxa de cancelamento':  'var(--color-rose)',
  'Taxa de cartão':        'var(--color-amber)',
  'Comissão':              '#7C3AED',
  'Despesa':               'var(--color-red)',
};
function corCategoria(categoria: string): string {
  if (CATEGORIA_CORES[categoria]) return CATEGORIA_CORES[categoria];
  let hue = 0;
  for (let i = 0; i < categoria.length; i++) hue = (hue * 31 + categoria.charCodeAt(i)) % 360;
  return `oklch(0.5 0.15 ${hue})`;
}

// ── Helpers ───────────────────────────────────────────────────

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);
}
function delta(atual: number, anterior: number) {
  if (anterior === 0) return null;
  return Math.round(((atual - anterior) / anterior) * 100);
}

const CATEGORIAS_DESP = [
  'Aluguel', 'Energia', 'Água', 'Internet',
  'Produtos / Insumos', 'Manutenção', 'Marketing', 'Contabilidade', 'Outros',
];
const PERIODICIDADES = [
  { key: 'semanal', label: 'Semanal' },
  { key: 'mensal', label: 'Mensal' },
  { key: 'trimestral', label: 'Trimestral' },
  { key: 'semestral', label: 'Semestral' },
  { key: 'anual', label: 'Anual' },
] as const;

const METODO_CFG: Record<string, { label: string; icon: React.ElementType; bg: string; cor: string }> = {
  pix:      { label: 'PIX / Transferência', icon: Layers,     bg: '#EEF2FF', cor: '#4F46E5' },
  dinheiro: { label: 'Dinheiro',            icon: Banknote,   bg: '#F0FDF4', cor: '#16A34A' },
  credito:  { label: 'Crédito',             icon: CreditCard, bg: '#FEF3C7', cor: '#D97706' },
  debito:   { label: 'Débito',              icon: CreditCard, bg: '#FDF2F8', cor: '#9D174D' },
  cortesia: { label: 'Cortesia',            icon: Gift,       bg: '#F9FAFB', cor: '#6B7280' },
};

const inputClass = "w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
const labelClass = "block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5";

// ── Modal Nova Despesa ────────────────────────────────────────

function NovaDespesaModal({ empresaId, onClose, onSalvo }: {
  empresaId: string; onClose: () => void; onSalvo: () => void;
}) {
  useScrollLock();
  const [descricao,     setDescricao]     = useState('');
  const [valor,         setValor]         = useState('');
  const [categoria,     setCategoria]     = useState('');
  const [recorrente,    setRecorrente]    = useState(false);
  const [periodicidade, setPeriodicidade] = useState<'mensal' | 'semanal' | 'trimestral' | 'semestral' | 'anual'>('mensal');
  const [vencimento,    setVencimento]    = useState('');
  const [recorrenciaAte, setRecorrenciaAte] = useState('');
  const [modoRepeticao, setModoRepeticao] = useState<'data' | 'parcelas'>('data');
  const [quantidadeParcelas, setQuantidadeParcelas] = useState('');
  const [contratoEmAndamento, setContratoEmAndamento] = useState(false);
  const [parcelaAtualInput, setParcelaAtualInput] = useState('');
  const [modoValor, setModoValor] = useState<'parcela' | 'total'>('parcela');
  const [valorTotalCompra, setValorTotalCompra] = useState('');
  const [salvando,      setSalvando]      = useState(false);
  const [erro,          setErro]          = useState('');

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setSalvando(true);
    const totalParcelasNum = modoRepeticao === 'parcelas' ? (parseInt(quantidadeParcelas, 10) || 0) : 0;
    const parcelaAtualNumRaw = contratoEmAndamento ? (parseInt(parcelaAtualInput, 10) || 1) : 1;
    const parcelaAtualNum = totalParcelasNum > 0 ? clampParcelaAtual(parcelaAtualNumRaw, totalParcelasNum) : parcelaAtualNumRaw;
    const usaValorDividido = recorrente && periodicidade === 'mensal' && modoRepeticao === 'parcelas' && modoValor === 'total';
    let valorN: number;
    let valorTotalCompraNum: number | null = null;
    if (usaValorDividido) {
      valorTotalCompraNum = parseFloat(valorTotalCompra.replace(',', '.'));
      if (isNaN(valorTotalCompraNum) || valorTotalCompraNum <= 0) {
        setErro('Informe o valor total da compra.'); setSalvando(false); return;
      }
      valorN = dividirValorCompra(valorTotalCompraNum, totalParcelasNum || 1).valorParcelaAtual;
    } else {
      valorN = parseFloat(valor.replace(',', '.'));
      if (isNaN(valorN) || valorN <= 0) {
        setErro('Informe um valor maior que zero.'); setSalvando(false); return;
      }
    }
    if (recorrente && periodicidade === 'mensal' && modoRepeticao === 'parcelas') {
      if (totalParcelasNum < 1) {
        setErro('Informe a quantidade de parcelas.'); setSalvando(false); return;
      }
      if (!vencimento) {
        setErro('Informe a data de vencimento para calcular o término das parcelas.'); setSalvando(false); return;
      }
    }
    const usaParcelas = periodicidade === 'mensal' && modoRepeticao === 'parcelas' && totalParcelasNum > 0 && !!vencimento;
    const recorrenciaAteFinal = usaParcelas
      ? calcularRecorrenciaAtePorParcelas(vencimento, totalParcelasNum, parcelaAtualNum)
      : recorrenciaAte;
    const { error } = await supabase.from('despesas').insert({
      empresa_id:      empresaId,
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorN,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: vencimento || null,
      recorrencia_ate: recorrente ? (recorrenciaAteFinal || null) : null,
      parcela_atual:   recorrente && usaParcelas ? parcelaAtualNum : null,
      total_parcelas:  recorrente && usaParcelas ? totalParcelasNum : null,
      valor_total_compra: usaValorDividido ? valorTotalCompraNum : null,
      status:          'pendente',
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo();
  }

  const totalParcelasPreview = modoRepeticao === 'parcelas' ? (parseInt(quantidadeParcelas, 10) || 0) : 0;
  const valorTotalCompraPreviewNum = parseFloat(valorTotalCompra.replace(',', '.'));
  const valorCalculadoPreview = recorrente && periodicidade === 'mensal' && modoValor === 'total' && totalParcelasPreview > 0 && !isNaN(valorTotalCompraPreviewNum) && valorTotalCompraPreviewNum > 0
    ? dividirValorCompra(valorTotalCompraPreviewNum, totalParcelasPreview).valorParcelaAtual
    : null;

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <h2 className="font-serif text-xl text-text">Nova despesa</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition"><X size={16}/></button>
        </div>
        <form onSubmit={salvar} className="overflow-y-auto flex-1 min-h-0 p-5 flex flex-col gap-4">
          <div>
            <label className={labelClass}>Descrição *</label>
            <input value={descricao} onChange={e => setDescricao(e.target.value)}
              placeholder="Ex: Aluguel do espaço" required className={inputClass}/>
          </div>
          <div>
            <label className={labelClass}>Valor *</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
              <input value={valorCalculadoPreview !== null ? formatValorMonetarioInput(valorCalculadoPreview) : valor}
                onChange={e => setValor(e.target.value)}
                readOnly={valorCalculadoPreview !== null}
                inputMode="decimal" placeholder="0,00" required
                className={`${inputClass} pl-9 ${valorCalculadoPreview !== null ? 'bg-bg text-text-3' : ''}`}/>
            </div>
          </div>
          <div>
            <label className={labelClass}>Categoria</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIAS_DESP.map(c => (
                <button key={c} type="button" onClick={() => setCategoria(c === categoria ? '' : c)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                    categoria === c
                      ? 'bg-primary text-white border-primary'
                      : 'bg-bg border-border text-text-3 hover:border-accent'
                  }`}>{c}</button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelClass}>Data de vencimento</label>
            <input value={vencimento} onChange={e => setVencimento(e.target.value)}
              type="date" className={inputClass}/>
          </div>
          <div className="border-t border-border pt-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <div onClick={() => setRecorrente(v => !v)}
                className={`w-5 h-5 rounded-md border flex items-center justify-center transition ${
                  recorrente ? 'bg-primary border-primary' : 'border-border bg-bg'
                }`}>
                {recorrente && <Check size={12} strokeWidth={3} className="text-white"/>}
              </div>
              <span className="flex items-center gap-2 text-sm font-semibold text-text-2">
                <RefreshCw size={14} strokeWidth={2} className={recorrente ? 'text-primary' : 'text-text-4'}/>
                Despesa recorrente
              </span>
            </label>
            {recorrente && (
              <div className="flex flex-wrap gap-2 mt-3">
                {PERIODICIDADES.map(p => (
                  <button key={p.key} type="button" onClick={() => setPeriodicidade(p.key)}
                    className={`flex-1 min-w-[90px] py-2 rounded-xl text-xs font-semibold border transition ${
                      periodicidade === p.key
                        ? 'bg-amber-soft border-amber/30 text-amber'
                        : 'bg-bg border-border text-text-3'
                    }`}>{p.label}</button>
                ))}
                <div className="w-full mt-1">
                  <label className={labelClass}>Repetir até (opcional)</label>
                  {periodicidade === 'mensal' && (
                    <div className="flex gap-2 mb-2">
                      <button type="button" onClick={() => setModoRepeticao('data')}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                          modoRepeticao === 'data' ? 'bg-amber-soft border-amber/30 text-amber' : 'bg-bg border-border text-text-3'
                        }`}>Por data</button>
                      <button type="button" onClick={() => setModoRepeticao('parcelas')}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                          modoRepeticao === 'parcelas' ? 'bg-amber-soft border-amber/30 text-amber' : 'bg-bg border-border text-text-3'
                        }`}>Por quantidade de parcelas</button>
                    </div>
                  )}
                  {periodicidade === 'mensal' && modoRepeticao === 'parcelas' ? (
                    <div className="flex flex-col gap-2">
                      <input value={quantidadeParcelas} onChange={e => setQuantidadeParcelas(e.target.value)}
                        inputMode="numeric" placeholder="Quantidade de parcelas" className={inputClass}/>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setContratoEmAndamento(false)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                            !contratoEmAndamento ? 'bg-amber-soft border-amber/30 text-amber' : 'bg-bg border-border text-text-3'
                          }`}>Novo</button>
                        <button type="button" onClick={() => setContratoEmAndamento(true)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                            contratoEmAndamento ? 'bg-amber-soft border-amber/30 text-amber' : 'bg-bg border-border text-text-3'
                          }`}>Já em andamento</button>
                      </div>
                      {contratoEmAndamento && (
                        <input value={parcelaAtualInput} onChange={e => setParcelaAtualInput(e.target.value)}
                          inputMode="numeric" placeholder="Parcela atual" className={inputClass}/>
                      )}
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setModoValor('parcela')}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                            modoValor === 'parcela' ? 'bg-amber-soft border-amber/30 text-amber' : 'bg-bg border-border text-text-3'
                          }`}>Valor da parcela</button>
                        <button type="button" onClick={() => setModoValor('total')}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                            modoValor === 'total' ? 'bg-amber-soft border-amber/30 text-amber' : 'bg-bg border-border text-text-3'
                          }`}>Valor total da compra</button>
                      </div>
                      {modoValor === 'total' && (
                        <input value={valorTotalCompra} onChange={e => setValorTotalCompra(e.target.value)}
                          inputMode="decimal" placeholder="Valor total da compra" className={inputClass}/>
                      )}
                    </div>
                  ) : (
                    <input value={recorrenciaAte} onChange={e => setRecorrenciaAte(e.target.value)}
                      type="date" className={inputClass}/>
                  )}
                </div>
              </div>
            )}
          </div>
          {erro && <p className="text-red text-sm">{erro}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
              Cancelar
            </button>
            <button type="submit" disabled={salvando || !descricao.trim() || (valorCalculadoPreview === null && !valor)}
              className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-50">
              {salvando ? 'Salvando...' : 'Registrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Modal Marcar como pago ────────────────────────────────────

function MarcarPagoModal({ despesa, onClose, onSalvo, onEditar }: {
  despesa: Despesa; onClose: () => void; onSalvo: () => void; onEditar: () => void;
}) {
  useScrollLock();
  const [data,    setData]    = useState(format(new Date(), 'yyyy-MM-dd'));
  const [valor,   setValor]   = useState(formatValorMonetarioInput(Number(despesa.valor)));
  const [salvando,setSalvando]= useState(false);
  const [erro,    setErro]    = useState('');

  async function confirmar() {
    setSalvando(true); setErro('');
    const payload = buildDespesaPagamentoUpdate(data, valor);
    if (!payload) {
      setErro('Informe um valor maior que zero.');
      setSalvando(false);
      return;
    }
    const { error } = await supabase.from('despesas').update(payload).eq('id', despesa.id);
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo();
  }

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-xs p-6 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="text-xs text-text-4 uppercase tracking-wide font-semibold">Confirmar pagamento</p>
          <button type="button" onClick={onEditar} className="text-xs font-semibold text-accent hover:underline flex-shrink-0">
            Editar despesa
          </button>
        </div>
        <p className="font-serif text-xl text-text mb-4">{despesa.descricao}</p>
        <div className="bg-red-soft rounded-xl p-4 mb-4">
          <label className="block text-xs text-red mb-2 text-center">Valor deste mês</label>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-red text-sm font-bold">R$</span>
            <input value={valor} onChange={e => setValor(e.target.value)}
              inputMode="decimal" className={`${inputClass} pl-9 text-center text-2xl font-bold text-red bg-white/70 border-red/20`}/>
          </div>
        </div>
        <div className="mb-5">
          <label className={labelClass}>Data do pagamento</label>
          <input value={data} onChange={e => setData(e.target.value)}
            type="date" className={inputClass}/>
        </div>
        {erro && <p className="text-red text-sm mb-2">{erro}</p>}
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={salvando}
            className="flex-1 h-10 rounded-xl bg-green text-white text-sm font-bold hover:opacity-90 transition disabled:opacity-60">
            {salvando ? 'Salvando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal Editar Despesa ──────────────────────────────────────

function EditarDespesaModal({ despesa, onClose, onSalvo }: {
  despesa: Despesa; onClose: () => void; onSalvo: () => void;
}) {
  useScrollLock();
  const [descricao,     setDescricao]     = useState(despesa.descricao);
  const [valor,         setValor]         = useState(formatValorMonetarioInput(Number(despesa.valor)));
  const [categoria,     setCategoria]     = useState(despesa.categoria ?? '');
  const [recorrente,    setRecorrente]    = useState(despesa.recorrente);
  const [periodicidade, setPeriodicidade] = useState<'mensal' | 'semanal' | 'trimestral' | 'semestral' | 'anual'>(
    (despesa.periodicidade ?? 'mensal') as 'mensal' | 'semanal' | 'trimestral' | 'semestral' | 'anual'
  );
  const [vencimento,    setVencimento]    = useState(despesa.data_vencimento ?? '');
  const [recorrenciaAte, setRecorrenciaAte] = useState(despesa.recorrencia_ate ?? '');
  const [modoRepeticao, setModoRepeticao] = useState<'data' | 'parcelas'>(despesa.total_parcelas ? 'parcelas' : 'data');
  const [quantidadeParcelas, setQuantidadeParcelas] = useState(despesa.total_parcelas ? String(despesa.total_parcelas) : '');
  const [contratoEmAndamento, setContratoEmAndamento] = useState((despesa.parcela_atual ?? 1) > 1);
  const [parcelaAtualInput, setParcelaAtualInput] = useState(despesa.parcela_atual ? String(despesa.parcela_atual) : '');
  const [modoValor, setModoValor] = useState<'parcela' | 'total'>(despesa.valor_total_compra ? 'total' : 'parcela');
  const [valorTotalCompra, setValorTotalCompra] = useState(despesa.valor_total_compra ? formatValorMonetarioInput(Number(despesa.valor_total_compra)) : '');
  const [salvando,      setSalvando]      = useState(false);
  const [excluindo,     setExcluindo]     = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [erro,          setErro]          = useState('');

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setSalvando(true);
    const totalParcelasNum = modoRepeticao === 'parcelas' ? (parseInt(quantidadeParcelas, 10) || 0) : 0;
    const parcelaAtualNumRaw = contratoEmAndamento ? (parseInt(parcelaAtualInput, 10) || 1) : 1;
    const parcelaAtualNum = totalParcelasNum > 0 ? clampParcelaAtual(parcelaAtualNumRaw, totalParcelasNum) : parcelaAtualNumRaw;
    const usaValorDividido = recorrente && periodicidade === 'mensal' && modoRepeticao === 'parcelas' && modoValor === 'total';
    let valorN: number;
    let valorTotalCompraNum: number | null = null;
    if (usaValorDividido) {
      valorTotalCompraNum = parseFloat(valorTotalCompra.replace(',', '.'));
      if (isNaN(valorTotalCompraNum) || valorTotalCompraNum <= 0) {
        setErro('Informe o valor total da compra.'); setSalvando(false); return;
      }
      valorN = dividirValorCompra(valorTotalCompraNum, totalParcelasNum || 1).valorParcelaAtual;
    } else {
      valorN = parseFloat(valor.replace(',', '.'));
      if (isNaN(valorN) || valorN <= 0) {
        setErro('Informe um valor maior que zero.'); setSalvando(false); return;
      }
    }
    if (recorrente && periodicidade === 'mensal' && modoRepeticao === 'parcelas') {
      if (totalParcelasNum < 1) {
        setErro('Informe a quantidade de parcelas.'); setSalvando(false); return;
      }
      if (!vencimento) {
        setErro('Informe a data de vencimento para calcular o término das parcelas.'); setSalvando(false); return;
      }
    }
    const usaParcelas = periodicidade === 'mensal' && modoRepeticao === 'parcelas' && totalParcelasNum > 0 && !!vencimento;
    const recorrenciaAteFinal = usaParcelas
      ? calcularRecorrenciaAtePorParcelas(vencimento, totalParcelasNum, parcelaAtualNum)
      : recorrenciaAte;
    const { error } = await supabase.from('despesas').update({
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorN,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: vencimento || null,
      recorrencia_ate: recorrente ? (recorrenciaAteFinal || null) : null,
      parcela_atual:   recorrente && usaParcelas ? parcelaAtualNum : null,
      total_parcelas:  recorrente && usaParcelas ? totalParcelasNum : null,
      valor_total_compra: usaValorDividido ? valorTotalCompraNum : null,
    }).eq('id', despesa.id);
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo();
  }

  async function excluir() {
    setExcluindo(true);
    await supabase.from('despesas').delete().eq('id', despesa.id);
    setExcluindo(false);
    onSalvo();
  }

  const totalParcelasPreview = modoRepeticao === 'parcelas' ? (parseInt(quantidadeParcelas, 10) || 0) : 0;
  const valorTotalCompraPreviewNum = parseFloat(valorTotalCompra.replace(',', '.'));
  const valorCalculadoPreview = recorrente && periodicidade === 'mensal' && modoValor === 'total' && totalParcelasPreview > 0 && !isNaN(valorTotalCompraPreviewNum) && valorTotalCompraPreviewNum > 0
    ? dividirValorCompra(valorTotalCompraPreviewNum, totalParcelasPreview).valorParcelaAtual
    : null;

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <h2 className="font-serif text-xl text-text">Editar despesa</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition"><X size={16}/></button>
        </div>
        <form onSubmit={salvar} className="overflow-y-auto flex-1 min-h-0 p-5 flex flex-col gap-4">
          <div>
            <label className={labelClass}>Descrição *</label>
            <input value={descricao} onChange={e => setDescricao(e.target.value)}
              placeholder="Ex: Aluguel do espaço" required className={inputClass}/>
          </div>
          <div>
            <label className={labelClass}>Valor *</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
              <input value={valorCalculadoPreview !== null ? formatValorMonetarioInput(valorCalculadoPreview) : valor}
                onChange={e => setValor(e.target.value)}
                readOnly={valorCalculadoPreview !== null}
                inputMode="decimal" placeholder="0,00" required
                className={`${inputClass} pl-9 ${valorCalculadoPreview !== null ? 'bg-bg text-text-3' : ''}`}/>
            </div>
          </div>
          <div>
            <label className={labelClass}>Categoria</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIAS_DESP.map(c => (
                <button key={c} type="button" onClick={() => setCategoria(c === categoria ? '' : c)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                    categoria === c
                      ? 'bg-primary text-white border-primary'
                      : 'bg-bg border-border text-text-3 hover:border-accent'
                  }`}>{c}</button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelClass}>Data de vencimento</label>
            <input value={vencimento} onChange={e => setVencimento(e.target.value)}
              type="date" className={inputClass}/>
          </div>
          <div className="border-t border-border pt-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <div onClick={() => setRecorrente(v => !v)}
                className={`w-5 h-5 rounded-md border flex items-center justify-center transition ${
                  recorrente ? 'bg-primary border-primary' : 'border-border bg-bg'
                }`}>
                {recorrente && <Check size={12} strokeWidth={3} className="text-white"/>}
              </div>
              <span className="flex items-center gap-2 text-sm font-semibold text-text-2">
                <RefreshCw size={14} strokeWidth={2} className={recorrente ? 'text-primary' : 'text-text-4'}/>
                Despesa recorrente
              </span>
            </label>
            {recorrente && (
              <div className="flex flex-wrap gap-2 mt-3">
                {PERIODICIDADES.map(p => (
                  <button key={p.key} type="button" onClick={() => setPeriodicidade(p.key)}
                    className={`flex-1 min-w-[90px] py-2 rounded-xl text-xs font-semibold border transition ${
                      periodicidade === p.key
                        ? 'bg-amber-soft border-amber/30 text-amber'
                        : 'bg-bg border-border text-text-3'
                    }`}>{p.label}</button>
                ))}
                <div className="w-full mt-1">
                  <label className={labelClass}>Repetir até (opcional)</label>
                  {periodicidade === 'mensal' && (
                    <div className="flex gap-2 mb-2">
                      <button type="button" onClick={() => setModoRepeticao('data')}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                          modoRepeticao === 'data' ? 'bg-amber-soft border-amber/30 text-amber' : 'bg-bg border-border text-text-3'
                        }`}>Por data</button>
                      <button type="button" onClick={() => setModoRepeticao('parcelas')}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                          modoRepeticao === 'parcelas' ? 'bg-amber-soft border-amber/30 text-amber' : 'bg-bg border-border text-text-3'
                        }`}>Por quantidade de parcelas</button>
                    </div>
                  )}
                  {periodicidade === 'mensal' && modoRepeticao === 'parcelas' ? (
                    <div className="flex flex-col gap-2">
                      <input value={quantidadeParcelas} onChange={e => setQuantidadeParcelas(e.target.value)}
                        inputMode="numeric" placeholder="Quantidade de parcelas" className={inputClass}/>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setContratoEmAndamento(false)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                            !contratoEmAndamento ? 'bg-amber-soft border-amber/30 text-amber' : 'bg-bg border-border text-text-3'
                          }`}>Novo</button>
                        <button type="button" onClick={() => setContratoEmAndamento(true)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                            contratoEmAndamento ? 'bg-amber-soft border-amber/30 text-amber' : 'bg-bg border-border text-text-3'
                          }`}>Já em andamento</button>
                      </div>
                      {contratoEmAndamento && (
                        <input value={parcelaAtualInput} onChange={e => setParcelaAtualInput(e.target.value)}
                          inputMode="numeric" placeholder="Parcela atual" className={inputClass}/>
                      )}
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setModoValor('parcela')}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                            modoValor === 'parcela' ? 'bg-amber-soft border-amber/30 text-amber' : 'bg-bg border-border text-text-3'
                          }`}>Valor da parcela</button>
                        <button type="button" onClick={() => setModoValor('total')}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                            modoValor === 'total' ? 'bg-amber-soft border-amber/30 text-amber' : 'bg-bg border-border text-text-3'
                          }`}>Valor total da compra</button>
                      </div>
                      {modoValor === 'total' && (
                        <input value={valorTotalCompra} onChange={e => setValorTotalCompra(e.target.value)}
                          inputMode="decimal" placeholder="Valor total da compra" className={inputClass}/>
                      )}
                    </div>
                  ) : (
                    <input value={recorrenciaAte} onChange={e => setRecorrenciaAte(e.target.value)}
                      type="date" className={inputClass}/>
                  )}
                </div>
              </div>
            )}
          </div>
          {erro && <p className="text-red text-sm">{erro}</p>}
          <div className="border-t border-border pt-3">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <p className="text-xs text-red flex-1">Confirmar exclusão?</p>
                <button type="button" onClick={() => setConfirmDelete(false)}
                  className="px-3 h-8 rounded-lg border border-border text-xs text-text-2 hover:bg-bg transition">Cancelar</button>
                <button type="button" onClick={excluir} disabled={excluindo}
                  className="px-3 h-8 rounded-lg bg-red text-white text-xs font-bold hover:opacity-90 transition disabled:opacity-50">
                  {excluindo ? 'Excluindo...' : 'Excluir'}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 text-xs text-red font-semibold hover:underline">
                <Trash2 size={12} strokeWidth={2}/> Excluir despesa
              </button>
            )}
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
              Cancelar
            </button>
            <button type="submit" disabled={salvando || !descricao.trim() || (valorCalculadoPreview === null && !valor)}
              className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-50">
              {salvando ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Modal: detalhamento (histórico) de um KPI ou forma de pagamento ──

function DetalheModal({ titulo, cor, itens, onClose }: {
  titulo: string; cor: string; itens: LedgerItem[]; onClose: () => void;
}) {
  useScrollLock();
  const [filtro, setFiltro] = useState<string | null>(null);

  const categorias = useMemo(() => {
    const contagem = new Map<string, number>();
    itens.forEach(i => contagem.set(i.categoria, (contagem.get(i.categoria) ?? 0) + 1));
    return Array.from(contagem.entries()).sort((a, b) => b[1] - a[1]).map(([nome]) => nome);
  }, [itens]);

  const filtrados  = filtro ? itens.filter(i => i.categoria === filtro) : itens;
  const ordenados  = [...filtrados].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
  const total      = filtrados.reduce((s, i) => s + i.valor * i.sinal, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-surface w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl shadow-xl flex flex-col max-h-[85dvh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-serif text-lg text-text">{titulo}</h2>
            <p className="text-xs text-text-3 mt-0.5">{ordenados.length} lançamento{ordenados.length !== 1 ? 's' : ''} no período</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition flex-shrink-0">
            <X size={16}/>
          </button>
        </div>

        {categorias.length > 1 && (
          <div className="flex gap-1.5 px-5 py-3 border-b border-border flex-shrink-0 overflow-x-auto">
            <button onClick={() => setFiltro(null)}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition flex-shrink-0 ${
                filtro === null ? 'bg-primary text-white border-primary' : 'bg-surface text-text-3 border-border hover:border-accent/40'
              }`}>
              Todas
            </button>
            {categorias.map(catg => (
              <button key={catg} onClick={() => setFiltro(catg)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition flex-shrink-0 ${
                  filtro === catg ? 'text-white border-transparent' : 'bg-surface border-border hover:border-accent/40'
                }`}
                style={filtro === catg ? { background: corCategoria(catg) } : { color: corCategoria(catg) }}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: filtro === catg ? '#fff' : corCategoria(catg) }}/>
                {catg}
              </button>
            ))}
          </div>
        )}

        <div className="overflow-y-auto flex-1 min-h-0">
          {ordenados.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-text-4 italic">Nenhum lançamento neste período.</p>
            </div>
          ) : ordenados.map((item, i) => (
            <div key={i} className={`flex items-center gap-3 px-5 py-3 ${i < ordenados.length - 1 ? 'border-b border-border' : ''}`}>
              <span className="w-3 h-3 rounded-[4px] flex-shrink-0" style={{ background: corCategoria(item.categoria) }} title={item.categoria}/>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text truncate">{item.descricao}</p>
                <p className="text-xs text-text-4 mt-0.5">{format(new Date(item.data), "dd 'de' MMMM", { locale: ptBR })}</p>
              </div>
              <p className={`text-sm font-bold flex-shrink-0 ${item.sinal > 0 ? 'text-green' : 'text-red'}`}>
                {item.sinal > 0 ? '+' : '−'} {fmtBRL(item.valor)}
              </p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-border flex-shrink-0">
          <span className="text-xs font-bold uppercase tracking-wide text-text-3">
            {filtro ? `Total · ${filtro}` : 'Total do período'}
          </span>
          <span className="text-lg font-bold" style={{ color: filtro ? corCategoria(filtro) : cor }}>{fmtBRL(Math.abs(total))}</span>
        </div>
      </div>
    </div>
  );
}

// ── Modal: todas as despesas (não só as do mês selecionado no Financeiro) ──

function TodasDespesasModal({ empresaId, onClose, onMarcarPago, onEditar }: {
  empresaId: string; onClose: () => void;
  onMarcarPago: (d: Despesa) => void; onEditar: (d: Despesa) => void;
}) {
  useScrollLock();
  const [loading, setLoading] = useState(true);
  const [todas, setTodas] = useState<Despesa[]>([]);
  const [filtroStatus, setFiltroStatus] = useState<'todas' | 'pendente' | 'pago'>('todas');
  const [busca, setBusca] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('despesas').select('*')
        .eq('empresa_id', empresaId)
        .order('data_vencimento', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(1000);
      setTodas((data ?? []) as Despesa[]);
      setLoading(false);
    })();
  }, [empresaId]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return todas.filter(d =>
      (filtroStatus === 'todas' || d.status === filtroStatus) &&
      (q === '' || d.descricao.toLowerCase().includes(q) || (d.categoria ?? '').toLowerCase().includes(q))
    );
  }, [todas, filtroStatus, busca]);

  const grupos = useMemo(() => {
    const porMes = new Map<string, Despesa[]>();
    filtradas.forEach(d => {
      const ref = d.data_vencimento ?? d.data_pagamento ?? d.created_at ?? new Date().toISOString();
      const chave = ref.slice(0, 7); // yyyy-MM
      porMes.set(chave, [...(porMes.get(chave) ?? []), d]);
    });
    return Array.from(porMes.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtradas]);

  const totalPendenteGeral = todas.filter(d => d.status === 'pendente').reduce((s, d) => s + Number(d.valor), 0);

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl shadow-xl flex flex-col max-h-[88dvh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-serif text-lg text-text">Todas as despesas</h2>
            <p className="text-xs text-text-3 mt-0.5">{fmtBRL(totalPendenteGeral)} pendente no total · {todas.length} despesa{todas.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition flex-shrink-0">
            <X size={16}/>
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 px-5 py-3 border-b border-border flex-shrink-0">
          <div className="flex gap-1.5">
            {(['todas', 'pendente', 'pago'] as const).map(s => (
              <button key={s} onClick={() => setFiltroStatus(s)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition flex-shrink-0 ${
                  filtroStatus === s ? 'bg-primary text-white border-primary' : 'bg-surface text-text-3 border-border hover:border-accent/40'
                }`}>
                {s === 'todas' ? 'Todas' : s === 'pendente' ? 'Pendentes' : 'Pagas'}
              </button>
            ))}
          </div>
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por descrição ou categoria..."
            className="flex-1 h-8 px-3 rounded-full border border-border bg-bg text-xs focus:outline-none focus:border-accent transition"/>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0">
          {loading ? (
            <div className="p-5 flex flex-col gap-2">{[1,2,3,4].map(i => <div key={i} className="h-12 bg-bg rounded-lg animate-pulse"/>)}</div>
          ) : grupos.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-text-4 italic">Nenhuma despesa encontrada.</p>
            </div>
          ) : grupos.map(([mesKey, itens]) => (
            <div key={mesKey}>
              <p className="px-5 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-text-4 capitalize sticky top-0 bg-surface">
                {format(new Date(`${mesKey}-01T12:00:00`), "MMMM 'de' yyyy", { locale: ptBR })}
              </p>
              {itens.map(d => (
                <div key={d.id} className="flex items-center gap-2 px-5 py-2.5 border-b border-border last:border-0">
                  <button onClick={() => d.status === 'pendente' ? onMarcarPago(d) : onEditar(d)}
                    className="flex items-center gap-3 flex-1 min-w-0 rounded-lg text-left hover:bg-bg transition py-0.5">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${d.status === 'pago' ? 'bg-green-soft' : 'bg-amber-soft'}`}>
                      {d.status === 'pago'
                        ? <CheckCircle2 size={12} strokeWidth={2} className="text-green"/>
                        : <AlertTriangle size={12} strokeWidth={2} className="text-amber"/>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-text truncate">{d.descricao}</p>
                      <p className="text-[10px] text-text-4 mt-0.5 truncate">
                        {d.categoria ? `${d.categoria} · ` : ''}
                        {d.status === 'pago'
                          ? `Pago ${d.data_pagamento ? format(new Date(d.data_pagamento + 'T12:00'), 'dd/MM') : ''}`
                          : `Vence ${d.data_vencimento ? format(new Date(d.data_vencimento + 'T12:00'), 'dd/MM') : 'sem data'}`}
                      </p>
                    </div>
                  </button>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-red">{fmtBRL(d.valor)}</p>
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md ${d.status === 'pago' ? 'bg-green-soft text-green' : 'bg-amber-soft text-amber'}`}>
                      {d.status === 'pago' ? 'Paga' : 'Pendente'}
                    </span>
                  </div>
                  <button onClick={() => onEditar(d)} title="Editar despesa"
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-text-3 border border-border hover:bg-bg hover:text-primary hover:border-primary/40 transition flex-shrink-0">
                    <Pencil size={12} strokeWidth={2}/>
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Modal: detalhe de uma taxa (cancelamento/reserva) individual ──
// Substitui o clique instantâneo que só mudava o status sem feedback nenhum.

function TaxaDetalheModal({ tipo, taxa, marcando, onClose, onMarcarPaga }: {
  tipo: 'cancelamento' | 'reserva'; taxa: TaxaCancelamento | TaxaReserva;
  marcando: boolean; onClose: () => void; onMarcarPaga: () => void;
}) {
  useScrollLock();
  const statusCfg: Record<string, { label: string; cls: string }> = {
    pago:      { label: 'Paga',     cls: 'bg-green-soft text-green' },
    pendente:  { label: 'Pendente', cls: 'bg-amber-soft text-amber' },
    retida:    { label: 'Retida',   cls: 'bg-border text-text-3'    },
    cancelada: { label: 'Cancelada',cls: 'bg-border text-text-3'    },
  };
  const cfg = statusCfg[taxa.status] ?? statusCfg.pendente;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-surface w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-serif text-lg text-text">{tipo === 'cancelamento' ? 'Taxa de Cancelamento' : 'Taxa de Reserva'}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
            <X size={16}/>
          </button>
        </div>
        <div className="p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-3">Cliente</span>
            <span className="text-sm font-semibold text-text">{taxa.cliente?.nome ?? 'Cliente'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-3">Valor</span>
            <span className="text-lg font-bold text-red">{fmtBRL(taxa.valor)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-3">Status</span>
            <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-md ${cfg.cls}`}>{cfg.label}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-3">Gerada em</span>
            <span className="text-sm text-text-2">{format(new Date(taxa.created_at), "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}</span>
          </div>
          {taxa.paga_em && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-3">Paga em</span>
              <span className="text-sm text-text-2">{format(new Date(taxa.paga_em), "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}</span>
            </div>
          )}
        </div>
        {taxa.status === 'pendente' && (
          <div className="px-5 pb-5">
            <button onClick={onMarcarPaga} disabled={marcando}
              className="w-full h-11 rounded-xl bg-green text-white text-sm font-bold hover:opacity-90 transition disabled:opacity-50">
              {marcando ? 'Marcando...' : 'Marcar como paga'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tela principal ────────────────────────────────────────────

export default function FinanceiroPage() {
  const [mesRef,   setMesRef]   = useState(new Date());
  const [empresaId,setEmpresaId]= useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);

  // Dados
  const [receita,       setReceita]       = useState(0);
  const [receitaAnt,    setReceitaAnt]    = useState(0);
  const [taxasCartao,   setTaxasCartao]   = useState(0);
  const [comissoes,     setComissoes]     = useState(0);
  const [comissoesAnt,  setComissoesAnt]  = useState(0);
  const [gastos,        setGastos]        = useState(0);
  const [gastosAnt,     setGastosAnt]     = useState(0);
  const [topServicos,   setTopServicos]   = useState<TopServico[]>([]);
  const [metodos,       setMetodos]       = useState<MetodoPag[]>([]);
  const [despesas,      setDespesas]      = useState<Despesa[]>([]);
  const [taxasCancelamento,      setTaxasCancelamento]      = useState<TaxaCancelamento[]>([]);
  const [taxasCancelamentoPagas, setTaxasCancelamentoPagas] = useState(0);
  const [taxasReserva,      setTaxasReserva]      = useState<TaxaReserva[]>([]);
  const [taxasReservaPagas, setTaxasReservaPagas] = useState(0);
  const [evolucao,      setEvolucao]      = useState<{ mes: string; receita: number; comissoes: number; gastos: number }[]>([]);
  const [seriesVisiveis, setSeriesVisiveis] = useState({ receita: true, comissoes: true, gastos: true });

  // Listas brutas do mês — só para montar o detalhamento (ledger) ao clicar num KPI
  const [agsDetalhe,     setAgsDetalhe]     = useState<{ data: string; descricao: string; valor: number; profissional_id: string | null; profissionalNome: string }[]>([]);
  const [vendasDetalhe,  setVendasDetalhe]  = useState<{ data: string; descricao: string; valor: number }[]>([]);
  const [pagsDetalhe,    setPagsDetalhe]    = useState<{ data: string; metodo: string; valor: number; valor_liquido: number | null }[]>([]);
  const [comMapState,    setComMapState]    = useState<Record<string, number>>({});
  const [detalhe, setDetalhe] = useState<{ titulo: string; cor: string; itens: LedgerItem[] } | null>(null);
  const [detalheTaxa, setDetalheTaxa] = useState<{ tipo: 'cancelamento' | 'reserva'; taxa: TaxaCancelamento | TaxaReserva } | null>(null);
  const [marcandoTaxa, setMarcandoTaxa] = useState(false);

  // Modais
  const [modalDespesa, setModalDespesa] = useState(false);
  const [verTodasDespesas, setVerTodasDespesas] = useState(false);
  const [calendarioAberto, setCalendarioAberto] = useState(false);
  const [marcarPago,            setMarcarPago]            = useState<Despesa | null>(null);
  const [recorrentesParaLancar, setRecorrentesParaLancar] = useState<RecorrenteTemplate[]>([]);
  const [historicoMensal, setHistoricoMensal] = useState<RecorrenteTemplate[]>([]);
  const [lancandoRec,           setLancandoRec]           = useState(false);
  const [editarDespesa,         setEditarDespesa]         = useState<Despesa | null>(null);

  const isHoje = isSameMonth(mesRef, new Date());

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membro } = await supabase.from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (membro) { setEmpresaId(membro.empresa_id); }
    })();
  }, []);

  useEffect(() => {
    if (!empresaId) return;
    carregar(empresaId, mesRef);
  }, [empresaId, mesRef]);

  async function carregar(empId: string, mes: Date) {
    setLoading(true);
    const periodo    = getMonthQueryBounds(mes);
    const periodoAnt = getMonthQueryBounds(subMonths(mes, 1));
    const periodo6   = getMonthQueryBounds(subMonths(mes, 11));
    const ini  = periodo.startIso;
    const fim  = periodo.endIso;
    const iniA = periodoAnt.startIso;
    const fimA = periodoAnt.endIso;
    const ini6 = periodo6.startIso;

    const [agsMes, agsAnt, ags6m, membros, despMes, despAnt, desp6m, pagsMes, despLista, vendasMes, vendasAnt, vendas6m, recMesAnt, fechamentos6m, taxasLista, taxasPagasMes, taxasPagasAnt, reservaLista, reservaPagasMes] = await Promise.all([
      // Agendamentos concluídos do mês (com profissional, serviço, data e cliente — usados
      // também no detalhamento por KPI ao clicar)
      supabase.from('agendamentos').select('profissional_id, servico_id, valor, data_hora_inicio, servico:servicos(nome), cliente:clientes!agendamentos_cliente_id_fkey(nome), profissional:users!agendamentos_profissional_id_fkey(nome)')
        .eq('empresa_id', empId).eq('status', 'concluido')
        .gte('data_hora_inicio', ini).lte('data_hora_inicio', fim),
      // Agendamentos mês anterior
      supabase.from('agendamentos').select('profissional_id, valor')
        .eq('empresa_id', empId).eq('status', 'concluido')
        .gte('data_hora_inicio', iniA).lte('data_hora_inicio', fimA),
      // Agendamentos 12 meses (evolução)
      supabase.from('agendamentos').select('profissional_id, valor, data_hora_inicio')
        .eq('empresa_id', empId).eq('status', 'concluido')
        .gte('data_hora_inicio', ini6).lte('data_hora_inicio', fim),
      // Membros ativos → percentual de comissão (inclui owner/gestor que também atendem)
      supabase.from('empresa_membros').select('user_id, percentual_comissao')
        .eq('empresa_id', empId).eq('ativo', true),
      // Despesas pagas no mês
      supabase.from('despesas').select('valor')
        .eq('empresa_id', empId).eq('status', 'pago')
        .gte('data_pagamento', periodo.startDate).lte('data_pagamento', periodo.endDate),
      // Despesas pagas mês anterior
      supabase.from('despesas').select('valor')
        .eq('empresa_id', empId).eq('status', 'pago')
        .gte('data_pagamento', periodoAnt.startDate).lte('data_pagamento', periodoAnt.endDate),
      // Despesas 12 meses (evolução)
      supabase.from('despesas').select('valor, data_pagamento')
        .eq('empresa_id', empId).eq('status', 'pago')
        .gte('data_pagamento', periodo6.startDate).lte('data_pagamento', periodo.endDate),
      // Formas de pagamento (com data — usada no detalhamento por método/por KPI)
      supabase.from('pagamentos').select('metodo, valor, valor_liquido, created_at')
        .eq('empresa_id', empId).eq('status', 'pago')
        .gte('created_at', ini).lte('created_at', fim),
      // Lista de despesas do mês (pendentes + pagas)
      supabase.from('despesas').select('*')
        .eq('empresa_id', empId)
        .or(`and(data_vencimento.gte.${periodo.startDate},data_vencimento.lte.${periodo.endDate}),and(data_pagamento.gte.${periodo.startDate},data_pagamento.lte.${periodo.endDate})`)
        .order('status').order('data_vencimento'),
      // Vendas avulsas do mês (com data e cliente — usadas no detalhamento)
      supabase.from('vendas').select('valor_final, created_at, cliente:clientes(nome)')
        .eq('empresa_id', empId).gte('created_at', ini).lte('created_at', fim),
      // Vendas avulsas mês anterior
      supabase.from('vendas').select('valor_final')
        .eq('empresa_id', empId).gte('created_at', iniA).lte('created_at', fimA),
      // Vendas avulsas 12 meses
      supabase.from('vendas').select('valor_final, created_at')
        .eq('empresa_id', empId).gte('created_at', ini6).lte('created_at', fim),
      // Histórico de despesas mensais recorrentes (para auto-lançamento robusto)
      supabase.from('despesas')
        .select('descricao, categoria, valor, periodicidade, data_vencimento, recorrencia_ate, parcela_atual, total_parcelas, valor_total_compra')
        .eq('empresa_id', empId).eq('recorrente', true).eq('periodicidade', 'mensal')
        .lt('data_vencimento', periodo.startDate)   // somente meses passados
        .order('data_vencimento', { ascending: false })
        .limit(5000),  // teto explicito: a contagem derivada (calcularParcelaDerivada) depende
                        // da linha mais antiga de cada serie estar presente no historico
      // Fechamentos importados para meses sem historico operacional completo.
      supabase.from('financeiro_ajustes_mensais')
        .select('mes, receita_bruta, comissao_paga')
        .eq('empresa_id', empId)
        .gte('mes', periodo6.startDate).lte('mes', periodo.endDate),
      // Lista de taxas de cancelamento do mês (pendentes + pagas)
      supabase.from('taxas_cancelamento')
        .select('*, cliente:clientes(nome)')
        .eq('empresa_id', empId)
        .neq('status', 'cancelada')
        .gte('created_at', ini).lte('created_at', fim)
        .order('status').order('created_at'),
      // Taxas pagas no mês (para somar ao bruto)
      supabase.from('taxas_cancelamento').select('valor')
        .eq('empresa_id', empId).eq('status', 'pago')
        .gte('paga_em', ini).lte('paga_em', fim),
      // Taxas pagas no mês anterior (para somar ao bruto do mês anterior)
      supabase.from('taxas_cancelamento').select('valor')
        .eq('empresa_id', empId).eq('status', 'pago')
        .gte('paga_em', iniA).lte('paga_em', fimA),
      // Lista de taxas de reserva do mês (pendentes + pagas + retidas —
      // exclui 'cancelada' explicitamente: mesmo não sendo um status
      // documentado no schema atual, já apareceu em dados reais e sem esse
      // filtro cai no fallback "Pendente" da renderização, inflando a
      // contagem de pendências com taxas que na verdade foram canceladas)
      supabase.from('taxas_reserva')
        .select('*, cliente:clientes(nome)')
        .eq('empresa_id', empId)
        .neq('status', 'cancelada')
        .gte('created_at', ini).lte('created_at', fim)
        .order('status').order('created_at'),
      // Taxas de reserva pagas no mês (exibidas à parte, não somadas ao bruto)
      supabase.from('taxas_reserva').select('valor')
        .eq('empresa_id', empId).not('paga_em', 'is', null)
        .gte('paga_em', ini).lte('paga_em', fim),
    ]);

    // Mapa de comissão por profissional (user_id → %)
    const comMap: Record<string, number> = {};
    ((membros.data ?? []) as { user_id: string; percentual_comissao: number }[])
      .forEach(m => { comMap[m.user_id] = m.percentual_comissao ?? 0; });
    setComMapState(comMap);

    type AgRow = { profissional_id: string | null; valor: number };
    const calcCom = (ags: AgRow[]) =>
      ags
        .filter(a => a.profissional_id != null)
        .reduce((s, a) => s + Number(a.valor) * (comMap[a.profissional_id!] ?? 0) / 100, 0);

    type ValRow = { valor: number };
    type VendaRow = { valor_final: number };
    type TaxaRow = { valor: number };
    const brutoServicos   = ((agsMes.data ?? []) as ValRow[]).reduce((s, a) => s + Number(a.valor), 0);
    const brutoVendas     = ((vendasMes.data ?? []) as VendaRow[]).reduce((s, v) => s + Number(v.valor_final), 0);
    const brutoTaxasCanc  = ((taxasPagasMes.data ?? []) as TaxaRow[]).reduce((s, t) => s + Number(t.valor), 0);
    const brutoTaxasCancAnt = ((taxasPagasAnt.data ?? []) as TaxaRow[]).reduce((s, t) => s + Number(t.valor), 0);
    // Taxa de reserva NÃO entra na receita bruta: quando o cliente realiza o
    // procedimento ela é abatida do valor da comanda (já contado em
    // brutoServicos); fica só como card informativo próprio abaixo.
    const brutoReserva    = ((reservaPagasMes.data ?? []) as { valor: number }[]).reduce((s, t) => s + Number(t.valor), 0);
    const receitaVal      = brutoServicos + brutoVendas + brutoTaxasCanc;
    const receitaAntVal   = ((agsAnt.data ?? []) as ValRow[]).reduce((s, a) => s + Number(a.valor), 0)
                          + ((vendasAnt.data ?? []) as VendaRow[]).reduce((s, v) => s + Number(v.valor_final), 0)
                          + brutoTaxasCancAnt;
    const comissoesVal    = calcCom((agsMes.data ?? []) as AgRow[]);
    const comissoesAntVal = calcCom((agsAnt.data ?? []) as AgRow[]);
    const gastosVal       = ((despMes.data ?? []) as ValRow[]).reduce((s, d) => s + Number(d.valor), 0);
    const gastosAntVal    = ((despAnt.data ?? []) as ValRow[]).reduce((s, d) => s + Number(d.valor), 0);
    const fechamentosData = (fechamentos6m.data ?? []) as FinanceiroFechamentoRow[];
    const fechamentoMes   = getFechamentoForMonth(fechamentosData, format(mes, 'yyyy-MM'));
    const fechamentoAnt   = getFechamentoForMonth(fechamentosData, format(subMonths(mes, 1), 'yyyy-MM'));

    type PagRow = { metodo: string; valor: number; valor_liquido: number | null };
    const pagsData = (pagsMes.data ?? []) as PagRow[];
    const taxasCartaoVal = pagsData.reduce((s, p) =>
      s + (p.valor_liquido != null ? Number(p.valor) - Number(p.valor_liquido) : 0), 0);
    const kpisMes = resolveFinanceiroKpis({
      receita: receitaVal,
      comissoes: comissoesVal,
      gastos: gastosVal,
      taxasCartao: taxasCartaoVal,
    }, fechamentoMes);
    const kpisAnt = resolveFinanceiroKpis({
      receita: receitaAntVal,
      comissoes: comissoesAntVal,
      gastos: gastosAntVal,
      taxasCartao: 0,
    }, fechamentoAnt);

    setReceita(kpisMes.receita);       setReceitaAnt(kpisAnt.receita);
    setComissoes(kpisMes.comissoes);   setComissoesAnt(kpisAnt.comissoes);
    setGastos(kpisMes.gastos);         setGastosAnt(kpisAnt.gastos);
    setTaxasCartao(kpisMes.taxasCartao);
    setTaxasCancelamento((taxasLista.data ?? []) as TaxaCancelamento[]);
    setTaxasCancelamentoPagas(brutoTaxasCanc);
    setTaxasReserva((reservaLista.data ?? []) as TaxaReserva[]);
    setTaxasReservaPagas(brutoReserva);

    // Listas brutas para o detalhamento por KPI (histórico ao clicar)
    type AgDetalheRow = { profissional_id: string | null; valor: number; data_hora_inicio: string; servico: { nome: string } | null; cliente: { nome: string } | null; profissional: { nome: string } | null };
    setAgsDetalhe(((agsMes.data ?? []) as unknown as AgDetalheRow[]).map(a => ({
      data: a.data_hora_inicio, valor: Number(a.valor), profissional_id: a.profissional_id,
      profissionalNome: a.profissional?.nome ?? 'Profissional',
      descricao: `${a.servico?.nome ?? 'Serviço'} · ${a.cliente?.nome ?? 'Cliente'}`,
    })));
    type VendaDetalheRow = { valor_final: number; created_at: string; cliente: { nome: string } | null };
    setVendasDetalhe(((vendasMes.data ?? []) as unknown as VendaDetalheRow[]).map(v => ({
      data: v.created_at, valor: Number(v.valor_final),
      descricao: `Venda avulsa · ${v.cliente?.nome ?? 'Sem cliente'}`,
    })));
    type PagDetalheRow = { metodo: string; valor: number; valor_liquido: number | null; created_at: string };
    setPagsDetalhe(((pagsMes.data ?? []) as unknown as PagDetalheRow[]).map(p => ({
      data: p.created_at, metodo: p.metodo, valor: Number(p.valor),
      valor_liquido: p.valor_liquido != null ? Number(p.valor_liquido) : null,
    })));

    // Top serviços
    type TopServicoRow = { servico_id: string | null; valor: number; servico: { nome: string } | null };
    const svcMap: Record<string, { nome: string; qtd: number; receita: number }> = {};
    ((agsMes.data ?? []) as TopServicoRow[]).forEach(a => {
      if (!a.servico_id) return;
      const id = a.servico_id; const nome = a.servico?.nome ?? 'Serviço';
      if (!svcMap[id]) svcMap[id] = { nome, qtd: 0, receita: 0 };
      svcMap[id].qtd += 1; svcMap[id].receita += Number(a.valor);
    });
    const svcLista = Object.entries(svcMap)
      .map(([, s]) => ({ nome: s.nome, quantidade: s.qtd, receita: s.receita, percentual: 0 }))
      .sort((a, b) => b.receita - a.receita).slice(0, 5);
    const maxSvc = svcLista[0]?.receita ?? 1;
    setTopServicos(svcLista.map(s => ({ ...s, percentual: Math.round((s.receita / maxSvc) * 100) })));

    // Formas de pagamento
    const metMap: Record<string, { valor: number; quantidade: number }> = {};
    pagsData.forEach(p => {
      if (!metMap[p.metodo]) metMap[p.metodo] = { valor: 0, quantidade: 0 };
      metMap[p.metodo].valor += Number(p.valor); metMap[p.metodo].quantidade += 1;
    });
    const metTotal = Object.values(metMap).reduce((s, m) => s + m.valor, 0);
    setMetodos(Object.entries(metMap).map(([metodo, m]) => ({
      metodo, valor: m.valor, quantidade: m.quantidade,
      percentual: metTotal > 0 ? Math.round((m.valor / metTotal) * 100) : 0,
    })).sort((a, b) => b.valor - a.valor));

    // Evolução 12 meses (client-side, a partir das queries únicas) — arrastável no card
    const evolucaoData = Array.from({ length: 12 }, (_, i) => {
      const m    = subMonths(mes, 11 - i);
      type Desp6Row = { valor: number; data_pagamento: string | null };
      type Venda6Row = { valor_final: number; created_at: string };
      const mesAgs  = ((ags6m.data ?? []) as (AgRow & { data_hora_inicio: string })[]).filter(a =>
        isSameMonth(new Date(a.data_hora_inicio), m)
      );
      const mesDesp = ((desp6m.data ?? []) as Desp6Row[]).filter(d =>
        d.data_pagamento && isSameMonth(new Date(d.data_pagamento + 'T12:00'), m)
      );
      const mesVendas = ((vendas6m.data ?? []) as Venda6Row[]).filter(v =>
        isSameMonth(new Date(v.created_at), m)
      );
      const gastosMes = mesDesp.reduce((s, d) => s + Number(d.valor), 0);
      const fechamento = getFechamentoForMonth(fechamentosData, format(m, 'yyyy-MM'));
      const kpis = resolveFinanceiroKpis({
        receita: mesAgs.reduce((s, a) => s + Number(a.valor), 0)
               + mesVendas.reduce((s, v) => s + Number(v.valor_final), 0),
        comissoes: calcCom(mesAgs),
        gastos: gastosMes,
        taxasCartao: 0,
      }, fechamento);
      return {
        mes:       format(m, 'MMM', { locale: ptBR }),
        receita:   kpis.receita,
        comissoes: kpis.comissoes,
        gastos:    kpis.gastos,
      };
    });
    setEvolucao(evolucaoData);

    setDespesas((despLista.data ?? []) as Despesa[]);

    // Auto-lançamento robusto: pega o template mais recente por (descricao+categoria),
    // independente de quantos meses foram pulados, ignorando recorrências já
    // encerradas e as que já existem no mês atual. Composição (agrupar por chave
    // antes de filtrar por término) coberta por teste em
    // shared/despesas.ts::templatesRecorrentesParaLancar — não reordenar sem testes.
    const todasMensais = (recMesAnt.data ?? []) as RecorrenteTemplate[];
    const despAtual = (despLista.data ?? []) as { descricao: string; categoria?: string }[];
    const chavesMesAtual = new Set(despAtual.map(d => `${d.descricao}||${d.categoria ?? ''}`));
    setRecorrentesParaLancar(
      templatesRecorrentesParaLancar(todasMensais, chavesMesAtual, periodo.startDate)
    );
    setHistoricoMensal(todasMensais);

    setLoading(false);
  }

  function recarregar() { if (empresaId) carregar(empresaId, mesRef); }

  async function lancarRecorrentes() {
    if (!empresaId || recorrentesParaLancar.length === 0) return;
    setLancandoRec(true);
    await supabase.from('despesas').insert(
      recorrentesParaLancar.map(r => ({
        empresa_id:      empresaId,
        descricao:       r.descricao,
        categoria:       r.categoria ?? null,
        valor:           r.valor_total_compra != null && r.total_parcelas != null
          ? dividirValorCompra(r.valor_total_compra, r.total_parcelas).valorBase
          : r.valor,
        recorrente:      true,
        periodicidade:   r.periodicidade ?? 'mensal',
        data_vencimento: (() => {
          // Preserva o dia do template, mas força o ano/mês atual visualizado
          const dia = r.data_vencimento ? parseInt(r.data_vencimento.slice(8, 10)) : 1;
          const ano  = mesRef.getFullYear();
          const mes  = mesRef.getMonth(); // 0-based
          // Clamp: dia 31 em fevereiro → último dia do mês
          const ultimo = new Date(ano, mes + 1, 0).getDate();
          return format(new Date(ano, mes, Math.min(dia, ultimo)), 'yyyy-MM-dd');
        })(),
        recorrencia_ate: r.recorrencia_ate ?? null,
        total_parcelas:  r.total_parcelas ?? null,
        parcela_atual:   r.total_parcelas != null && r.parcela_atual != null && r.data_vencimento
          ? proximaParcelaAtual(r.parcela_atual, r.total_parcelas, r.data_vencimento, mesRef.getFullYear(), mesRef.getMonth() + 1)
          : null,
        valor_total_compra: r.valor_total_compra ?? null,
        status:          'pendente',
      }))
    );
    setLancandoRec(false);
    setRecorrentesParaLancar([]);
    recarregar();
  }

  async function marcarTaxaPaga(taxa: TaxaCancelamento) {
    const { error } = await supabase.from('taxas_cancelamento')
      .update({ status: 'pago', paga_em: new Date().toISOString() })
      .eq('id', taxa.id);
    if (error) { alert(`Erro ao marcar taxa como paga: ${error.message}`); return; }
    if (empresaId) await carregar(empresaId, mesRef);
  }

  async function marcarReservaPaga(taxa: TaxaReserva) {
    const { error } = await supabase.from('taxas_reserva')
      .update({ status: 'pago', paga_em: new Date().toISOString() })
      .eq('id', taxa.id);
    if (error) { alert(`Erro ao marcar taxa de reserva como paga: ${error.message}`); return; }
    if (empresaId) await carregar(empresaId, mesRef);
  }

  async function confirmarMarcarTaxaPaga() {
    if (!detalheTaxa) return;
    setMarcandoTaxa(true);
    if (detalheTaxa.tipo === 'cancelamento') {
      await marcarTaxaPaga(detalheTaxa.taxa as TaxaCancelamento);
    } else {
      await marcarReservaPaga(detalheTaxa.taxa as TaxaReserva);
    }
    setMarcandoTaxa(false);
    setDetalheTaxa(null);
  }

  const liquidoAposTaxas = receita - taxasCartao;
  const lucro            = liquidoAposTaxas - comissoes - gastos;
  const dReceita         = delta(receita,   receitaAnt);
  const dComissoes       = delta(comissoes, comissoesAnt);
  const dGastos          = delta(gastos,    gastosAnt);
  const hojeIso           = format(new Date(), 'yyyy-MM-dd');
  const despesasPendentes = despesas.filter(d => d.status === 'pendente');
  const totalPendente     = despesasPendentes.reduce((soma, d) => soma + Number(d.valor), 0);
  const maxEvolucao = Math.max(...evolucao.flatMap(e => [e.receita, e.gastos, e.comissoes ?? 0]), 1);

  // ── Ledgers do detalhamento por KPI (histórico ao clicar) ──────
  const METODO_LABEL: Record<string, string> = { pix: 'PIX', dinheiro: 'Dinheiro', credito: 'Crédito', debito: 'Débito', cortesia: 'Cortesia' };

  const ledgerServicos: LedgerItem[] = useMemo(() => agsDetalhe.map(a => ({
    data: a.data, descricao: a.descricao, valor: a.valor, sinal: 1 as const, categoria: 'Serviço',
  })), [agsDetalhe]);

  const ledgerVendas: LedgerItem[] = useMemo(() => vendasDetalhe.map(v => ({
    data: v.data, descricao: v.descricao, valor: v.valor, sinal: 1 as const, categoria: 'Venda',
  })), [vendasDetalhe]);

  const ledgerTaxasCancPagas: LedgerItem[] = useMemo(() => taxasCancelamento
    .filter(t => t.status === 'pago')
    .map(t => ({ data: t.paga_em ?? t.created_at, descricao: `Taxa de cancelamento · ${t.cliente?.nome ?? 'Cliente'}`, valor: Number(t.valor), sinal: 1 as const, categoria: 'Taxa de cancelamento' })),
    [taxasCancelamento]);

  // Comissão por profissional — usada tanto na KPI "Comissões" (categoria =
  // nome da profissional, para filtrar por quem gerou) quanto embutida no
  // Lucro Real (categoria única "Comissão", pra não fragmentar o filtro ali).
  const ledgerComissoesPorProfissional: LedgerItem[] = useMemo(() => agsDetalhe
    .filter(a => a.profissional_id != null)
    .map(a => ({
      data: a.data,
      descricao: `${a.profissionalNome} · ${a.descricao}`,
      valor: Number(a.valor) * (comMapState[a.profissional_id!] ?? 0) / 100,
      sinal: 1 as const,
      categoria: a.profissionalNome,
    }))
    .filter(l => l.valor > 0),
    [agsDetalhe, comMapState]);
  const ledgerComissoesParaLucro: LedgerItem[] = useMemo(() =>
    ledgerComissoesPorProfissional.map(l => ({ ...l, sinal: -1 as const, categoria: 'Comissão' })),
    [ledgerComissoesPorProfissional]);

  const ledgerGastos: LedgerItem[] = useMemo(() => despesas
    .filter(d => d.status === 'pago')
    .map(d => ({ data: d.data_pagamento ?? d.created_at ?? hojeIso, descricao: d.descricao, valor: Number(d.valor), sinal: -1 as const, categoria: d.categoria ?? 'Despesa' })),
    [despesas, hojeIso]);

  const ledgerBruto: LedgerItem[] = useMemo(() => [...ledgerServicos, ...ledgerVendas, ...ledgerTaxasCancPagas], [ledgerServicos, ledgerVendas, ledgerTaxasCancPagas]);

  const ledgerTaxasCartao: LedgerItem[] = useMemo(() => pagsDetalhe
    .filter(p => p.valor_liquido != null)
    .map(p => ({
      data: p.data, descricao: `Taxa de cartão · ${METODO_LABEL[p.metodo] ?? p.metodo}`,
      valor: p.valor - (p.valor_liquido as number), sinal: -1 as const, categoria: 'Taxa de cartão',
    }))
    .filter(l => l.valor > 0.001),
    [pagsDetalhe]);

  // Líquido após Taxas = Bruto − Taxas de Cartão (não comissões — a fórmula
  // real é `receita - taxasCartao`, ver liquidoAposTaxas abaixo). Lucro Real
  // segue subtraindo comissões e gastos por cima do líquido.
  const ledgerLiquido: LedgerItem[] = useMemo(() => [...ledgerBruto, ...ledgerTaxasCartao], [ledgerBruto, ledgerTaxasCartao]);
  const ledgerLucro: LedgerItem[]   = useMemo(() => [...ledgerLiquido, ...ledgerComissoesParaLucro, ...ledgerGastos], [ledgerLiquido, ledgerComissoesParaLucro, ledgerGastos]);

  function abrirDetalheMetodo(metodo: string) {
    const itens: LedgerItem[] = pagsDetalhe
      .filter(p => p.metodo === metodo)
      .map(p => ({ data: p.data, descricao: METODO_LABEL[metodo] ?? metodo, valor: p.valor, sinal: 1 as const, categoria: 'Pagamento' }));
    setDetalhe({ titulo: `Formas de pagamento · ${METODO_LABEL[metodo] ?? metodo}`, cor: 'var(--color-primary)', itens });
  }

  return (
    <div className="bm-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 bm-mobile-page-header">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>Visão Geral</p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>Financeiro</h1>
        </div>
        <ExportButton
          variant="mobileHeader"
          className="bm-mobile-header-export"
          filename={`financeiro-despesas-${format(mesRef, 'yyyy-MM')}`}
          title={`Despesas — ${format(mesRef, 'MMMM yyyy', { locale: ptBR })}`}
          columns={[
            { header: 'Descrição',   accessor: (d: Despesa) => d.descricao,                                            width: 30 },
            { header: 'Categoria',   accessor: (d: Despesa) => d.categoria ?? '',                                       width: 18 },
            { header: 'Valor',       accessor: (d: Despesa) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(d.valor), width: 14 },
            { header: 'Vencimento',  accessor: (d: Despesa) => d.data_vencimento ?? '',                                 width: 14 },
            { header: 'Pagamento',   accessor: (d: Despesa) => d.data_pagamento ?? '',                                  width: 14 },
            { header: 'Status',      accessor: (d: Despesa) => d.status === 'pago' ? 'Pago' : 'Pendente',               width: 12 },
            { header: 'Recorrente',  accessor: (d: Despesa) => d.recorrente ? 'Sim' : 'Não',                            width: 12 },
          ]}
          getData={() => despesas}
        />
      </div>

      <FinanceMonthCalendar
        month={mesRef}
        isOpen={calendarioAberto}
        isNextDisabled={false}
        onToggle={() => setCalendarioAberto(open => !open)}
        onPreviousMonth={() => setMesRef(m => subMonths(m, 1))}
        onNextMonth={() => setMesRef(m => addMonths(m, 1))}
      />

      {/* KPIs — grid auto-fit: preenche a largura sem deixar buraco na
          última linha, não importa quantos cards existam (a lista cresce
          com taxas condicionais e deve continuar crescendo no futuro). */}
      {loading ? (
        <div className="grid gap-3 sm:gap-4 mb-6 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-3 sm:p-5 shadow-sm">
              <Sk className="h-3 w-1/3 mb-3 max-w-[100px]"/><Sk className="h-7 w-2/3 mb-3 max-w-[140px]"/><Sk className="h-3 w-1/2 max-w-[120px]"/>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:gap-4 mb-6 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
          {[
            { label: 'Faturamento Bruto',   ledger: ledgerBruto,        value: receita,          d: dReceita,   cor: 'text-green',   corVar: 'var(--color-green)',   invertDelta: false },
            { label: 'Taxas de Cartão',     ledger: ledgerTaxasCartao,  value: taxasCartao,      d: null,       cor: 'text-rose',    corVar: 'var(--color-rose)',    invertDelta: false },
            { label: 'Líquido após Taxas',  ledger: ledgerLiquido,      value: liquidoAposTaxas, d: null,       cor: 'text-primary', corVar: 'var(--color-primary)', invertDelta: false },
            { label: 'Comissões',           ledger: ledgerComissoesPorProfissional, value: comissoes, d: dComissoes, cor: 'text-amber',                        corVar: 'var(--color-amber)',   invertDelta: true  },
            { label: 'Gastos Operacionais', ledger: ledgerGastos,       value: gastos,    d: dGastos,   cor: 'text-rose',                                     corVar: 'var(--color-rose)',    invertDelta: true  },
            { label: 'Lucro Real',          ledger: ledgerLucro,        value: lucro,     d: null,      cor: lucro >= 0 ? 'text-primary' : 'text-red',        corVar: lucro >= 0 ? 'var(--color-primary)' : 'var(--color-red)', invertDelta: false },
            ...(taxasCancelamentoPagas > 0
              ? [{ label: 'Taxas de Cancelamento', ledger: ledgerTaxasCancPagas, value: taxasCancelamentoPagas, d: null, cor: 'text-rose', corVar: 'var(--color-rose)', invertDelta: false }]
              : []),
          ].map(({ label, ledger, value, d, cor, corVar, invertDelta }) => (
            <button key={label} type="button" onClick={() => setDetalhe({ titulo: label, cor: corVar, itens: ledger })}
              className="text-left bg-surface border border-border rounded-2xl p-3 sm:p-5 shadow-sm min-w-0 block transition-opacity hover:opacity-80">
              <p className="text-[10px] sm:text-xs text-text-4 uppercase tracking-wide font-semibold mb-1.5 sm:mb-2 truncate">{label}</p>
              <p className={`text-lg sm:text-xl font-bold leading-none mb-1.5 sm:mb-2 truncate ${cor}`}>{fmtBRL(value)}</p>
              {d !== null && (
                <div className="flex items-center gap-1 min-w-0">
                  {(invertDelta ? d < 0 : d >= 0)
                    ? <TrendingUp  size={11} className="text-green flex-shrink-0" strokeWidth={2.5}/>
                    : <TrendingDown size={11} className="text-red flex-shrink-0"  strokeWidth={2.5}/>
                  }
                  <span className={`text-[10px] sm:text-xs font-bold truncate ${(invertDelta ? d < 0 : d >= 0) ? 'text-green' : 'text-red'}`}>
                    {d >= 0 ? '+' : ''}{d}% vs mês anterior
                  </span>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Skeleton: despesas (col-span-2, agora no topo) */}
          <div className="md:col-span-2 bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <Sk className="h-5 w-24"/>
              <Sk className="h-4 w-16"/>
            </div>
            <div className="p-5 flex flex-col gap-3">
              {[1,2,3].map(i => (
                <div key={i} className="flex items-center gap-3">
                  <Sk className="w-8 h-8 rounded-lg flex-shrink-0"/>
                  <div className="flex-1 flex flex-col gap-1.5">
                    <Sk className="h-3.5 w-40"/>
                    <Sk className="h-3 w-24"/>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <Sk className="h-4 w-16"/>
                    <Sk className="h-4 w-20 rounded-md"/>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Skeleton: evolução (12 meses) */}
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            <Sk className="h-5 w-36 mb-5"/>
            <div className="flex items-end gap-3 h-24 overflow-hidden">
              {[60,80,45,90,70,100,55,75,40,85,65,95].map((h,i) => (
                <div key={i} className="flex-1 min-w-[16px] flex flex-col items-center gap-1">
                  <Sk className="w-full rounded-t-sm" style={{ height: `${h}%` }}/>
                  <Sk className="h-2.5 w-6"/>
                </div>
              ))}
            </div>
          </div>
          {/* Skeleton: top serviços */}
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            <Sk className="h-5 w-28 mb-5"/>
            <div className="flex flex-col gap-4">
              {[1,2,3].map(i => (
                <div key={i} className="flex items-center gap-3">
                  <Sk className="w-5 h-5 rounded flex-shrink-0"/>
                  <div className="flex-1 flex flex-col gap-1.5">
                    <Sk className="h-3.5 w-full"/>
                    <Sk className="h-2 w-full rounded-full"/>
                    <Sk className="h-2.5 w-16"/>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">

        {/* Despesas — no topo, é o que mais precisa de atenção no dia a dia */}
        <div id="secao-despesas" className="md:col-span-2 bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <p className="font-serif text-lg text-text">Despesas</p>
              {despesasPendentes.length > 0 && (
                <p className="text-[10px] text-text-4 mt-0.5">
                  {fmtBRL(totalPendente)} pendente · {despesasPendentes.length} despesa{despesasPendentes.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setVerTodasDespesas(true)}
                className="press flex items-center gap-1.5 px-3 h-8 rounded-xl border border-border text-text-2 text-xs font-bold hover:bg-bg transition">
                Ver todas
              </button>
              <button onClick={() => setModalDespesa(true)}
                className="press flex items-center gap-1.5 px-3 h-8 rounded-xl text-white text-xs font-bold"
                style={{ background: 'var(--color-primary)', boxShadow: '0 4px 14px rgba(44,23,80,0.18)' }}>
                <Plus size={13} strokeWidth={2.5}/> Nova
              </button>
            </div>
          </div>

          {/* Banner: despesas recorrentes não lançadas */}
          {!loading && recorrentesParaLancar.length > 0 && (
            <div className="flex items-center gap-3 px-5 py-3 bg-amber-soft border-b border-amber/20">
              <RefreshCw size={14} className="text-amber flex-shrink-0" strokeWidth={2.5}/>
              <p className="text-xs text-amber font-semibold flex-1">
                {recorrentesParaLancar.length} despesa{recorrentesParaLancar.length !== 1 ? 's' : ''} recorrente{recorrentesParaLancar.length !== 1 ? 's' : ''} do mês anterior não {recorrentesParaLancar.length !== 1 ? 'foram lançadas' : 'foi lançada'}.
              </p>
              <button onClick={lancarRecorrentes} disabled={lancandoRec}
                className="flex-shrink-0 text-xs font-bold text-amber hover:underline disabled:opacity-50">
                {lancandoRec ? 'Lançando...' : 'Lançar agora'}
              </button>
            </div>
          )}

          {loading ? (
            <div className="p-5 flex flex-col gap-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-bg rounded-lg animate-pulse"/>)}</div>
          ) : despesas.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-text-4 italic mb-2">Nenhuma despesa neste mês.</p>
              <button onClick={() => setModalDespesa(true)} className="text-accent text-sm font-semibold hover:underline">
                + Registrar despesa
              </button>
            </div>
          ) : (
            despesas.map((d, i) => {
              const vencimentoPendente = d.status === 'pendente' ? d.data_vencimento : undefined;
              const dias = vencimentoPendente
                ? diasParaVencimento(vencimentoPendente, hojeIso)
                : null;
              const progresso = vencimentoPendente
                ? progressoVencimento(d.created_at ?? hojeIso, vencimentoPendente, hojeIso)
                : null;
              const labelDias = dias === null ? '' :
                dias < 0 ? `atrasada há ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? '' : 's'}` :
                dias === 0 ? 'vence hoje' :
                `faltam ${dias} dia${dias === 1 ? '' : 's'}`;

              return (
                <div key={d.id}
                  className={`relative flex items-center gap-2 px-4 py-3 ${i < despesas.length - 1 ? 'border-b border-border' : ''}`}>
                  <div
                    className="flex items-center gap-3 flex-1 min-w-0 rounded-lg cursor-pointer hover:bg-bg transition"
                    onClick={() => d.status === 'pendente' ? setMarcarPago(d) : setEditarDespesa(d)}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${d.status === 'pago' ? 'bg-green-soft' : 'bg-amber-soft'}`}>
                      {d.status === 'pago'
                        ? <CheckCircle2 size={14} strokeWidth={2} className="text-green"/>
                        : <AlertTriangle size={14} strokeWidth={2} className="text-amber"/>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-text truncate">{d.descricao}</p>
                      <p className="text-[10px] text-text-4 mt-0.5">
                        {d.status === 'pago'
                          ? `Pago ${d.data_pagamento ? format(new Date(d.data_pagamento + 'T12:00'), 'dd/MM') : ''}`
                          : `Vence ${d.data_vencimento ? format(new Date(d.data_vencimento + 'T12:00'), 'dd/MM') : 'sem data'}`
                        }
                        {d.recorrente && ' · Recorrente'}
                        {(() => {
                          if (d.total_parcelas) return ` · (${d.parcela_atual ?? 1}/${d.total_parcelas})`;
                          if (d.recorrente && d.periodicidade === 'mensal' && d.recorrencia_ate && d.data_vencimento) {
                            const derivada = calcularParcelaDerivada(d.descricao, d.categoria, d.data_vencimento, d.recorrencia_ate, historicoMensal);
                            return derivada ? ` · (${derivada.atual}/${derivada.total})` : '';
                          }
                          return '';
                        })()}
                        {labelDias && ` · ${labelDias}`}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-red">{fmtBRL(d.valor)}</p>
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md ${
                        d.status === 'pago' ? 'bg-green-soft text-green' : 'bg-amber-soft text-amber'
                      }`}>
                        {d.status === 'pago' ? 'Pago' : 'Toque p/ pagar'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setEditarDespesa(d)}
                    title="Editar despesa"
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-text-3 border border-border hover:bg-bg hover:text-primary hover:border-primary/40 transition flex-shrink-0">
                    <Pencil size={13} strokeWidth={2}/>
                  </button>
                  {progresso !== null && (
                    <div className="absolute left-4 right-4 bottom-0 h-0.5 rounded-full overflow-hidden bg-border">
                      <div className={`h-full ${dias !== null && dias < 0 ? 'bg-red' : 'bg-amber'}`} style={{ width: `${progresso * 100}%` }}/>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Evolução mensal — 12 meses, arrastável no mobile (overflow-x),
            cada série pode ser escondida clicando na legenda */}
        <div id="secao-evolucao" className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mb-4">
            <p className="font-serif text-lg text-text flex-1">Evolução Mensal</p>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[10px] sm:text-xs">
              {([
                { key: 'receita' as const,   cor: 'bg-primary', label: 'Bruto'      },
                { key: 'comissoes' as const, cor: 'bg-amber',   label: 'Comissões'  },
                { key: 'gastos' as const,    cor: 'bg-red',     label: 'Gastos'     },
              ]).map(({ key, cor, label }) => (
                <button key={key} type="button"
                  onClick={() => setSeriesVisiveis(s => ({ ...s, [key]: !s[key] }))}
                  className={`flex items-center gap-1.5 transition ${seriesVisiveis[key] ? 'text-text-4' : 'text-text-4/40'}`}>
                  <span className={`w-2 h-2 rounded-sm inline-block ${cor}`} style={{ opacity: seriesVisiveis[key] ? 0.8 : 0.25 }}/>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-end gap-3 overflow-x-auto pb-1">
            {evolucao.map((e, i) => {
              const rH = maxEvolucao > 0 && seriesVisiveis.receita   ? (e.receita          / maxEvolucao) * 100 : 0;
              const cH = maxEvolucao > 0 && seriesVisiveis.comissoes ? ((e.comissoes ?? 0) / maxEvolucao) * 100 : 0;
              const gH = maxEvolucao > 0 && seriesVisiveis.gastos    ? (e.gastos           / maxEvolucao) * 100 : 0;
              const isAtual = i === evolucao.length - 1;
              const fade = evolucao.length > 1 ? 0.3 + (i / (evolucao.length - 1)) * 0.7 : 1;
              return (
                <div key={i} className="flex-1 min-w-[40px] flex flex-col items-center gap-1">
                  <div className="w-full flex items-end gap-0.5 h-24">
                    <div className="flex-1 rounded-t-sm bm-grow"
                      style={{ '--bm-i': i, height: `${rH}%`, backgroundColor: 'var(--color-primary)', opacity: isAtual ? 1 : fade } as React.CSSProperties}/>
                    <div className="flex-1 rounded-t-sm bm-grow"
                      style={{ '--bm-i': i + 0.65, height: `${cH}%`, backgroundColor: 'var(--color-amber)', opacity: isAtual ? 0.8 : fade * 0.85 } as React.CSSProperties}/>
                    <div className="flex-1 rounded-t-sm bm-grow"
                      style={{ '--bm-i': i + 1.3, height: `${gH}%`, backgroundColor: 'var(--color-rose)', opacity: isAtual ? 0.7 : fade * 0.7 } as React.CSSProperties}/>
                  </div>
                  <p className={`text-[10px] font-semibold capitalize ${isAtual ? 'text-primary' : 'text-text-4'}`}>{e.mes}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top serviços */}
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <p className="font-serif text-lg text-text mb-4">Top Serviços</p>
          {loading ? (
            <div className="flex flex-col gap-3">{[1,2,3].map(i => <div key={i} className="h-8 bg-bg rounded-lg animate-pulse"/>)}</div>
          ) : topServicos.length === 0 ? (
            <p className="text-sm text-text-4 italic">Sem atendimentos concluídos no mês.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {topServicos.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className={`text-lg font-bold w-5 flex-shrink-0 ${i < 2 ? 'text-primary' : 'text-text-4'}`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-xs font-semibold text-text truncate">{s.nome}</p>
                      <p className="text-xs font-bold text-text-2 flex-shrink-0">{fmtBRL(s.receita)}</p>
                    </div>
                    <div className="h-1.5 bg-border rounded-full overflow-hidden">
                      <div className="h-full bg-accent rounded-full transition-all"
                        style={{ width: `${s.percentual}%`, opacity: 0.5 + s.percentual / 200 }}/>
                    </div>
                    <p className="text-[10px] text-text-4 mt-0.5">{s.quantidade} atend.</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Formas de pagamento */}
        {metodos.length > 0 && (
          <div id="secao-formas-pagamento" className="md:col-span-2 bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
            <p className="font-serif text-lg text-text px-5 pt-5 pb-4">Formas de Pagamento</p>
            {metodos.map((m, i) => {
              const cfg = METODO_CFG[m.metodo] ?? METODO_CFG.cortesia;
              const Icon = cfg.icon;
              return (
                <button key={m.metodo} type="button" onClick={() => abrirDetalheMetodo(m.metodo)}
                  className={`w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-bg transition ${i < metodos.length - 1 ? 'border-b border-border' : ''}`}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: cfg.bg }}>
                    <Icon size={14} strokeWidth={2} style={{ color: cfg.cor }}/>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-text">{cfg.label}</p>
                    <p className="text-[10px] text-text-4">{m.quantidade} {m.quantidade === 1 ? 'transação' : 'transações'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-text">{fmtBRL(m.valor)}</p>
                    <p className="text-[10px] text-text-4">{m.percentual}%</p>
                  </div>
                </button>
              );
            })}
            <div className="flex h-1.5 mx-4 mb-3 mt-2 rounded-full overflow-hidden">
              {metodos.map(m => {
                const cfg = METODO_CFG[m.metodo];
                return <div key={m.metodo} style={{ flex: m.percentual, backgroundColor: cfg?.cor ?? '#9CA3AF', opacity: 0.6 }}/>;
              })}
            </div>
          </div>
        )}

        {/* Taxas de cancelamento — lado a lado com Taxas de Reserva no
            desktop quando as duas existem; largura total quando só uma */}
        {taxasCancelamento.length > 0 && (
          <div id="secao-taxas-cancelamento" className={`${taxasReserva.length > 0 ? '' : 'md:col-span-2'} bg-surface border border-border rounded-2xl overflow-hidden shadow-sm`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <p className="font-serif text-lg text-text">Taxas de Cancelamento</p>
              <span className="text-xs text-text-4">{taxasCancelamento.length} lançamento(s)</span>
            </div>
            {taxasCancelamento.map((t, i) => (
              <div key={t.id}
                className={`flex items-center gap-2 px-4 py-3 ${i < taxasCancelamento.length - 1 ? 'border-b border-border' : ''}`}>
                <div
                  className="flex items-center gap-3 flex-1 min-w-0 rounded-lg cursor-pointer hover:bg-bg transition"
                  onClick={() => setDetalheTaxa({ tipo: 'cancelamento', taxa: t })}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${t.status === 'pago' ? 'bg-green-soft' : 'bg-amber-soft'}`}>
                    {t.status === 'pago'
                      ? <CheckCircle2 size={14} strokeWidth={2} className="text-green"/>
                      : <AlertTriangle size={14} strokeWidth={2} className="text-amber"/>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-text truncate">{t.cliente?.nome ?? 'Cliente'}</p>
                    <p className="text-[10px] text-text-4 mt-0.5">
                      {t.status === 'pago'
                        ? `Pago ${t.paga_em ? format(new Date(t.paga_em), 'dd/MM') : ''}`
                        : `Gerada ${format(new Date(t.created_at), 'dd/MM')}`
                      }
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-red">{fmtBRL(t.valor)}</p>
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md ${
                      t.status === 'pago' ? 'bg-green-soft text-green' : 'bg-amber-soft text-amber'
                    }`}>
                      {t.status === 'pago' ? 'Paga' : 'Pendente'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Taxas de reserva */}
        {taxasReserva.length > 0 && (
          <div id="secao-taxas-reserva" className={`${taxasCancelamento.length > 0 ? '' : 'md:col-span-2'} bg-surface border border-border rounded-2xl overflow-hidden shadow-sm`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <p className="font-serif text-lg text-text">Taxas de Reserva</p>
              <span className="text-xs text-text-4">{taxasReserva.length} lançamento(s)</span>
            </div>
            {taxasReserva.map((t, i) => (
              <div key={t.id}
                className={`flex items-center gap-2 px-4 py-3 ${i < taxasReserva.length - 1 ? 'border-b border-border' : ''}`}>
                <div
                  className="flex items-center gap-3 flex-1 min-w-0 rounded-lg cursor-pointer hover:bg-bg transition"
                  onClick={() => setDetalheTaxa({ tipo: 'reserva', taxa: t })}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    t.status === 'pago' ? 'bg-green-soft' : t.status === 'retida' ? 'bg-border' : 'bg-amber-soft'
                  }`}>
                    {t.status === 'pago'
                      ? <CheckCircle2 size={14} strokeWidth={2} className="text-green"/>
                      : t.status === 'retida'
                        ? <Ban size={14} strokeWidth={2} className="text-text-3"/>
                        : <AlertTriangle size={14} strokeWidth={2} className="text-amber"/>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-text truncate">{t.cliente?.nome ?? 'Cliente'}</p>
                    <p className="text-[10px] text-text-4 mt-0.5">
                      {t.status === 'pago' || t.status === 'retida'
                        ? `Pago ${t.paga_em ? format(new Date(t.paga_em), 'dd/MM') : ''}`
                        : `Gerada ${format(new Date(t.created_at), 'dd/MM')}`
                      }
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-red">{fmtBRL(t.valor)}</p>
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md ${
                      t.status === 'pago' ? 'bg-green-soft text-green' : t.status === 'retida' ? 'bg-border text-text-3' : 'bg-amber-soft text-amber'
                    }`}>
                      {t.status === 'pago' ? 'Paga' : t.status === 'retida' ? 'Retida' : 'Pendente'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {modalDespesa && empresaId && (
        <NovaDespesaModal empresaId={empresaId} onClose={() => setModalDespesa(false)} onSalvo={() => { setModalDespesa(false); recarregar(); }}/>
      )}
      {marcarPago && (
        <MarcarPagoModal despesa={marcarPago} onClose={() => setMarcarPago(null)} onSalvo={() => { setMarcarPago(null); recarregar(); }}
          onEditar={() => { setEditarDespesa(marcarPago); setMarcarPago(null); }}/>
      )}
      {editarDespesa && (
        <EditarDespesaModal despesa={editarDespesa} onClose={() => setEditarDespesa(null)} onSalvo={() => { setEditarDespesa(null); recarregar(); }}/>
      )}
      {detalhe && (
        <DetalheModal titulo={detalhe.titulo} cor={detalhe.cor} itens={detalhe.itens} onClose={() => setDetalhe(null)}/>
      )}
      {detalheTaxa && (
        <TaxaDetalheModal tipo={detalheTaxa.tipo} taxa={detalheTaxa.taxa} marcando={marcandoTaxa}
          onClose={() => setDetalheTaxa(null)} onMarcarPaga={confirmarMarcarTaxaPaga}/>
      )}
      {verTodasDespesas && empresaId && (
        <TodasDespesasModal empresaId={empresaId} onClose={() => setVerTodasDespesas(false)}
          onMarcarPago={d => { setVerTodasDespesas(false); setMarcarPago(d); }}
          onEditar={d => { setVerTodasDespesas(false); setEditarDespesa(d); }}/>
      )}
    </div>
  );
}
