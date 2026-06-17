import { useCallback } from 'react';
import {
  View, Text, ScrollView,
  RefreshControl, StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { CheckCircle, Calendar } from 'lucide-react-native';
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
import { format, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { useAuthStore } from '@/stores/authStore';
import { useHistoricoCliente, type HistoricoItem } from '@/hooks/useCliente';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  rose: '#D4608A', roseSoft: '#FDF0F5',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const AVATAR_COLORS: [string, string][] = [
  ['#7C3AED', '#A855F7'], ['#D4608A', '#F472B6'],
  ['#0D7E5F', '#34D399'], ['#B45309', '#F59E0B'],
  ['#1D4ED8', '#60A5FA'], ['#7C2D12', '#EA580C'],
];

// ── Helpers ──────────────────────────────────────────────────

function avatarColors(nome: string): [string, string] {
  return AVATAR_COLORS[(nome?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length];
}

function iniciaisNome(nome: string) {
  return (nome ?? '').split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}

function formatBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function formatUltimaVisita(data: string | null): string {
  if (!data) return '—';
  const dias = differenceInDays(new Date(), new Date(data));
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  return `há ${Math.floor(dias / 30)} meses`;
}

function formatMembroDesde(data: string | null): string {
  if (!data) return '';
  return `desde ${format(new Date(data), "MMM/yyyy", { locale: ptBR })}`;
}

// ── Item do histórico ────────────────────────────────────────

function HistoricoCard({ item, index }: { item: HistoricoItem; index: number }) {
  const data = new Date(item.data_hora_inicio);
  const [c1, c2] = avatarColors(item.profissional.nome);

  return (
    <MotiView
      from={{ opacity: 0, translateX: 8 }}
      animate={{ opacity: 1, translateX: 0 }}
      transition={{ type: 'timing', duration: 280, delay: index * 40 }}
      style={{ flexDirection: 'row', gap: 12, marginBottom: 10 }}
    >
      {/* Data */}
      <View style={{ minWidth: 32, alignItems: 'center' }}>
        <Text style={{
          fontFamily: 'PlusJakartaSans_700Bold',
          fontSize: 16, color: C.text, lineHeight: 18,
        }}>
          {format(data, 'dd')}
        </Text>
        <Text style={{
          fontFamily: 'PlusJakartaSans_400Regular',
          fontSize: 9, color: C.text3,
          textTransform: 'uppercase', letterSpacing: 0.5,
        }}>
          {format(data, 'MMM', { locale: ptBR })}
        </Text>
      </View>

      {/* Dot da categoria */}
      <View style={{ alignItems: 'center', paddingTop: 3 }}>
        <View style={{
          width: 10, height: 10, borderRadius: 5,
          backgroundColor: item.categoriaCor,
          borderWidth: 2, borderColor: C.surface,
        }} />
      </View>

      {/* Card */}
      <View style={{
        flex: 1,
        backgroundColor: C.surface,
        borderWidth: 1, borderColor: C.border,
        borderRadius: 14, padding: 12,
        shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
      }}>
        {/* Serviço */}
        <Text style={{
          fontFamily: 'PlusJakartaSans_600SemiBold',
          fontSize: 13, color: C.text, marginBottom: 3,
        }}>
          {item.servico.nome}
        </Text>

        {/* Profissional */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 }}>
          <LinearGradient
            colors={[c1, c2]}
            style={{
              width: 16, height: 16, borderRadius: 5,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{
              fontFamily: 'PlusJakartaSans_700Bold',
              fontSize: 7, color: '#fff',
            }}>
              {iniciaisNome(item.profissional.nome)}
            </Text>
          </LinearGradient>
          <Text style={{
            fontFamily: 'PlusJakartaSans_400Regular',
            fontSize: 11, color: C.text3,
          }}>
            {item.profissional.nome}
          </Text>
        </View>

        {/* Footer: categoria + valor */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{
              width: 7, height: 7, borderRadius: 4,
              backgroundColor: item.categoriaCor,
            }} />
            <Text style={{
              fontFamily: 'PlusJakartaSans_700Bold',
              fontSize: 9, color: item.categoriaCor,
              textTransform: 'uppercase', letterSpacing: 0.4,
            }}>
              {item.servico.categoria ?? 'Serviço'}
            </Text>
          </View>
          <Text style={{
            fontFamily: 'PlusJakartaSans_700Bold',
            fontSize: 13, color: C.text,
          }}>
            {formatBRL(item.valor)}
          </Text>
        </View>
      </View>
    </MotiView>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function ClienteHistorico() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();

  const { data: historico, isLoading, refetch } = useHistoricoCliente();

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const onRefresh = useCallback(() => refetch(), [refetch]);

  if (!fontsLoaded) return null;

  const semHistorico = !isLoading && (historico?.totalVisitas ?? 0) === 0;

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
          style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 16 }}
        >
          <Text style={{
            fontFamily: 'PlusJakartaSans_500Medium',
            fontSize: 11, color: C.text3,
            letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4,
          }}>
            {user?.nome}
          </Text>
          <Text style={{
            fontFamily: 'CormorantGaramond_600SemiBold',
            fontSize: 26, color: C.text,
          }}>
            Meu Histórico
          </Text>
        </MotiView>

        {semHistorico ? (
          /* ── Estado vazio ── */
          <MotiView
            from={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'timing', duration: 350 }}
            style={{
              marginHorizontal: 24, marginTop: 40,
              backgroundColor: C.surface,
              borderWidth: 1, borderColor: C.border,
              borderRadius: 20, padding: 36,
              alignItems: 'center', gap: 12,
            }}
          >
            <Calendar size={36} color={C.text4} strokeWidth={1.5} />
            <Text style={{
              fontFamily: 'CormorantGaramond_600SemiBold',
              fontSize: 20, color: C.text,
            }}>
              Nenhum atendimento
            </Text>
            <Text style={{
              fontFamily: 'PlusJakartaSans_400Regular',
              fontSize: 13, color: C.text3, textAlign: 'center',
            }}>
              Seu histórico aparecerá aqui após o primeiro atendimento.
            </Text>
          </MotiView>
        ) : (
          <>
            {/* ── Card total ── */}
            <MotiView
              from={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'timing', duration: 400, delay: 60 }}
              style={{ marginHorizontal: 24, marginBottom: 12 }}
            >
              <LinearGradient
                colors={['#2C1654', '#3D1F72']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{
                  borderRadius: 20, padding: 20,
                  shadowColor: '#1A0A3C', shadowOpacity: 0.2,
                  shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8,
                }}
              >
                <Text style={{
                  fontFamily: 'PlusJakartaSans_500Medium',
                  fontSize: 10, color: 'rgba(255,255,255,0.5)',
                  letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6,
                }}>
                  Total investido · {/* empresa nome */}
                </Text>
                <Text style={{
                  fontFamily: 'PlusJakartaSans_700Bold',
                  fontSize: 34, color: '#fff',
                  letterSpacing: -1, lineHeight: 38, marginBottom: 12,
                }}>
                  {formatBRL(historico?.totalGasto ?? 0)}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {[
                    { icon: <CheckCircle size={10} color="rgba(255,255,255,0.7)" strokeWidth={2.5} />, label: `${historico?.totalVisitas ?? 0} visitas` },
                    { icon: <Calendar size={10} color="rgba(255,255,255,0.7)" strokeWidth={2.5} />, label: formatMembroDesde(historico?.membroDesde ?? null) },
                  ].map((p) => (
                    <View key={p.label} style={{
                      flexDirection: 'row', alignItems: 'center', gap: 4,
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
                      borderRadius: 20, paddingVertical: 4, paddingHorizontal: 10,
                    }}>
                      {p.icon}
                      <Text style={{
                        fontFamily: 'PlusJakartaSans_600SemiBold',
                        fontSize: 11, color: 'rgba(255,255,255,0.7)',
                      }}>
                        {p.label}
                      </Text>
                    </View>
                  ))}
                </View>
              </LinearGradient>
            </MotiView>

            {/* ── KPIs ── */}
            <MotiView
              from={{ opacity: 0, translateY: 6 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 350, delay: 100 }}
              style={{ marginHorizontal: 24, marginBottom: 20, flexDirection: 'row', gap: 8 }}
            >
              {[
                { value: String(historico?.totalVisitas ?? 0), label: 'Visitas', color: C.primary },
                { value: formatUltimaVisita(historico?.ultimaVisita ?? null), label: 'Última visita', color: C.rose },
                { value: formatBRL(historico?.ticketMedio ?? 0), label: 'Ticket médio', color: C.green },
              ].map((k) => (
                <View key={k.label} style={{
                  flex: 1, backgroundColor: C.surface,
                  borderWidth: 1, borderColor: C.border,
                  borderRadius: 14, padding: 12,
                  shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
                  alignItems: 'center',
                }}>
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_700Bold',
                    fontSize: k.value.length > 6 ? 14 : 20,
                    color: k.color, letterSpacing: -0.5,
                    lineHeight: 22, marginBottom: 3,
                  }}>
                    {k.value}
                  </Text>
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_500Medium',
                    fontSize: 9, color: C.text3,
                    textTransform: 'uppercase', letterSpacing: 0.8,
                    textAlign: 'center',
                  }}>
                    {k.label}
                  </Text>
                </View>
              ))}
            </MotiView>

            {/* ── Timeline por mês ── */}
            <View style={{ paddingHorizontal: 24 }}>
              {(historico?.meses ?? []).map((mes, mi) => (
                <MotiView
                  key={mes.mesLabel}
                  from={{ opacity: 0, translateY: 8 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: 'timing', duration: 320, delay: 140 + mi * 60 }}
                >
                  {/* Label do mês */}
                  <Text style={{
                    fontFamily: 'CormorantGaramond_600SemiBold',
                    fontSize: 16, color: C.text2,
                    marginBottom: 10,
                    paddingLeft: 44,
                    marginTop: mi > 0 ? 8 : 0,
                  }}>
                    {mes.mesLabel}
                  </Text>

                  {/* Linha vertical do mês */}
                  <View style={{ position: 'relative' }}>
                    <View style={{
                      position: 'absolute',
                      left: 31, top: 0, bottom: 0,
                      width: 1.5,
                      backgroundColor: C.border,
                    }} />
                    {mes.itens.map((item, i) => (
                      <HistoricoCard key={item.id} item={item} index={i} />
                    ))}
                  </View>
                </MotiView>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
