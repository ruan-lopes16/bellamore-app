'use client';

/**
 * @file vendas/page.tsx
 * Módulo de Vendas Avulsas — PDV para produtos fora de agendamentos.
 *
 * ## Abas
 * - PDV       : carrinho + checkout (produtos → pagamento → finalizar)
 * - Histórico : vendas do dia escolhido (em Brasília), com itens, formas de pagamento e exportação
 *               — o mesmo conteúdo do app (mobile/app/(empresa)/vendas.tsx)
 * - Pós-venda : tela de sucesso com itens/pagamentos, aviso de estoque e recibo por WhatsApp
 *               quando a cliente tem telefone (gerarTextoRecibo com tipo "compra")
 *
 * ## Regras (as mesmas do app e da comanda)
 * - carrinho com limite de estoque     = shared/venda.ts (adicionarAoCarrinho, alterarQuantidade)
 * - desconto % ou R$ (gravado em R$)   = calcularDesconto (shared/comanda-fechamento.ts)
 * - total, falta, troco, cortesia      = resumoComanda (descontoReserva sempre 0 na venda)
 * - cartão: maquininha/bandeira/parcelas/taxa da configuração (shared/taxas-cartao.ts)
 * - gravação vendas → venda_itens → estoque_movimentos → pagamentos = gravarVenda
 *   (estoque_atual decrementado pelo trigger trg_atualizar_estoque)
 *
 * Sem N+1: todos os produtos carregados de uma vez, filtro local.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ShoppingCart, Search, Plus, Minus, X, Trash2,
  Banknote, Zap, CreditCard, Gift, Package, Tag,
  AlertCircle, Check, History, ChevronLeft, ChevronRight, Share2,
} from 'lucide-react';
import { ExportButton } from '@/components/ExportButton';
import { definicaoVendas, linhasVendas } from '@shared/exportacao/vendas';
import { createClient } from '@/lib/supabase/client';
import { usePermissoes } from '@/components/PermissoesProvider';
import type { Cliente as ClienteBase } from '@/types';
import { Sk } from '@/components/Skeleton';
import { Secret, PrivacyToggle } from '@/components/privacy';
import { SearchSelect } from '@/components/SearchSelect';
import { SmoothTabs } from '@/components/SmoothTabs';
import {
  fmtTaxa, valorLiquido, configIndisponivel, AVISO_CARTOES_SEM_TAXA, maquininhasAtivas, maquininhaPadrao, bandeirasAtivas,
  nomeBandeira, parcelasDisponiveis, type ConfigCartoes,
} from '@shared/taxas-cartao';
import { carregarConfigCartoes } from '@shared/taxas-cartao-consultas';
import { calcularDesconto, resumoComanda, taxaDoSplit, parseValorBR, type ModoDesconto } from '@shared/comanda-fechamento';
import { adicionarAoCarrinho, alterarQuantidade, subtotalVenda, gravarVenda, ErroVenda, type ItemVenda } from '@shared/venda';
import { buscarTodasOuLancar } from '@shared/kpis-financeiros-consultas';
import { mensagemErroBanco } from '@shared/erros';
import { formatarMoeda as fmtBRL } from '@shared/moeda';
import { gerarTextoRecibo, linkWhatsAppRecibo } from '@shared/comanda-recibo';
import { hojeBRT, somarDias, limitesDias, rotuloDiaExtenso, rotuloDataHoraBRT } from '@shared/periodos';

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

/** Pagamento na tela (valor como texto). Métodos podem se repetir (ex.: dois cartões). */
type Split = { metodo: string; valor: string; bandeira?: string; parcelas?: number; maquininhaId?: string | null };

type Cliente = Pick<ClienteBase, 'id' | 'nome' | 'telefone'>;

type VendaHistorico = {
  id: string;
  created_at: string;
  cliente: { nome: string } | null;
  valor_total: number;
  desconto: number;
  valor_final: number;
  itens: { produto: { nome: string } | null; quantidade: number; preco_unitario: number }[];
  pagamentos_venda: { metodo: string; valor: number; bandeira: string | null; parcelas: number | null }[];
};

/** Venda recém-finalizada (tela de sucesso e recibo por WhatsApp, igual ao app). */
type Sucesso = {
  total: number; desconto: number; dataIso: string;
  cliente: Cliente | null;
  itens: { descricao: string; quantidade: number; valor: number }[];
  splits: Split[];
  avisoEstoque: string | null;
};

// ── Constantes ────────────────────────────────────────────────

const METODOS_PAG = [
  { id: 'pix',      label: 'PIX',      icon: Zap        },
  { id: 'dinheiro', label: 'Dinheiro', icon: Banknote   },
  { id: 'credito',  label: 'Crédito',  icon: CreditCard },
  { id: 'debito',   label: 'Débito',   icon: CreditCard },
  { id: 'cortesia', label: 'Cortesia', icon: Gift       },
];

// ── Helpers ───────────────────────────────────────────────────

const inputCls = "w-full h-10 px-3.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
const labelCls = "block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5";

/** Rótulo de um pagamento no histórico: método + bandeira cadastrada + parcelas. */
function rotuloPagamento(config: ConfigCartoes, p: VendaHistorico['pagamentos_venda'][number]): string {
  const metodo = METODOS_PAG.find(m => m.id === p.metodo)?.label ?? p.metodo;
  const bandeira = nomeBandeira(config, p.bandeira);
  const parcelas = p.metodo === 'credito' && (p.parcelas ?? 1) > 1 ? ` ${p.parcelas}x` : '';
  return `${metodo}${bandeira ? ` ${bandeira}` : ''}${parcelas}`;
}

// ── Página principal ──────────────────────────────────────────

export default function VendasPage() {
  // Desconto e Cortesia: mesma regra da comanda (comanda.desconto). Sem a permissão, nada de
  // campo de desconto nem chip Cortesia; a cortesia automática de total R$ 0 continua valendo.
  const { pode } = usePermissoes();
  const podeDesconto = pode('comanda.desconto');
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  // Maquininhas, bandeiras e taxas por parcela (migration 086; sem ela, a configuração legada da 084).
  const [config, setConfig] = useState<ConfigCartoes>(() => configIndisponivel());
  // Finalizar fica desligado até a configuração terminar de carregar (igual à comanda).
  const [configPronta, setConfigPronta] = useState(false);
  const [aba, setAba]             = useState<'pdv' | 'historico'>('pdv');

  // Catálogo
  const [produtos,  setProdutos]  = useState<Produto[]>([]);
  const [clientes,  setClientes]  = useState<Cliente[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [busca,     setBusca]     = useState('');

  // Carrinho
  const [cart,       setCart]       = useState<ItemVenda[]>([]);
  const [clienteId,  setClienteId]  = useState('');
  // Desconto: o que a pessoa digitou + se é % ou R$ (grava-se sempre o valor em reais)
  const [descontoEntrada, setDescontoEntrada] = useState('');
  const [descontoModo,    setDescontoModo]    = useState<ModoDesconto>('percentual');
  const [splits,     setSplits]     = useState<Split[]>([]);
  const [finalizando,setFinalizando]= useState(false);
  const [erro,       setErro]       = useState('');
  // Falha ao carregar produtos/clientes: separada de `erro` para não apagar (nem ser apagada por) a mensagem de finalização.
  const [erroCarga,  setErroCarga]  = useState<string | null>(null);
  const [sucesso,    setSucesso]    = useState<Sucesso | null>(null);
  // Venda gravada pela metade (ex.: pagamentos falharam depois de a venda existir): bloqueia
  // um novo "Finalizar" deste carrinho para não registrar a mesma venda duas vezes.
  const [vendaIncompleta, setVendaIncompleta] = useState<string | null>(null);
  // Trava de duplo clique (o estado `finalizando` só vale no próximo render)
  const gravandoRef = useRef(false);

  // Histórico: vendas do dia escolhido (chave 'yyyy-MM-dd' em Brasília)
  const [diaHist,       setDiaHist]       = useState<string>(() => hojeBRT());
  const [vendas,        setVendas]        = useState<VendaHistorico[]>([]);
  const [loadingVendas, setLoadingVendas] = useState(false);
  const [erroVendas,    setErroVendas]    = useState<string | null>(null);
  // Contador de requisição: troca rápida de dia nunca mostra as vendas de outro dia
  const reqVendasRef = useRef(0);

  // ── Carregar empresa
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (data) {
        setEmpresaId(data.empresa_id);
        try {
          setConfig(await carregarConfigCartoes(supabase, data.empresa_id));
        } catch (e) {
          // Taxa nunca inventada: sem configuração, todo cartão é gravado sem taxa (com aviso).
          setErro(`${mensagemErroBanco(e as { code?: string; message?: string }, 'carregar as taxas dos cartões')} ${AVISO_CARTOES_SEM_TAXA}`);
          setConfig(configIndisponivel());
        } finally {
          setConfigPronta(true);
        }
      }
    })();
  }, []);

  // ── Carregar produtos + clientes
  const carregar = useCallback(async (empId: string) => {
    setLoading(true);
    const [rProdutos, rClientes] = await Promise.all([
      supabase.from('produtos')
        .select('id, nome, categoria, preco_venda, estoque_atual, unidade')
        .eq('empresa_id', empId).eq('ativo', true).eq('tipo', 'venda').order('nome'),
      // Paginada: acima de 1000 clientes o PostgREST cortaria a lista em silêncio.
      buscarTodasOuLancar<Cliente>((de, ate) => supabase.from('clientes')
        .select('id, nome, telefone')
        .eq('empresa_id', empId).eq('ativo', true)
        .order('nome').order('id')
        .range(de, ate)).then(
        data => ({ data, error: null as { message: string } | null }),
        (e: unknown) => ({ data: null as Cliente[] | null, error: { message: e instanceof Error ? e.message : String(e) } }),
      ),
    ]);
    if (rProdutos.error) setErroCarga(mensagemErroBanco(rProdutos.error, 'carregar os produtos'));
    else if (rClientes.error) setErroCarga(mensagemErroBanco(rClientes.error, 'carregar as clientes'));
    else setErroCarga(null);
    if (!rProdutos.error) setProdutos((rProdutos.data ?? []) as Produto[]);
    if (!rClientes.error) setClientes((rClientes.data ?? []) as Cliente[]);
    setLoading(false);
  }, []);

  useEffect(() => { if (empresaId) carregar(empresaId); }, [empresaId, carregar]);

  // ── Vendas do dia escolhido (limites do dia em Brasília, igual ao app)
  const carregarVendas = useCallback(async (empId: string, dia: string) => {
    const req = ++reqVendasRef.current;
    const { startIso, endIso } = limitesDias(dia, dia);
    setLoadingVendas(true);
    const { data, error } = await supabase
      .from('vendas')
      .select(`
        id, created_at, valor_total, desconto, valor_final,
        cliente:clientes(nome),
        itens:venda_itens(quantidade, preco_unitario, produto:produtos(nome)),
        pagamentos_venda:pagamentos!pagamentos_venda_id_fkey(metodo, valor, bandeira, parcelas)
      `)
      .eq('empresa_id', empId)
      .gte('created_at', startIso).lte('created_at', endIso)
      .order('created_at', { ascending: false });
    if (req !== reqVendasRef.current) return; // resposta de um dia que já não está na tela
    if (error) { setErroVendas(mensagemErroBanco(error, 'carregar as vendas')); setVendas([]); }
    else { setErroVendas(null); setVendas((data ?? []) as unknown as VendaHistorico[]); }
    setLoadingVendas(false);
  }, []);

  useEffect(() => {
    if (aba === 'historico' && empresaId) carregarVendas(empresaId, diaHist);
  }, [aba, empresaId, diaHist, carregarVendas]);

  // ── Filtro de produtos (local)
  const produtosFiltrados = useMemo(() => {
    if (!busca.trim()) return produtos;
    const q = busca.toLowerCase();
    return produtos.filter(p =>
      p.nome.toLowerCase().includes(q) ||
      (p.categoria ?? '').toLowerCase().includes(q)
    );
  }, [produtos, busca]);

  // ── Totais (mesma regra da comanda)
  const subtotal = subtotalVenda(cart);
  const descontoEntradaN = parseValorBR(descontoEntrada);
  const { valor: descontoN, erro: erroDesconto } = calcularDesconto(subtotal, descontoEntradaN, descontoModo);
  const splitsNumericos = splits.map(s => ({ ...s, valor: parseValorBR(s.valor) }));
  const resumo = resumoComanda({ subtotal, desconto: descontoN, erroDesconto, descontoReserva: 0, splits: splitsNumericos });
  const { total, recebido, falta, troco } = resumo;

  // ── Pagamento (métodos podem se repetir)
  function adicionarSplit(metodo: string) {
    const cartao = metodo === 'credito' || metodo === 'debito';
    setSplits(prev => [...prev, {
      metodo,
      valor: falta > 0 ? falta.toFixed(2).replace('.', ',') : '',
      ...(cartao ? { maquininhaId: maquininhaPadrao(config)?.id ?? null } : {}),
    }]);
  }
  function atualizarSplit(idx: number, valor: string) {
    setSplits(prev => prev.map((s, i) => i === idx ? { ...s, valor } : s));
  }
  function removerSplit(idx: number) {
    setSplits(prev => prev.filter((_, i) => i !== idx));
  }
  function atualizarSplitBandeira(idx: number, bandeira: string) {
    setSplits(prev => prev.map((s, i) => i === idx ? { ...s, bandeira } : s));
  }
  function atualizarSplitParcelas(idx: number, parcelas: number) {
    setSplits(prev => prev.map((s, i) => i === idx ? { ...s, parcelas } : s));
  }
  /** Troca a maquininha; se ela aceita menos parcelas que as escolhidas, ajusta para o máximo dela. */
  function atualizarSplitMaquininha(idx: number, maquininhaId: string) {
    const maq = config.maquininhas.find(m => m.id === maquininhaId);
    setSplits(prev => prev.map((s, i) => {
      if (i !== idx) return s;
      const parcelas = maq && (s.parcelas ?? 1) > maq.maxParcelas ? maq.maxParcelas : s.parcelas;
      return { ...s, maquininhaId, parcelas };
    }));
  }
  /** Maquininha efetiva do split: a escolhida (se existir na configuração) ou a padrão. */
  function maquininhaDoSplit(s: Split) {
    return config.maquininhas.find(m => m.id === s.maquininhaId) ?? maquininhaPadrao(config);
  }

  function limparVenda() {
    setCart([]); setClienteId(''); setDescontoEntrada(''); setSplits([]);
    setVendaIncompleta(null); setErro('');
  }

  // ── Finalizar venda
  async function finalizar() {
    if (!empresaId || gravandoRef.current) return;
    if (vendaIncompleta) { setErro('Esta venda já foi registrada. Confira em Financeiro e clique em "Nova venda".'); return; }
    if (cart.length === 0) { setErro('Carrinho vazio'); return; }
    // Mesma regra do botão: total coberto (troco permitido; R$0 = cortesia) e desconto ≤ subtotal.
    if (!resumo.podeFechar) { setErro(resumo.motivo ?? 'Não foi possível finalizar a venda.'); return; }
    if (!configPronta) { setErro('Aguarde: carregando as taxas dos cartões.'); return; }

    gravandoRef.current = true;
    setFinalizando(true); setErro('');
    try {
      const r = await gravarVenda(supabase, {
        empresaId, clienteId: clienteId || null, itens: cart, desconto: descontoN,
        splits: splitsNumericos, config,
      });
      const lancados = splits.filter(sp => parseValorBR(sp.valor) > 0);
      setSucesso({
        total, desconto: descontoN, dataIso: new Date().toISOString(),
        cliente: clientes.find(c => c.id === clienteId) ?? null,
        itens: cart.map(i => ({ descricao: i.nome, quantidade: i.quantidade, valor: i.precoUnitario })),
        splits: lancados.length === 0 && resumo.cortesiaAutomatica ? [{ metodo: 'cortesia', valor: '0,00' }] : lancados,
        avisoEstoque: r.avisoEstoque,
      });
      limparVenda();
      carregar(empresaId); // atualiza o estoque nos cards
    } catch (e) {
      if (e instanceof ErroVenda) {
        // Qualquer erro da gravação (estoque insuficiente, produto indisponível, sem resposta do
        // servidor...) recarrega o catálogo: saldo dos cards e limite do carrinho voltam a ser reais.
        if (e.vendaId) {
          setVendaIncompleta(e.vendaId);
        }
        carregar(empresaId);
        setErro(e.message);
      } else {
        setErro(e instanceof Error ? e.message : 'Não foi possível finalizar a venda.');
      }
    } finally {
      gravandoRef.current = false;
      setFinalizando(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="bm-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>Ponto de Venda</p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>Vendas</h1>
          <PrivacyToggle />
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

      {/* ══════════ PÓS-VENDA (igual ao app) ══════════ */}
      {aba === 'pdv' && sucesso && (
        <div className="max-w-md mx-auto flex flex-col items-center gap-4 py-6">
          <div className="w-16 h-16 rounded-full bg-green/10 flex items-center justify-center">
            <Check size={30} className="text-green" strokeWidth={3}/>
          </div>
          <div className="text-center">
            <p style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 600, color: 'var(--color-ink)' }}>Venda finalizada</p>
            <p className="text-sm font-bold text-green mt-1"><Secret>{fmtBRL(sucesso.total)}</Secret></p>
            <p className="text-xs text-text-3 mt-0.5">{sucesso.cliente ? sucesso.cliente.nome : 'Venda avulsa'} · {rotuloDataHoraBRT(sucesso.dataIso)}</p>
          </div>

          <div className="w-full bg-bg border border-border rounded-2xl p-4 flex flex-col gap-1.5">
            <p className="text-[11px] font-bold text-text-3 uppercase tracking-wide">Itens</p>
            {sucesso.itens.map((i, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-text truncate">{i.descricao} × {i.quantidade}</span>
                <span className="font-semibold text-text flex-shrink-0">{fmtBRL(i.valor * i.quantidade)}</span>
              </div>
            ))}
            {sucesso.desconto > 0 && (
              <div className="flex items-center justify-between text-sm text-green font-semibold">
                <span>(−) Desconto</span><span>− {fmtBRL(sucesso.desconto)}</span>
              </div>
            )}
            <p className="text-[11px] font-bold text-text-3 uppercase tracking-wide mt-2">Pagamento</p>
            {sucesso.splits.map((sp, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2 text-sm">
                <span className="font-semibold text-text-2">{rotuloPagamento(config, { metodo: sp.metodo, valor: 0, bandeira: sp.bandeira ?? null, parcelas: sp.parcelas ?? null })}</span>
                <span className="text-text-3">{fmtBRL(parseValorBR(sp.valor))}</span>
              </div>
            ))}
          </div>

          {sucesso.avisoEstoque && (
            <div className="w-full flex items-start gap-2 bg-amber/10 border border-amber/20 rounded-xl px-3 py-2.5">
              <AlertCircle size={14} className="text-amber flex-shrink-0 mt-0.5"/>
              <p className="text-xs font-semibold text-amber">{sucesso.avisoEstoque}</p>
            </div>
          )}

          <div className="w-full flex flex-col gap-2">
            {!!sucesso.cliente?.telefone && (
              <button
                onClick={() => {
                  const texto = gerarTextoRecibo({
                    tipo: 'compra',
                    nome: sucesso.cliente!.nome, valor: sucesso.total, dataIso: sucesso.dataIso, itens: sucesso.itens,
                    splits: sucesso.splits.map(sp => ({ metodo: sp.metodo, valor: parseValorBR(sp.valor), bandeira: sp.bandeira, parcelas: sp.parcelas })),
                    desconto: sucesso.desconto, descontoReserva: 0,
                    nomeBandeira: chave => nomeBandeira(config, chave),
                  });
                  window.open(linkWhatsAppRecibo(sucesso.cliente!.telefone!, texto), '_blank');
                }}
                className="w-full h-12 rounded-2xl text-white text-sm font-bold flex items-center justify-center gap-2 hover:opacity-90 transition"
                style={{ background: 'var(--color-green)' }}>
                <Share2 size={16}/> Enviar recibo por WhatsApp
              </button>
            )}
            <button onClick={() => setSucesso(null)}
              className="w-full h-12 rounded-2xl text-sm font-bold border border-border text-text-2 hover:bg-bg transition">
              Nova venda
            </button>
          </div>
        </div>
      )}

      {/* ══════════ TAB: PDV ══════════ */}
      {aba === 'pdv' && !sucesso && (
        <div className="flex flex-col lg:flex-row gap-6 lg:h-[calc(100dvh-220px)]">

          {/* ── Coluna esquerda: produtos ── */}
          <div className="w-full lg:w-[300px] lg:flex-shrink-0 flex flex-col gap-3 max-h-[50dvh] lg:max-h-none overflow-y-auto lg:overflow-visible">
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
                const noCart = cart.find(i => i.produtoId === p.id);
                const semEstoque = p.estoque_atual <= 0;
                return (
                  <button key={p.id} onClick={() => setCart(prev => adicionarAoCarrinho(prev, p))}
                    disabled={semEstoque || !!vendaIncompleta}
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
                {cart.length > 0 && !vendaIncompleta && (
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
                    <div key={item.produtoId}
                      className={`flex items-center gap-3 py-2.5 ${idx < cart.length - 1 ? 'border-b border-border' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-text truncate">{item.nome}</p>
                        <p className="text-xs text-text-3">{fmtBRL(item.precoUnitario)} / {item.unidade}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => setCart(prev => alterarQuantidade(prev, item.produtoId, item.quantidade - 1))}
                          disabled={!!vendaIncompleta}
                          className="w-7 h-7 rounded-lg border border-border text-text-2 flex items-center justify-center hover:bg-bg transition disabled:opacity-30">
                          {item.quantidade > 1 ? <Minus size={11}/> : <Trash2 size={11}/>}
                        </button>
                        <span className="w-7 text-center text-sm font-bold text-text">{item.quantidade}</span>
                        <button
                          onClick={() => setCart(prev => alterarQuantidade(prev, item.produtoId, item.quantidade + 1))}
                          disabled={item.quantidade >= item.estoqueAtual || !!vendaIncompleta}
                          className="w-7 h-7 rounded-lg border border-border text-text-2 flex items-center justify-center hover:bg-bg transition disabled:opacity-30">
                          <Plus size={11}/>
                        </button>
                      </div>
                      <p className="text-sm font-bold text-text w-16 text-right flex-shrink-0">
                        {fmtBRL(item.precoUnitario * item.quantidade)}
                      </p>
                      <button onClick={() => setCart(prev => alterarQuantidade(prev, item.produtoId, 0))}
                        disabled={!!vendaIncompleta}
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition disabled:opacity-30">
                        <X size={12}/>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Cliente + Desconto (desconto só com comanda.desconto, igual à comanda) */}
            <div className="bg-surface border border-border rounded-2xl p-4">
              <div className={`grid grid-cols-1 gap-3 ${podeDesconto ? 'sm:grid-cols-2' : ''}`}>
                <div>
                  <label className={labelCls}>Cliente (opcional)</label>
                  <SearchSelect
                    options={clientes.map(c => ({ value: c.id, label: c.nome }))}
                    value={clienteId} onChange={setClienteId}
                    placeholder="Sem cliente"
                  />
                </div>
                {podeDesconto && (
                <div>
                  <label className={labelCls}>Desconto</label>
                  <div className="flex items-center gap-2">
                    <Tag size={15} className="text-text-3 flex-shrink-0"/>
                    {/* Seletor % / R$ — trocar o modo limpa o valor para não reinterpretar o número */}
                    <div className="flex rounded-lg border border-border overflow-hidden flex-shrink-0">
                      {([['percentual', '%'], ['valor', 'R$']] as const).map(([modo, rotulo]) => (
                        <button key={modo} type="button"
                          onClick={() => { if (descontoModo !== modo) { setDescontoModo(modo); setDescontoEntrada(''); } }}
                          aria-pressed={descontoModo === modo}
                          className={`h-10 px-3 text-xs font-bold transition ${descontoModo === modo ? 'bg-primary text-white' : 'bg-surface text-text-3 hover:text-text'}`}>
                          {rotulo}
                        </button>
                      ))}
                    </div>
                    <div className="relative flex-1">
                      <input value={descontoEntrada} onChange={e => setDescontoEntrada(e.target.value)}
                        inputMode="decimal" placeholder={descontoModo === 'percentual' ? '0' : '0,00'}
                        className={`${inputCls} pr-9 ${erroDesconto ? '!border-red' : ''}`}/>
                      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">{descontoModo === 'percentual' ? '%' : 'R$'}</span>
                    </div>
                  </div>
                  {erroDesconto && (
                    <p className="text-xs text-red font-semibold mt-2">{erroDesconto}</p>
                  )}
                </div>
                )}
              </div>
            </div>

            {/* Pagamento */}
            <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-4">
              <h3 className="font-semibold text-text">Pagamento</h3>

              {/* Chips de método — cada clique adiciona um pagamento (pode repetir). Cortesia só com comanda.desconto. */}
              <div className="flex gap-2 flex-wrap">
                {METODOS_PAG.filter(m => podeDesconto || m.id !== 'cortesia').map(({ id, label, icon: Icon }) => (
                  <button key={id} onClick={() => adicionarSplit(id)}
                    disabled={!!vendaIncompleta}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-semibold border transition bg-surface border-border text-text-2 hover:border-accent/60 disabled:opacity-40">
                    <Icon size={12}/> {label}
                  </button>
                ))}
              </div>

              {/* Inputs de valor por pagamento */}
              {splits.length > 0 && (
                <div className="flex flex-col gap-2">
                  {splits.map((sp, i) => {
                    const m      = METODOS_PAG.find(x => x.id === sp.metodo) ?? METODOS_PAG[0];
                    const Icon   = m.icon;
                    const isCard = sp.metodo === 'credito' || sp.metodo === 'debito';
                    return (
                      <div key={i} className="flex flex-col gap-2 rounded-xl px-3 py-2.5 border border-border bg-bg">
                        <div className="flex items-center gap-2">
                          <Icon size={13} className="text-text-3 flex-shrink-0"/>
                          <span className="text-xs font-semibold text-text-2 flex-1">{m.label}</span>
                          <span className="text-xs text-text-3">R$</span>
                          <input
                            value={sp.valor}
                            onChange={e => atualizarSplit(i, e.target.value)}
                            inputMode="decimal" placeholder="0,00"
                            className="w-24 h-8 px-2 text-sm text-right rounded-lg border border-border bg-surface text-text focus:outline-none focus:border-accent transition font-semibold"
                          />
                          <button onClick={() => removerSplit(i)}
                            className="w-6 h-6 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition flex-shrink-0">
                            <X size={12}/>
                          </button>
                        </div>
                        {isCard && maquininhasAtivas(config).length >= 2 && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-text-3 flex-shrink-0">Maquininha:</span>
                            <select
                              value={maquininhaDoSplit(sp)?.id ?? ''}
                              onChange={e => atualizarSplitMaquininha(i, e.target.value)}
                              className="h-7 px-2 rounded-lg border border-border/60 bg-surface text-xs font-semibold text-text-2 focus:outline-none focus:border-accent transition">
                              {maquininhasAtivas(config).map(mq => <option key={mq.id} value={mq.id}>{mq.nome}</option>)}
                            </select>
                          </div>
                        )}
                        {isCard && (
                          <div className="flex gap-1.5 flex-wrap">
                            {bandeirasAtivas(config).map(b => (
                              <button key={b.chave} type="button" onClick={() => atualizarSplitBandeira(i, b.chave)}
                                className={`px-2 py-0.5 rounded-lg text-xs font-semibold border transition ${
                                  sp.bandeira === b.chave
                                    ? 'bg-accent/10 border-accent text-accent'
                                    : 'border-border/60 text-text-3 hover:border-accent/50 hover:text-text-2'
                                }`}>
                                {b.nome}
                              </button>
                            ))}
                          </div>
                        )}
                        {sp.metodo === 'credito' && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-text-3 flex-shrink-0">Parcelas:</span>
                            <select
                              value={sp.parcelas ?? 1}
                              onChange={e => atualizarSplitParcelas(i, Number(e.target.value))}
                              className="h-7 px-2 rounded-lg border border-border/60 bg-surface text-xs font-semibold text-text-2 focus:outline-none focus:border-accent transition">
                              {(() => {
                                const maq = maquininhaDoSplit(sp);
                                return (maq ? parcelasDisponiveis(maq) : [1]).map(n => (
                                  <option key={n} value={n}>{n}x{n === 1 ? ' (à vista)' : ''}</option>
                                ));
                              })()}
                            </select>
                          </div>
                        )}
                        {isCard && (() => {
                          const valorN = parseValorBR(sp.valor);
                          const taxa   = taxaDoSplit(sp, config);
                          if (taxa === null) {
                            // Taxa nunca inventada: a venda fecha normalmente, gravando o pagamento sem taxa.
                            return (
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber">
                                <AlertCircle size={12}/>
                                <span>Taxa não cadastrada para esta combinação</span>
                              </div>
                            );
                          }
                          if (!valorN) return null;
                          return (
                            <div className="flex items-center justify-between text-xs text-text-3">
                              <span>Taxa {fmtTaxa(taxa)}</span>
                              <span>Líquido {fmtBRL(valorLiquido(valorN, taxa))}</span>
                            </div>
                          );
                        })()}
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
                      <span>Subtotal</span><span><Secret>{fmtBRL(subtotal)}</Secret></span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-green font-semibold">
                      <span>(−) Desconto{descontoModo === 'percentual' && <> (<Secret>{String(descontoEntradaN).replace('.', ',')}%</Secret>)</>}</span>
                      <span>− <Secret>{fmtBRL(descontoN)}</Secret></span>
                    </div>
                  </>
                )}
                <div className="flex items-center justify-between">
                  <span className="font-bold text-text">Total</span>
                  <span className="font-bold text-2xl text-text"><Secret>{fmtBRL(total)}</Secret></span>
                </div>
                {splits.length > 0 && (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-text-2">Recebido</span>
                      <span className="font-bold text-text"><Secret>{fmtBRL(recebido)}</Secret></span>
                    </div>
                    {falta > 0.01 && (
                      <div className="flex items-center justify-between text-sm font-bold text-amber">
                        <span>Falta</span><span><Secret>{fmtBRL(falta)}</Secret></span>
                      </div>
                    )}
                    {troco > 0.01 && (
                      <div className="flex items-center justify-between text-sm font-bold text-primary">
                        <span>Troco</span><span><Secret>{fmtBRL(troco)}</Secret></span>
                      </div>
                    )}
                    {falta <= 0.01 && troco <= 0.01 && (
                      <div className="flex items-center justify-center gap-1.5">
                        <Check size={14} className="text-green" strokeWidth={3}/>
                        <span className="text-green text-sm font-bold">Valor quitado</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {erroCarga && (
              <div className="flex items-center gap-2 bg-red-soft rounded-xl px-3 py-2.5 border border-red/20">
                <AlertCircle size={14} className="text-red flex-shrink-0"/>
                <p className="text-sm text-red flex-1">{erroCarga}</p>
              </div>
            )}

            {/* Erro */}
            {erro && (
              <div className="flex items-center gap-2 bg-red-soft rounded-xl px-3 py-2.5 border border-red/20">
                <AlertCircle size={14} className="text-red flex-shrink-0"/>
                <p className="text-sm text-red flex-1">{erro}</p>
                {vendaIncompleta && (
                  <button onClick={limparVenda}
                    className="text-xs font-bold text-primary underline flex-shrink-0">
                    Nova venda
                  </button>
                )}
              </div>
            )}

            {/* Botão finalizar */}
            <div className="flex-shrink-0">
              <button
                onClick={finalizar}
                disabled={finalizando || !configPronta || cart.length === 0 || !empresaId || !resumo.podeFechar || !!vendaIncompleta}
                className="w-full h-12 rounded-2xl bg-primary text-white font-bold text-base hover:opacity-90 transition disabled:opacity-40 flex items-center justify-center gap-2">
                {finalizando ? 'Finalizando...' : (
                  <><Check size={18} strokeWidth={2.5}/> Finalizar venda · {fmtBRL(total)}</>
                )}
              </button>
              {cart.length > 0 && !configPronta && (
                <p className="text-xs text-center mt-2 font-semibold text-text-3">Carregando as taxas dos cartões…</p>
              )}
              {cart.length > 0 && !vendaIncompleta && resumo.motivo && (
                <p className={`text-xs text-center mt-2 font-semibold ${erroDesconto ? 'text-red' : 'text-amber'}`}>
                  {resumo.motivo}
                </p>
              )}
              {cart.length > 0 && !vendaIncompleta && resumo.podeFechar && resumo.cortesiaAutomatica && splits.length === 0 && (
                <p className="text-xs text-text-4 text-center mt-2">
                  Total R$ 0 — será registrado como Cortesia
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════ TAB: HISTÓRICO ══════════ */}
      {aba === 'historico' && (
        <div>
          {/* Seletor de dia (Brasília), igual ao app */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="flex items-center flex-1 sm:flex-none sm:w-80 bg-surface border border-border rounded-2xl p-1">
              <button onClick={() => setDiaHist(d => somarDias(d, -1))} aria-label="Dia anterior"
                className="w-9 h-9 rounded-xl flex items-center justify-center text-text-2 hover:bg-bg transition">
                <ChevronLeft size={18}/>
              </button>
              <div className="flex-1 text-center">
                <p className="text-sm font-bold text-text">{diaHist === hojeBRT() ? 'Hoje' : rotuloDiaExtenso(diaHist)}</p>
                {diaHist === hojeBRT() && <p className="text-[11px] text-text-3">{rotuloDiaExtenso(diaHist)}</p>}
              </div>
              <button onClick={() => setDiaHist(d => somarDias(d, 1))} disabled={diaHist >= hojeBRT()} aria-label="Próximo dia"
                className="w-9 h-9 rounded-xl flex items-center justify-center text-text-2 hover:bg-bg transition disabled:opacity-30">
                <ChevronRight size={18}/>
              </button>
            </div>
            {!loadingVendas && !erroVendas && vendas.length > 0 && (
              <div className="flex items-center gap-3 ml-auto">
                <p className="text-xs font-semibold text-text-3">
                  {vendas.length} {vendas.length === 1 ? 'venda' : 'vendas'} · <Secret>{fmtBRL(vendas.reduce((acc, v) => acc + Math.round(Number(v.valor_final) * 100), 0) / 100)}</Secret>
                </p>
                <ExportButton
                  definicao={definicaoVendas()}
                  getLinhas={() => linhasVendas(vendas, m => METODOS_PAG.find(x => x.id === m)?.label ?? m)}
                />
              </div>
            )}
          </div>
          {loadingVendas ? (
            <div className="flex flex-col gap-3">
              {[1,2,3,4].map(i => <Sk key={i} className="h-20 rounded-2xl"/>)}
            </div>
          ) : erroVendas ? (
            <div className="flex items-center gap-2 bg-red-soft rounded-xl px-3 py-2.5 border border-red/20">
              <AlertCircle size={14} className="text-red flex-shrink-0"/>
              <p className="text-sm text-red flex-1">{erroVendas}</p>
              <button onClick={() => { if (empresaId) carregarVendas(empresaId, diaHist); }}
                className="text-xs font-bold text-primary underline flex-shrink-0">
                Tentar de novo
              </button>
            </div>
          ) : vendas.length === 0 ? (
            <div className="text-center py-16">
              <History size={36} className="mx-auto mb-3 text-text-4"/>
              <p className="text-text-3 text-sm">Nenhuma venda neste dia.</p>
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
                        {v.cliente ? v.cliente.nome : 'Venda avulsa'}
                      </p>
                      <span className="text-text-4">·</span>
                      <p className="text-xs text-text-4">
                        {rotuloDataHoraBRT(v.created_at)}
                      </p>
                    </div>

                    {/* Itens */}
                    <p className="text-xs text-text-3 truncate mb-2">
                      {v.itens.map(i => `${i.produto?.nome ?? '?'} × ${i.quantidade}`).join('  ·  ')}
                    </p>

                    {/* Formas de pagamento (métodos podem se repetir) */}
                    <div className="flex gap-1.5 flex-wrap">
                      {v.pagamentos_venda.map((p, i) => (
                        <span key={i}
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-bg border border-border text-text-3">
                          {rotuloPagamento(config, p)} {fmtBRL(p.valor)}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Valor */}
                  <div className="text-right flex-shrink-0">
                    {v.desconto > 0 && (
                      <p className="text-xs text-text-4 line-through"><Secret>{fmtBRL(v.valor_total)}</Secret></p>
                    )}
                    <p className="text-xl font-bold text-text"><Secret>{fmtBRL(v.valor_final)}</Secret></p>
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
