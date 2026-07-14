'use client';

/**
 * @file financeiro/page.tsx
 * Módulo financeiro completo com KPIs, evolução e gestão de despesas.
 *
 * ## KPIs calculados
 * Todos os valores são calculados a partir de agendamentos (status = 'concluido'),
 * NÃO da tabela `comissoes` ou `pagamentos`.
 *
 * - Faturamento Bruto  = soma de agendamentos.valor no mês
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
 * Busca agendamentos dos últimos 6 meses em UMA query só (range de datas),
 * depois agrupa por mês no client usando `isSameMonth` do date-fns.
 * Evita 6 queries paralelas.
 *
 * ## Despesas
 * - Listagem do mês com status pendente/pago
 * - Modal de nova despesa com suporte a recorrentes
 * - Modal de marcar como pago (registra data e forma de pagamento)
 */

import { useState, useEffect } from 'react';
import {
  Plus, ChevronLeft, ChevronRight, TrendingUp, TrendingDown,
  CheckCircle2, AlertTriangle, X, Layers, Banknote, CreditCard, Gift,
  RefreshCw, Check,
} from 'lucide-react';
import { ExportButton } from '@/components/ExportButton';
import { createClient } from '@/lib/supabase/client';
import { Sk } from '@/components/Skeleton';
import {
  format, addMonths, subMonths, startOfMonth, endOfMonth, isSameMonth, parseISO,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { buildDespesaPagamentoUpdate, formatValorMonetarioInput } from '@shared/despesas';

const supabase = createClient();

// ── Tipos ─────────────────────────────────────────────────────

type Despesa = {
  id: string; descricao: string; categoria?: string;
  valor: number; recorrente: boolean;
  data_vencimento?: string; data_pagamento?: string;
  status: 'pendente' | 'pago';
};
type TopServico = { nome: string; quantidade: number; receita: number; percentual: number };
type MetodoPag  = { metodo: string; valor: number; quantidade: number; percentual: number };
type RecorrenteTemplate = { descricao: string; categoria?: string; valor: number; periodicidade?: string; data_vencimento?: string };

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
  { key: 'mensal', label: 'Mensal' },
  { key: 'semanal', label: 'Semanal' },
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
  const [descricao,     setDescricao]     = useState('');
  const [valor,         setValor]         = useState('');
  const [categoria,     setCategoria]     = useState('');
  const [recorrente,    setRecorrente]    = useState(false);
  const [periodicidade, setPeriodicidade] = useState<'mensal' | 'semanal' | 'anual'>('mensal');
  const [vencimento,    setVencimento]    = useState('');
  const [salvando,      setSalvando]      = useState(false);
  const [erro,          setErro]          = useState('');

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setSalvando(true);
    const valorN = parseFloat(valor.replace(',', '.'));
    if (isNaN(valorN) || valorN <= 0) {
      setErro('Informe um valor maior que zero.'); setSalvando(false); return;
    }
    const { error } = await supabase.from('despesas').insert({
      empresa_id:      empresaId,
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorN,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: vencimento || null,
      status:          'pendente',
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo();
  }

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <h2 className="font-serif text-xl text-text">Nova despesa</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition"><X size={16}/></button>
        </div>
        <form onSubmit={salvar} className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
          <div>
            <label className={labelClass}>Descrição *</label>
            <input value={descricao} onChange={e => setDescricao(e.target.value)}
              placeholder="Ex: Aluguel do espaço" required className={inputClass}/>
          </div>
          <div>
            <label className={labelClass}>Valor *</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
              <input value={valor} onChange={e => setValor(e.target.value)}
                inputMode="decimal" placeholder="0,00" required className={`${inputClass} pl-9`}/>
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
              <div className="flex gap-2 mt-3">
                {PERIODICIDADES.map(p => (
                  <button key={p.key} type="button" onClick={() => setPeriodicidade(p.key)}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition ${
                      periodicidade === p.key
                        ? 'bg-amber-soft border-amber/30 text-amber'
                        : 'bg-bg border-border text-text-3'
                    }`}>{p.label}</button>
                ))}
              </div>
            )}
          </div>
          {erro && <p className="text-red text-sm">{erro}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
              Cancelar
            </button>
            <button type="submit" disabled={salvando || !descricao.trim() || !valor}
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

function MarcarPagoModal({ despesa, onClose, onSalvo }: {
  despesa: Despesa; onClose: () => void; onSalvo: () => void;
}) {
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
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-xs p-6 max-h-[90vh] overflow-y-auto">
        <p className="text-xs text-text-4 uppercase tracking-wide font-semibold mb-1">Confirmar pagamento</p>
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
  const [evolucao,      setEvolucao]      = useState<{ mes: string; receita: number; comissoes: number; gastos: number }[]>([]);

  // Modais
  const [modalDespesa, setModalDespesa] = useState(false);
  const [marcarPago,            setMarcarPago]            = useState<Despesa | null>(null);
  const [recorrentesParaLancar, setRecorrentesParaLancar] = useState<RecorrenteTemplate[]>([]);
  const [lancandoRec,           setLancandoRec]           = useState(false);

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
    const ini  = startOfMonth(mes).toISOString();
    const fim  = endOfMonth(mes).toISOString();
    const iniA = startOfMonth(subMonths(mes, 1)).toISOString();
    const fimA = endOfMonth(subMonths(mes, 1)).toISOString();
    const ini6 = startOfMonth(subMonths(mes, 5)).toISOString();

    const [agsMes, agsAnt, ags6m, membros, despMes, despAnt, desp6m, pagsMes, despLista, vendasMes, vendasAnt, vendas6m, recMesAnt] = await Promise.all([
      // Agendamentos concluídos do mês (com profissional e serviço)
      supabase.from('agendamentos').select('profissional_id, servico_id, valor, servico:servicos(nome)')
        .eq('empresa_id', empId).eq('status', 'concluido')
        .gte('data_hora_inicio', ini).lte('data_hora_inicio', fim),
      // Agendamentos mês anterior
      supabase.from('agendamentos').select('profissional_id, valor')
        .eq('empresa_id', empId).eq('status', 'concluido')
        .gte('data_hora_inicio', iniA).lte('data_hora_inicio', fimA),
      // Agendamentos 6 meses (evolução)
      supabase.from('agendamentos').select('profissional_id, valor, data_hora_inicio')
        .eq('empresa_id', empId).eq('status', 'concluido')
        .gte('data_hora_inicio', ini6).lte('data_hora_inicio', fim),
      // Membros ativos → percentual de comissão (inclui owner/gestor que também atendem)
      supabase.from('empresa_membros').select('user_id, percentual_comissao')
        .eq('empresa_id', empId).eq('ativo', true),
      // Despesas pagas no mês
      supabase.from('despesas').select('valor')
        .eq('empresa_id', empId).eq('status', 'pago')
        .gte('data_pagamento', ini.slice(0,10)).lte('data_pagamento', fim.slice(0,10)),
      // Despesas pagas mês anterior
      supabase.from('despesas').select('valor')
        .eq('empresa_id', empId).eq('status', 'pago')
        .gte('data_pagamento', iniA.slice(0,10)).lte('data_pagamento', fimA.slice(0,10)),
      // Despesas 6 meses (evolução)
      supabase.from('despesas').select('valor, data_pagamento')
        .eq('empresa_id', empId).eq('status', 'pago')
        .gte('data_pagamento', ini6.slice(0,10)).lte('data_pagamento', fim.slice(0,10)),
      // Formas de pagamento
      supabase.from('pagamentos').select('metodo, valor, valor_liquido')
        .eq('empresa_id', empId).eq('status', 'pago')
        .gte('created_at', ini).lte('created_at', fim),
      // Lista de despesas do mês (pendentes + pagas)
      supabase.from('despesas').select('*')
        .eq('empresa_id', empId)
        .or(`and(data_vencimento.gte.${ini.slice(0,10)},data_vencimento.lte.${fim.slice(0,10)}),and(data_pagamento.gte.${ini.slice(0,10)},data_pagamento.lte.${fim.slice(0,10)})`)
        .order('status').order('data_vencimento'),
      // Vendas avulsas do mês
      supabase.from('vendas').select('valor_final')
        .eq('empresa_id', empId).gte('created_at', ini).lte('created_at', fim),
      // Vendas avulsas mês anterior
      supabase.from('vendas').select('valor_final')
        .eq('empresa_id', empId).gte('created_at', iniA).lte('created_at', fimA),
      // Vendas avulsas 6 meses
      supabase.from('vendas').select('valor_final, created_at')
        .eq('empresa_id', empId).gte('created_at', ini6).lte('created_at', fim),
      // Histórico de despesas mensais recorrentes (para auto-lançamento robusto)
      supabase.from('despesas')
        .select('descricao, categoria, valor, periodicidade, data_vencimento')
        .eq('empresa_id', empId).eq('recorrente', true).eq('periodicidade', 'mensal')
        .lt('data_vencimento', ini.slice(0,10))   // somente meses passados
        .order('data_vencimento', { ascending: false }),
    ]);

    // Mapa de comissão por profissional (user_id → %)
    const comMap: Record<string, number> = {};
    ((membros.data ?? []) as { user_id: string; percentual_comissao: number }[])
      .forEach(m => { comMap[m.user_id] = m.percentual_comissao ?? 0; });

    type AgRow = { profissional_id: string | null; valor: number };
    const calcCom = (ags: AgRow[]) =>
      ags
        .filter(a => a.profissional_id != null)
        .reduce((s, a) => s + Number(a.valor) * (comMap[a.profissional_id!] ?? 0) / 100, 0);

    type ValRow = { valor: number };
    type VendaRow = { valor_final: number };
    const brutoServicos   = ((agsMes.data ?? []) as ValRow[]).reduce((s, a) => s + Number(a.valor), 0);
    const brutoVendas     = ((vendasMes.data ?? []) as VendaRow[]).reduce((s, v) => s + Number(v.valor_final), 0);
    const receitaVal      = brutoServicos + brutoVendas;
    const receitaAntVal   = ((agsAnt.data ?? []) as ValRow[]).reduce((s, a) => s + Number(a.valor), 0)
                          + ((vendasAnt.data ?? []) as VendaRow[]).reduce((s, v) => s + Number(v.valor_final), 0);
    const comissoesVal    = calcCom((agsMes.data ?? []) as AgRow[]);
    const comissoesAntVal = calcCom((agsAnt.data ?? []) as AgRow[]);
    const gastosVal       = ((despMes.data ?? []) as ValRow[]).reduce((s, d) => s + Number(d.valor), 0);
    const gastosAntVal    = ((despAnt.data ?? []) as ValRow[]).reduce((s, d) => s + Number(d.valor), 0);

    setReceita(receitaVal);       setReceitaAnt(receitaAntVal);
    setComissoes(comissoesVal);   setComissoesAnt(comissoesAntVal);
    setGastos(gastosVal);         setGastosAnt(gastosAntVal);

    // Top serviços
    const svcMap: Record<string, { nome: string; qtd: number; receita: number }> = {};
    (agsMes.data ?? []).forEach((a: any) => {
      const id = a.servico_id; const nome = a.servico?.nome ?? 'Serviço';
      if (!svcMap[id]) svcMap[id] = { nome, qtd: 0, receita: 0 };
      svcMap[id].qtd += 1; svcMap[id].receita += Number(a.valor);
    });
    const svcLista = Object.entries(svcMap)
      .map(([, s]) => ({ nome: s.nome, quantidade: s.qtd, receita: s.receita, percentual: 0 }))
      .sort((a, b) => b.receita - a.receita).slice(0, 5);
    const maxSvc = svcLista[0]?.receita ?? 1;
    setTopServicos(svcLista.map(s => ({ ...s, percentual: Math.round((s.receita / maxSvc) * 100) })));

    // Taxas de cartão — soma (valor - valor_liquido) onde valor_liquido não é nulo
    type PagRow = { metodo: string; valor: number; valor_liquido: number | null };
    const pagsData = (pagsMes.data ?? []) as PagRow[];
    const taxasCartaoVal = pagsData.reduce((s, p) =>
      s + (p.valor_liquido != null ? Number(p.valor) - Number(p.valor_liquido) : 0), 0);
    setTaxasCartao(taxasCartaoVal);

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

    // Evolução 6 meses (client-side, a partir das queries únicas)
    const evolucaoData = Array.from({ length: 6 }, (_, i) => {
      const m    = subMonths(mes, 5 - i);
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
      return {
        mes:       format(m, 'MMM', { locale: ptBR }),
        receita:   mesAgs.reduce((s, a) => s + Number(a.valor), 0)
                 + mesVendas.reduce((s, v) => s + Number(v.valor_final), 0),
        comissoes: calcCom(mesAgs),
        gastos:    mesDesp.reduce((s, d) => s + Number(d.valor), 0),
      };
    });
    setEvolucao(evolucaoData);

    setDespesas((despLista.data ?? []) as Despesa[]);

    // Auto-lançamento robusto: pega o template mais recente por (descricao+categoria),
    // independente de quantos meses foram pulados.
    const todasMensais = (recMesAnt.data ?? []) as RecorrenteTemplate[];
    // Agrupa por chave composta — preserva a versão mais recente (já vem desc por data)
    const porChave: Record<string, RecorrenteTemplate> = {};
    for (const r of todasMensais) {
      const chave = `${r.descricao}||${r.categoria ?? ''}`;
      if (!porChave[chave]) porChave[chave] = r;   // primeiro = mais recente
    }
    // Compara com o mês atual pela mesma chave composta
    const despAtual = (despLista.data ?? []) as { descricao: string; categoria?: string }[];
    const chavesMesAtual = new Set(despAtual.map(d => `${d.descricao}||${d.categoria ?? ''}`));
    setRecorrentesParaLancar(Object.values(porChave).filter(r =>
      !chavesMesAtual.has(`${r.descricao}||${r.categoria ?? ''}`)
    ));

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
        valor:           r.valor,
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
        status:          'pendente',
      }))
    );
    setLancandoRec(false);
    setRecorrentesParaLancar([]);
    recarregar();
  }

  const liquidoAposTaxas = receita - taxasCartao;
  const lucro            = liquidoAposTaxas - comissoes - gastos;
  const dReceita         = delta(receita,   receitaAnt);
  const dComissoes       = delta(comissoes, comissoesAnt);
  const dGastos          = delta(gastos,    gastosAnt);
  const maxEvolucao = Math.max(...evolucao.flatMap(e => [e.receita, e.gastos, e.comissoes ?? 0]), 1);

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

      {/* Seletor de mês */}
      <div className="flex items-center justify-center mb-6">
        <div className="bg-surface border border-border rounded-[20px] flex items-center gap-2 px-3 py-2">
          <button onClick={() => setMesRef(m => subMonths(m, 1))}
            className="w-8 h-8 rounded-[10px] flex items-center justify-center text-text-3 hover:bg-bg transition">
            <ChevronLeft size={16}/>
          </button>
          <div className="text-center" style={{ minWidth: 180 }}>
            <p className="text-sm font-semibold capitalize" style={{ color: 'var(--color-ink)' }}>
              {format(mesRef, 'MMMM yyyy', { locale: ptBR })}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-ink4)' }}>
              {format(startOfMonth(mesRef), 'dd/MM')} – {format(endOfMonth(mesRef), 'dd/MM')}
            </p>
          </div>
          <button onClick={() => !isHoje && setMesRef(m => addMonths(m, 1))}
            disabled={isHoje}
            className="w-8 h-8 rounded-[10px] flex items-center justify-center text-text-3 hover:bg-bg transition disabled:opacity-30">
            <ChevronRight size={16}/>
          </button>
        </div>
      </div>

      {/* KPIs */}
      {loading ? (
        <div className="flex flex-col gap-3 mb-6">
          {[0,1].map(row => (
            <div key={row} className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {[1,2,3].map(i => (
                <div key={i} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
                  <Sk className="h-3 w-1/3 mb-3 max-w-[100px]"/><Sk className="h-7 w-2/3 mb-3 max-w-[140px]"/><Sk className="h-3 w-1/2 max-w-[120px]"/>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3 mb-6">
          {/* Linha 1: Bruto → Taxas Cartão → Líquido após Taxas */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: 'Faturamento Bruto',   value: receita,          d: dReceita,   cor: 'text-green',   invertDelta: false },
              { label: 'Taxas de Cartão',     value: taxasCartao,      d: null,       cor: 'text-rose',    invertDelta: false },
              { label: 'Líquido após Taxas',  value: liquidoAposTaxas, d: null,       cor: 'text-primary', invertDelta: false },
            ].map(({ label, value, d, cor, invertDelta }) => (
              <div key={label} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
                <p className="text-xs text-text-4 uppercase tracking-wide font-semibold mb-2">{label}</p>
                <p className={`text-2xl font-bold leading-none mb-2 ${cor}`}>{fmtBRL(value)}</p>
                {d !== null && (
                  <div className="flex items-center gap-1">
                    {(invertDelta ? d < 0 : d >= 0)
                      ? <TrendingUp  size={11} className="text-green" strokeWidth={2.5}/>
                      : <TrendingDown size={11} className="text-red"  strokeWidth={2.5}/>
                    }
                    <span className={`text-xs font-bold ${(invertDelta ? d < 0 : d >= 0) ? 'text-green' : 'text-red'}`}>
                      {d >= 0 ? '+' : ''}{d}% vs mês anterior
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* Linha 2: Comissões | Gastos | Lucro Real */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: 'Comissões',           value: comissoes, d: dComissoes, cor: 'text-amber',                                    invertDelta: true  },
              { label: 'Gastos Operacionais', value: gastos,    d: dGastos,   cor: 'text-rose',                                     invertDelta: true  },
              { label: 'Lucro Real',          value: lucro,     d: null,      cor: lucro >= 0 ? 'text-primary' : 'text-red',        invertDelta: false },
            ].map(({ label, value, d, cor, invertDelta }) => (
              <div key={label} className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
                <p className="text-xs text-text-4 uppercase tracking-wide font-semibold mb-2">{label}</p>
                <p className={`text-2xl font-bold leading-none mb-2 ${cor}`}>{fmtBRL(value)}</p>
                {d !== null && (
                  <div className="flex items-center gap-1">
                    {(invertDelta ? d < 0 : d >= 0)
                      ? <TrendingUp  size={11} className="text-green" strokeWidth={2.5}/>
                      : <TrendingDown size={11} className="text-red"  strokeWidth={2.5}/>
                    }
                    <span className={`text-xs font-bold ${(invertDelta ? d < 0 : d >= 0) ? 'text-green' : 'text-red'}`}>
                      {d >= 0 ? '+' : ''}{d}% vs mês anterior
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Skeleton: evolução */}
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            <Sk className="h-5 w-36 mb-5"/>
            <div className="flex items-end gap-3 h-24">
              {[60,80,45,90,70,100].map((h,i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
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
          {/* Skeleton: despesas (col-span-2) */}
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
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Evolução mensal */}
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mb-4">
            <p className="font-serif text-lg text-text flex-1">Evolução Mensal</p>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[10px] sm:text-xs text-text-4">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-primary inline-block"/>Bruto</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-amber inline-block opacity-80"/>Comissões</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-red inline-block opacity-60"/>Gastos</span>
            </div>
          </div>
          <div className="flex items-end gap-3 h-32">
            {evolucao.map((e, i) => {
              const rH = maxEvolucao > 0 ? (e.receita          / maxEvolucao) * 100 : 0;
              const cH = maxEvolucao > 0 ? ((e.comissoes ?? 0) / maxEvolucao) * 100 : 0;
              const gH = maxEvolucao > 0 ? (e.gastos           / maxEvolucao) * 100 : 0;
              const isAtual = i === evolucao.length - 1;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end gap-0.5 h-24">
                    <div className="flex-1 rounded-t-sm bm-grow"
                      style={{ '--bm-i': i, height: `${rH}%`, backgroundColor: 'var(--color-primary)', opacity: isAtual ? 1 : 0.3 + i * 0.12 } as React.CSSProperties}/>
                    <div className="flex-1 rounded-t-sm bm-grow"
                      style={{ '--bm-i': i + 0.65, height: `${cH}%`, backgroundColor: 'var(--color-amber)', opacity: isAtual ? 0.8 : 0.2 + i * 0.1 } as React.CSSProperties}/>
                    <div className="flex-1 rounded-t-sm bm-grow"
                      style={{ '--bm-i': i + 1.3, height: `${gH}%`, backgroundColor: 'var(--color-rose)', opacity: isAtual ? 0.7 : 0.2 + i * 0.08 } as React.CSSProperties}/>
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
          <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
            <p className="font-serif text-lg text-text px-5 pt-5 pb-4">Formas de Pagamento</p>
            {metodos.map((m, i) => {
              const cfg = METODO_CFG[m.metodo] ?? METODO_CFG.cortesia;
              const Icon = cfg.icon;
              return (
                <div key={m.metodo}
                  className={`flex items-center gap-3 px-5 py-3 ${i < metodos.length - 1 ? 'border-b border-border' : ''}`}>
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
                </div>
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

        {/* Despesas */}
        <div className={`bg-surface border border-border rounded-2xl overflow-hidden shadow-sm ${metodos.length > 0 ? '' : 'md:col-span-2'}`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <p className="font-serif text-lg text-text">Despesas</p>
            <button onClick={() => setModalDespesa(true)}
              className="press flex items-center gap-1.5 px-3 h-8 rounded-xl text-white text-xs font-bold"
              style={{ background: 'var(--color-primary)', boxShadow: '0 4px 14px rgba(44,23,80,0.18)' }}>
              <Plus size={13} strokeWidth={2.5}/> Nova
            </button>
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
            despesas.map((d, i) => (
              <div key={d.id}
                className={`flex items-center gap-3 px-5 py-3 ${i < despesas.length - 1 ? 'border-b border-border' : ''} ${d.status === 'pendente' ? 'cursor-pointer hover:bg-bg transition' : ''}`}
                onClick={() => d.status === 'pendente' && setMarcarPago(d)}>
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
            ))
          )}
        </div>
      </div>
      )}

      {modalDespesa && empresaId && (
        <NovaDespesaModal empresaId={empresaId} onClose={() => setModalDespesa(false)} onSalvo={() => { setModalDespesa(false); recarregar(); }}/>
      )}
      {marcarPago && (
        <MarcarPagoModal despesa={marcarPago} onClose={() => setMarcarPago(null)} onSalvo={() => { setMarcarPago(null); recarregar(); }}/>
      )}
    </div>
  );
}
