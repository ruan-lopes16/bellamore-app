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
  Fraunces_600SemiBold,
} from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  PERIODOS_COMISSAO, limitesPeriodoComissao, rotuloPeriodoComissao, hojeBRT, rotuloDataHoraBRT,
  type PeriodoComissao,
} from '@shared/periodos';
import { FILTROS_COMISSAO, filtrarComissoes, type FiltroComissao } from '@shared/comissoes';

import { useAuthStore } from '@/stores/authStore';
import { SmoothTabs } from '@/components/SmoothTabs';
import { SecretText } from '@/components/Secret';
import {
  useComissoesProfissional, useResumoComissoes,
  type ComissaoItem,
} from '@/hooks/useProfissional';
import { formatarMoeda } from '@shared/moeda';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

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
            {item.clienteNome}
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginLeft: 8 }}>
            {rotuloDataHoraBRT(item.dataAtendimento ?? item.criadaEm)}
          </Text>
        </View>

        {/* Serviço */}
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginBottom: 10 }} numberOfLines={1}>
          {item.servicoNome}
        </Text>

        {/* Footer: cálculo + status */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Cálculo transparente */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3 }}>
              <SecretText>{formatarMoeda(item.valorServico)}</SecretText>
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }}>×</Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.accent }}>
              {item.percentual}%
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }}>=</Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.green, letterSpacing: -0.5 }}>
              <SecretText>{formatarMoeda(item.valorComissao)}</SecretText>
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

  const [periodo, setPeriodo] = useState<PeriodoComissao>('mes');
  const [deslocamento, setDeslocamento] = useState(0);
  const [filtro, setFiltro] = useState<FiltroComissao>('todas');
  // Períodos de calendário em Brasília, iguais ao web (nunca o futuro).
  const l = limitesPeriodoComissao(periodo, hojeBRT(), deslocamento);
  const rotulo = rotuloPeriodoComissao(periodo, l);
  const podeAvancar = deslocamento < 0;

  const { data: itens = [], isLoading, isError: erroLista, error: errLista, refetch } = useComissoesProfissional(l);
  const { data: resumo, isLoading: carregandoResumo, isError: erroResumo, error: errResumo, refetch: refetchResumo } = useResumoComissoes(l);
  const comissoes = filtrarComissoes(itens, filtro);
  const erro = erroResumo || erroLista;
  // Sem número (erro, carregando ou sem resumo): "—", nunca zeros enganosos.
  const semNumero = erro || isLoading || carregandoResumo || !resumo;
  // Nunca mostrar R$ 0 no lugar dos números quando a consulta falha.
  const fmtRes = (n: number) => (semNumero ? '—' : formatarMoeda(n));
  const numRes = (n: number) => (semNumero ? '—' : String(n));

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const onRefresh = useCallback(() => { refetch(); refetchResumo(); }, [refetch, refetchResumo]);

  if (!fontsLoaded) return null;

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
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: C.text }}>
            Comissões
          </Text>
        </MotiView>

        {/* ── Período + navegação ── */}
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 350, delay: 60 }}
          style={{ marginHorizontal: 24, marginBottom: 16 }}
        >
          <SmoothTabs
            tabs={PERIODOS_COMISSAO}
            active={periodo}
            onChange={key => { setPeriodo(key as PeriodoComissao); setDeslocamento(0); }}
            activeColor={C.primary}
            trackBg={C.surface}
            trackBorder={C.border}
            inactiveTextColor={C.text3}
            style={{ marginBottom: 10 }}
          />
          <View style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 14, padding: 10, paddingHorizontal: 14,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
          }}>
            <TouchableOpacity
              onPress={() => setDeslocamento(d => d - 1)}
              style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}
            >
              <ChevronLeft size={14} color={C.text2} strokeWidth={2.5} />
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>
                {rotulo}
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 1 }}>
                {numRes(resumo?.atendimentos ?? 0)} atendimentos
              </Text>
            </View>
            <TouchableOpacity
              disabled={!podeAvancar}
              onPress={() => podeAvancar && setDeslocamento(d => d + 1)}
              style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, opacity: podeAvancar ? 1 : 0.3 }}
            >
              <ChevronRight size={14} color={C.text2} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
        </MotiView>

        {/* Erro ao carregar: nunca mostrar zeros no lugar dos números */}
        {erro && (
          <TouchableOpacity
            onPress={() => { refetch(); refetchResumo(); }}
            activeOpacity={0.8}
            style={{ marginHorizontal: 24, marginBottom: 12, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#C0392B', borderRadius: 14, padding: 12 }}
          >
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#C0392B', marginBottom: 2 }}>
              Não foi possível carregar suas comissões
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text2 }}>
              {[errResumo, errLista].filter(Boolean).map(e => (e as Error).message).join(" · ") || "Falha ao buscar os dados"} · Tentar de novo
            </Text>
          </TouchableOpacity>
        )}

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
              Total de comissões · {rotulo}
            </Text>
            <SecretText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 36, color: '#fff', letterSpacing: -1, lineHeight: 40, marginBottom: 12 }}>{fmtRes(resumo?.total ?? 0)}</SecretText>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 20, paddingVertical: 4, paddingHorizontal: 10 }}>
                <TrendingUp size={10} color="#6EE7B7" strokeWidth={2.5} />
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: '#6EE7B7' }}>
                  <SecretText>{fmtRes(resumo?.pago ?? 0)}</SecretText> recebido
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 20, paddingVertical: 4, paddingHorizontal: 10 }}>
                <Clock size={10} color="#FCD34D" strokeWidth={2.5} />
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: '#FCD34D' }}>
                  <SecretText>{fmtRes(resumo?.pendente ?? 0)}</SecretText> a receber
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
            { label: 'Atendimentos', value: numRes(resumo?.atendimentos ?? 0), color: C.primary },
            { label: 'Comissão média', value: fmtRes(resumo?.ticketMedio ?? 0), color: C.primary },
            { label: 'Já recebido', value: fmtRes(resumo?.pago ?? 0), color: C.green, pill: 'pago' },
            { label: 'Pendente', value: fmtRes(resumo?.pendente ?? 0), color: C.amber, pill: 'pendente' },
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
          tabs={FILTROS_COMISSAO}
          active={filtro}
          onChange={key => setFiltro(key as FiltroComissao)}
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
              {semNumero ? '—' : comissoes.length} {filtro === 'todas' ? 'comissões' : filtro === 'pendentes' ? 'pendentes' : 'pagas'}
            </Text>
          </View>

          {semNumero ? (isLoading && !erro ? <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>Carregando…</Text> : null) : comissoes.length === 0 ? (
            <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 24, alignItems: 'center' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                Nenhuma comissão neste período.
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
