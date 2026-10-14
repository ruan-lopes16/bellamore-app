/**
 * @file vendas.tsx
 * Vendas avulsas no app — o mesmo PDV do web (web/app/(app)/vendas/page.tsx).
 *
 * ## Abas
 * - Nova venda : produtos de venda → carrinho → cliente (opcional) → desconto → pagamento → finalizar
 * - Histórico  : vendas do dia escolhido (em Brasília), com cliente, itens, pagamentos e total
 *
 * ## Regras (as mesmas do web e da comanda)
 * - carrinho com limite de estoque     = shared/venda.ts (adicionarAoCarrinho, alterarQuantidade)
 * - desconto % ou R$ (gravado em R$)   = calcularDesconto (shared/comanda-fechamento.ts)
 * - total, falta, troco, cortesia      = resumoComanda (descontoReserva sempre 0 na venda)
 * - cartão: maquininha/bandeira/parcelas/taxa da configuração (PagamentosEditor, shared/taxas-cartao.ts)
 * - gravação vendas → venda_itens → estoque_movimentos → pagamentos = gravarVenda
 *   (estoque_atual decrementado pelo trigger trg_atualizar_estoque)
 * - venda gravada pela metade (ErroVenda com vendaId) trava um novo "Finalizar" deste carrinho.
 */
import { useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert,
  StatusBar, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, Check, X, Trash2, Plus, Minus, Search, Package, ShoppingCart,
  Tag, AlertCircle, Send, History, User,
} from 'lucide-react-native';
import { useFonts, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';

import { useAuthStore } from '@/stores/authStore';
import { usePermissoes } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { invalidarFinanceiro } from '@/lib/invalidarFinanceiro';
import SuccessCheck from '@/components/SuccessCheck';
import { SmoothTabs } from '@/components/SmoothTabs';
import { BotaoExportar } from '@/components/BotaoExportar';
import { definicaoVendas, linhasVendas } from '@shared/exportacao/vendas';
import PagamentosEditor, { METODOS_PAGAMENTO, type SplitEditavel } from '@/components/comanda/PagamentosEditor';
import { calcularDesconto, resumoComanda, parseValorBR, type ModoDesconto } from '@shared/comanda-fechamento';
import { configIndisponivel, AVISO_CARTOES_SEM_TAXA, nomeBandeira, type ConfigCartoes } from '@shared/taxas-cartao';
import { carregarConfigCartoes } from '@shared/taxas-cartao-consultas';
import {
  adicionarAoCarrinho, alterarQuantidade, subtotalVenda, gravarVenda, ErroVenda,
  type ItemVenda, type ProdutoVenda,
} from '@shared/venda';
import { gerarTextoRecibo, linkWhatsAppRecibo } from '@shared/comanda-recibo';
import { buscarTodasOuLancar } from '@shared/kpis-financeiros-consultas';
import { mensagemErroBanco } from '@shared/erros';
import { formatarMoeda } from '@shared/moeda';
import { limitesDias, chaveDiaExibido, horaBRT, rotuloDiaExtenso } from '@shared/periodos';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  red: '#EF4444', redSoft: '#FEF2F2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

// ── Tipos ─────────────────────────────────────────────────────

type Produto = ProdutoVenda & { categoria: string | null };
type Cliente = { id: string; nome: string; telefone: string | null };

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

type Sucesso = {
  total: number; desconto: number; dataIso: string;
  cliente: Cliente | null;
  itens: { descricao: string; quantidade: number; valor: number }[];
  splits: SplitEditavel[];
  avisoEstoque: string | null;
};

const fonte = (peso: '400' | '500' | '600' | '700') => ({
  '400': 'PlusJakartaSans_400Regular', '500': 'PlusJakartaSans_500Medium',
  '600': 'PlusJakartaSans_600SemiBold', '700': 'PlusJakartaSans_700Bold',
}[peso]);

/** Rótulo de um pagamento no histórico: método + bandeira cadastrada + parcelas (igual ao web). */
function rotuloPagamento(config: ConfigCartoes, p: { metodo: string; bandeira?: string | null; parcelas?: number | null }): string {
  const metodo = METODOS_PAGAMENTO.find(m => m.key === p.metodo)?.label ?? p.metodo;
  const bandeira = p.bandeira ? nomeBandeira(config, p.bandeira) : '';
  const parcelas = p.metodo === 'credito' && (p.parcelas ?? 1) > 1 ? ` ${p.parcelas}x` : '';
  return `${metodo}${bandeira ? ` ${bandeira}` : ''}${parcelas}`;
}

const somarDiasData = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// ── Tela ──────────────────────────────────────────────────────

export default function VendasScreen() {
  const insets = useSafeAreaInsets();
  const empresaId = useAuthStore(s => s.empresaAtiva?.id ?? null);
  const { pode, permissoesCarregadas } = usePermissoes();
  const podeVendas = pode('vendas.acessar');
  // Desconto e Cortesia: mesma regra da comanda (comanda.desconto). Sem a permissão, nada de
  // campo de desconto nem chip Cortesia; a cortesia automática de total R$ 0 continua valendo.
  const podeDesconto = pode('comanda.desconto');
  const qc = useQueryClient();
  /** Estoque mudou (produtos vendidos): atualiza a tela de Estoque e os alertas. */
  const invalidarEstoque = () => {
    qc.invalidateQueries({ queryKey: ['estoque'] });
    qc.invalidateQueries({ queryKey: ['estoque-movimentos'] });
    qc.invalidateQueries({ queryKey: ['estoque-baixo'] });
  };

  const [aba, setAba] = useState<'nova' | 'historico'>('nova');
  // Maquininhas, bandeiras e taxas por parcela (migration 086; sem ela, a configuração legada da 084).
  const [config, setConfig] = useState<ConfigCartoes>(() => configIndisponivel());

  // Catálogo
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const avisoCartoesRef = useRef(false);
  // Vira true no primeiro sucesso: uma falha passageira na recarga não troca a config boa por configIndisponivel().
  const configCarregadaRef = useRef(false);

  // Venda
  const [cart, setCart] = useState<ItemVenda[]>([]);
  const [clienteId, setClienteId] = useState('');
  const [buscaCliente, setBuscaCliente] = useState('');
  const [descontoEntrada, setDescontoEntrada] = useState('');
  const [descontoModo, setDescontoModo] = useState<ModoDesconto>('percentual');
  const [splits, setSplits] = useState<SplitEditavel[]>([]);
  const [finalizando, setFinalizando] = useState(false);
  const [erro, setErro] = useState('');
  // Venda gravada pela metade: bloqueia um novo "Finalizar" deste carrinho (não registrar duas vezes).
  const [vendaIncompleta, setVendaIncompleta] = useState<string | null>(null);
  // Trava de duplo toque (o estado `finalizando` só vale no próximo render)
  const gravandoRef = useRef(false);
  const [sucesso, setSucesso] = useState<Sucesso | null>(null);

  // Histórico
  const [dia, setDia] = useState<Date>(() => new Date());
  const [vendas, setVendas] = useState<VendaHistorico[]>([]);
  const [loadingVendas, setLoadingVendas] = useState(false);
  const [erroVendas, setErroVendas] = useState<string | null>(null);
  // Contador de requisição: troca rápida de dia nunca mostra as vendas de outro dia
  const reqVendasRef = useRef(0);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  });

  // ── Produtos de venda + clientes + configuração de cartões (mesma consulta do web)
  const carregar = useCallback(async () => {
    if (!empresaId) return;
    const [rProdutos, rClientes, rCartoes] = await Promise.all([
      supabase.from('produtos')
        .select('id, nome, categoria, preco_venda, estoque_atual, unidade')
        .eq('empresa_id', empresaId).eq('ativo', true).eq('tipo', 'venda').order('nome'),
      // Paginada: acima de 1000 clientes o PostgREST cortaria a lista em silêncio.
      buscarTodasOuLancar<Cliente>((de, ate) => supabase.from('clientes')
        .select('id, nome, telefone')
        .eq('empresa_id', empresaId).eq('ativo', true)
        .order('nome').order('id')
        .range(de, ate)).then(
        data => ({ data, error: null as { message: string } | null }),
        (e: unknown) => ({ data: null as Cliente[] | null, error: { message: e instanceof Error ? e.message : String(e) } }),
      ),
      // Erro de leitura não derruba a tela: avisa e usa configIndisponivel (cartão sem taxa) —
      // nunca as taxas antigas da 084 nem o padrão.
      carregarConfigCartoes(supabase, empresaId).then(
        c => ({ config: c, erro: null as string | null }),
        (e: unknown) => ({
          config: configIndisponivel(),
          erro: `${mensagemErroBanco(e as { code?: string; message?: string }, 'carregar as taxas dos cartões')} ${AVISO_CARTOES_SEM_TAXA}` as string | null,
        }),
      ),
    ]);
    if (rProdutos.error) setErroCarga(mensagemErroBanco(rProdutos.error, 'carregar os produtos'));
    else if (rClientes.error) setErroCarga(mensagemErroBanco(rClientes.error, 'carregar as clientes'));
    else setErroCarga(null);
    if (!rProdutos.error) setProdutos((rProdutos.data ?? []) as Produto[]);
    if (!rClientes.error) setClientes((rClientes.data ?? []) as Cliente[]);
    if (!rCartoes.erro) { configCarregadaRef.current = true; setConfig(rCartoes.config); }
    else if (!configCarregadaRef.current) setConfig(rCartoes.config);
    if (rCartoes.erro && !avisoCartoesRef.current) {
      avisoCartoesRef.current = true;
      Alert.alert('Cartões', rCartoes.erro);
    }
    setLoading(false);
  }, [empresaId]);

  // Ao abrir e ao VOLTAR para a tela (ela fica montada na pilha): estoque dos cards sempre atual.
  useFocusEffect(useCallback(() => { if (podeVendas) carregar(); }, [carregar, podeVendas]));

  // ── Vendas do dia escolhido (limites do dia em Brasília)
  const carregarVendas = useCallback(async () => {
    if (!empresaId) return;
    const req = ++reqVendasRef.current;
    const chave = chaveDiaExibido(dia);
    const { startIso, endIso } = limitesDias(chave, chave);
    setLoadingVendas(true);
    const { data, error } = await supabase
      .from('vendas')
      .select(`
        id, created_at, valor_total, desconto, valor_final,
        cliente:clientes(nome),
        itens:venda_itens(quantidade, preco_unitario, produto:produtos(nome)),
        pagamentos_venda:pagamentos!pagamentos_venda_id_fkey(metodo, valor, bandeira, parcelas)
      `)
      .eq('empresa_id', empresaId)
      .gte('created_at', startIso).lte('created_at', endIso)
      .order('created_at', { ascending: false });
    if (req !== reqVendasRef.current) return; // resposta de um dia que já não está na tela
    if (error) { setErroVendas(mensagemErroBanco(error, 'carregar as vendas')); setVendas([]); }
    else { setErroVendas(null); setVendas((data ?? []) as unknown as VendaHistorico[]); }
    setLoadingVendas(false);
  }, [empresaId, dia]);

  // Histórico do dia: ao abrir a aba, ao trocar o dia e ao voltar para a tela.
  useFocusEffect(useCallback(() => {
    if (aba === 'historico' && podeVendas) carregarVendas();
  }, [aba, carregarVendas, podeVendas]));

  // ── Filtros locais
  const produtosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return produtos;
    return produtos.filter(p => p.nome.toLowerCase().includes(q) || (p.categoria ?? '').toLowerCase().includes(q));
  }, [produtos, busca]);
  const clienteSel = clientes.find(c => c.id === clienteId) ?? null;
  const clientesFiltrados = useMemo(() => {
    const q = buscaCliente.trim().toLowerCase();
    if (!q) return [];
    const digitos = q.replace(/\D/g, '');
    return clientes.filter(c => c.nome.toLowerCase().includes(q) || (!!digitos && (c.telefone ?? '').replace(/\D/g, '').includes(digitos))).slice(0, 6);
  }, [clientes, buscaCliente]);

  // ── Totais (mesma regra da comanda e do web)
  const subtotal = subtotalVenda(cart);
  const descontoEntradaN = parseValorBR(descontoEntrada);
  const { valor: descontoN, erro: erroDesconto } = calcularDesconto(subtotal, descontoEntradaN, descontoModo);
  const splitsNumericos = splits.map(s => ({ ...s, valor: parseValorBR(s.valor) }));
  const resumo = resumoComanda({ subtotal, desconto: descontoN, erroDesconto, descontoReserva: 0, splits: splitsNumericos });
  const { total, recebido, falta, troco } = resumo;
  const travada = !!vendaIncompleta;
  const botaoDesabilitado = finalizando || cart.length === 0 || !empresaId || !resumo.podeFechar || travada;

  function limparVenda() {
    setCart([]); setClienteId(''); setBuscaCliente(''); setDescontoEntrada(''); setSplits([]);
    setVendaIncompleta(null); setErro('');
  }

  // ── Finalizar venda
  async function finalizar() {
    if (!empresaId || gravandoRef.current) return;
    if (vendaIncompleta) { setErro('Esta venda já foi registrada. Confira em Financeiro e toque em "Nova venda".'); return; }
    if (cart.length === 0) { setErro('Carrinho vazio'); return; }
    // Mesma regra do botão: total coberto (troco permitido; R$0 = cortesia) e desconto ≤ subtotal.
    if (!resumo.podeFechar) { setErro(resumo.motivo ?? 'Não foi possível finalizar a venda.'); return; }

    gravandoRef.current = true;
    setFinalizando(true); setErro('');
    try {
      const r = await gravarVenda(supabase, {
        empresaId, clienteId: clienteId || null, itens: cart, desconto: descontoN,
        splits: splitsNumericos, config,
      });
      const lancados = splits.filter(s => parseValorBR(s.valor) > 0);
      setSucesso({
        total, desconto: descontoN, dataIso: new Date().toISOString(),
        cliente: clienteSel,
        itens: cart.map(i => ({ descricao: i.nome, quantidade: i.quantidade, valor: i.precoUnitario })),
        splits: lancados.length === 0 && resumo.cortesiaAutomatica ? [{ metodo: 'cortesia', valor: '0,00' }] : lancados,
        avisoEstoque: r.avisoEstoque,
      });
      limparVenda();
      invalidarFinanceiro(qc);
      invalidarEstoque();
      carregar(); // atualiza o estoque nos cards
    } catch (e) {
      if (e instanceof ErroVenda) {
        // Qualquer erro da gravação (estoque insuficiente, produto indisponível, sem resposta do
        // servidor...) recarrega o catálogo: saldo dos cards e limite do carrinho voltam a ser reais.
        if (e.vendaId) {
          setVendaIncompleta(e.vendaId);
          invalidarFinanceiro(qc); // a venda existe e já conta no faturamento
          invalidarEstoque();
        }
        carregar();
        setErro(e.message);
      } else {
        setErro(e instanceof Error ? e.message : 'Não foi possível finalizar a venda.');
      }
    } finally {
      gravandoRef.current = false;
      setFinalizando(false);
    }
  }

  if (!fontsLoaded) return null;

  // Permissões ainda carregando: não mostrar "Sem permissão" por um instante.
  if (!permissoesCarregadas) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.primary} />
      </View>
    );
  }

  // ── Sem permissão (ex.: deep link)
  if (!podeVendas) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 20, color: C.text3, textAlign: 'center' }}>
          Sem permissão para registrar e ver vendas avulsas
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}>
          <Text style={{ fontFamily: fonte('700'), fontSize: 13, color: '#fff' }}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Sucesso
  if (sucesso) {
    const s = sucesso;
    return (
      <View style={{ flex: 1, backgroundColor: C.surface, paddingTop: insets.top }}>
        <StatusBar barStyle="dark-content" />
        <ScrollView contentContainerStyle={{ alignItems: 'center', padding: 24, paddingBottom: insets.bottom + 32 }}>
          <SuccessCheck size={84} />
          <MotiView from={{ opacity: 0, translateY: 8 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 350, delay: 200 }}>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 22, color: C.text, textAlign: 'center', marginTop: 16 }}>Venda finalizada</Text>
            <Text style={{ fontFamily: fonte('700'), fontSize: 14, color: C.green, textAlign: 'center', marginTop: 4 }}>{formatarMoeda(s.total)}</Text>
            <Text style={{ fontFamily: fonte('400'), fontSize: 12, color: C.text3, textAlign: 'center', marginTop: 2 }}>
              {s.cliente ? s.cliente.nome : 'Venda avulsa'}
            </Text>
          </MotiView>

          <View style={{ width: '100%', maxWidth: 340, marginTop: 20, backgroundColor: C.bg, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14, gap: 6 }}>
            <Text style={{ fontFamily: fonte('700'), fontSize: 10.5, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6 }}>Itens</Text>
            {s.itens.map((i, idx) => (
              <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ fontFamily: fonte('500'), fontSize: 13, color: C.text, flex: 1 }} numberOfLines={1}>{i.descricao} × {i.quantidade}</Text>
                <Text style={{ fontFamily: fonte('600'), fontSize: 13, color: C.text }}>{formatarMoeda(i.valor * i.quantidade)}</Text>
              </View>
            ))}
            {s.desconto > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: fonte('500'), fontSize: 13, color: C.green }}>(−) Desconto</Text>
                <Text style={{ fontFamily: fonte('600'), fontSize: 13, color: C.green }}>− {formatarMoeda(s.desconto)}</Text>
              </View>
            )}
            <Text style={{ fontFamily: fonte('700'), fontSize: 10.5, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 8 }}>Pagamento</Text>
            {s.splits.map((sp, idx) => {
              const m = METODOS_PAGAMENTO.find(x => x.key === sp.metodo) ?? METODOS_PAGAMENTO[0];
              return (
                <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: m.bg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, gap: 8 }}>
                  <Text style={{ fontFamily: fonte('600'), fontSize: 13, color: m.cor, flex: 1 }}>{rotuloPagamento(config, sp)}</Text>
                  <Text style={{ fontFamily: fonte('500'), fontSize: 12, color: m.cor }}>{formatarMoeda(parseValorBR(sp.valor))}</Text>
                </View>
              );
            })}
          </View>

          {s.avisoEstoque && (
            <View style={{ width: '100%', maxWidth: 340, marginTop: 12, flexDirection: 'row', gap: 8, backgroundColor: C.amberSoft, borderRadius: 12, padding: 12 }}>
              <AlertCircle size={16} color={C.amber} />
              <Text style={{ fontFamily: fonte('600'), fontSize: 12, color: C.amber, flex: 1 }}>{s.avisoEstoque}</Text>
            </View>
          )}

          {!!s.cliente?.telefone && (
            <TouchableOpacity
              onPress={() => {
                const texto = gerarTextoRecibo({
                  tipo: 'compra',
                  nome: s.cliente!.nome, valor: s.total, dataIso: s.dataIso, itens: s.itens,
                  splits: s.splits.map(sp => ({ metodo: sp.metodo, valor: parseValorBR(sp.valor), bandeira: sp.bandeira, parcelas: sp.parcelas })),
                  desconto: s.desconto, descontoReserva: 0,
                  nomeBandeira: chave => nomeBandeira(config, chave),
                });
                Linking.openURL(linkWhatsAppRecibo(s.cliente!.telefone!, texto))
                  .catch(() => Alert.alert('WhatsApp', 'Não foi possível abrir o WhatsApp.'));
              }}
              activeOpacity={0.8}
              style={{ marginTop: 24, backgroundColor: '#16A34A', borderRadius: 16, paddingHorizontal: 32, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Send size={16} color="#fff" />
              <Text style={{ fontFamily: fonte('700'), fontSize: 14, color: '#fff' }}>Enviar recibo por WhatsApp</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={() => setSucesso(null)} activeOpacity={0.8}
            style={{ marginTop: 16, backgroundColor: C.green, borderRadius: 16, paddingHorizontal: 32, paddingVertical: 14 }}>
            <Text style={{ fontFamily: fonte('700'), fontSize: 14, color: '#fff' }}>Nova venda</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  const chaveDia = chaveDiaExibido(dia);
  const ehHoje = chaveDia === chaveDiaExibido(new Date());

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
        <StatusBar barStyle="dark-content" />
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
            <ChevronLeft size={20} color={C.text3} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonte('700'), fontSize: 10.5, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2 }}>Ponto de venda</Text>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 22, color: C.text }}>Vendas</Text>
          </View>
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <SmoothTabs variant="segmented"
            tabs={[{ key: 'nova', label: 'Nova venda' }, { key: 'historico', label: 'Histórico' }]}
            active={aba} onChange={k => setAba(k as 'nova' | 'historico')} />
        </View>

        {aba === 'nova' ? (
          <>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 200, gap: 16 }} keyboardShouldPersistTaps="handled">
              {erroCarga && (
                <TouchableOpacity onPress={carregar} style={{ backgroundColor: C.redSoft, borderRadius: 12, padding: 12 }}>
                  <Text style={{ fontFamily: fonte('600'), fontSize: 12, color: C.red }}>{erroCarga} — toque para tentar de novo.</Text>
                </TouchableOpacity>
              )}

              {/* ── Produtos ── */}
              <View style={{ backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderRadius: 12, paddingHorizontal: 12, height: 42, borderWidth: 1, borderColor: C.border }}>
                  <Search size={15} color={C.text4} />
                  <TextInput value={busca} onChangeText={setBusca} placeholder="Buscar produto..." placeholderTextColor={C.text4}
                    style={{ flex: 1, marginLeft: 8, fontFamily: fonte('500'), fontSize: 14, color: C.text }} />
                </View>
                {loading ? (
                  <ActivityIndicator color={C.primary} style={{ marginVertical: 20 }} />
                ) : produtosFiltrados.length === 0 ? (
                  <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                    <Package size={26} color={C.text4} />
                    <Text style={{ fontFamily: fonte('500'), fontSize: 13, color: C.text4, marginTop: 6 }}>
                      {busca ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado'}
                    </Text>
                  </View>
                ) : (
                  <ScrollView style={{ maxHeight: 280 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {produtosFiltrados.map(p => {
                      const noCart = cart.find(i => i.produtoId === p.id);
                      const semEstoque = p.estoque_atual <= 0;
                      return (
                        <TouchableOpacity key={p.id} onPress={() => setCart(prev => adicionarAoCarrinho(prev, p))}
                          disabled={semEstoque || travada} activeOpacity={0.7}
                          style={{
                            flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, marginBottom: 6,
                            borderWidth: 1, borderColor: noCart ? C.primary : C.border,
                            backgroundColor: noCart ? C.primarySoft : C.surface, opacity: semEstoque ? 0.5 : 1,
                          }}>
                          <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                            <Package size={14} color={C.primary} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontFamily: fonte('600'), fontSize: 13, color: C.text }} numberOfLines={1}>{p.nome}</Text>
                            <Text style={{ fontFamily: fonte('400'), fontSize: 11, color: C.text4 }}>
                              {semEstoque ? 'Sem estoque' : `${p.estoque_atual} ${p.unidade}`}
                              {noCart ? ` · ${noCart.quantidade} no carrinho` : ''}
                            </Text>
                          </View>
                          <Text style={{ fontFamily: fonte('700'), fontSize: 13, color: C.text }}>{formatarMoeda(p.preco_venda)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </View>

              {/* ── Carrinho ── */}
              <View style={{ backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <ShoppingCart size={15} color={C.text} />
                    <Text style={{ fontFamily: fonte('700'), fontSize: 14, color: C.text }}>Carrinho</Text>
                    {cart.length > 0 && (
                      <View style={{ backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1 }}>
                        <Text style={{ fontFamily: fonte('700'), fontSize: 11, color: '#fff' }}>{cart.length}</Text>
                      </View>
                    )}
                  </View>
                  {cart.length > 0 && !travada && (
                    <TouchableOpacity onPress={() => setCart([])}>
                      <Text style={{ fontFamily: fonte('600'), fontSize: 12, color: C.text4 }}>Limpar</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {cart.length === 0 ? (
                  <Text style={{ fontFamily: fonte('400'), fontSize: 13, color: C.text4, textAlign: 'center', paddingVertical: 12 }}>
                    Toque nos produtos acima para adicionar
                  </Text>
                ) : cart.map((item, idx) => (
                  <View key={item.produtoId} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderTopWidth: idx === 0 ? 0 : 1, borderColor: C.border }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: fonte('600'), fontSize: 13, color: C.text }} numberOfLines={1}>{item.nome}</Text>
                      <Text style={{ fontFamily: fonte('400'), fontSize: 11, color: C.text3 }}>{formatarMoeda(item.precoUnitario)} / {item.unidade}</Text>
                    </View>
                    <TouchableOpacity onPress={() => setCart(prev => alterarQuantidade(prev, item.produtoId, item.quantidade - 1))}
                      disabled={travada}
                      style={{ width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', opacity: travada ? 0.3 : 1 }}>
                      {item.quantidade > 1 ? <Minus size={12} color={C.text2} /> : <Trash2 size={12} color={C.text2} />}
                    </TouchableOpacity>
                    <Text style={{ width: 24, textAlign: 'center', fontFamily: fonte('700'), fontSize: 14, color: C.text }}>{item.quantidade}</Text>
                    <TouchableOpacity onPress={() => setCart(prev => alterarQuantidade(prev, item.produtoId, item.quantidade + 1))}
                      disabled={travada || item.quantidade >= item.estoqueAtual}
                      style={{ width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', opacity: travada || item.quantidade >= item.estoqueAtual ? 0.3 : 1 }}>
                      <Plus size={12} color={C.text2} />
                    </TouchableOpacity>
                    <Text style={{ width: 76, textAlign: 'right', fontFamily: fonte('700'), fontSize: 13, color: C.text }} numberOfLines={1} adjustsFontSizeToFit>
                      {formatarMoeda(item.precoUnitario * item.quantidade)}
                    </Text>
                    <TouchableOpacity onPress={() => setCart(prev => alterarQuantidade(prev, item.produtoId, 0))} disabled={travada}
                      style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center', opacity: travada ? 0.3 : 1 }}>
                      <X size={13} color={C.text4} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>

              {/* ── Cliente (opcional) ── */}
              <View>
                <Text style={{ fontFamily: fonte('700'), fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10 }}>Cliente (opcional)</Text>
                {clienteSel ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, height: 48 }}>
                    <User size={16} color={C.text3} />
                    <Text style={{ flex: 1, fontFamily: fonte('600'), fontSize: 14, color: C.text }} numberOfLines={1}>{clienteSel.nome}</Text>
                    {!travada && (
                      <TouchableOpacity onPress={() => { setClienteId(''); setBuscaCliente(''); }}>
                        <X size={16} color={C.text4} />
                      </TouchableOpacity>
                    )}
                  </View>
                ) : (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, height: 48 }}>
                      <Search size={15} color={C.text4} />
                      <TextInput value={buscaCliente} onChangeText={setBuscaCliente} editable={!travada}
                        placeholder="Sem cliente — buscar por nome ou telefone" placeholderTextColor={C.text4}
                        style={{ flex: 1, marginLeft: 8, fontFamily: fonte('500'), fontSize: 14, color: C.text }} />
                    </View>
                    {clientesFiltrados.length > 0 && (
                      <View style={{ marginTop: 6, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
                        {clientesFiltrados.map((c, idx) => (
                          <TouchableOpacity key={c.id} onPress={() => { setClienteId(c.id); setBuscaCliente(''); }}
                            style={{ paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: idx === 0 ? 0 : 1, borderColor: C.border }}>
                            <Text style={{ fontFamily: fonte('600'), fontSize: 13, color: C.text }}>{c.nome}</Text>
                            {!!c.telefone && <Text style={{ fontFamily: fonte('400'), fontSize: 11, color: C.text4 }}>{c.telefone}</Text>}
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </>
                )}
              </View>

              {/* ── Desconto (mesma permissão da comanda: comanda.desconto) ── */}
              {podeDesconto && (
              <View pointerEvents={travada ? 'none' : 'auto'}>
                <Text style={{ fontFamily: fonte('700'), fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10 }}>Desconto</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 14, paddingHorizontal: 14, height: 48, borderWidth: 1, borderColor: erroDesconto ? C.red : C.border }}>
                  <Tag size={16} color={C.text3} />
                  <Text style={{ flex: 1, fontFamily: fonte('400'), fontSize: 14, color: C.text2, marginLeft: 10 }}>Desconto</Text>
                  {/* Seletor % / R$ — trocar o modo limpa o valor para não reinterpretar o número */}
                  <View style={{ flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: C.border, overflow: 'hidden', marginRight: 8 }}>
                    {([['percentual', '%'], ['valor', 'R$']] as const).map(([modo, rotulo]) => {
                      const ativo = descontoModo === modo;
                      return (
                        <TouchableOpacity key={modo}
                          onPress={() => { if (!ativo) { setDescontoModo(modo); setDescontoEntrada(''); } }}
                          accessibilityRole="button" accessibilityState={{ selected: ativo }}
                          style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: ativo ? C.primary : C.surface }}>
                          <Text style={{ fontFamily: fonte('700'), fontSize: 12, color: ativo ? '#fff' : C.text3 }}>{rotulo}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TextInput value={descontoEntrada} onChangeText={setDescontoEntrada}
                    keyboardType="decimal-pad" placeholder={descontoModo === 'percentual' ? '0' : '0,00'} placeholderTextColor={C.text4}
                    style={{ width: 64, fontFamily: fonte('600'), fontSize: 14, color: C.text, textAlign: 'right' }} />
                  <Text style={{ fontFamily: fonte('700'), fontSize: 12, color: C.text3, marginLeft: 4 }}>{descontoModo === 'percentual' ? '%' : 'R$'}</Text>
                </View>
                {erroDesconto && (
                  <Text style={{ fontFamily: fonte('600'), fontSize: 12, color: C.red, marginTop: 6 }}>{erroDesconto}</Text>
                )}
              </View>
              )}

              {/* ── Resumo ── */}
              <View style={{ backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
                {descontoN > 0 && (
                  <>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
                      <Text style={{ fontFamily: fonte('400'), fontSize: 14, color: C.text2 }}>Subtotal</Text>
                      <Text style={{ fontFamily: fonte('600'), fontSize: 14, color: C.text }}>{formatarMoeda(subtotal)}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
                      <Text style={{ fontFamily: fonte('400'), fontSize: 14, color: C.text2 }}>
                        (−) Desconto{descontoModo === 'percentual' ? ` ${String(descontoEntradaN).replace('.', ',')}%` : ''}
                      </Text>
                      <Text style={{ fontFamily: fonte('600'), fontSize: 14, color: C.red }}>− {formatarMoeda(descontoN)}</Text>
                    </View>
                  </>
                )}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14 }}>
                  <Text style={{ fontFamily: fonte('700'), fontSize: 16, color: C.text }}>Total</Text>
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 24, color: C.text }}>{formatarMoeda(total)}</Text>
                </View>
              </View>

              {/* ── Pagamento (mesmo bloco da comanda; chip Cortesia só com comanda.desconto, igual à comanda) ── */}
              <PagamentosEditor
                splits={splits} setSplits={setSplits} config={config}
                resumo={{ recebido, falta, troco }}
                permitirCortesia={podeDesconto} desabilitado={travada}
              />

              {!!erro && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.redSoft, borderRadius: 12, padding: 12 }}>
                  <AlertCircle size={15} color={C.red} />
                  <Text style={{ flex: 1, fontFamily: fonte('500'), fontSize: 13, color: C.red }}>{erro}</Text>
                  {travada && (
                    <TouchableOpacity onPress={limparVenda}>
                      <Text style={{ fontFamily: fonte('700'), fontSize: 12, color: C.primary, textDecorationLine: 'underline' }}>Nova venda</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </ScrollView>

            {/* Footer — Finalizar venda */}
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: insets.bottom + 12, paddingTop: 12, backgroundColor: C.surface, borderTopWidth: 1, borderColor: C.border }}>
              {cart.length > 0 && !travada && resumo.motivo && (
                <Text style={{ fontFamily: fonte('600'), fontSize: 12, color: erroDesconto ? C.red : C.amber, textAlign: 'center', marginBottom: 8 }}>
                  {resumo.motivo}
                </Text>
              )}
              {cart.length > 0 && !travada && resumo.podeFechar && resumo.cortesiaAutomatica && splits.length === 0 && (
                <Text style={{ fontFamily: fonte('400'), fontSize: 12, color: C.text4, textAlign: 'center', marginBottom: 8 }}>
                  Total R$ 0 — será registrado como Cortesia
                </Text>
              )}
              <TouchableOpacity onPress={finalizar} disabled={botaoDesabilitado} activeOpacity={0.8}
                style={{ height: 52, borderRadius: 16, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: botaoDesabilitado ? 0.5 : 1 }}>
                {finalizando ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Check size={18} color="#fff" strokeWidth={2.5} />
                    <Text style={{ fontFamily: fonte('700'), fontSize: 15, color: '#fff' }}>Finalizar venda — {formatarMoeda(total)}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 10 }}>
            {/* Seletor de dia */}
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 6 }}>
              <TouchableOpacity onPress={() => setDia(d => somarDiasData(d, -1))} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                <ChevronLeft size={18} color={C.text2} />
              </TouchableOpacity>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontFamily: fonte('700'), fontSize: 14, color: C.text }}>{ehHoje ? 'Hoje' : rotuloDiaExtenso(chaveDia)}</Text>
                {ehHoje && <Text style={{ fontFamily: fonte('400'), fontSize: 11, color: C.text3 }}>{rotuloDiaExtenso(chaveDia)}</Text>}
              </View>
              <TouchableOpacity onPress={() => setDia(d => somarDiasData(d, 1))} disabled={ehHoje}
                style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: ehHoje ? 0.3 : 1 }}>
                <ChevronRight size={18} color={C.text2} />
              </TouchableOpacity>
            </View>

            {!loadingVendas && !erroVendas && vendas.length > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                <Text style={{ fontFamily: fonte('600'), fontSize: 12, color: C.text3, textAlign: 'right' }}>
                  {vendas.length} {vendas.length === 1 ? 'venda' : 'vendas'} · {formatarMoeda(vendas.reduce((s, v) => s + Math.round(Number(v.valor_final) * 100), 0) / 100)}
                </Text>
                {/* Mesma exportação do web (shared/exportacao/vendas.ts), com as vendas do dia */}
                <BotaoExportar
                  definicao={definicaoVendas()}
                  getLinhas={() => linhasVendas(vendas, m => METODOS_PAGAMENTO.find(x => x.key === m)?.label ?? m)}
                  cor={C.text2}
                />
              </View>
            )}

            {loadingVendas ? (
              <ActivityIndicator color={C.primary} style={{ marginTop: 30 }} />
            ) : erroVendas ? (
              <TouchableOpacity onPress={carregarVendas} style={{ backgroundColor: C.redSoft, borderRadius: 12, padding: 12 }}>
                <Text style={{ fontFamily: fonte('600'), fontSize: 12, color: C.red }}>{erroVendas} — toque para tentar de novo.</Text>
              </TouchableOpacity>
            ) : vendas.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <History size={32} color={C.text4} />
                <Text style={{ fontFamily: fonte('500'), fontSize: 13, color: C.text3, marginTop: 8 }}>Nenhuma venda neste dia.</Text>
                <TouchableOpacity onPress={() => setAba('nova')} style={{ marginTop: 14, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 9 }}>
                  <Text style={{ fontFamily: fonte('700'), fontSize: 13, color: '#fff' }}>Nova venda</Text>
                </TouchableOpacity>
              </View>
            ) : vendas.map(v => (
              <View key={v.id} style={{ backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14, flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonte('700'), fontSize: 14, color: C.text }} numberOfLines={1}>
                    {v.cliente ? v.cliente.nome : 'Venda avulsa'}
                    <Text style={{ fontFamily: fonte('400'), fontSize: 12, color: C.text4 }}>  ·  {horaBRT(v.created_at)}</Text>
                  </Text>
                  <Text style={{ fontFamily: fonte('400'), fontSize: 12, color: C.text3, marginTop: 4 }}>
                    {v.itens.map(i => `${i.produto?.nome ?? '?'} × ${i.quantidade}`).join('  ·  ')}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {v.pagamentos_venda.map((p, i) => (
                      <View key={i} style={{ backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ fontFamily: fonte('600'), fontSize: 10.5, color: C.text3 }}>{rotuloPagamento(config, p)} {formatarMoeda(p.valor)}</Text>
                      </View>
                    ))}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {Number(v.desconto) > 0 && (
                    <Text style={{ fontFamily: fonte('400'), fontSize: 11, color: C.text4, textDecorationLine: 'line-through' }}>{formatarMoeda(v.valor_total)}</Text>
                  )}
                  <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text }}>{formatarMoeda(v.valor_final)}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
