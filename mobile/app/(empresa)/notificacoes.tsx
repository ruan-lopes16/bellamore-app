import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  RefreshControl, StatusBar,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import {
  ChevronLeft, CalendarCheck2, Percent, CircleCheck,
  TriangleAlert, CalendarX, UserRoundX, Bell,
} from 'lucide-react-native';
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

import { useNotificacoes, type Notificacao, type NotifTipo } from '@/hooks/useNotificacoes';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  red: '#C0392B', redSoft: '#FEF2F2',
  amber: '#B45309', amberSoft: '#FEF3E2',
  indigo: '#4F46E5', indigoSoft: '#EEF2FF',
  rose: '#D4608A', roseSoft: '#FDF0F5',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

// ── Config de ícone por tipo ──────────────────────────────────

const TIPO_CONFIG: Record<NotifTipo, {
  icon: React.ReactNode; bg: string;
}> = {
  agendamento: {
    icon: <CalendarCheck2 size={15} color={C.primary} strokeWidth={1.8} />,
    bg: C.primarySoft,
  },
  comissao: {
    icon: <Percent size={15} color={C.amber} strokeWidth={1.8} />,
    bg: C.amberSoft,
  },
  pagamento: {
    icon: <CircleCheck size={15} color={C.green} strokeWidth={1.8} />,
    bg: C.greenSoft,
  },
  estoque_baixo: {
    icon: <TriangleAlert size={15} color={C.red} strokeWidth={1.8} />,
    bg: C.redSoft,
  },
  cliente_sumido: {
    icon: <UserRoundX size={15} color={C.indigo} strokeWidth={1.8} />,
    bg: C.indigoSoft,
  },
};

// ── Helpers ──────────────────────────────────────────────────

function agruparPorData(notifs: Notificacao[]): { grupo: string; items: Notificacao[] }[] {
  const hoje     = new Date(); hoje.setHours(0,0,0,0);
  const ontem    = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
  const semana   = new Date(hoje); semana.setDate(semana.getDate() - 7);

  const grupos: Record<string, Notificacao[]> = {};

  notifs.forEach((n) => {
    const d = new Date(n.created_at); d.setHours(0,0,0,0);
    let grupo: string;
    if (d >= hoje)       grupo = 'Hoje';
    else if (d >= ontem) grupo = 'Ontem';
    else if (d >= semana) grupo = 'Esta semana';
    else                 grupo = 'Mais antigas';

    if (!grupos[grupo]) grupos[grupo] = [];
    grupos[grupo].push(n);
  });

  const ordem = ['Hoje', 'Ontem', 'Esta semana', 'Mais antigas'];
  return ordem.filter((g) => grupos[g]).map((g) => ({ grupo: g, items: grupos[g] }));
}

// ── Card de notificação ───────────────────────────────────────

function NotifRow({
  item, isLast, onPress,
}: {
  item: Notificacao;
  isLast: boolean;
  onPress: () => void;
}) {
  const cfg = TIPO_CONFIG[item.tipo] ?? TIPO_CONFIG.agendamento;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={item.lida ? 1 : 0.7}
      style={{
        flexDirection: 'row', alignItems: 'flex-start', gap: 12,
        paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: isLast ? 0 : 1, borderBottomColor: C.border,
        backgroundColor: item.lida ? C.surface : '#FDFBFF',
        borderLeftWidth: item.lida ? 0 : 3,
        borderLeftColor: C.accent,
        opacity: item.lida ? 0.75 : 1,
      }}
    >
      {/* Ícone */}
      <View style={{
        width: 38, height: 38, borderRadius: 12,
        backgroundColor: cfg.bg,
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {cfg.icon}
      </View>

      {/* Corpo */}
      <View style={{ flex: 1 }}>
        <Text style={{
          fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13,
          color: C.text, marginBottom: 3,
        }}>
          {item.titulo}
        </Text>
        <Text style={{
          fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12,
          color: C.text3, lineHeight: 17, marginBottom: 6,
        }}>
          {item.mensagem}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {!item.lida && (
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.accent }} />
          )}
          <Text style={{
            fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text4,
          }}>
            {item.tempoRelativo}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function Notificacoes() {
  const insets = useSafeAreaInsets();
  const [filtro, setFiltro] = useState<'todas' | 'nao-lidas'>('todas');

  const { notificacoes, naoLidas, countNaoLidas, isLoading, refetch, marcarLida, marcarTodasLidas } = useNotificacoes();

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const onRefresh = useCallback(() => refetch(), [refetch]);

  if (!fontsLoaded) return null;

  const lista  = filtro === 'nao-lidas' ? naoLidas : notificacoes;
  const grupos = agruparPorData(lista);

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
          from={{ opacity: 0, translateY: -6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 350 }}
          style={{
            paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 16,
            flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
          }}
        >
          <View>
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
              Central de
            </Text>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: C.text }}>
              Notificações
            </Text>
          </View>

          <View style={{ alignItems: 'flex-end', gap: 6, paddingTop: 4 }}>
            {countNaoLidas > 0 && (
              <View style={{ backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: '#fff' }}>
                  {countNaoLidas} {countNaoLidas === 1 ? 'nova' : 'novas'}
                </Text>
              </View>
            )}
            {countNaoLidas > 0 && (
              <TouchableOpacity onPress={marcarTodasLidas}>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.accent }}>
                  Marcar todas como lidas
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </MotiView>

        {/* ── Filtros ── */}
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 350, delay: 60 }}
          style={{ flexDirection: 'row', gap: 6, marginHorizontal: 24, marginBottom: 16 }}
        >
          {(['todas', 'nao-lidas'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFiltro(f)}
              style={{
                paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
                backgroundColor: filtro === f ? C.primary : C.surface,
                borderWidth: 1, borderColor: filtro === f ? C.primary : C.border,
              }}
            >
              <Text style={{
                fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12,
                color: filtro === f ? '#fff' : C.text3,
              }}>
                {f === 'todas' ? 'Todas' : 'Não lidas'}
              </Text>
            </TouchableOpacity>
          ))}
        </MotiView>

        {/* ── Lista ── */}
        {grupos.length === 0 ? (
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 400 }}
            style={{ alignItems: 'center', paddingTop: 80, paddingHorizontal: 24 }}
          >
            <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Bell size={28} color={C.text4} strokeWidth={1.5} />
            </View>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 20, color: C.text3, marginBottom: 6 }}>
              Tudo em dia
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text4, textAlign: 'center', lineHeight: 18 }}>
              Nenhuma notificação{filtro === 'nao-lidas' ? ' não lida' : ''} no momento.
            </Text>
          </MotiView>
        ) : (
          grupos.map(({ grupo, items }, gi) => (
            <MotiView
              key={grupo}
              from={{ opacity: 0, translateY: 6 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 380, delay: gi * 60 }}
            >
              {/* Label do grupo */}
              <Text style={{
                fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10,
                color: C.text3, textTransform: 'uppercase', letterSpacing: 1.5,
                marginLeft: 24, marginTop: gi > 0 ? 8 : 0, marginBottom: 8,
              }}>
                {grupo}
              </Text>

              {/* Card agrupado */}
              <View style={{
                backgroundColor: C.surface,
                borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border,
              }}>
                {items.map((item, i) => (
                  <NotifRow
                    key={item.id}
                    item={item}
                    isLast={i === items.length - 1}
                    onPress={() => {
                      if (!item.lida) marcarLida(item.id);
                    }}
                  />
                ))}
              </View>
            </MotiView>
          ))
        )}
      </ScrollView>
    </View>
  );
}
