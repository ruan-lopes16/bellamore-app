import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  RefreshControl, StatusBar, ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { router } from 'expo-router';
import Svg, { Rect, Line, Text as SvgText, G } from 'react-native-svg';
import {
  ChevronLeft, ChevronRight, Download,
  TrendingUp, TrendingDown, Plus,
  Layers, CreditCard, Banknote, Smartphone, Gift,
  AlertTriangle, CheckCircle2, X,
} from 'lucide-react-native';
import {
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  useFonts,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
} from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { addMonths, subMonths, format, isSameMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useQueryClient } from '@tanstack/react-query';

import { useFinanceiro, type MetodoPagamento, type DespesaItem } from '@/hooks/useFinanceiro';
import { supabase } from '@/lib/supabase';
import type { PagamentoMetodo } from '@/types';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  red: '#C0392B', redSoft: '#FEF2F2',
  amber: '#B45309', amberSoft: '#FEF3E2',
  indigo: '#4F46E5', indigoSoft: '#EEF2FF',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const METODO_CONFIG: Record<PagamentoMetodo, {
  label: string; icon: React.ReactNode; bg: string; color: string; barColor: string;
}> = {
  pix:      { label: 'PIX / Transferência', icon: <Layers size={14} color="#4F46E5" strokeWidth={2} />,    bg: C.indigoSoft, color: C.indigo,  barColor: '#4F46E5' },
  dinheiro: { label: 'Dinheiro',            icon: <Banknote size={14} color="#16A34A" strokeWidth={2} />,  bg: '#F0FDF4',    color: '#16A34A', barColor: '#16A34A' },
  credito:  { label: 'Crédito',             icon: <CreditCard size={14} color="#D97706" strokeWidth={2} />, bg: '#FEF3C7',   color: '#D97706', barColor: '#D97706' },
  debito:   { label: 'Débito',              icon: <CreditCard size={14} color="#9D174D" strokeWidth={2} />, bg: '#FDF2F8',   color: '#9D174D', barColor: '#9D174D' },
  cortesia: { label: 'Cortesia',            icon: <Gift size={14} color="#6B7280" strokeWidth={2} />,      bg: '#F9FAFB',    color: '#6B7280', barColor: '#9CA3AF' },
};

// ── Helpers ──────────────────────────────────────────────────

function formatBRL(value: number, compact = false) {
  if (compact && value >= 1000) {
    return `R$${(value / 1000).toFixed(1).replace('.', ',')}k`;
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

function deltaPercent(atual: number, anterior: number): number | null {
  if (anterior === 0) return null;
  return Math.round(((atual - anterior) / anterior) * 100);
}

// ── Gráfico de barras SVG ────────────────────────────────────

function GraficoEvolucao({ dados }: { dados: { mes: string; receita: number; gastos: number }[] }) {
  const W = 330;
  const H = 110;
  const PAD_LEFT = 8;
  const PAD_RIGHT = 8;
  const PAD_TOP = 10;
  const PAD_BOT = 22;

  const maxVal = Math.max(...dados.flatMap((d) => [d.receita, d.gastos]), 1);
  const barW = (W - PAD_LEFT - PAD_RIGHT) / (dados.length * 3);
  const chartH = H - PAD_TOP - PAD_BOT;

  return (
    <Svg width={W} height={H}>
      {dados.map((d, i) => {
        const x = PAD_LEFT + i * barW * 3;
        const rH = (d.receita / maxVal) * chartH;
        const gH = (d.gastos  / maxVal) * chartH;
        const isLast = i === dados.length - 1;

        return (
          <G key={i}>
            {/* Receita */}
            <Rect
              x={x}
              y={PAD_TOP + chartH - rH}
              width={barW}
              height={rH}
              rx={3}
              fill={C.primary}
              opacity={isLast ? 1 : 0.35 + i * 0.1}
            />
            {/* Gastos */}
            <Rect
              x={x + barW + 2}
              y={PAD_TOP + chartH - gH}
              width={barW}
              height={gH}
              rx={3}
              fill="#F87171"
              opacity={isLast ? 0.8 : 0.3 + i * 0.08}
            />
            {/* Label mês */}
            <SvgText
              x={x + barW}
              y={H - 4}
              fontSize={9}
              fill={isLast ? C.primary : C.text4}
              fontWeight={isLast ? '700' : '400'}
              textAnchor="middle"
            >
              {d.mes}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

// ── Componente método de pagamento ───────────────────────────

function MetodoRow({ item, isLast }: { item: MetodoPagamento; isLast: boolean }) {
  const cfg = METODO_CONFIG[item.metodo];
  if (!cfg) return null;

  return (
    <View style={{
      paddingVertical: 11, paddingHorizontal: 16,
      flexDirection: 'row', alignItems: 'center', gap: 12,
      borderBottomWidth: isLast ? 0 : 1, borderBottomColor: C.border,
    }}>
      <View style={{
        width: 32, height: 32, borderRadius: 9,
        backgroundColor: cfg.bg,
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {cfg.icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text }}>
          {cfg.label}
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 1 }}>
          {item.quantidade} {item.quantidade === 1 ? 'transação' : 'transações'}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>
          {formatBRL(item.valor)}
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3, marginTop: 2 }}>
          {item.percentual}%
        </Text>
      </View>
    </View>
  );
}

// ── Despesa row ──────────────────────────────────────────────

function DespesaRow({
  item, isLast, onMarcarPago,
}: {
  item: DespesaItem;
  isLast: boolean;
  onMarcarPago: (item: DespesaItem) => void;
}) {
  const pago = item.status === 'pago';

  return (
    <TouchableOpacity
      activeOpacity={pago ? 1 : 0.7}
      onPress={() => !pago && onMarcarPago(item)}
      style={{
        paddingVertical: 11, paddingHorizontal: 16,
        flexDirection: 'row', alignItems: 'center', gap: 12,
        borderBottomWidth: isLast ? 0 : 1, borderBottomColor: C.border,
      }}
    >
      <View style={{
        width: 32, height: 32, borderRadius: 9,
        backgroundColor: pago ? C.greenSoft : C.amberSoft,
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {pago
          ? <CheckCircle2 size={14} color={C.green} strokeWidth={2} />
          : <AlertTriangle size={14} color={C.amber} strokeWidth={2} />
        }
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text }}>
          {item.descricao}
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 1 }}>
          {pago
            ? `Pago ${item.data_pagamento ? format(new Date(item.data_pagamento + 'T12:00:00'), 'dd/MM') : ''}`
            : `Vence ${item.data_vencimento ? format(new Date(item.data_vencimento + 'T12:00:00'), 'dd/MM') : 'sem data'}`
          }
          {item.recorrente ? ' · Recorrente' : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.red }}>
          {formatBRL(item.valor)}
        </Text>
        <View style={{
          marginTop: 3,
          backgroundColor: pago ? C.greenSoft : C.amberSoft,
          borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2,
        }}>
          <Text style={{
            fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9,
            color: pago ? C.green : C.amber,
            textTransform: 'uppercase',
          }}>
            {pago ? 'Pago' : 'Toque p/ pagar'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Modal marcar como paga ───────────────────────────────────

function ModalMarcarPago({
  item, onClose, onSalvo,
}: {
  item: DespesaItem | null;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const hoje = format(new Date(), 'dd/MM/yyyy');
  const [dataPgto, setDataPgto] = useState(hoje);
  const [salvando, setSalvando] = useState(false);

  function mascaraData(v: string) {
    const n = v.replace(/\D/g, '').slice(0, 8);
    if (n.length <= 2) return n;
    if (n.length <= 4) return `${n.slice(0, 2)}/${n.slice(2)}`;
    return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n.slice(4)}`;
  }

  function dataParaBanco(v: string): string | null {
    const p = v.split('/');
    if (p.length !== 3 || p[2].length !== 4) return null;
    return `${p[2]}-${p[1]}-${p[0]}`;
  }

  async function confirmar() {
    if (!item) return;
    const dataBanco = dataParaBanco(dataPgto);
    if (!dataBanco) {
      Alert.alert('Data inválida', 'Use o formato DD/MM/AAAA');
      return;
    }
    setSalvando(true);
    const { error } = await supabase
      .from('despesas')
      .update({ status: 'pago', data_pagamento: dataBanco })
      .eq('id', item.id);
    setSalvando(false);
    if (error) { Alert.alert('Erro', error.message); return; }
    onSalvo();
    onClose();
  }

  return (
    <Modal visible={!!item} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={onClose}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={{
              backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
              padding: 24, paddingBottom: 36,
            }}>
              {/* Handle */}
              <View style={{
                width: 36, height: 4, borderRadius: 2,
                backgroundColor: C.border, alignSelf: 'center', marginBottom: 20,
              }} />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <View>
                  <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>
                    Confirmar pagamento
                  </Text>
                  <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 22, color: C.text }}>
                    {item?.descricao}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  style={{
                    width: 32, height: 32, borderRadius: 10,
                    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <X size={14} color={C.text2} strokeWidth={2.5} />
                </TouchableOpacity>
              </View>

              {/* Valor */}
              <View style={{
                backgroundColor: C.redSoft, borderRadius: 14, padding: 14,
                alignItems: 'center', marginBottom: 20,
              }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.red, marginBottom: 2 }}>
                  Valor da despesa
                </Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 32, color: C.red }}>
                  {formatBRL(item?.valor ?? 0)}
                </Text>
              </View>

              {/* Data de pagamento */}
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 8 }}>
                Data do pagamento
              </Text>
              <View style={{
                backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
                borderRadius: 12, paddingHorizontal: 14, height: 48,
                justifyContent: 'center', marginBottom: 24,
              }}>
                <TextInput
                  value={dataPgto}
                  onChangeText={(v) => setDataPgto(mascaraData(v))}
                  placeholder="DD/MM/AAAA"
                  placeholderTextColor={C.text4}
                  keyboardType="numeric"
                  style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 15, color: C.text }}
                />
              </View>

              {/* Botão */}
              <TouchableOpacity
                onPress={confirmar}
                disabled={salvando}
                style={{
                  backgroundColor: C.green, borderRadius: 14,
                  height: 52, alignItems: 'center', justifyContent: 'center',
                  opacity: salvando ? 0.6 : 1,
                }}
              >
                {salvando
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff' }}>
                      Confirmar pagamento
                    </Text>
                }
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function Financeiro() {
  const insets = useSafeAreaInsets();
  const [mesRef, setMesRef] = useState(new Date());
  const isHoje = isSameMonth(mesRef, new Date());
  const [despesaSelecionada, setDespesaSelecionada] = useState<DespesaItem | null>(null);

  const qc = useQueryClient();
  const { resumo, metodos, topServicos, despesas, evolucao, isLoading, refetch } = useFinanceiro(mesRef);

  function aposMarcarPago() {
    qc.invalidateQueries({ queryKey: ['fin-resumo'] });
    qc.invalidateQueries({ queryKey: ['fin-despesas'] });
    qc.invalidateQueries({ queryKey: ['fin-evolucao'] });
  }

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const onRefresh = useCallback(() => refetch(), [refetch]);

  if (!fontsLoaded) return null;

  const deltaReceita = resumo ? deltaPercent(resumo.receita, resumo.receitaAnterior) : null;
  const deltaGastos  = resumo ? deltaPercent(resumo.gastos,  resumo.gastosAnterior)  : null;

  // Barra proporcional de métodos
  const totalMetodos = metodos.reduce((s, m) => s + m.valor, 0);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={onRefresh} tintColor={C.accent} />
        }
      >
        {/* ── Header ── */}
        <MotiView
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 380 }}
          style={{
            paddingTop: insets.top + 12,
            paddingHorizontal: 24, paddingBottom: 16,
            flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
          }}
        >
          <View>
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
              Visão Geral
            </Text>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: C.text }}>
              Financeiro
            </Text>
          </View>
          <TouchableOpacity style={{
            width: 38, height: 38, borderRadius: 12,
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            marginTop: 4,
          }}>
            <Download size={16} color={C.text2} strokeWidth={1.8} />
          </TouchableOpacity>
        </MotiView>

        {/* ── Seletor de mês ── */}
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 350, delay: 60 }}
          style={{ marginHorizontal: 24, marginBottom: 16 }}
        >
          <View style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 14, padding: 10, paddingHorizontal: 14,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
          }}>
            <TouchableOpacity
              onPress={() => setMesRef((m) => subMonths(m, 1))}
              style={{
                width: 28, height: 28, borderRadius: 8,
                borderWidth: 1, borderColor: C.border,
                alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg,
              }}
            >
              <ChevronLeft size={14} color={C.text2} strokeWidth={2.5} />
            </TouchableOpacity>

            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>
                {format(mesRef, 'MMMM yyyy', { locale: ptBR }).replace(/^\w/, c => c.toUpperCase())}
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 1 }}>
                {format(startOfMonth(mesRef) as any, "dd/MM")} – {format(endOfMonth(mesRef) as any, "dd/MM")}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => !isHoje && setMesRef((m) => addMonths(m, 1))}
              style={{
                width: 28, height: 28, borderRadius: 8,
                borderWidth: 1, borderColor: C.border,
                alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg,
                opacity: isHoje ? 0.3 : 1,
              }}
            >
              <ChevronRight size={14} color={C.text2} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
        </MotiView>

        {/* ── Resumo ── */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 380, delay: 100 }}
          style={{ marginHorizontal: 24, marginBottom: 12, flexDirection: 'row', gap: 8 }}
        >
          {[
            {
              label: 'Receita',
              value: formatBRL(resumo?.receita ?? 0),
              delta: deltaReceita,
              color: C.green,
              bg: C.greenSoft,
            },
            {
              label: 'Gastos',
              value: formatBRL(resumo?.gastos ?? 0),
              delta: deltaGastos,
              color: C.red,
              bg: C.redSoft,
              invertDelta: true,
            },
            {
              label: 'Lucro',
              value: formatBRL(resumo?.lucro ?? 0),
              delta: null,
              color: C.primary,
              bg: C.primarySoft,
            },
          ].map((s) => (
            <View key={s.label} style={{
              flex: 1, backgroundColor: C.surface,
              borderWidth: 1, borderColor: C.border,
              borderRadius: 16, padding: 14,
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                {s.label}
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: s.color, letterSpacing: -0.5, lineHeight: 20, marginBottom: 5 }}>
                {s.value}
              </Text>
              {s.delta !== null && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  {(s.invertDelta ? (s.delta ?? 0) < 0 : (s.delta ?? 0) >= 0)
                    ? <TrendingUp size={10} color={C.green} strokeWidth={2.5} />
                    : <TrendingDown size={10} color={C.red} strokeWidth={2.5} />
                  }
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9,
                    color: (s.invertDelta ? (s.delta ?? 0) < 0 : (s.delta ?? 0) >= 0) ? C.green : C.red,
                  }}>
                    {(s.delta ?? 0) >= 0 ? '+' : ''}{s.delta}%
                  </Text>
                </View>
              )}
            </View>
          ))}
        </MotiView>

        {/* ── Evolução mensal ── */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 380, delay: 140 }}
          style={{ marginHorizontal: 24, marginBottom: 20 }}
        >
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text, marginBottom: 12 }}>
            Evolução Mensal
          </Text>
          <View style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 18, padding: 18,
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
          }}>
            {/* Legenda */}
            <View style={{ flexDirection: 'row', gap: 14, marginBottom: 14 }}>
              {[
                { color: C.primary, label: 'Receita' },
                { color: '#F87171', label: 'Gastos' },
              ].map((l) => (
                <View key={l.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 3, backgroundColor: l.color }} />
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3 }}>
                    {l.label}
                  </Text>
                </View>
              ))}
            </View>
            <GraficoEvolucao dados={evolucao.length > 0 ? evolucao : Array.from({ length: 6 }, (_, i) => ({
              mes: format(subMonths(mesRef, 5 - i), 'MMM', { locale: ptBR }),
              receita: 0, gastos: 0,
            }))} />
          </View>
        </MotiView>

        {/* ── Formas de pagamento ── */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 380, delay: 180 }}
          style={{ marginHorizontal: 24, marginBottom: 20 }}
        >
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text, marginBottom: 12 }}>
            Formas de Pagamento
          </Text>
          <View style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 18, overflow: 'hidden',
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
          }}>
            {metodos.length === 0 ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                  Sem pagamentos registrados
                </Text>
              </View>
            ) : (
              <>
                {metodos.map((m, i) => (
                  <MetodoRow key={m.metodo} item={m} isLast={i === metodos.length - 1} />
                ))}
                {/* Barra proporcional */}
                <View style={{ height: 5, flexDirection: 'row', margin: 10, borderRadius: 4, overflow: 'hidden' }}>
                  {metodos.map((m) => {
                    const cfg = METODO_CONFIG[m.metodo];
                    const pct = totalMetodos > 0 ? (m.valor / totalMetodos) * 100 : 0;
                    return (
                      <View
                        key={m.metodo}
                        style={{ flex: pct, backgroundColor: cfg?.barColor ?? C.text4, opacity: 0.7 }}
                      />
                    );
                  })}
                </View>
              </>
            )}
          </View>
        </MotiView>

        {/* ── Top serviços ── */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 380, delay: 220 }}
          style={{ marginHorizontal: 24, marginBottom: 20 }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text }}>
              Top Serviços
            </Text>
            <TouchableOpacity onPress={() => router.push('/(empresa)/servicos' as any)}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.accent }}>
                Ver todos
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 18, overflow: 'hidden',
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
          }}>
            {topServicos.length === 0 ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                  Sem atendimentos registrados
                </Text>
              </View>
            ) : (
              topServicos.map((s, i) => (
                <View
                  key={s.servico_id}
                  style={{
                    paddingVertical: 12, paddingHorizontal: 16,
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                    borderBottomWidth: i < topServicos.length - 1 ? 1 : 0,
                    borderBottomColor: C.border,
                  }}
                >
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_700Bold',
                    fontSize: 20, color: i < 2 ? C.primary : C.text4,
                    minWidth: 20,
                  }}>
                    {i + 1}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 5 }}>
                      {s.nome}
                    </Text>
                    <View style={{ height: 3, backgroundColor: C.border, borderRadius: 2 }}>
                      <View style={{
                        height: 3, borderRadius: 2,
                        backgroundColor: C.accent,
                        width: `${s.percentual}%`,
                        opacity: 0.5 + (s.percentual / 200),
                      }} />
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>
                      {formatBRL(s.receita)}
                    </Text>
                    <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 1 }}>
                      {s.quantidade} atend.
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </MotiView>

        {/* ── Despesas ── */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 380, delay: 260 }}
          style={{ marginHorizontal: 24 }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text }}>
              Despesas
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/(empresa)/nova-despesa' as any)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <Plus size={12} color={C.accent} strokeWidth={2.5} />
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.accent }}>
                Nova
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 18, overflow: 'hidden',
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
          }}>
            {despesas.length === 0 ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                  Nenhuma despesa registrada
                </Text>
              </View>
            ) : (
              despesas.map((d, i) => (
                <DespesaRow
                  key={d.id}
                  item={d}
                  isLast={i === despesas.length - 1}
                  onMarcarPago={setDespesaSelecionada}
                />
              ))
            )}
          </View>
        </MotiView>

      </ScrollView>

      {/* Modal marcar como paga */}
      <ModalMarcarPago
        item={despesaSelecionada}
        onClose={() => setDespesaSelecionada(null)}
        onSalvo={aposMarcarPago}
      />
    </View>
  );
}
