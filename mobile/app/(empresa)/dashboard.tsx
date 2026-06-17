import { useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  RefreshControl, StatusBar, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import {
  Bell, Calendar, FileText, User, DollarSign,
  TrendingUp, AlertTriangle, ChevronRight,
  Home, BarChart2, Users, MoreHorizontal,
} from 'lucide-react-native';
import {
  useFonts,
  CormorantGaramond_400Regular,
  CormorantGaramond_600SemiBold,
  CormorantGaramond_700Bold,
} from '@expo-google-fonts/cormorant-garamond';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { useAuthStore } from '@/stores/authStore';
import { useDashboard } from '@/hooks/useDashboard';
import { useNotificacoes } from '@/hooks/useNotificacoes';
import { temPermissao } from '@/lib/permissions';
import TiltCard from '@/components/TiltCard';

// ── Helpers ─────────────────────────────────────────────────

function formatBRL(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function iniciaisNome(nome: string) {
  return nome
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
}

const AVATAR_COLORS = [
  ['#7C3AED', '#A855F7'],
  ['#B45309', '#D97706'],
  ['#065F46', '#10B981'],
  ['#9D174D', '#EC4899'],
  ['#1D4ED8', '#60A5FA'],
  ['#7C2D12', '#EA580C'],
];

function avatarColors(nome: string): [string, string] {
  const idx = nome.charCodeAt(0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx] as [string, string];
}

const STATUS_CONFIG = {
  agendado:   { label: 'Agendado',   bg: '#F3EFFE', text: '#7C3AED' },
  confirmado: { label: 'Confirmado', bg: '#EAFAF5', text: '#0D7E5F' },
  concluido:  { label: 'Concluído',  bg: '#EAFAF5', text: '#0D7E5F' },
  cancelado:  { label: 'Cancelado',  bg: '#FEF2F2', text: '#DC2626' },
  faltou:     { label: 'Faltou',     bg: '#FEF3E2', text: '#B45309' },
};

// ── Constantes de cor ────────────────────────────────────────

const C = {
  bg:          '#F4F1EE',
  surface:     '#FFFFFF',
  border:      '#E8E2DC',
  primary:     '#2C1654',
  primarySoft: '#EEE8F8',
  accent:      '#9B6FE8',
  text:        '#1A1228',
  text2:       '#4A3F5C',
  text3:       '#8878A6',
  text4:       '#B8AECC',
  green:       '#0D7E5F',
  greenSoft:   '#EAFAF5',
  amber:       '#B45309',
  amberSoft:   '#FEF3E2',
  rose:        '#D4608A',
  roseSoft:    '#FDF0F5',
};

// ── Componente principal ─────────────────────────────────────

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const { user, empresaAtiva, isOwner, roleAtivo } = useAuthStore();
  const role = isOwner ? 'owner' : (roleAtivo ?? 'gestor');

  const {
    agendamentosHoje,
    receitaHoje,
    receitaMes,
    comissoesPendentes,
    estoqueBaixo,
    isLoading,
    refetch,
  } = useDashboard();

  const { countNaoLidas: countNotifNaoLidas } = useNotificacoes();

  const [fontsLoaded] = useFonts({
    CormorantGaramond_400Regular,
    CormorantGaramond_600SemiBold,
    CormorantGaramond_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const hoje = new Date();
  const dataFormatada = format(hoje, "EEEE',' d 'de' MMMM", { locale: ptBR });
  const dataCapitalizada = dataFormatada.charAt(0).toUpperCase() + dataFormatada.slice(1);

  const onRefresh = useCallback(() => { refetch(); }, [refetch]);

  if (!fontsLoaded) return null;

  // ── RENDER ──────────────────────────────────────────────────
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
          transition={{ type: 'timing', duration: 400 }}
          style={{
            paddingTop: insets.top + 12,
            paddingHorizontal: 24,
            paddingBottom: 16,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <View>
            <Text style={{
              fontFamily: 'PlusJakartaSans_500Medium',
              fontSize: 11,
              color: C.text3,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              marginBottom: 4,
            }}>
              Bom dia
            </Text>
            <Text style={{
              fontFamily: 'CormorantGaramond_600SemiBold',
              fontSize: 28,
              color: C.text,
              lineHeight: 32,
            }}>
              {user?.nome?.split(' ')[0] ?? 'Olá'}
            </Text>
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              marginTop: 6,
              backgroundColor: C.primarySoft,
              borderWidth: 1,
              borderColor: 'rgba(44,22,84,0.1)',
              borderRadius: 20,
              paddingVertical: 3,
              paddingHorizontal: 10,
              alignSelf: 'flex-start',
            }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent }} />
              <Text style={{
                fontFamily: 'PlusJakartaSans_500Medium',
                fontSize: 11,
                color: C.primary,
              }}>
                {empresaAtiva?.nome ?? 'Meu Estúdio'}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 8, paddingTop: 4 }}>
            <TouchableOpacity
              onPress={() => router.push('/(empresa)/notificacoes' as any)}
              style={{
                width: 38, height: 38,
                borderRadius: 12,
                backgroundColor: C.surface,
                borderWidth: 1,
                borderColor: C.border,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Bell size={16} color={C.text2} strokeWidth={1.8} />
              {/* Badge de notificação — count de não lidas */}
              {countNotifNaoLidas > 0 && (
                <View style={{
                  position: 'absolute',
                  top: -4, right: -4,
                  minWidth: 16, height: 16,
                  borderRadius: 8,
                  backgroundColor: C.rose,
                  borderWidth: 1.5,
                  borderColor: C.bg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 3,
                }}>
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_700Bold',
                    fontSize: 9, color: '#fff', lineHeight: 11,
                  }}>
                    {countNotifNaoLidas > 9 ? '9+' : countNotifNaoLidas}
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push('/(empresa)/configuracoes' as any)}
              style={{
                width: 38, height: 38,
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              <LinearGradient
                colors={[C.primary, '#5B2D99']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{
                  fontFamily: 'PlusJakartaSans_700Bold',
                  fontSize: 13,
                  color: '#fff',
                }}>
                  {iniciaisNome(user?.nome ?? 'U')}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </MotiView>

        {/* ── Pílula de data ── */}
        <MotiView
          from={{ opacity: 0, translateY: -4 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400, delay: 60 }}
          style={{ marginHorizontal: 24, marginBottom: 16 }}
        >
          <TouchableOpacity
            onPress={() => router.push('/(empresa)/agenda' as any)}
            style={{
              backgroundColor: C.surface,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: 14,
              padding: 12,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              shadowColor: C.primary,
              shadowOpacity: 0.05,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 2 },
              elevation: 2,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{
                width: 30, height: 30,
                backgroundColor: C.primarySoft,
                borderRadius: 8,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Calendar size={14} color={C.primary} strokeWidth={2} />
              </View>
              <View>
                <Text style={{
                  fontFamily: 'PlusJakartaSans_600SemiBold',
                  fontSize: 13,
                  color: C.text,
                }}>
                  {dataCapitalizada}
                </Text>
                <Text style={{
                  fontFamily: 'PlusJakartaSans_400Regular',
                  fontSize: 11,
                  color: C.text3,
                  marginTop: 1,
                }}>
                  {agendamentosHoje.length} atendimentos hoje
                </Text>
              </View>
            </View>
            <Text style={{
              fontFamily: 'PlusJakartaSans_600SemiBold',
              fontSize: 11,
              color: C.accent,
            }}>
              Ver agenda
            </Text>
          </TouchableOpacity>
        </MotiView>

        {/* ── Card hero receita ── */}
        {temPermissao(role, 'ver_resumo_financeiro') && (
          <MotiView
            from={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'timing', duration: 450, delay: 100 }}
            style={{ marginHorizontal: 24, marginBottom: 12 }}
          >
            <TiltCard>
            <TouchableOpacity
              onPress={() => router.push('/(empresa)/financeiro' as any)}
              activeOpacity={0.92}
            >
              <LinearGradient
                colors={['#2C1654', '#3D1F72']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  borderRadius: 20,
                  padding: 22,
                  overflow: 'hidden',
                  shadowColor: '#1A0A3C',
                  shadowOpacity: 0.25,
                  shadowRadius: 16,
                  shadowOffset: { width: 0, height: 6 },
                  elevation: 8,
                }}
              >
                <Text style={{
                  fontFamily: 'PlusJakartaSans_500Medium',
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.5)',
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}>
                  Receita do Mês · {format(hoje, 'MMMM yyyy', { locale: ptBR }).replace(/^\w/, c => c.toUpperCase())}
                </Text>

                <Text style={{
                  fontFamily: 'PlusJakartaSans_700Bold',
                  fontSize: 44,
                  color: '#fff',
                  lineHeight: 48,
                  letterSpacing: -1,
                  marginBottom: 10,
                }}>
                  {formatBRL(receitaMes)}
                </Text>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.08)',
                    borderRadius: 20,
                    paddingVertical: 4,
                    paddingHorizontal: 10,
                  }}>
                    <TrendingUp size={10} color="#A8F0D4" strokeWidth={2.5} />
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_700Bold',
                      fontSize: 11,
                      color: '#A8F0D4',
                    }}>
                      +12% vs mês anterior
                    </Text>
                  </View>
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_400Regular',
                    fontSize: 11,
                    color: 'rgba(255,255,255,0.35)',
                  }}>
                    Toque para detalhes
                  </Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
            </TiltCard>
          </MotiView>
        )}

        {/* ── KPIs mini ── */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400, delay: 160 }}
          style={{
            marginHorizontal: 24,
            marginBottom: 20,
            flexDirection: 'row',
            gap: 8,
          }}
        >
          {/* Agendamentos hoje */}
          <View style={{
            flex: 1,
            backgroundColor: C.surface,
            borderWidth: 1,
            borderColor: C.border,
            borderRadius: 16,
            padding: 14,
            shadowColor: C.primary,
            shadowOpacity: 0.04,
            shadowRadius: 6,
            elevation: 1,
          }}>
            <Text style={{
              fontFamily: 'PlusJakartaSans_500Medium',
              fontSize: 9,
              color: C.text3,
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: 8,
            }}>
              Hoje
            </Text>
            <Text style={{
              fontFamily: 'PlusJakartaSans_700Bold',
              fontSize: 28,
              color: C.text,
              lineHeight: 30,
              marginBottom: 4,
            }}>
              {agendamentosHoje.length}
            </Text>
            <Text style={{
              fontFamily: 'PlusJakartaSans_400Regular',
              fontSize: 10,
              color: C.text3,
            }}>
              agendamentos
            </Text>
          </View>

          {/* Receita hoje */}
          <View style={{
            flex: 1,
            backgroundColor: C.surface,
            borderWidth: 1,
            borderColor: C.border,
            borderRadius: 16,
            padding: 14,
            shadowColor: C.primary,
            shadowOpacity: 0.04,
            shadowRadius: 6,
            elevation: 1,
          }}>
            <Text style={{
              fontFamily: 'PlusJakartaSans_500Medium',
              fontSize: 9,
              color: C.text3,
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: 8,
            }}>
              Receita Hoje
            </Text>
            <Text style={{
              fontFamily: 'PlusJakartaSans_700Bold',
              fontSize: 20,
              color: C.green,
              lineHeight: 22,
              marginBottom: 4,
            }}>
              {formatBRL(receitaHoje)}
            </Text>
            <View style={{
              backgroundColor: C.greenSoft,
              borderRadius: 6,
              paddingHorizontal: 6,
              paddingVertical: 2,
              alignSelf: 'flex-start',
            }}>
              <Text style={{
                fontFamily: 'PlusJakartaSans_700Bold',
                fontSize: 9,
                color: C.green,
              }}>
                confirmada
              </Text>
            </View>
          </View>

          {/* Comissões pendentes */}
          <View style={{
            flex: 1,
            backgroundColor: C.surface,
            borderWidth: 1,
            borderColor: C.border,
            borderRadius: 16,
            padding: 14,
            shadowColor: C.primary,
            shadowOpacity: 0.04,
            shadowRadius: 6,
            elevation: 1,
          }}>
            <Text style={{
              fontFamily: 'PlusJakartaSans_500Medium',
              fontSize: 9,
              color: C.text3,
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: 8,
            }}>
              Comissões
            </Text>
            <Text style={{
              fontFamily: 'PlusJakartaSans_700Bold',
              fontSize: 20,
              color: C.amber,
              lineHeight: 22,
              marginBottom: 4,
            }}>
              {formatBRL(comissoesPendentes.total)}
            </Text>
            <View style={{
              backgroundColor: C.amberSoft,
              borderRadius: 6,
              paddingHorizontal: 6,
              paddingVertical: 2,
              alignSelf: 'flex-start',
            }}>
              <Text style={{
                fontFamily: 'PlusJakartaSans_700Bold',
                fontSize: 9,
                color: C.amber,
              }}>
                pendente
              </Text>
            </View>
          </View>
        </MotiView>

        {/* ── Ações rápidas ── */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400, delay: 200 }}
        >
          <Text style={{
            fontFamily: 'PlusJakartaSans_600SemiBold',
            fontSize: 11,
            color: C.text3,
            textTransform: 'uppercase',
            letterSpacing: 1.5,
            marginHorizontal: 24,
            marginBottom: 10,
          }}>
            Ações rápidas
          </Text>

          <View style={{
            marginHorizontal: 24,
            flexDirection: 'row',
            gap: 8,
            marginBottom: 20,
          }}>
            {[
              { icon: Calendar, label: 'Agendar', bg: C.primarySoft, color: C.primary, route: '/(empresa)/novo-agendamento' },
              { icon: FileText, label: 'Comanda', bg: C.roseSoft, color: C.rose, route: '/(empresa)/nova-comanda' },
              { icon: User, label: 'Cliente', bg: C.greenSoft, color: C.green, route: '/(empresa)/novo-cliente' },
              { icon: DollarSign, label: 'Despesa', bg: C.amberSoft, color: C.amber, route: '/(empresa)/nova-despesa' },
            ].map(({ icon: Icon, label, bg, color, route }) => (
              <TouchableOpacity
                key={label}
                onPress={() => router.push(route as any)}
                style={{
                  flex: 1,
                  backgroundColor: C.surface,
                  borderWidth: 1,
                  borderColor: C.border,
                  borderRadius: 14,
                  paddingVertical: 14,
                  paddingHorizontal: 6,
                  alignItems: 'center',
                  gap: 7,
                  shadowColor: C.primary,
                  shadowOpacity: 0.04,
                  shadowRadius: 6,
                  elevation: 1,
                }}
              >
                <View style={{
                  width: 34, height: 34,
                  borderRadius: 10,
                  backgroundColor: bg,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Icon size={16} color={color} strokeWidth={2} />
                </View>
                <Text style={{
                  fontFamily: 'PlusJakartaSans_600SemiBold',
                  fontSize: 9,
                  color: C.text2,
                  textAlign: 'center',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </MotiView>

        {/* ── Agenda de hoje ── */}
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400, delay: 240 }}
        >
          <View style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginHorizontal: 24,
            marginBottom: 12,
          }}>
            <Text style={{
              fontFamily: 'CormorantGaramond_600SemiBold',
              fontSize: 20,
              color: C.text,
            }}>
              Agenda de Hoje
            </Text>
            <TouchableOpacity onPress={() => router.push('/(empresa)/agenda' as any)}>
              <Text style={{
                fontFamily: 'PlusJakartaSans_600SemiBold',
                fontSize: 11,
                color: C.accent,
              }}>
                Ver todos
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ marginHorizontal: 24, gap: 6 }}>
            {agendamentosHoje.length === 0 ? (
              <View style={{
                backgroundColor: C.surface,
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: 16,
                padding: 20,
                alignItems: 'center',
              }}>
                <Calendar size={24} color={C.text4} strokeWidth={1.5} />
                <Text style={{
                  fontFamily: 'PlusJakartaSans_400Regular',
                  fontSize: 13,
                  color: C.text3,
                  marginTop: 8,
                }}>
                  Nenhum agendamento para hoje
                </Text>
              </View>
            ) : (
              agendamentosHoje.map((ag, i) => {
                const hora = format(new Date(ag.data_hora_inicio), 'HH:mm');
                const ampm = Number(hora.split(':')[0]) < 12 ? 'AM' : 'PM';
                const statusCfg = STATUS_CONFIG[ag.status] ?? STATUS_CONFIG.agendado;
                const [c1, c2] = avatarColors(ag.cliente?.nome ?? 'A');

                return (
                  <MotiView
                    key={ag.id}
                    from={{ opacity: 0, translateX: -8 }}
                    animate={{ opacity: 1, translateX: 0 }}
                    transition={{ type: 'timing', duration: 350, delay: 260 + i * 60 }}
                  >
                    <TouchableOpacity
                      onPress={() => router.push(`/(empresa)/agendamento/${ag.id}` as any)}
                      style={{
                        backgroundColor: C.surface,
                        borderWidth: 1,
                        borderColor: i === 0 ? C.accent + '40' : C.border,
                        borderLeftWidth: i === 0 ? 3 : 1,
                        borderLeftColor: i === 0 ? C.accent : C.border,
                        borderRadius: 16,
                        padding: 14,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        shadowColor: C.primary,
                        shadowOpacity: 0.04,
                        shadowRadius: 6,
                        elevation: 1,
                      }}
                    >
                      {/* Hora */}
                      <View style={{ minWidth: 42, alignItems: 'center' }}>
                        <Text style={{
                          fontFamily: 'PlusJakartaSans_700Bold',
                          fontSize: 13,
                          color: C.text,
                          lineHeight: 16,
                        }}>
                          {hora}
                        </Text>
                        <Text style={{
                          fontFamily: 'PlusJakartaSans_400Regular',
                          fontSize: 9,
                          color: C.text3,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                        }}>
                          {ampm}
                        </Text>
                      </View>

                      {/* Divisor */}
                      <View style={{ width: 1, height: 32, backgroundColor: C.border }} />

                      {/* Avatar */}
                      <LinearGradient
                        colors={[c1, c2]}
                        style={{
                          width: 32, height: 32,
                          borderRadius: 10,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{
                          fontFamily: 'PlusJakartaSans_700Bold',
                          fontSize: 11,
                          color: '#fff',
                        }}>
                          {iniciaisNome(ag.cliente?.nome ?? 'CL')}
                        </Text>
                      </LinearGradient>

                      {/* Info */}
                      <View style={{ flex: 1 }}>
                        <Text
                          numberOfLines={1}
                          style={{
                            fontFamily: 'PlusJakartaSans_600SemiBold',
                            fontSize: 13,
                            color: C.text,
                            marginBottom: 2,
                          }}
                        >
                          {ag.cliente?.nome}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={{
                            fontFamily: 'PlusJakartaSans_400Regular',
                            fontSize: 11,
                            color: C.text3,
                          }}
                        >
                          {ag.servico?.nome} · {ag.profissional?.nome}
                        </Text>
                      </View>

                      {/* Valor + status */}
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{
                          fontFamily: 'PlusJakartaSans_700Bold',
                          fontSize: 13,
                          color: C.text,
                          marginBottom: 4,
                        }}>
                          {formatBRL(ag.valor)}
                        </Text>
                        <View style={{
                          backgroundColor: statusCfg.bg,
                          borderRadius: 6,
                          paddingHorizontal: 7,
                          paddingVertical: 2,
                        }}>
                          <Text style={{
                            fontFamily: 'PlusJakartaSans_700Bold',
                            fontSize: 9,
                            color: statusCfg.text,
                            textTransform: 'uppercase',
                            letterSpacing: 0.3,
                          }}>
                            {statusCfg.label}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  </MotiView>
                );
              })
            )}
          </View>
        </MotiView>

        {/* ── Alertas ── */}
        {(estoqueBaixo.length > 0 || comissoesPendentes.quantidade > 0) && (
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 400, delay: 320 }}
          >
            <View style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginHorizontal: 24,
              marginTop: 20,
              marginBottom: 12,
            }}>
              <Text style={{
                fontFamily: 'CormorantGaramond_600SemiBold',
                fontSize: 20,
                color: C.text,
              }}>
                Alertas
              </Text>
            </View>

            <View style={{ marginHorizontal: 24, gap: 6 }}>
              {estoqueBaixo.map((produto) => (
                <TouchableOpacity
                  key={produto.id}
                  onPress={() => router.push('/(empresa)/estoque' as any)}
                  style={{
                    backgroundColor: C.amberSoft,
                    borderWidth: 1,
                    borderColor: 'rgba(180,83,9,0.12)',
                    borderRadius: 14,
                    padding: 12,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <View style={{
                    width: 30, height: 30,
                    backgroundColor: 'rgba(180,83,9,0.1)',
                    borderRadius: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <AlertTriangle size={14} color={C.amber} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_600SemiBold',
                      fontSize: 12,
                      color: C.amber,
                      lineHeight: 16,
                    }}>
                      Estoque baixo: {produto.nome}
                    </Text>
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_400Regular',
                      fontSize: 10,
                      color: C.text3,
                      marginTop: 1,
                    }}>
                      {produto.estoque_atual} un. restantes · mínimo: {produto.estoque_minimo}
                    </Text>
                  </View>
                  <ChevronRight size={14} color={C.amber} strokeWidth={2} />
                </TouchableOpacity>
              ))}

              {comissoesPendentes.quantidade > 0 && (
                <TouchableOpacity
                  onPress={() => router.push('/(empresa)/comissoes' as any)}
                  style={{
                    backgroundColor: '#F3EFFE',
                    borderWidth: 1,
                    borderColor: 'rgba(155,111,232,0.12)',
                    borderRadius: 14,
                    padding: 12,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <View style={{
                    width: 30, height: 30,
                    backgroundColor: 'rgba(155,111,232,0.1)',
                    borderRadius: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <DollarSign size={14} color={C.accent} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_600SemiBold',
                      fontSize: 12,
                      color: C.primary,
                      lineHeight: 16,
                    }}>
                      {comissoesPendentes.quantidade} comissões pendentes de pagamento
                    </Text>
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_400Regular',
                      fontSize: 10,
                      color: C.text3,
                      marginTop: 1,
                    }}>
                      Total: {formatBRL(comissoesPendentes.total)}
                    </Text>
                  </View>
                  <ChevronRight size={14} color={C.accent} strokeWidth={2} />
                </TouchableOpacity>
              )}
            </View>
          </MotiView>
        )}
      </ScrollView>
    </View>
  );
}
