import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  RefreshControl, StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { ChevronLeft, ChevronRight, TrendingUp, Clock } from 'lucide-react-native';
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
import { addMonths, subMonths, format, isSameMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { useAuthStore } from '@/stores/authStore';
import { SmoothTabs } from '@/components/SmoothTabs';
import {
  useComissoesProfissional, useResumoComissoes,
  type ComissaoItem,
} from '@/hooks/useProfissional';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

type Filtro = 'todas' | 'pendente' | 'pago';

function formatBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

// ── Card de comissão ─────────────────────────────────────────

function ComissaoCard({ item, index }: { item: ComissaoItem; index: number }) {
  const pago = item.status === 'pago';

  return (
    <MotiView
      from={{ opacity: 0, translateY: 4 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 280, delay: index * 40 }}
    >
      <View style={{
        backgroundColor: C.surface,
        borderWidth: 1, borderColor: C.border,
        borderRadius: 16, padding: 14,
        shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
      }}>
        {/* Header: cliente + data */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text, flex: 1 }} numberOfLines={1}>
            {item.cliente_nome}
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginLeft: 8 }}>
            {format(new Date(item.data_hora), "dd/MM · HH:mm")}
          </Text>
        </View>

        {/* Serviço */}
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginBottom: 10 }} numberOfLines={1}>
          {item.servico_nome}
        </Text>

        {/* Footer: cálculo + status */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Cálculo transparente */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3 }}>
              {formatBRL(item.valor_servico)}
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }}>×</Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.accent }}>
              {item.percentual}%
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }}>=</Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.green, letterSpacing: -0.5 }}>
              {formatBRL(item.valor_comissao)}
            </Text>
          </View>

          {/* Status */}
          <View style={{
            backgroundColor: pago ? C.greenSoft : C.amberSoft,
            borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3,
          }}>
            <Text style={{
              fontFamily: 'PlusJakartaSans_700Bold',
              fontSize: 9, textTransform: 'uppercase',
              color: pago ? C.green : C.amber,
              letterSpacing: 0.3,
            }}>
              {pago ? 'Pago' : 'Pendente'}
            </Text>
          </View>
        </View>
      </View>
    </MotiView>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function Comissoes() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();

  const [mesRef, setMesRef] = useState(new Date());
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const isHoje = isSameMonth(mesRef, new Date());

  const { data: comissoes = [], isLoading, refetch } = useComissoesProfissional(mesRef, filtro);
  const { data: resumo } = useResumoComissoes(mesRef);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const onRefresh = useCallback(() => refetch(), [refetch]);

  if (!fontsLoaded) return null;

  const FILTROS: { key: Filtro; label: string }[] = [
    { key: 'todas',    label: 'Todas' },
    { key: 'pendente', label: 'Pendentes' },
    { key: 'pago',     label: 'Pagas' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        {/* ── Header ── */}
        <MotiView
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 380 }}
          style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 16 }}
        >
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
            {user?.nome?.split(' ')[0]}
          </Text>
          <Text style={{ fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 26, color: C.text }}>
            Comissões
          </Text>
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
              onPress={() => setMesRef(m => subMonths(m, 1))}
              style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}
            >
              <ChevronLeft size={14} color={C.text2} strokeWidth={2.5} />
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>
                {format(mesRef, 'MMMM yyyy', { locale: ptBR }).replace(/^\w/, c => c.toUpperCase())}
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 1 }}>
                {resumo?.atendimentos ?? 0} atendimentos
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => !isHoje && setMesRef(m => addMonths(m, 1))}
              style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, opacity: isHoje ? 0.3 : 1 }}
            >
              <ChevronRight size={14} color={C.text2} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
        </MotiView>

        {/* ── Hero total ── */}
        <MotiView
          from={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'timing', duration: 400, delay: 100 }}
          style={{ marginHorizontal: 24, marginBottom: 12 }}
        >
          <LinearGradient
            colors={['#2C1654', '#3D1F72']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ borderRadius: 20, padding: 22, shadowColor: '#1A0A3C', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 }}
          >
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>
              Total de comissões · {format(mesRef, 'MMMM', { locale: ptBR }).replace(/^\w/, c => c.toUpperCase())}
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 36, color: '#fff', letterSpacing: -1, lineHeight: 40, marginBottom: 12 }}>
              {formatBRL(resumo?.total ?? 0)}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 20, paddingVertical: 4, paddingHorizontal: 10 }}>
                <TrendingUp size={10} color="#6EE7B7" strokeWidth={2.5} />
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: '#6EE7B7' }}>
                  {formatBRL(resumo?.pago ?? 0)} recebido
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 20, paddingVertical: 4, paddingHorizontal: 10 }}>
                <Clock size={10} color="#FCD34D" strokeWidth={2.5} />
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: '#FCD34D' }}>
                  {formatBRL(resumo?.pendente ?? 0)} a receber
                </Text>
              </View>
            </View>
          </LinearGradient>
        </MotiView>

        {/* ── KPIs ── */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 380, delay: 140 }}
          style={{ marginHorizontal: 24, marginBottom: 20, flexDirection: 'row', gap: 8 }}
        >
          {[
            { label: 'Atendimentos', value: String(resumo?.atendimentos ?? 0), color: C.primary },
            { label: 'Ticket médio', value: formatBRL(resumo?.ticketMedio ?? 0), color: C.primary },
            { label: 'Já recebido', value: formatBRL(resumo?.pago ?? 0), color: C.green, pill: 'pago' },
            { label: 'Pendente', value: formatBRL(resumo?.pendente ?? 0), color: C.amber, pill: 'pendente' },
          ].map((k) => (
            <View key={k.label} style={{
              flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 16, padding: 12,
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
                {k.label}
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18, color: k.color, letterSpacing: -0.5, lineHeight: 20, marginBottom: 4 }}>
                {k.value}
              </Text>
              {k.pill && (
                <View style={{ backgroundColor: k.pill === 'pago' ? C.greenSoft : C.amberSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: k.pill === 'pago' ? C.green : C.amber, textTransform: 'uppercase' }}>
                    {k.pill}
                  </Text>
                </View>
              )}
            </View>
          ))}
        </MotiView>

        {/* ── Filtros ── */}
        <SmoothTabs
          tabs={FILTROS}
          active={filtro}
          onChange={key => setFiltro(key as Filtro)}
          activeColor={C.primary}
          trackBg={C.surface}
          trackBorder={C.border}
          inactiveTextColor={C.text3}
          style={{ marginHorizontal: 24, marginBottom: 16 }}
        />

        {/* ── Lista ── */}
        <View style={{ paddingHorizontal: 24 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 18, color: C.text }}>
              {comissoes.length} {filtro === 'todas' ? 'comissões' : filtro === 'pendente' ? 'pendentes' : 'pagas'}
            </Text>
          </View>

          {comissoes.length === 0 ? (
            <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 24, alignItems: 'center' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                Nenhuma comissão encontrada
              </Text>
            </View>
          ) : (
            <View style={{ gap: 6 }}>
              {comissoes.map((item, i) => (
                <ComissaoCard key={item.id} item={item} index={i} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
