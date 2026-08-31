import { useState, useCallback, useEffect } from 'react';
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
  AlertTriangle, CheckCircle2, Ban, X, Pencil, Trash2, RefreshCw,
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
import { addMonths, subMonths, format, isSameMonth, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useQueryClient } from '@tanstack/react-query';

import { useFinanceiro, type MetodoPagamento, type DespesaItem } from '@/hooks/useFinanceiro';
import { supabase } from '@/lib/supabase';
import type { PagamentoMetodo, TaxaCancelamento, TaxaReserva } from '@/types';
import { buildDespesaPagamentoUpdate, formatValorMonetarioInput, parseValorMonetario, diasParaVencimento, progressoVencimento, calcularRecorrenciaAtePorParcelas, clampParcelaAtual, calcularParcelaDerivada, dividirValorCompra } from '@shared/despesas';
import {
  somaDevolucoesPorRetirada, saldoEmprestimo, statusParcela, montarDevolucaoInsert,
  type RetiradaSociaRow, type MetodoPagamentoRetirada,
} from '@shared/retiradas-socia';
import { SecretText, PrivacyToggle } from '@/components/Secret';
import type { OcorrenciaHistorico } from '@shared/despesas';

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

const CATEGORIAS_MOBILE = [
  'Aluguel', 'Energia', 'Água', 'Internet',
  'Produtos / Insumos', 'Manutenção', 'Marketing', 'Contabilidade', 'Outros',
];

const PERIODICIDADES_MOBILE = [
  { key: 'semanal', label: 'Semanal' },
  { key: 'mensal', label: 'Mensal' },
  { key: 'trimestral', label: 'Trimestral' },
  { key: 'semestral', label: 'Semestral' },
  { key: 'anual', label: 'Anual' },
];

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
        <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>
          {formatBRL(item.valor)}
        </SecretText>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3, marginTop: 2 }}>
          {item.percentual}%
        </Text>
      </View>
    </View>
  );
}

// ── Despesa row ──────────────────────────────────────────────

function DespesaRow({
  item, isLast, hojeIso, historico, onMarcarPago, onEditar,
}: {
  item: DespesaItem;
  isLast: boolean;
  hojeIso: string;
  historico: OcorrenciaHistorico[];
  onMarcarPago: (item: DespesaItem) => void;
  onEditar: (item: DespesaItem) => void;
}) {
  const pago = item.status === 'pago';
  const vencimentoPendente = !pago ? item.data_vencimento : undefined;
  const dias = vencimentoPendente
    ? diasParaVencimento(vencimentoPendente, hojeIso)
    : null;
  const progresso = vencimentoPendente
    ? progressoVencimento(item.created_at ?? hojeIso, vencimentoPendente, hojeIso)
    : null;
  const labelDias = dias === null ? '' :
    dias < 0 ? `atrasada há ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? '' : 's'}` :
    dias === 0 ? 'vence hoje' :
    `faltam ${dias} dia${dias === 1 ? '' : 's'}`;

  return (
    <View style={{
      paddingVertical: 11, paddingHorizontal: 16,
      flexDirection: 'row', alignItems: 'center', gap: 8,
      borderBottomWidth: isLast ? 0 : 1, borderBottomColor: C.border,
      position: 'relative',
    }}>
      <TouchableOpacity
        activeOpacity={pago ? 1 : 0.7}
        onPress={() => !pago && onMarcarPago(item)}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}
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
            {(() => {
              if (item.total_parcelas) return ` · (${item.parcela_atual ?? 1}/${item.total_parcelas})`;
              if (item.recorrente && item.periodicidade === 'mensal' && item.recorrencia_ate && item.data_vencimento) {
                const derivada = calcularParcelaDerivada(item.descricao, item.categoria, item.data_vencimento, item.recorrencia_ate, historico);
                return derivada ? ` · (${derivada.atual}/${derivada.total})` : '';
              }
              return '';
            })()}
            {labelDias ? ` · ${labelDias}` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.red }}>
            {formatBRL(item.valor)}
          </SecretText>
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
      <TouchableOpacity
        onPress={() => onEditar(item)}
        style={{
          width: 28, height: 28, borderRadius: 8,
          backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Pencil size={12} color={C.text3} strokeWidth={2} />
      </TouchableOpacity>
      {progresso !== null && (
        <View style={{
          position: 'absolute', left: 16, right: 16, bottom: 0,
          height: 2, borderRadius: 1, backgroundColor: C.border, overflow: 'hidden',
        }}>
          <View style={{
            width: `${progresso * 100}%`, height: '100%',
            backgroundColor: dias !== null && dias < 0 ? C.red : C.amber,
          }} />
        </View>
      )}
    </View>
  );
}

// ── Taxa de cancelamento row ─────────────────────────────────

function TaxaCancelamentoRow({
  item, isLast, onMarcarPago,
}: {
  item: TaxaCancelamento & { cliente: { nome: string } | null };
  isLast: boolean;
  onMarcarPago: (item: TaxaCancelamento & { cliente: { nome: string } | null }) => void;
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
          {item.cliente?.nome ?? 'Cliente'}
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 1 }}>
          {pago
            ? `Pago ${item.paga_em ? format(new Date(item.paga_em), 'dd/MM') : ''}${item.metodo ? ` · ${METODO_CONFIG[item.metodo]?.label ?? item.metodo}` : ''}`
            : `Gerada ${format(new Date(item.created_at), 'dd/MM')}`
          }
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
            {pago ? 'Paga' : 'Toque p/ pagar'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Taxa de reserva row ───────────────────────────────────────

function TaxaReservaRow({
  item, isLast, onMarcarPago,
}: {
  item: TaxaReserva & { cliente: { nome: string } | null };
  isLast: boolean;
  onMarcarPago: (item: TaxaReserva & { cliente: { nome: string } | null }) => void;
}) {
  const pago = item.status === 'pago';
  const retida = item.status === 'retida';
  const acionavel = item.status === 'pendente';
  const corFundo = pago ? C.greenSoft : retida ? C.border : C.amberSoft;
  const corTexto = pago ? C.green : retida ? C.text3 : C.amber;

  return (
    <TouchableOpacity
      activeOpacity={acionavel ? 0.7 : 1}
      onPress={() => acionavel && onMarcarPago(item)}
      style={{
        paddingVertical: 11, paddingHorizontal: 16,
        flexDirection: 'row', alignItems: 'center', gap: 12,
        borderBottomWidth: isLast ? 0 : 1, borderBottomColor: C.border,
      }}
    >
      <View style={{
        width: 32, height: 32, borderRadius: 9,
        backgroundColor: corFundo,
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {pago
          ? <CheckCircle2 size={14} color={C.green} strokeWidth={2} />
          : retida
            ? <Ban size={14} color={C.text3} strokeWidth={2} />
            : <AlertTriangle size={14} color={C.amber} strokeWidth={2} />
        }
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text }}>
          {item.cliente?.nome ?? 'Cliente'}
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 1 }}>
          {item.paga_em
            ? `Pago ${format(new Date(item.paga_em), 'dd/MM')}${item.metodo ? ` · ${METODO_CONFIG[item.metodo]?.label ?? item.metodo}` : ''}`
            : retida ? 'Retida sem pagamento prévio' : `Gerada ${format(new Date(item.created_at), 'dd/MM')}`
          }
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.red }}>
          {formatBRL(item.valor)}
        </Text>
        <View style={{
          marginTop: 3,
          backgroundColor: corFundo,
          borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2,
        }}>
          <Text style={{
            fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9,
            color: corTexto,
            textTransform: 'uppercase',
          }}>
            {pago ? 'Paga' : retida ? 'Retida' : 'Toque p/ pagar'}
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
  const [valorDespesa, setValorDespesa] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!item) return;
    setDataPgto(hoje);
    setValorDespesa(formatValorMonetarioInput(Number(item.valor)));
  }, [item, hoje]);

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
    const payload = buildDespesaPagamentoUpdate(dataBanco, valorDespesa);
    if (!payload) {
      Alert.alert('Valor inválido', 'Informe um valor maior que zero.');
      return;
    }
    setSalvando(true);
    const { error } = await supabase
      .from('despesas')
      .update(payload)
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
                marginBottom: 20,
              }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.red, marginBottom: 8, textAlign: 'center' }}>
                  Valor deste mês
                </Text>
                <View style={{
                  flexDirection: 'row', alignItems: 'center',
                  backgroundColor: 'rgba(255,255,255,0.7)',
                  borderWidth: 1, borderColor: 'rgba(239,68,68,0.18)',
                  borderRadius: 12, paddingHorizontal: 14, height: 52,
                }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.red, marginRight: 8 }}>
                    R$
                  </Text>
                  <TextInput
                    value={valorDespesa}
                    onChangeText={setValorDespesa}
                    placeholder="0,00"
                    placeholderTextColor={C.text4}
                    keyboardType="decimal-pad"
                    style={{ flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 24, color: C.red, textAlign: 'center', paddingVertical: 0 }}
                  />
                </View>
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

// ── Modal confirmar pagamento de taxa (reserva ou cancelamento) ─────
// Forma de pagamento é opcional ("quando houver", pedido do usuário): quem
// não sabe ou não quer informar pode confirmar sem escolher nenhum método.

function ModalConfirmarTaxa({
  item, titulo, onClose, onConfirmar,
}: {
  item: { id: string; valor: number; cliente: { nome: string } | null } | null;
  titulo: string;
  onClose: () => void;
  onConfirmar: (metodo: PagamentoMetodo | null) => void;
}) {
  const [metodo, setMetodo] = useState<PagamentoMetodo | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { setMetodo(null); }, [item]);

  async function confirmar() {
    setSalvando(true);
    await onConfirmar(metodo);
    setSalvando(false);
  }

  return (
    <Modal visible={!!item} transparent animationType="fade" onRequestClose={onClose}>
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
            <View style={{
              width: 36, height: 4, borderRadius: 2,
              backgroundColor: C.border, alignSelf: 'center', marginBottom: 20,
            }} />

            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>
              {titulo}
            </Text>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 22, color: C.text, marginBottom: 4 }}>
              {item?.cliente?.nome ?? 'Cliente'}
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20, color: C.green, marginBottom: 18 }}>
              {item ? formatBRL(item.valor) : ''}
            </Text>

            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 8 }}>
              Forma de pagamento <Text style={{ color: C.text3, fontFamily: 'PlusJakartaSans_400Regular' }}>(opcional)</Text>
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
              {(Object.keys(METODO_CONFIG) as PagamentoMetodo[]).map(key => {
                const cfg = METODO_CONFIG[key];
                const ativo = metodo === key;
                return (
                  <TouchableOpacity key={key}
                    onPress={() => setMetodo(ativo ? null : key)}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
                      borderWidth: 1, borderColor: ativo ? cfg.color : C.border,
                      backgroundColor: ativo ? cfg.color : C.bg,
                    }}>
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12,
                      color: ativo ? '#fff' : C.text2,
                    }}>
                      {cfg.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

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
    </Modal>
  );
}

// ── Modais de retirada da dona (devolução / converter / excluir) ──

function ModalDevolucaoRetirada({ retirada, saldo, onClose, onSalvo }: {
  retirada: RetiradaSociaRow | null; saldo: number; onClose: () => void; onSalvo: () => void;
}) {
  const sugestao = retirada?.valor_parcela && saldo > 0 ? Math.min(Number(retirada.valor_parcela), saldo) : saldo;
  const [valor, setValor] = useState('');
  const [metodo, setMetodo] = useState<PagamentoMetodo | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setValor(sugestao > 0 ? formatValorMonetarioInput(sugestao) : ''); setMetodo(null); }, [retirada]);

  const valorNum = parseValorMonetario(valor);
  const sobra = valorNum && valorNum > saldo ? valorNum - saldo : 0;

  async function confirmar() {
    if (!retirada) return;
    const built = montarDevolucaoInsert(retirada.id, retirada.empresa_id, valor, format(new Date(), 'yyyy-MM-dd'), metodo as MetodoPagamentoRetirada | null);
    if (!built.ok) { Alert.alert('Valor inválido', built.erro); return; }
    setSalvando(true);
    const { error } = await supabase.from('retiradas_socia_devolucoes').insert(built.payload).select('id');
    setSalvando(false);
    if (error) { Alert.alert('Erro', 'Não foi possível salvar. Verifique se você é a dona da conta.'); return; }
    onSalvo();
  }

  return (
    <Modal visible={!!retirada} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 20 }} />
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>Registrar devolução</Text>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 20, color: C.text, marginBottom: 14 }}>Saldo devedor {formatBRL(saldo)}</Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 6 }}>Valor devolvido</Text>
            <TextInput
              value={valor} onChangeText={setValor} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={C.text4}
              style={{ borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, height: 46, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 15, color: C.text, marginBottom: sobra > 0 ? 6 : 18 }}
            />
            {sobra > 0 && <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.amber, marginBottom: 14 }}>Isso quita o empréstimo e sobra {formatBRL(sobra)}.</Text>}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
              {(Object.keys(METODO_CONFIG) as PagamentoMetodo[]).map(key => {
                const cfg = METODO_CONFIG[key]; const ativo = metodo === key;
                return (
                  <TouchableOpacity key={key} onPress={() => setMetodo(ativo ? null : key)}
                    style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: ativo ? cfg.color : C.border, backgroundColor: ativo ? cfg.color : C.bg }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? '#fff' : C.text2 }}>{cfg.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity onPress={confirmar} disabled={salvando}
              style={{ backgroundColor: C.green, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', opacity: salvando ? 0.6 : 1 }}>
              {salvando ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff' }}>Confirmar</Text>}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function ModalConfirmacaoRetirada({ visivel, titulo, texto, corBotao, textoBotao, onClose, onConfirmar }: {
  visivel: boolean; titulo: string; texto: string; corBotao: string; textoBotao: string;
  onClose: () => void; onConfirmar: () => Promise<void>;
}) {
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setSalvando(false); }, [visivel]);
  async function go() { setSalvando(true); await onConfirmar(); setSalvando(false); }
  return (
    <Modal visible={visivel} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 20 }} />
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 20, color: C.text, marginBottom: 8 }}>{titulo}</Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3, marginBottom: 22, lineHeight: 19 }}>{texto}</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={onClose} style={{ flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 14, height: 50, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text2 }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={go} disabled={salvando} style={{ flex: 1, backgroundColor: corBotao, borderRadius: 14, height: 50, alignItems: 'center', justifyContent: 'center', opacity: salvando ? 0.6 : 1 }}>
                {salvando ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: '#fff' }}>{textoBotao}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ── Modal editar despesa ─────────────────────────────────────

function ModalEditarDespesa({
  item, onClose, onSalvo,
}: {
  item: DespesaItem | null;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const [descricao,     setDescricao]     = useState('');
  const [valor,         setValor]         = useState('');
  const [categoria,     setCategoria]     = useState('');
  const [recorrente,    setRecorrente]    = useState(false);
  const [periodicidade, setPeriodicidade] = useState('mensal');
  const [vencimento,    setVencimento]    = useState('');
  const [recorrenciaAte, setRecorrenciaAte] = useState('');
  const [modoRepeticao, setModoRepeticao] = useState<'data' | 'parcelas'>('data');
  const [quantidadeParcelas, setQuantidadeParcelas] = useState('');
  const [contratoEmAndamento, setContratoEmAndamento] = useState(false);
  const [parcelaAtualInput, setParcelaAtualInput] = useState('');
  const [modoValor, setModoValor] = useState<'parcela' | 'total'>('parcela');
  const [valorTotalCompra, setValorTotalCompra] = useState('');
  const [salvando,      setSalvando]      = useState(false);
  const [excluindo,     setExcluindo]     = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!item) return;
    setDescricao(item.descricao);
    setValor(formatValorMonetarioInput(Number(item.valor)));
    setCategoria(item.categoria ?? '');
    setRecorrente(item.recorrente);
    setPeriodicidade(item.periodicidade ?? 'mensal');
    if (item.data_vencimento) {
      const [y, m, d] = item.data_vencimento.split('-');
      setVencimento(`${d}/${m}/${y}`);
    } else {
      setVencimento('');
    }
    if (item.recorrencia_ate) {
      const [y, m, d] = item.recorrencia_ate.split('-');
      setRecorrenciaAte(`${d}/${m}/${y}`);
    } else {
      setRecorrenciaAte('');
    }
    setModoRepeticao(item.total_parcelas ? 'parcelas' : 'data');
    setQuantidadeParcelas(item.total_parcelas ? String(item.total_parcelas) : '');
    setContratoEmAndamento((item.parcela_atual ?? 1) > 1);
    setParcelaAtualInput(item.parcela_atual ? String(item.parcela_atual) : '');
    setModoValor(item.valor_total_compra ? 'total' : 'parcela');
    setValorTotalCompra(item.valor_total_compra ? formatValorMonetarioInput(Number(item.valor_total_compra)) : '');
    setConfirmDelete(false);
  }, [item]);

  const totalParcelasPreview = modoRepeticao === 'parcelas' ? (parseInt(quantidadeParcelas, 10) || 0) : 0;
  const valorTotalCompraPreviewNum = parseFloat(valorTotalCompra.replace(',', '.'));
  const valorCalculadoPreview = recorrente && periodicidade === 'mensal' && modoValor === 'total' && totalParcelasPreview > 0 && !isNaN(valorTotalCompraPreviewNum) && valorTotalCompraPreviewNum > 0
    ? dividirValorCompra(valorTotalCompraPreviewNum, totalParcelasPreview).valorParcelaAtual
    : null;

  function mascaraData(v: string) {
    const n = v.replace(/\D/g, '').slice(0, 8);
    if (n.length <= 2) return n;
    if (n.length <= 4) return `${n.slice(0, 2)}/${n.slice(2)}`;
    return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n.slice(4)}`;
  }

  function dataParaBanco(v: string): string | null {
    if (!v) return null;
    const p = v.split('/');
    if (p.length !== 3 || p[2].length !== 4) return null;
    return `${p[2]}-${p[1]}-${p[0]}`;
  }

  async function salvar() {
    if (!item) return;
    setSalvando(true);
    const vencimentoBanco = dataParaBanco(vencimento);
    const totalParcelasNum = modoRepeticao === 'parcelas' ? (parseInt(quantidadeParcelas, 10) || 0) : 0;
    const parcelaAtualNumRaw = contratoEmAndamento ? (parseInt(parcelaAtualInput, 10) || 1) : 1;
    const parcelaAtualNum = totalParcelasNum > 0 ? clampParcelaAtual(parcelaAtualNumRaw, totalParcelasNum) : parcelaAtualNumRaw;
    const usaValorDividido = recorrente && periodicidade === 'mensal' && modoRepeticao === 'parcelas' && modoValor === 'total';
    if (recorrente && periodicidade === 'mensal' && modoRepeticao === 'parcelas') {
      if (totalParcelasNum < 1) {
        setSalvando(false);
        Alert.alert('Quantidade inválida', 'Informe a quantidade de parcelas.');
        return;
      }
      if (!vencimentoBanco) {
        setSalvando(false);
        Alert.alert('Vencimento obrigatório', 'Informe a data de vencimento para calcular o término das parcelas.');
        return;
      }
    }
    let valorFinal: number;
    let valorTotalCompraNum: number | null = null;
    if (usaValorDividido) {
      valorTotalCompraNum = parseFloat(valorTotalCompra.replace(',', '.'));
      if (isNaN(valorTotalCompraNum) || valorTotalCompraNum <= 0) {
        setSalvando(false);
        Alert.alert('Valor inválido', 'Informe o valor total da compra.');
        return;
      }
      valorFinal = dividirValorCompra(valorTotalCompraNum, totalParcelasNum || 1).valorParcelaAtual;
    } else {
      valorFinal = parseFloat(valor.replace(',', '.'));
      if (isNaN(valorFinal) || valorFinal <= 0) {
        setSalvando(false);
        Alert.alert('Valor inválido', 'Informe um valor maior que zero.');
        return;
      }
    }
    const usaParcelas = periodicidade === 'mensal' && modoRepeticao === 'parcelas' && totalParcelasNum > 0 && !!vencimentoBanco;
    const recorrenciaAteFinal = usaParcelas
      ? calcularRecorrenciaAtePorParcelas(vencimentoBanco!, totalParcelasNum, parcelaAtualNum)
      : dataParaBanco(recorrenciaAte);
    const { error } = await supabase.from('despesas').update({
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           valorFinal,
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: vencimentoBanco,
      recorrencia_ate: recorrente ? recorrenciaAteFinal : null,
      parcela_atual:   recorrente && usaParcelas ? parcelaAtualNum : null,
      total_parcelas:  recorrente && usaParcelas ? totalParcelasNum : null,
      valor_total_compra: usaValorDividido ? valorTotalCompraNum : null,
    }).eq('id', item.id);
    setSalvando(false);
    if (error) { Alert.alert('Erro', error.message); return; }
    onSalvo();
    onClose();
  }

  async function excluir() {
    if (!item) return;
    setExcluindo(true);
    await supabase.from('despesas').delete().eq('id', item.id);
    setExcluindo(false);
    onSalvo();
    onClose();
  }

  return (
    <Modal visible={!!item} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={onClose}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
        />
        <View style={{ maxHeight: '92%' }}>
          <ScrollView
            style={{ backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
            contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            {/* Handle */}
            <View style={{
              width: 36, height: 4, borderRadius: 2,
              backgroundColor: C.border, alignSelf: 'center', marginBottom: 20,
            }} />

            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 22, color: C.text }}>
                Editar despesa
              </Text>
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

            {/* Descrição */}
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2, marginBottom: 8 }}>
              Descrição *
            </Text>
            <View style={{
              backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
              borderRadius: 12, paddingHorizontal: 14, height: 48,
              justifyContent: 'center', marginBottom: 16,
            }}>
              <TextInput
                value={descricao}
                onChangeText={setDescricao}
                placeholder="Ex: Aluguel do espaço"
                placeholderTextColor={C.text4}
                style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text }}
              />
            </View>

            {/* Valor */}
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2, marginBottom: 8 }}>
              Valor *
            </Text>
            <View style={{
              backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
              borderRadius: 12, paddingHorizontal: 14, height: 48,
              flexDirection: 'row', alignItems: 'center', marginBottom: 16,
            }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text3, marginRight: 6 }}>R$</Text>
              <TextInput
                value={valorCalculadoPreview !== null ? valorCalculadoPreview.toFixed(2).replace('.', ',') : valor}
                onChangeText={setValor}
                editable={valorCalculadoPreview === null}
                placeholder="0,00"
                placeholderTextColor={C.text4}
                keyboardType="decimal-pad"
                style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: valorCalculadoPreview !== null ? C.text3 : C.text }}
              />
            </View>

            {/* Categoria */}
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2, marginBottom: 8 }}>
              Categoria
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              {CATEGORIAS_MOBILE.map(c => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setCategoria(c === categoria ? '' : c)}
                  style={{
                    paddingHorizontal: 10, paddingVertical: 5,
                    borderRadius: 20, borderWidth: 1,
                    borderColor: categoria === c ? C.primary : C.border,
                    backgroundColor: categoria === c ? C.primary : C.bg,
                  }}
                >
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11,
                    color: categoria === c ? '#fff' : C.text3,
                  }}>
                    {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Vencimento */}
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2, marginBottom: 8 }}>
              Data de vencimento
            </Text>
            <View style={{
              backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
              borderRadius: 12, paddingHorizontal: 14, height: 48,
              justifyContent: 'center', marginBottom: 16,
            }}>
              <TextInput
                value={vencimento}
                onChangeText={v => setVencimento(mascaraData(v))}
                placeholder="DD/MM/AAAA"
                placeholderTextColor={C.text4}
                keyboardType="numeric"
                style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text }}
              />
            </View>

            {/* Recorrente */}
            <TouchableOpacity
              onPress={() => setRecorrente(v => !v)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.border, marginBottom: 8,
              }}
            >
              <View style={{
                width: 20, height: 20, borderRadius: 5, borderWidth: 1.5,
                borderColor: recorrente ? C.primary : C.border,
                backgroundColor: recorrente ? C.primary : C.bg,
                alignItems: 'center', justifyContent: 'center',
              }}>
                {recorrente && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', lineHeight: 14 }}>✓</Text>}
              </View>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text2 }}>
                Despesa recorrente
              </Text>
            </TouchableOpacity>
            {recorrente && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                {PERIODICIDADES_MOBILE.map(p => (
                  <TouchableOpacity
                    key={p.key}
                    onPress={() => setPeriodicidade(p.key)}
                    style={{
                      flex: 1, minWidth: 80, paddingVertical: 8,
                      borderRadius: 12, borderWidth: 1,
                      borderColor: periodicidade === p.key ? C.amber : C.border,
                      backgroundColor: periodicidade === p.key ? C.amberSoft : C.bg,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11,
                      color: periodicidade === p.key ? C.amber : C.text3,
                    }}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                ))}
                <View style={{ width: '100%', marginTop: 4 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2, marginBottom: 8 }}>
                    Repetir até (opcional)
                  </Text>
                  {periodicidade === 'mensal' && (
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                      <TouchableOpacity
                        onPress={() => setModoRepeticao('data')}
                        style={{
                          flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                          backgroundColor: modoRepeticao === 'data' ? C.amberSoft : C.bg,
                          borderWidth: 1, borderColor: modoRepeticao === 'data' ? C.amber : C.border,
                        }}
                      >
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: modoRepeticao === 'data' ? C.amber : C.text3 }}>
                          Por data
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setModoRepeticao('parcelas')}
                        style={{
                          flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                          backgroundColor: modoRepeticao === 'parcelas' ? C.amberSoft : C.bg,
                          borderWidth: 1, borderColor: modoRepeticao === 'parcelas' ? C.amber : C.border,
                        }}
                      >
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: modoRepeticao === 'parcelas' ? C.amber : C.text3 }}>
                          Por quantidade de parcelas
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {periodicidade === 'mensal' && modoRepeticao === 'parcelas' ? (
                    <View style={{ gap: 8 }}>
                      <View style={{
                        backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
                        borderRadius: 12, paddingHorizontal: 14, height: 48, justifyContent: 'center',
                      }}>
                        <TextInput
                          value={quantidadeParcelas}
                          onChangeText={setQuantidadeParcelas}
                          placeholder="Quantidade de parcelas"
                          placeholderTextColor={C.text4}
                          keyboardType="numeric"
                          style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text }}
                        />
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          onPress={() => setContratoEmAndamento(false)}
                          style={{
                            flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                            backgroundColor: !contratoEmAndamento ? C.amberSoft : C.bg,
                            borderWidth: 1, borderColor: !contratoEmAndamento ? C.amber : C.border,
                          }}
                        >
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: !contratoEmAndamento ? C.amber : C.text3 }}>
                            Novo
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setContratoEmAndamento(true)}
                          style={{
                            flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                            backgroundColor: contratoEmAndamento ? C.amberSoft : C.bg,
                            borderWidth: 1, borderColor: contratoEmAndamento ? C.amber : C.border,
                          }}
                        >
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: contratoEmAndamento ? C.amber : C.text3 }}>
                            Já em andamento
                          </Text>
                        </TouchableOpacity>
                      </View>
                      {contratoEmAndamento && (
                        <View style={{
                          backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
                          borderRadius: 12, paddingHorizontal: 14, height: 48, justifyContent: 'center',
                        }}>
                          <TextInput
                            value={parcelaAtualInput}
                            onChangeText={setParcelaAtualInput}
                            placeholder="Parcela atual"
                            placeholderTextColor={C.text4}
                            keyboardType="numeric"
                            style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text }}
                          />
                        </View>
                      )}
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          onPress={() => setModoValor('parcela')}
                          style={{
                            flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                            backgroundColor: modoValor === 'parcela' ? C.amberSoft : C.bg,
                            borderWidth: 1, borderColor: modoValor === 'parcela' ? C.amber : C.border,
                          }}
                        >
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: modoValor === 'parcela' ? C.amber : C.text3 }}>
                            Valor da parcela
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setModoValor('total')}
                          style={{
                            flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                            backgroundColor: modoValor === 'total' ? C.amberSoft : C.bg,
                            borderWidth: 1, borderColor: modoValor === 'total' ? C.amber : C.border,
                          }}
                        >
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: modoValor === 'total' ? C.amber : C.text3 }}>
                            Valor total da compra
                          </Text>
                        </TouchableOpacity>
                      </View>
                      {modoValor === 'total' && (
                        <View style={{
                          backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
                          borderRadius: 12, paddingHorizontal: 14, height: 48, justifyContent: 'center',
                        }}>
                          <TextInput
                            value={valorTotalCompra}
                            onChangeText={setValorTotalCompra}
                            placeholder="Valor total da compra"
                            placeholderTextColor={C.text4}
                            keyboardType="numeric"
                            style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text }}
                          />
                        </View>
                      )}
                    </View>
                  ) : (
                    <View style={{
                      backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
                      borderRadius: 12, paddingHorizontal: 14, height: 48,
                      justifyContent: 'center',
                    }}>
                      <TextInput
                        value={recorrenciaAte}
                        onChangeText={v => setRecorrenciaAte(mascaraData(v))}
                        placeholder="DD/MM/AAAA"
                        placeholderTextColor={C.text4}
                        keyboardType="numeric"
                        style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text }}
                      />
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Excluir */}
            <View style={{ borderTopWidth: 1, borderTopColor: C.border, paddingTop: 16, marginTop: 4, marginBottom: 20 }}>
              {confirmDelete ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.red, flex: 1 }}>
                    Confirmar exclusão?
                  </Text>
                  <TouchableOpacity
                    onPress={() => setConfirmDelete(false)}
                    style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.border }}
                  >
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text2 }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={excluir}
                    disabled={excluindo}
                    style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: C.red, opacity: excluindo ? 0.6 : 1 }}
                  >
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: '#fff' }}>
                      {excluindo ? 'Excluindo...' : 'Excluir'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity onPress={() => setConfirmDelete(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Trash2 size={13} color={C.red} strokeWidth={2} />
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.red }}>
                    Excluir despesa
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Botões */}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={onClose}
                style={{
                  flex: 1, height: 52, borderRadius: 14,
                  borderWidth: 1, borderColor: C.border,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text2 }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={salvar}
                disabled={salvando || !descricao.trim() || !valor}
                style={{
                  flex: 1, height: 52, borderRadius: 14,
                  backgroundColor: C.primary,
                  alignItems: 'center', justifyContent: 'center',
                  opacity: (salvando || !descricao.trim() || !valor) ? 0.5 : 1,
                }}
              >
                {salvando
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: '#fff' }}>Salvar alterações</Text>
                }
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
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
  const [despesaParaEditar,  setDespesaParaEditar]  = useState<DespesaItem | null>(null);
  const [confirmarTaxaCanc,    setConfirmarTaxaCanc]    = useState<(TaxaCancelamento & { cliente: { nome: string } | null }) | null>(null);
  const [confirmarTaxaReserva, setConfirmarTaxaReserva] = useState<(TaxaReserva & { cliente: { nome: string } | null }) | null>(null);
  const [devolucaoDe,  setDevolucaoDe]  = useState<RetiradaSociaRow | null>(null);
  const [converterDe,  setConverterDe]  = useState<RetiradaSociaRow | null>(null);
  const [excluirDe,    setExcluirDe]    = useState<RetiradaSociaRow | null>(null);

  const qc = useQueryClient();
  const {
    resumo, metodos, topServicos, despesas, despesasHistorico, taxasCancelamento, taxasReserva, evolucao, isLoading, refetch,
    isOwner, retiradas, retiradasDevs, aDonaDeve, retiradasPeriodo,
  } = useFinanceiro(mesRef);
  const devPorRetirada = somaDevolucoesPorRetirada(retiradasDevs);
  const despesasPendentes = despesas.filter(d => d.status === 'pendente');
  const totalPendente     = despesasPendentes.reduce((soma, d) => soma + Number(d.valor), 0);
  const hojeIso            = format(new Date(), 'yyyy-MM-dd');

  function aposMarcarPago() {
    qc.invalidateQueries({ queryKey: ['fin-resumo'] });
    qc.invalidateQueries({ queryKey: ['fin-despesas'] });
    qc.invalidateQueries({ queryKey: ['fin-evolucao'] });
  }

  async function marcarTaxaPaga(item: TaxaCancelamento, metodo: PagamentoMetodo | null) {
    // `.select()` não é decoração: o RLS de UPDATE de taxas_cancelamento só
    // libera gestor/owner. Sem ele, um toque de profissional não atualiza
    // nada e o Postgres devolve sucesso com zero linhas — a lista recarregava,
    // a taxa continuava pendente e nenhum aviso aparecia. Mesmo bug já
    // corrigido em marcarReservaPaga.
    const { data, error } = await supabase
      .from('taxas_cancelamento')
      .update({ status: 'pago', paga_em: new Date().toISOString(), metodo })
      .eq('id', item.id)
      .select('id');
    if (error) { Alert.alert('Erro', error.message); return; }
    if (!data || data.length === 0) {
      Alert.alert('Sem permissão', 'Só gestores podem marcar taxas como pagas.');
      return;
    }
    setConfirmarTaxaCanc(null);
    qc.invalidateQueries({ queryKey: ['fin-taxas-cancelamento'] });
  }

  async function marcarReservaPaga(item: TaxaReserva, metodo: PagamentoMetodo | null) {
    // `.select()` não é decoração: o RLS de UPDATE de taxas_reserva só libera
    // gestor/owner. Sem ele, um toque de profissional não atualiza nada e o
    // Postgres devolve sucesso com zero linhas — a lista recarregava, a taxa
    // continuava pendente e nenhum aviso aparecia.
    const { data, error } = await supabase
      .from('taxas_reserva')
      .update({ status: 'pago', paga_em: new Date().toISOString(), metodo })
      .eq('id', item.id)
      .select('id');
    if (error) { Alert.alert('Erro', error.message); return; }
    if (!data || data.length === 0) {
      Alert.alert('Sem permissão', 'Só gestores podem marcar taxas de reserva como pagas.');
      return;
    }
    setConfirmarTaxaReserva(null);
    qc.invalidateQueries({ queryKey: ['fin-taxas-reserva'] });
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <PrivacyToggle color={C.text} />
          <TouchableOpacity style={{
            width: 38, height: 38, borderRadius: 12,
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            marginTop: 4,
          }}>
            <Download size={16} color={C.text2} strokeWidth={1.8} />
          </TouchableOpacity>
          </View>
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
              onPress={() => setMesRef((m) => addMonths(m, 1))}
              style={{
                width: 28, height: 28, borderRadius: 8,
                borderWidth: 1, borderColor: C.border,
                alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg,
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
              sub: null as string | null,
            },
            {
              label: 'Gastos',
              value: formatBRL(resumo?.gastos ?? 0),
              delta: deltaGastos,
              color: C.red,
              bg: C.redSoft,
              invertDelta: true,
              sub: null as string | null,
            },
            {
              label: 'Lucro',
              value: formatBRL(resumo?.lucro ?? 0),
              delta: null,
              color: C.primary,
              bg: C.primarySoft,
              sub: isOwner && retiradasPeriodo > 0 ? `Após retiradas ${formatBRL((resumo?.lucro ?? 0) - retiradasPeriodo)}` : null,
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
              <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: s.color, letterSpacing: -0.5, lineHeight: 20, marginBottom: 5 }}>
                {s.value}
              </SecretText>
              {s.sub && (
                <SecretText style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, marginBottom: 3 }}>{s.sub}</SecretText>
              )}
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
                    <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>
                      {formatBRL(s.receita)}
                    </SecretText>
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
            <View>
              <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text }}>
                Despesas
              </Text>
              {despesasPendentes.length > 0 && (
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 2 }}>
                  <SecretText>{formatBRL(totalPendente)}</SecretText> pendente · <SecretText>{despesasPendentes.length}</SecretText> despesa{despesasPendentes.length !== 1 ? 's' : ''}
                </Text>
              )}
            </View>
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
                  hojeIso={hojeIso}
                  historico={despesasHistorico}
                  onMarcarPago={setDespesaSelecionada}
                  onEditar={setDespesaParaEditar}
                />
              ))
            )}
          </View>
        </MotiView>

        {/* ── Taxas de cancelamento ── */}
        {(taxasCancelamento ?? []).length > 0 && (
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 380, delay: 300 }}
            style={{ marginHorizontal: 24, marginTop: 20 }}
          >
            <View style={{
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16,
              overflow: 'hidden',
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              <View style={{ paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 15, color: C.text }}>
                  Taxas de Cancelamento
                </Text>
              </View>
              {(taxasCancelamento ?? []).map((item, i, arr) => (
                <TaxaCancelamentoRow
                  key={item.id}
                  item={item}
                  isLast={i === arr.length - 1}
                  onMarcarPago={setConfirmarTaxaCanc}
                />
              ))}
            </View>
          </MotiView>
        )}

        {/* ── Taxas de reserva ── */}
        {(taxasReserva ?? []).length > 0 && (
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 380, delay: 320 }}
            style={{ marginHorizontal: 24, marginTop: 20 }}
          >
            <View style={{
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16,
              overflow: 'hidden',
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              <View style={{ paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 15, color: C.text }}>
                  Taxas de Reserva
                </Text>
              </View>
              {(taxasReserva ?? []).map((item, i, arr) => (
                <TaxaReservaRow
                  key={item.id}
                  item={item}
                  isLast={i === arr.length - 1}
                  onMarcarPago={setConfirmarTaxaReserva}
                />
              ))}
            </View>
          </MotiView>
        )}

        {/* ── Retiradas da dona (owner-only) ── */}
        {isOwner && (
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 380, delay: 360 }}
            style={{ marginHorizontal: 24, marginTop: 20 }}
          >
            <View style={{
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16,
              overflow: 'hidden',
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 15, color: C.text }}>Retiradas da dona</Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 2 }}>
                    {aDonaDeve > 0 ? <>A dona deve: <SecretText>{formatBRL(aDonaDeve)}</SecretText></> : 'Nenhum empréstimo em aberto'}
                    {retiradasPeriodo > 0 ? <> · Retiradas no mês: <SecretText>{formatBRL(retiradasPeriodo)}</SecretText></> : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => router.push('/(empresa)/nova-retirada' as any)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.primary, paddingHorizontal: 12, height: 32, borderRadius: 10 }}
                >
                  <Plus size={13} color="#fff" strokeWidth={2.5} />
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' }}>Registrar</Text>
                </TouchableOpacity>
              </View>

              {retiradas.length === 0 ? (
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3, padding: 16 }}>
                  Nenhuma retirada ou empréstimo neste mês.
                </Text>
              ) : retiradas.map((r, i) => {
                const devolvido = devPorRetirada[r.id] ?? 0;
                const saldo = saldoEmprestimo(Number(r.valor), devolvido);
                const parc = (r.tipo === 'emprestimo' && r.parcelado && r.valor_parcela && r.primeira_parcela_em)
                  ? statusParcela(Number(r.valor_parcela), r.primeira_parcela_em, r.total_parcelas ?? 0, devolvido, hojeIso)
                  : null;
                const quitado = r.tipo === 'emprestimo' && (!!r.convertido_em || saldo <= 0);
                const podeAgir = r.tipo === 'emprestimo' && !quitado;
                return (
                  <View key={r.id} style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: i < retiradas.length - 1 ? 1 : 0, borderBottomColor: C.border }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: r.tipo === 'emprestimo' ? C.amberSoft : C.greenSoft }}>
                            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: r.tipo === 'emprestimo' ? C.amber : C.green, textTransform: 'uppercase' }}>
                              {r.tipo === 'emprestimo' ? 'Empréstimo' : 'Retirada'}
                            </Text>
                          </View>
                          <SecretText style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text }}>{formatBRL(Number(r.valor))}</SecretText>
                          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text4 }}>
                            {r.data.split('-').reverse().join('/')}
                            {r.metodo && METODO_CONFIG[r.metodo as PagamentoMetodo] ? ` · ${METODO_CONFIG[r.metodo as PagamentoMetodo].label}` : ''}
                          </Text>
                        </View>
                        {!!r.descricao && <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 2 }} numberOfLines={1}>{r.descricao}</Text>}
                        {r.tipo === 'emprestimo' && !r.convertido_em && (
                          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 2 }}>
                            Devolvido <SecretText>{formatBRL(devolvido)}</SecretText> de <SecretText>{formatBRL(Number(r.valor))}</SecretText> · saldo <SecretText>{formatBRL(saldo)}</SecretText>
                            {parc ? ` · Parcela ${Math.min(parc.parcelasQuitadas + (parc.proximaParcelaEm ? 1 : 0), r.total_parcelas ?? 0)}/${r.total_parcelas}` : ''}
                            {parc?.atrasada ? '  atrasada' : ''}
                            {quitado ? '  quitado' : ''}
                          </Text>
                        )}
                        {!!r.convertido_em && (
                          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 2 }}>
                            Convertido em retirada em {r.convertido_em.split('-').reverse().join('/')}
                          </Text>
                        )}
                      </View>
                      <View style={{ flexDirection: 'row', gap: 2 }}>
                        {podeAgir && (
                          <>
                            <TouchableOpacity onPress={() => setDevolucaoDe(r)} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                              <RefreshCw size={14} color={C.text3} strokeWidth={2} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setConverterDe(r)} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                              <Ban size={14} color={C.text3} strokeWidth={2} />
                            </TouchableOpacity>
                          </>
                        )}
                        <TouchableOpacity onPress={() => router.push({ pathname: '/(empresa)/nova-retirada' as any, params: { id: r.id } })} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                          <Pencil size={14} color={C.text3} strokeWidth={2} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setExcluirDe(r)} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                          <Trash2 size={14} color={C.red} strokeWidth={2} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </MotiView>
        )}

      </ScrollView>

      {/* Modal marcar como paga */}
      <ModalMarcarPago
        item={despesaSelecionada}
        onClose={() => setDespesaSelecionada(null)}
        onSalvo={aposMarcarPago}
      />

      {/* Modal editar despesa */}
      <ModalEditarDespesa
        item={despesaParaEditar}
        onClose={() => setDespesaParaEditar(null)}
        onSalvo={() => {
          qc.invalidateQueries({ queryKey: ['fin-resumo'] });
          qc.invalidateQueries({ queryKey: ['fin-despesas'] });
        }}
      />

      {/* Modal confirmar taxa de cancelamento */}
      <ModalConfirmarTaxa
        item={confirmarTaxaCanc}
        titulo="Confirmar taxa de cancelamento"
        onClose={() => setConfirmarTaxaCanc(null)}
        onConfirmar={metodo => confirmarTaxaCanc && marcarTaxaPaga(confirmarTaxaCanc, metodo)}
      />

      {/* Modal confirmar taxa de reserva */}
      <ModalConfirmarTaxa
        item={confirmarTaxaReserva}
        titulo="Confirmar taxa de reserva"
        onClose={() => setConfirmarTaxaReserva(null)}
        onConfirmar={metodo => confirmarTaxaReserva && marcarReservaPaga(confirmarTaxaReserva, metodo)}
      />

      {/* Retiradas da dona: devolução / converter / excluir */}
      <ModalDevolucaoRetirada
        retirada={devolucaoDe}
        saldo={devolucaoDe ? saldoEmprestimo(Number(devolucaoDe.valor), devPorRetirada[devolucaoDe.id] ?? 0) : 0}
        onClose={() => setDevolucaoDe(null)}
        onSalvo={() => { setDevolucaoDe(null); qc.invalidateQueries({ queryKey: ['fin-retiradas'] }); }}
      />
      <ModalConfirmacaoRetirada
        visivel={!!converterDe}
        titulo={`${converterDe ? formatBRL(saldoEmprestimo(Number(converterDe.valor), devPorRetirada[converterDe.id] ?? 0)) : ''} não serão devolvidos`}
        texto="O saldo em aberto vira uma retirada definitiva na data de hoje. Sai do 'a dona deve' e passa a contar em 'Retiradas da dona' no mês atual."
        corBotao={C.primary}
        textoBotao="Converter"
        onClose={() => setConverterDe(null)}
        onConfirmar={async () => {
          if (!converterDe) return;
          const { error } = await supabase.from('retiradas_socia')
            .update({ convertido_em: format(new Date(), 'yyyy-MM-dd') }).eq('id', converterDe.id).select('id');
          if (error) { Alert.alert('Erro', 'Não foi possível converter. Verifique se você é a dona da conta.'); return; }
          setConverterDe(null);
          qc.invalidateQueries({ queryKey: ['fin-retiradas'] });
        }}
      />
      <ModalConfirmacaoRetirada
        visivel={!!excluirDe}
        titulo={excluirDe ? `${excluirDe.tipo === 'emprestimo' ? 'Empréstimo' : 'Retirada'} de ${formatBRL(Number(excluirDe.valor))}` : ''}
        texto="Isso apaga o lançamento e todas as devoluções ligadas a ele. Não dá pra desfazer."
        corBotao={C.red}
        textoBotao="Excluir"
        onClose={() => setExcluirDe(null)}
        onConfirmar={async () => {
          if (!excluirDe) return;
          const { error } = await supabase.from('retiradas_socia').delete().eq('id', excluirDe.id).select('id');
          if (error) { Alert.alert('Erro', 'Não foi possível excluir. Verifique se você é a dona da conta.'); return; }
          setExcluirDe(null);
          qc.invalidateQueries({ queryKey: ['fin-retiradas'] });
        }}
      />
    </View>
  );
}
