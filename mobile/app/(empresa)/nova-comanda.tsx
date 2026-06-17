import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, StatusBar, KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ChevronLeft, ChevronRight, Check, X, Trash2, User,
  Banknote, Zap, CreditCard, Gift, Tag, Receipt,
} from 'lucide-react-native';
import { format, startOfDay, endOfDay, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import {
  useFonts,
  CormorantGaramond_600SemiBold,
} from '@expo-google-fonts/cormorant-garamond';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';

import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import SuccessCheck from '@/components/SuccessCheck';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  rose: '#D4608A', roseSoft: '#FDF0F5',
  red: '#EF4444', redSoft: '#FEF2F2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const STATUS_COR: Record<string, { bg: string; text: string }> = {
  agendado:   { bg: C.amberSoft, text: C.amber },
  confirmado: { bg: C.primarySoft, text: C.primary },
  concluido:  { bg: C.greenSoft, text: C.green },
  faltou:     { bg: C.redSoft, text: C.red },
};

const METODOS = [
  { key: 'dinheiro', label: 'Dinheiro', bg: '#F0FDF4', cor: '#16A34A' },
  { key: 'pix',      label: 'PIX',      bg: '#EEF2FF', cor: '#4F46E5' },
  { key: 'credito',  label: 'Crédito',  bg: '#FEF3C7', cor: '#D97706' },
  { key: 'debito',   label: 'Débito',   bg: '#FDF2F8', cor: '#9D174D' },
  { key: 'cortesia', label: 'Cortesia', bg: '#F9FAFB', cor: '#6B7280' },
] as const;

type AgDia = {
  id: string;
  data_hora_inicio: string;
  status: string;
  valor: number;
  cliente:      { id: string; nome: string; telefone?: string } | null;
  profissional: { id: string; nome: string } | null;
  servico:      { id: string; nome: string; preco: number }    | null;
};

type ComandaItem = {
  uid: string;
  tipo: 'agendamento' | 'servico' | 'produto';
  descricao: string;
  profissional?: string;
  valor: number;
  quantidade: number;
  agendamento_id?: string;
  servico_id?: string;
  produto_id?: string;
  profissional_id?: string;
};

type Split = { metodo: string; valor: string };

type ClienteComanda = {
  id: string;
  nome: string;
  telefone?: string;
  agendamentos: AgDia[];
};

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);
}
function fmtHora(iso: string) { return format(parseISO(iso), 'HH:mm'); }
function iniciais(nome: string) {
  return nome.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}
function avatarHue(nome: string) {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 360;
  return h;
}
let uidCount = 0;
function uid() { return `tmp_${++uidCount}`; }

type Etapa = 'lista' | 'comanda' | 'sucesso';

export default function NovaComandaScreen() {
  const insets = useSafeAreaInsets();
  const empresaAtiva = useAuthStore(s => s.empresaAtiva);
  const empresaId = empresaAtiva?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [agDia, setAgDia] = useState<AgDia[]>([]);
  const [servicos, setServicos] = useState<{ id: string; nome: string; preco: number }[]>([]);
  const [produtos, setProdutos] = useState<{ id: string; nome: string; preco_venda: number }[]>([]);

  const [etapa, setEtapa] = useState<Etapa>('lista');
  const [clienteSel, setClienteSel] = useState<ClienteComanda | null>(null);
  const [itens, setItens] = useState<ComandaItem[]>([]);
  const [desconto, setDesconto] = useState('');
  const [splits, setSplits] = useState<Split[]>([]);
  const [fechando, setFechando] = useState(false);
  const [sucessoData, setSucessoData] = useState<{ nome: string; valor: number } | null>(null);
  const [showExtras, setShowExtras] = useState(false);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  useEffect(() => {
    if (!empresaId) return;
    const hoje = new Date();
    Promise.all([
      supabase.from('agendamentos')
        .select(`id, data_hora_inicio, status, valor,
          cliente:clientes!agendamentos_cliente_id_fkey(id, nome, telefone),
          profissional:users!agendamentos_profissional_id_fkey(id, nome),
          servico:servicos(id, nome, preco)`)
        .eq('empresa_id', empresaId)
        .gte('data_hora_inicio', startOfDay(hoje).toISOString())
        .lte('data_hora_inicio', endOfDay(hoje).toISOString())
        .neq('status', 'cancelado')
        .order('data_hora_inicio'),
      supabase.from('servicos').select('id, nome, preco').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      supabase.from('produtos').select('id, nome, preco_venda').eq('empresa_id', empresaId).eq('ativo', true).eq('tipo', 'venda').order('nome'),
    ]).then(([rAgs, rServs, rProds]) => {
      setAgDia((rAgs.data ?? []) as unknown as AgDia[]);
      setServicos((rServs.data ?? []) as any[]);
      setProdutos((rProds.data ?? []) as any[]);
      setLoading(false);
    });
  }, [empresaId]);

  const clientesDia = useMemo<ClienteComanda[]>(() => {
    const map: Record<string, ClienteComanda> = {};
    for (const ag of agDia) {
      const cid = ag.cliente?.id ?? '__sem__';
      if (!map[cid]) map[cid] = { id: cid, nome: ag.cliente?.nome ?? 'Cliente', telefone: ag.cliente?.telefone, agendamentos: [] };
      map[cid].agendamentos.push(ag);
    }
    return Object.values(map).sort((a, b) => (a.agendamentos[0]?.data_hora_inicio ?? '').localeCompare(b.agendamentos[0]?.data_hora_inicio ?? ''));
  }, [agDia]);

  function abrirComanda(cliente: ClienteComanda) {
    setClienteSel(cliente);
    setDesconto('');
    setSplits([]);
    setItens(
      cliente.agendamentos
        .filter(ag => ag.status !== 'concluido')
        .map(ag => ({
          uid: uid(), tipo: 'agendamento', descricao: ag.servico?.nome ?? 'Serviço',
          profissional: ag.profissional?.nome, valor: ag.valor, quantidade: 1,
          agendamento_id: ag.id, servico_id: ag.servico?.id, profissional_id: ag.profissional?.id,
        })),
    );
    setEtapa('comanda');
  }

  function adicionarServico(s: { id: string; nome: string; preco: number }) {
    setItens(prev => [...prev, { uid: uid(), tipo: 'servico', descricao: s.nome, valor: s.preco, quantidade: 1, servico_id: s.id }]);
    setShowExtras(false);
  }
  function adicionarProduto(p: { id: string; nome: string; preco_venda: number }) {
    setItens(prev => [...prev, { uid: uid(), tipo: 'produto', descricao: p.nome, valor: p.preco_venda, quantidade: 1, produto_id: p.id }]);
    setShowExtras(false);
  }
  function removerItem(u: string) { setItens(prev => prev.filter(i => i.uid !== u)); }

  const subtotal  = itens.reduce((s, i) => s + i.valor * i.quantidade, 0);
  const descontoN = parseFloat(desconto.replace(',', '.')) || 0;
  const total     = Math.max(subtotal - descontoN, 0);
  const recebido  = splits.reduce((s, x) => s + (parseFloat(x.valor.replace(',', '.')) || 0), 0);
  const restante  = total - recebido;

  function adicionarSplit(metodo: string) {
    const v = Math.max(restante, 0);
    setSplits(prev => [...prev, { metodo, valor: v > 0 ? v.toFixed(2).replace('.', ',') : '' }]);
  }
  function removerSplit(idx: number) { setSplits(prev => prev.filter((_, i) => i !== idx)); }

  async function fecharComanda() {
    if (!clienteSel || !empresaId || fechando) return;
    setFechando(true);

    const { data: comanda, error: errComanda } = await supabase
      .from('comandas').insert({
        empresa_id: empresaId,
        clientes_id: clienteSel.id === '__sem__' ? null : clienteSel.id,
        valor_total: subtotal, desconto: descontoN,
        status: 'fechada', fechada_at: new Date().toISOString(),
      }).select('id').single();

    if (errComanda || !comanda) {
      Alert.alert('Erro', errComanda?.message ?? 'Erro ao criar comanda');
      setFechando(false); return;
    }

    const comandaId = comanda.id;
    const agIds = itens.filter(i => i.agendamento_id).map(i => i.agendamento_id!);

    if (agIds.length > 0) {
      const { error } = await supabase.from('agendamentos')
        .update({ status: 'concluido', comanda_id: comandaId }).in('id', agIds).eq('empresa_id', empresaId);
      if (error) { Alert.alert('Erro', error.message); setFechando(false); return; }
    }

    const extras = itens.filter(i => i.tipo !== 'agendamento');
    if (extras.length > 0) {
      await supabase.from('comanda_itens').insert(
        extras.map(i => ({
          comanda_id: comandaId, empresa_id: empresaId, tipo: i.tipo,
          descricao: i.descricao, servico_id: i.servico_id ?? null,
          produto_id: i.produto_id ?? null, profissional_id: i.profissional_id ?? null,
          quantidade: i.quantidade, valor_unit: i.valor,
        })),
      );
    }

    const extrasProdutos = extras.filter(i => i.tipo === 'produto' && i.produto_id);
    if (extrasProdutos.length > 0) {
      await supabase.from('estoque_movimentos').insert(
        extrasProdutos.map(i => ({
          produto_id: i.produto_id!, empresa_id: empresaId,
          tipo: 'saida', quantidade: i.quantidade,
          motivo: `Produto via comanda — ${i.descricao}`,
        })),
      );
      const totalProdutos = extrasProdutos.reduce((s, i) => s + i.valor * i.quantidade, 0);
      const { data: venda } = await supabase.from('vendas').insert({
        empresa_id: empresaId,
        cliente_id: clienteSel.id === '__sem__' ? null : clienteSel.id,
        valor_total: totalProdutos, desconto: 0, observacao: 'Via comanda',
      }).select('id').single();
      if (venda) {
        await supabase.from('venda_itens').insert(
          extrasProdutos.map(i => ({
            empresa_id: empresaId, venda_id: venda.id,
            produto_id: i.produto_id!, quantidade: i.quantidade,
            preco_unitario: i.valor,
          })),
        );
      }
    }

    const splitsValidos = splits.filter(s => parseFloat(s.valor.replace(',', '.')) > 0);
    if (splitsValidos.length > 0) {
      await supabase.from('pagamentos').insert(
        splitsValidos.map(s => ({
          empresa_id: empresaId, comanda_id: comandaId,
          valor: parseFloat(s.valor.replace(',', '.')),
          metodo: s.metodo, status: 'pago',
        })),
      );
    }

    setFechando(false);
    setAgDia(prev => prev.map(ag => agIds.includes(ag.id) ? { ...ag, status: 'concluido' } : ag));
    setSucessoData({ nome: clienteSel.nome, valor: total });
    setEtapa('sucesso');
  }

  if (!fontsLoaded) return null;

  // ── Tela de sucesso ──
  if (etapa === 'sucesso' && sucessoData) {
    return (
      <View style={{ flex: 1, backgroundColor: C.surface, paddingTop: insets.top }}>
        <StatusBar barStyle="dark-content" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <View style={{ marginBottom: 20 }}>
            <SuccessCheck size={84} />
          </View>
          <MotiView from={{ translateY: 16, opacity: 0 }} animate={{ translateY: 0, opacity: 1 }}
            transition={{ type: 'timing', duration: 400, delay: 200 }}>
            <Text style={{ fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 28, color: C.text, textAlign: 'center' }}>
              Comanda fechada!
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2, textAlign: 'center', marginTop: 8 }}>
              {sucessoData.nome} · {fmtBRL(sucessoData.valor)}
            </Text>
          </MotiView>
          <TouchableOpacity onPress={() => { setEtapa('lista'); setClienteSel(null); setSucessoData(null); }}
            activeOpacity={0.8}
            style={{ marginTop: 32, backgroundColor: C.green, borderRadius: 16, paddingHorizontal: 32, paddingVertical: 14 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: '#fff' }}>Voltar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Lista de clientes ──
  if (etapa === 'lista') {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
        <StatusBar barStyle="dark-content" />
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
            <ChevronLeft size={20} color={C.text3} />
          </TouchableOpacity>
          <View>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2 }}>Comanda</Text>
            <Text style={{ fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 20, color: C.text }}>
              {format(new Date(), "EEEE, d 'de' MMM", { locale: ptBR })}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={C.primary} />
          </View>
        ) : clientesDia.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            <Receipt size={28} color={C.text4} />
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text3, marginTop: 8 }}>
              Nenhum atendimento hoje
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
            {clientesDia.map((cliente, idx) => {
              const jaFeita = cliente.agendamentos.every(a => a.status === 'concluido');
              const ag1 = cliente.agendamentos[0];
              const hue = avatarHue(cliente.nome);
              return (
                <MotiView key={cliente.id}
                  from={{ opacity: 0, translateY: 12 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: 'timing', duration: 300, delay: idx * 60 }}>
                  <TouchableOpacity
                    onPress={() => !jaFeita && abrirComanda(cliente)}
                    disabled={jaFeita}
                    activeOpacity={0.7}
                    style={{
                      backgroundColor: C.surface, borderRadius: 16, padding: 14,
                      borderWidth: 1, borderColor: C.border,
                      opacity: jaFeita ? 0.5 : 1,
                    }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <LinearGradient colors={[`hsl(${hue},60%,50%)`, `hsl(${hue},50%,35%)`]}
                        style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: '#fff', fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12 }}>{iniciais(cliente.nome)}</Text>
                      </LinearGradient>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }} numberOfLines={1}>
                          {cliente.nome}
                        </Text>
                        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }} numberOfLines={1}>
                          {fmtHora(ag1.data_hora_inicio)} · {ag1.servico?.nome ?? '—'}
                        </Text>
                      </View>
                      {jaFeita ? (
                        <Check size={16} color={C.green} strokeWidth={2.5} />
                      ) : (
                        <ChevronRight size={16} color={C.text4} />
                      )}
                    </View>
                    {cliente.agendamentos.length > 1 && (
                      <View style={{ flexDirection: 'row', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                        {cliente.agendamentos.map(ag => {
                          const sc = STATUS_COR[ag.status] ?? { bg: C.bg, text: C.text3 };
                          return (
                            <View key={ag.id} style={{ backgroundColor: sc.bg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: sc.text }}>{fmtHora(ag.data_hora_inicio)}</Text>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </TouchableOpacity>
                </MotiView>
              );
            })}
          </ScrollView>
        )}
      </View>
    );
  }

  // ── Comanda aberta ──
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1, backgroundColor: C.surface, paddingTop: insets.top }}>
        <StatusBar barStyle="dark-content" />

        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: C.border }}>
          <TouchableOpacity onPress={() => setEtapa('lista')}
            style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
            <ChevronLeft size={20} color={C.text3} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 15, color: C.text }} numberOfLines={1}>
              {clienteSel?.nome}
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>
              {itens.length} ite{itens.length !== 1 ? 'ns' : 'm'}
            </Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 20 }}>

          {/* ── Itens ── */}
          <View>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10 }}>
              Serviços
            </Text>
            {itens.map(item => (
              <View key={item.uid} style={{
                backgroundColor: item.tipo === 'agendamento' ? C.primarySoft : item.tipo === 'produto' ? C.amberSoft : C.bg,
                borderRadius: 14, padding: 14, marginBottom: 8,
                borderWidth: 1, borderColor: C.border,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }} numberOfLines={1}>
                      {item.descricao}
                    </Text>
                    {item.profissional && (
                      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3, marginTop: 2 }}>
                        {item.profissional}
                      </Text>
                    )}
                  </View>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>
                    {fmtBRL(item.valor * item.quantidade)}
                  </Text>
                  {item.tipo !== 'agendamento' && (
                    <TouchableOpacity onPress={() => removerItem(item.uid)}
                      style={{ width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                      <Trash2 size={14} color={C.red} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}

            {/* Adicionar extras */}
            <TouchableOpacity onPress={() => setShowExtras(!showExtras)}
              activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text3 }}>+ Adicionar extra</Text>
            </TouchableOpacity>

            {showExtras && (
              <View style={{ marginTop: 8, backgroundColor: C.bg, borderRadius: 14, padding: 12, gap: 4 }}>
                {servicos.length > 0 && (
                  <>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Serviços</Text>
                    {servicos.map(s => (
                      <TouchableOpacity key={s.id} onPress={() => adicionarServico(s)}
                        style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10, backgroundColor: C.surface, marginBottom: 4 }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text }}>{s.nome}</Text>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text3 }}>{fmtBRL(s.preco)}</Text>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
                {produtos.length > 0 && (
                  <>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8, marginBottom: 4 }}>Produtos</Text>
                    {produtos.map(p => (
                      <TouchableOpacity key={p.id} onPress={() => adicionarProduto(p)}
                        style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10, backgroundColor: C.surface, marginBottom: 4 }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text }}>{p.nome}</Text>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text3 }}>{fmtBRL(p.preco_venda)}</Text>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </View>
            )}
          </View>

          {/* ── Desconto ── */}
          <View>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10 }}>Desconto</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderRadius: 14, paddingHorizontal: 14, height: 48, borderWidth: 1, borderColor: C.border }}>
              <Tag size={16} color={C.text3} />
              <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2, marginLeft: 10 }}>Desconto</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3, marginRight: 4 }}>R$</Text>
              <TextInput
                value={desconto} onChangeText={setDesconto}
                keyboardType="decimal-pad" placeholder="0,00"
                placeholderTextColor={C.text4}
                style={{ width: 80, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text, textAlign: 'right' }}
              />
            </View>
          </View>

          {/* ── Resumo ── */}
          <View style={{ backgroundColor: C.bg, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2 }}>Subtotal</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>{fmtBRL(subtotal)}</Text>
            </View>
            {descontoN > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2 }}>(−) Desconto</Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.red }}>− {fmtBRL(descontoN)}</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.text }}>Total</Text>
              <Text style={{ fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 24, color: C.text }}>{fmtBRL(total)}</Text>
            </View>
          </View>

          {/* ── Pagamento ── */}
          <View>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10 }}>Pagamento</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
              {METODOS.map(m => (
                <TouchableOpacity key={m.key} onPress={() => adicionarSplit(m.key)}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, backgroundColor: m.bg, borderWidth: 1, borderColor: C.border }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: m.cor }}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {splits.length > 0 && (
              <View style={{ marginTop: 10, gap: 8 }}>
                {splits.map((s, i) => {
                  const m = METODOS.find(x => x.key === s.metodo) ?? METODOS[0];
                  return (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: m.bg, borderRadius: 14, paddingHorizontal: 14, height: 48, borderWidth: 1, borderColor: C.border, gap: 8 }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: m.cor, flex: 1 }}>{m.label}</Text>
                      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>R$</Text>
                      <TextInput
                        value={s.valor}
                        onChangeText={v => setSplits(prev => prev.map((x, j) => j === i ? { ...x, valor: v } : x))}
                        keyboardType="decimal-pad" placeholder="0,00"
                        placeholderTextColor={C.text4}
                        style={{ width: 80, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text, textAlign: 'right' }}
                      />
                      <TouchableOpacity onPress={() => removerSplit(i)}
                        style={{ width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                        <X size={14} color={C.text4} />
                      </TouchableOpacity>
                    </View>
                  );
                })}

                {/* Status pagamento */}
                <View style={{
                  borderRadius: 14, padding: 14, borderWidth: 1,
                  backgroundColor: Math.abs(restante) < 0.01 ? C.greenSoft : restante > 0 ? C.amberSoft : C.primarySoft,
                  borderColor: Math.abs(restante) < 0.01 ? '#0D7E5F33' : restante > 0 ? '#B4530933' : '#2C165433',
                }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2 }}>Recebido</Text>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text }}>{fmtBRL(recebido)}</Text>
                  </View>
                  {restante > 0.01 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.amber }}>Falta</Text>
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.amber }}>{fmtBRL(restante)}</Text>
                    </View>
                  )}
                  {restante < -0.01 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.primary }}>Troco</Text>
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.primary }}>{fmtBRL(-restante)}</Text>
                    </View>
                  )}
                  {Math.abs(restante) < 0.01 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 6 }}>
                      <Check size={14} color={C.green} strokeWidth={3} />
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.green }}>Valor quitado</Text>
                    </View>
                  )}
                </View>
              </View>
            )}
          </View>
        </ScrollView>

        {/* Footer — Fechar comanda */}
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: insets.bottom + 12, paddingTop: 12, backgroundColor: C.surface, borderTopWidth: 1, borderColor: C.border }}>
          <TouchableOpacity
            onPress={fecharComanda}
            disabled={fechando || itens.length === 0}
            activeOpacity={0.8}
            style={{
              height: 52, borderRadius: 16, backgroundColor: C.green,
              alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
              opacity: (fechando || itens.length === 0) ? 0.5 : 1,
            }}>
            {fechando ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Check size={18} color="#fff" strokeWidth={2.5} />
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff' }}>
                  Fechar comanda — {fmtBRL(total)}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
