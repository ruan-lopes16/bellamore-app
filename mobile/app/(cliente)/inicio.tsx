import { useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  RefreshControl, StatusBar, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import {
  Phone, MapPin, MessageCircle, Clock, Scissors,
} from 'lucide-react-native';
import {
  useFonts,
  CormorantGaramond_600SemiBold,
  CormorantGaramond_700Bold,
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
import { useClienteHomeStats, useServicosEmpresa } from '@/hooks/useCliente';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  rose: '#D4608A', roseSoft: '#FDF0F5',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const DIAS_SEMANA = [
  { key: 'dom', label: 'Domingo' },
  { key: 'seg', label: 'Segunda' },
  { key: 'ter', label: 'Terça' },
  { key: 'qua', label: 'Quarta' },
  { key: 'qui', label: 'Quinta' },
  { key: 'sex', label: 'Sexta' },
  { key: 'sab', label: 'Sábado' },
];

const AVATAR_COLORS: [string, string][] = [
  ['#7C3AED', '#A855F7'], ['#D4608A', '#F472B6'],
  ['#0D7E5F', '#34D399'], ['#B45309', '#F59E0B'],
  ['#1D4ED8', '#60A5FA'],
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
  return `há ${dias}d`;
}

function formatMembroDesde(data: string | null): string {
  if (!data) return '';
  return `Cliente desde ${format(new Date(data), "MMMM 'de' yyyy", { locale: ptBR })}`;
}

function diaHoje(): string {
  return DIAS_SEMANA[new Date().getDay()].key;
}

// ── Tela principal ───────────────────────────────────────────

export default function ClienteInicio() {
  const insets = useSafeAreaInsets();
  const { user, empresaAtiva } = useAuthStore();

  const { data: stats, isLoading, refetch } = useClienteHomeStats();
  const { data: servicos = [] } = useServicosEmpresa();

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    CormorantGaramond_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const onRefresh = useCallback(() => refetch(), [refetch]);

  if (!fontsLoaded) return null;

  const empresa = empresaAtiva;
  const horarios = empresa?.horario_funcionamento as
    Record<string, { inicio: string; fim: string }> | undefined;

  const [c1, c2] = avatarColors(user?.nome ?? '');
  const empresaIniciais = iniciaisNome(empresa?.nome ?? '');
  const hoje = diaHoje();

  function abrirTelefone() {
    if (empresa?.telefone) Linking.openURL(`tel:${empresa.telefone}`);
  }

  function abrirWhatsApp() {
    if (empresa?.telefone) {
      const num = empresa.telefone.replace(/\D/g, '');
      Linking.openURL(`https://wa.me/55${num}`);
    }
  }

  function abrirMapa() {
    if (empresa?.endereco) {
      const q = encodeURIComponent(empresa.endereco);
      Linking.openURL(`https://maps.google.com/?q=${q}`);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={onRefresh} tintColor="#fff" />
        }
      >
        {/* ── Hero empresa ── */}
        <LinearGradient
          colors={['#2C1654', '#3D1F72']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ paddingTop: insets.top + 16, paddingHorizontal: 24, paddingBottom: 28 }}
        >
          {/* Decoração */}
          <View style={{
            position: 'absolute', top: -80, right: -80,
            width: 220, height: 220, borderRadius: 110,
            backgroundColor: 'rgba(255,255,255,0.04)',
          }} />
          <View style={{
            position: 'absolute', bottom: -60, left: -40,
            width: 180, height: 180, borderRadius: 90,
            backgroundColor: 'rgba(255,255,255,0.03)',
          }} />

          {/* Logo */}
          <MotiView
            from={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'timing', duration: 400 }}
          >
            <View style={{
              width: 64, height: 64, borderRadius: 20,
              backgroundColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)',
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 14,
            }}>
              <Text style={{
                fontFamily: 'CormorantGaramond_700Bold',
                fontSize: 26, color: '#fff',
              }}>
                {empresaIniciais}
              </Text>
            </View>

            <Text style={{
              fontFamily: 'CormorantGaramond_600SemiBold',
              fontSize: 26, color: '#fff', marginBottom: 4,
            }}>
              {empresa?.nome}
            </Text>
            <Text style={{
              fontFamily: 'PlusJakartaSans_400Regular',
              fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 20,
            }}>
              {empresa?.endereco ?? 'Beleza que transforma'}
            </Text>
          </MotiView>

          {/* Ações rápidas */}
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 380, delay: 80 }}
            style={{ flexDirection: 'row', gap: 8 }}
          >
            {[
              { icon: <Phone size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />, label: 'Ligar', onPress: abrirTelefone },
              { icon: <MapPin size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />, label: 'Mapa', onPress: abrirMapa },
              { icon: <MessageCircle size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />, label: 'WhatsApp', onPress: abrirWhatsApp },
            ].map((a) => (
              <TouchableOpacity
                key={a.label}
                onPress={a.onPress}
                style={{
                  flex: 1, backgroundColor: 'rgba(255,255,255,0.1)',
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
                  borderRadius: 12, paddingVertical: 10,
                  alignItems: 'center', gap: 5,
                }}
              >
                {a.icon}
                <Text style={{
                  fontFamily: 'PlusJakartaSans_600SemiBold',
                  fontSize: 10, color: 'rgba(255,255,255,0.6)',
                  textTransform: 'uppercase', letterSpacing: 0.5,
                }}>
                  {a.label}
                </Text>
              </TouchableOpacity>
            ))}
          </MotiView>
        </LinearGradient>

        {/* ── Welcome card ── */}
        <MotiView
          from={{ opacity: 0, translateY: -10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 380, delay: 60 }}
          style={{ marginHorizontal: 24, marginTop: 16, marginBottom: 20 }}
        >
          <View style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 18, padding: 16,
            shadowColor: C.primary, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
          }}>
            {/* Avatar + saudação */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <LinearGradient
                colors={[c1, c2]}
                style={{
                  width: 44, height: 44, borderRadius: 14,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Text style={{
                  fontFamily: 'PlusJakartaSans_700Bold',
                  fontSize: 16, color: '#fff',
                }}>
                  {iniciaisNome(user?.nome ?? '')}
                </Text>
              </LinearGradient>
              <View>
                <Text style={{
                  fontFamily: 'PlusJakartaSans_600SemiBold',
                  fontSize: 16, color: C.text,
                }}>
                  Olá, {user?.nome?.split(' ')[0]}!
                </Text>
                <Text style={{
                  fontFamily: 'PlusJakartaSans_400Regular',
                  fontSize: 11, color: C.text3, marginTop: 1,
                }}>
                  {formatMembroDesde(stats?.membroDesde ?? null)}
                </Text>
              </View>
            </View>

            {/* Stats */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[
                { value: String(stats?.totalVisitas ?? 0), label: 'Visitas', color: C.primary },
                { value: formatUltimaVisita(stats?.ultimaVisita ?? null), label: 'Última visita', color: C.rose },
                { value: formatBRL(stats?.totalGasto ?? 0), label: 'Total gasto', color: C.green },
              ].map((s) => (
                <View key={s.label} style={{
                  flex: 1, backgroundColor: C.bg,
                  borderRadius: 10, padding: 10, alignItems: 'center',
                }}>
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_700Bold',
                    fontSize: 18, color: s.color,
                    letterSpacing: -0.5, lineHeight: 20, marginBottom: 3,
                  }}>
                    {s.value}
                  </Text>
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_500Medium',
                    fontSize: 9, color: C.text3,
                    textTransform: 'uppercase', letterSpacing: 0.8,
                  }}>
                    {s.label}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </MotiView>

        {/* ── Informações ── */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 350, delay: 100 }}
        >
          <Text style={{
            fontFamily: 'CormorantGaramond_600SemiBold',
            fontSize: 18, color: C.text,
            paddingHorizontal: 24, marginBottom: 10,
          }}>
            Informações
          </Text>

          <View style={{
            marginHorizontal: 24, marginBottom: 20,
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 18, overflow: 'hidden',
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
          }}>
            {[
              empresa?.endereco && {
                iconBg: C.primarySoft, iconColor: C.primary,
                icon: <MapPin size={13} color={C.primary} strokeWidth={2} />,
                label: 'Endereço', value: empresa.endereco,
              },
              empresa?.telefone && {
                iconBg: C.greenSoft, iconColor: C.green,
                icon: <Phone size={13} color={C.green} strokeWidth={2} />,
                label: 'Telefone', value: empresa.telefone,
              },
            ].filter(Boolean).map((item: any, i, arr) => (
              <View
                key={item.label}
                style={{
                  paddingVertical: 11, paddingHorizontal: 16,
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  borderBottomWidth: i < arr.length - 1 ? 1 : 0,
                  borderBottomColor: C.border,
                }}
              >
                <View style={{
                  width: 28, height: 28, borderRadius: 8,
                  backgroundColor: item.iconBg,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {item.icon}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_500Medium',
                    fontSize: 10, color: C.text3, marginBottom: 1,
                  }}>
                    {item.label}
                  </Text>
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_600SemiBold',
                    fontSize: 13, color: C.text,
                  }}>
                    {item.value}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </MotiView>

        {/* ── Horários ── */}
        {horarios && (
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 350, delay: 130 }}
          >
            <Text style={{
              fontFamily: 'CormorantGaramond_600SemiBold',
              fontSize: 18, color: C.text,
              paddingHorizontal: 24, marginBottom: 10,
            }}>
              Horários
            </Text>

            <View style={{
              marginHorizontal: 24, marginBottom: 20,
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 18, overflow: 'hidden',
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              {DIAS_SEMANA.map((dia, i) => {
                const h = horarios[dia.key];
                const isHoje = dia.key === hoje;
                return (
                  <View
                    key={dia.key}
                    style={{
                      paddingVertical: 10, paddingHorizontal: 16,
                      flexDirection: 'row', justifyContent: 'space-between',
                      alignItems: 'center',
                      borderBottomWidth: i < DIAS_SEMANA.length - 1 ? 1 : 0,
                      borderBottomColor: C.border,
                      backgroundColor: isHoje ? C.primarySoft : 'transparent',
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{
                        fontFamily: 'PlusJakartaSans_600SemiBold',
                        fontSize: 12, color: isHoje ? C.primary : C.text,
                      }}>
                        {dia.label}
                      </Text>
                      {isHoje && (
                        <View style={{
                          backgroundColor: C.primary, borderRadius: 6,
                          paddingHorizontal: 7, paddingVertical: 2,
                        }}>
                          <Text style={{
                            fontFamily: 'PlusJakartaSans_700Bold',
                            fontSize: 8, color: '#fff',
                            textTransform: 'uppercase', letterSpacing: 0.3,
                          }}>
                            Hoje
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_500Medium',
                      fontSize: 12,
                      color: !h ? C.text4 : isHoje ? C.green : C.text3,
                    }}>
                      {h ? `${h.inicio} – ${h.fim}` : 'Fechado'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </MotiView>
        )}

        {/* ── Serviços ── */}
        {servicos.length > 0 && (
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 350, delay: 160 }}
          >
            <Text style={{
              fontFamily: 'CormorantGaramond_600SemiBold',
              fontSize: 18, color: C.text,
              paddingHorizontal: 24, marginBottom: 10,
            }}>
              Serviços
            </Text>

            <View style={{
              marginHorizontal: 24,
              flexDirection: 'row', flexWrap: 'wrap', gap: 8,
            }}>
              {servicos.map((s) => (
                <View
                  key={s.id}
                  style={{
                    width: '47.5%',
                    backgroundColor: C.surface,
                    borderWidth: 1, borderColor: C.border,
                    borderRadius: 14, padding: 14,
                    shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
                  }}
                >
                  {/* Categoria */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                    <View style={{
                      width: 7, height: 7, borderRadius: 4,
                      backgroundColor: s.categoriaCor,
                    }} />
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_700Bold',
                      fontSize: 9, color: s.categoriaCor,
                      textTransform: 'uppercase', letterSpacing: 0.5,
                    }}>
                      {s.categoria ?? 'Serviço'}
                    </Text>
                  </View>

                  {/* Nome */}
                  <Text
                    numberOfLines={2}
                    style={{
                      fontFamily: 'PlusJakartaSans_600SemiBold',
                      fontSize: 12, color: C.text,
                      lineHeight: 16, marginBottom: 4,
                    }}
                  >
                    {s.nome}
                  </Text>

                  {/* Duração */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 6 }}>
                    <Clock size={10} color={C.text4} strokeWidth={2} />
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_400Regular',
                      fontSize: 10, color: C.text3,
                    }}>
                      {s.duracao_minutos} min
                    </Text>
                  </View>

                  {/* Preço */}
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_700Bold',
                    fontSize: 13, color: C.primary,
                  }}>
                    {formatBRL(s.preco)}
                  </Text>
                </View>
              ))}
            </View>
          </MotiView>
        )}
      </ScrollView>
    </View>
  );
}
