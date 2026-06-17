import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StatusBar, Linking, Alert, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import {
  Phone, MessageCircle, CalendarPlus, MoreHorizontal,
  User, Mail, Calendar, MapPin, AlertTriangle, Camera, LogOut,
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
import { format, differenceInDays, differenceInYears } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { useAuthStore } from '@/stores/authStore';
import { useClienteHomeStats, useAnamneseCliente } from '@/hooks/useCliente';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8', accentSoft: '#F3EFFE',
  rose: '#D4608A', roseSoft: '#FDF0F5',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  red: '#C0392B', redSoft: '#FEF2F2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const AVATAR_COLORS: [string, string][] = [
  ['#7C3AED', '#A855F7'], ['#D4608A', '#F472B6'],
  ['#0D7E5F', '#34D399'], ['#B45309', '#F59E0B'],
  ['#1D4ED8', '#60A5FA'],
];

type Aba = 'perfil' | 'anamnese' | 'fotos';

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

// ── Linha de info ────────────────────────────────────────────

function InfoRow({ icon, label, value, iconBg, last = false }: {
  icon: React.ReactNode; label: string; value: string;
  iconBg: string; last?: boolean;
}) {
  return (
    <View style={{
      paddingVertical: 11, paddingHorizontal: 16,
      flexDirection: 'row', alignItems: 'center', gap: 12,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: C.border,
    }}>
      <View style={{
        width: 28, height: 28, borderRadius: 8,
        backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, marginBottom: 1 }}>
          {label}
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
          {value}
        </Text>
      </View>
    </View>
  );
}

// ── Linha de anamnese ────────────────────────────────────────

function AnamneseRow({ pergunta, resposta, tipo, last = false }: {
  pergunta: string; resposta: string;
  tipo: 'alerta' | 'ok' | 'neutro'; last?: boolean;
}) {
  const dotColor   = tipo === 'alerta' ? '#EF4444' : tipo === 'ok' ? C.green : C.text4;
  const textColor  = tipo === 'alerta' ? C.red     : tipo === 'ok' ? C.green : C.text2;

  return (
    <View style={{
      paddingVertical: 13, paddingHorizontal: 16,
      flexDirection: 'row', alignItems: 'flex-start', gap: 10,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: C.border,
    }}>
      <View style={{
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: dotColor, marginTop: 4, flexShrink: 0,
      }} />
      <Text style={{
        fontFamily: 'PlusJakartaSans_500Medium',
        fontSize: 11, color: C.text3, flex: 1, lineHeight: 16,
      }}>
        {pergunta}
      </Text>
      <Text style={{
        fontFamily: 'PlusJakartaSans_600SemiBold',
        fontSize: 12, color: textColor, flex: 1, textAlign: 'right', lineHeight: 16,
      }}>
        {resposta}
      </Text>
    </View>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function ClientePerfil() {
  const insets = useSafeAreaInsets();
  const { user, sair } = useAuthStore();
  const [aba, setAba] = useState<Aba>('perfil');

  const { data: stats, isLoading, refetch } = useClienteHomeStats();
  const { data: anamneseData } = useAnamneseCliente();

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    CormorantGaramond_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  const [c1, c2] = avatarColors(user?.nome ?? '');
  const anamnese = anamneseData?.respostas as Record<string, string> | undefined;

  const idadeLabel = user?.data_nascimento
    ? `${differenceInYears(new Date(), new Date(user.data_nascimento))} anos`
    : null;

  const anamneseItens: { pergunta: string; key: string; tipo: 'alerta' | 'ok' | 'neutro' }[] = [
    { pergunta: 'Possui alguma alergia?',        key: 'alergia',               tipo: anamnese?.['alergia'] && anamnese['alergia'] !== 'Não' ? 'alerta' : 'ok' },
    { pergunta: 'Usa medicamentos?',             key: 'medicamentos',          tipo: anamnese?.['medicamentos'] && anamnese['medicamentos'] !== 'Não' ? 'alerta' : 'ok' },
    { pergunta: 'Tipo de pele',                  key: 'tipo_pele',             tipo: 'neutro' },
    { pergunta: 'Gestante ou lactante?',         key: 'gestante',              tipo: anamnese?.['gestante'] === 'Sim' ? 'alerta' : 'ok' },
    { pergunta: 'Sensibilidade nos olhos?',      key: 'sensibilidade',         tipo: anamnese?.['sensibilidade'] === 'Nenhuma' ? 'ok' : 'neutro' },
    { pergunta: 'Doenças autoimunes?',           key: 'autoimune',             tipo: anamnese?.['autoimune'] && anamnese['autoimune'] !== 'Não' ? 'alerta' : 'ok' },
    { pergunta: 'Já fez procedimento anterior?', key: 'procedimento_anterior', tipo: 'neutro' },
  ];

  const temAlertas = anamneseItens.some(
    (i) => i.tipo === 'alerta' && anamnese?.[i.key] && anamnese[i.key] !== 'Não'
  );

  function confirmarSaida() {
    Alert.alert('Sair', 'Deseja encerrar a sessão?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: sair },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={() => refetch()} tintColor="#fff" />
        }
      >
        {/* ── Hero ── */}
        <LinearGradient
          colors={['#2C1654', '#3D1F72']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 24 }}
        >
          {/* Decoração */}
          <View style={{
            position: 'absolute', bottom: -40, left: -40,
            width: 200, height: 200, borderRadius: 100,
            backgroundColor: 'rgba(255,255,255,0.03)',
          }} />

          {/* Avatar + info */}
          <MotiView
            from={{ opacity: 0, translateY: -8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 380 }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 }}
          >
            <LinearGradient
              colors={[c1, c2]}
              style={{
                width: 60, height: 60, borderRadius: 18,
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
              }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20, color: '#fff' }}>
                {iniciaisNome(user?.nome ?? '')}
              </Text>
            </LinearGradient>

            <View style={{ flex: 1 }}>
              <Text style={{
                fontFamily: 'CormorantGaramond_600SemiBold',
                fontSize: 22, color: '#fff', lineHeight: 26, marginBottom: 3,
              }}>
                {user?.nome}
              </Text>
              <Text style={{
                fontFamily: 'PlusJakartaSans_400Regular',
                fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 6,
              }}>
                {[user?.telefone, user?.email].filter(Boolean).join(' · ') || 'Sem contato cadastrado'}
              </Text>
              {/* Tags */}
              <View style={{ flexDirection: 'row', gap: 5 }}>
                {stats && stats.totalGasto >= 2000 && (
                  <View style={{
                    backgroundColor: 'rgba(180,83,9,0.2)',
                    borderWidth: 1, borderColor: 'rgba(252,211,77,0.2)',
                    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
                  }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: '#FCD34D', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      VIP
                    </Text>
                  </View>
                )}
                {stats && stats.totalVisitas >= 5 && (
                  <View style={{
                    backgroundColor: 'rgba(13,126,95,0.2)',
                    borderWidth: 1, borderColor: 'rgba(110,231,183,0.15)',
                    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
                  }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: '#6EE7B7', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Recorrente
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </MotiView>

          {/* Ações rápidas */}
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 380, delay: 80 }}
            style={{ flexDirection: 'row', gap: 8 }}
          >
            {[
              { icon: <Phone size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />, label: 'Ligar', onPress: () => user?.telefone && Linking.openURL(`tel:${user.telefone}`) },
              { icon: <MessageCircle size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />, label: 'WhatsApp', onPress: () => user?.telefone && Linking.openURL(`https://wa.me/55${user.telefone.replace(/\D/g, '')}`) },
              { icon: <LogOut size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />, label: 'Sair', onPress: confirmarSaida },
            ].map((a) => (
              <TouchableOpacity
                key={a.label}
                onPress={a.onPress}
                style={{
                  flex: 1,
                  backgroundColor: 'rgba(255,255,255,0.08)',
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

        {/* ── KPIs ── */}
        <MotiView
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 350 }}
          style={{
            marginHorizontal: 24, marginTop: -16,
            flexDirection: 'row', gap: 8,
          }}
        >
          {[
            { value: String(stats?.totalVisitas ?? 0), label: 'Visitas', color: C.primary },
            { value: formatBRL(stats?.totalGasto ?? 0), label: 'Total gasto', color: C.green },
            { value: formatUltimaVisita(stats?.ultimaVisita ?? null), label: 'Última visita', color: C.text },
          ].map((k) => (
            <View key={k.label} style={{
              flex: 1, backgroundColor: C.surface,
              borderWidth: 1, borderColor: C.border, borderRadius: 14,
              padding: 12, alignItems: 'center',
              shadowColor: C.primary, shadowOpacity: 0.08, shadowRadius: 8,
              shadowOffset: { width: 0, height: 4 }, elevation: 3,
            }}>
              <Text style={{
                fontFamily: 'PlusJakartaSans_700Bold',
                fontSize: k.value.length > 7 ? 13 : 18,
                color: k.color, letterSpacing: -0.5, marginBottom: 2,
              }}>
                {k.value}
              </Text>
              <Text style={{
                fontFamily: 'PlusJakartaSans_500Medium',
                fontSize: 9, color: C.text3,
                textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'center',
              }}>
                {k.label}
              </Text>
            </View>
          ))}
        </MotiView>

        {/* ── Tabs ── */}
        <View style={{
          marginHorizontal: 24, marginTop: 16, marginBottom: 16,
          backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
          borderRadius: 12, padding: 3, flexDirection: 'row',
          shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
        }}>
          {(['perfil', 'anamnese', 'fotos'] as Aba[]).map((a) => (
            <TouchableOpacity
              key={a}
              onPress={() => setAba(a)}
              style={{
                flex: 1, paddingVertical: 8, borderRadius: 10,
                alignItems: 'center',
                backgroundColor: aba === a ? C.primary : 'transparent',
              }}
            >
              <Text style={{
                fontFamily: 'PlusJakartaSans_600SemiBold',
                fontSize: 11,
                color: aba === a ? '#fff' : C.text3,
                textTransform: 'capitalize',
              }}>
                {a.charAt(0).toUpperCase() + a.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Aba: Perfil ── */}
        {aba === 'perfil' && (
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 280 }}>

            {/* Dados pessoais */}
            <View style={{
              marginHorizontal: 24, marginBottom: 14,
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 18, overflow: 'hidden',
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              <View style={{
                padding: 14, flexDirection: 'row',
                justifyContent: 'space-between', alignItems: 'center',
                borderBottomWidth: 1, borderBottomColor: C.border,
              }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>
                  Dados Pessoais
                </Text>
                <TouchableOpacity>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.accent }}>
                    Editar
                  </Text>
                </TouchableOpacity>
              </View>

              <InfoRow icon={<User size={13} color={C.primary} strokeWidth={2} />} label="Nome completo" value={user?.nome ?? '—'} iconBg={C.primarySoft} />
              {user?.telefone && <InfoRow icon={<Phone size={13} color={C.green} strokeWidth={2} />} label="Telefone" value={user.telefone} iconBg={C.greenSoft} />}
              {user?.email && <InfoRow icon={<Mail size={13} color={C.rose} strokeWidth={2} />} label="E-mail" value={user.email} iconBg={C.roseSoft} />}
              {user?.data_nascimento && (
                <InfoRow
                  icon={<Calendar size={13} color={C.amber} strokeWidth={2} />}
                  label="Data de nascimento"
                  value={`${format(new Date(user.data_nascimento), "d 'de' MMMM", { locale: ptBR })}${idadeLabel ? ` · ${idadeLabel}` : ''}`}
                  iconBg={C.amberSoft}
                />
              )}
              {user?.endereco && (
                <InfoRow icon={<MapPin size={13} color={C.accent} strokeWidth={2} />} label="Endereço" value={user.endereco} iconBg={C.accentSoft} last />
              )}
            </View>

            {/* Banner anamnese com alertas */}
            {temAlertas && (
              <TouchableOpacity
                onPress={() => setAba('anamnese')}
                style={{
                  marginHorizontal: 24, marginBottom: 14,
                  backgroundColor: C.amberSoft,
                  borderWidth: 1, borderColor: 'rgba(180,83,9,0.15)',
                  borderRadius: 14, padding: 14,
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                }}
              >
                <View style={{
                  width: 30, height: 30, backgroundColor: 'rgba(180,83,9,0.1)',
                  borderRadius: 8, alignItems: 'center', justifyContent: 'center',
                }}>
                  <AlertTriangle size={14} color={C.amber} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.amber }}>
                    Você tem restrições na ficha
                  </Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 1 }}>
                    Toque para ver sua anamnese completa
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          </MotiView>
        )}

        {/* ── Aba: Anamnese ── */}
        {aba === 'anamnese' && (
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 280 }}>
            <View style={{ paddingHorizontal: 24 }}>
              {!anamnese ? (
                <View style={{
                  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                  borderRadius: 16, padding: 28, alignItems: 'center', gap: 12,
                }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3, textAlign: 'center' }}>
                    Sua ficha de anamnese ainda não foi preenchida.
                  </Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text4, textAlign: 'center' }}>
                    Solicite ao estúdio no próximo atendimento.
                  </Text>
                </View>
              ) : (
                <>
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_600SemiBold',
                    fontSize: 11, color: C.text3,
                    textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10,
                  }}>
                    Ficha de Anamnese
                  </Text>
                  <View style={{
                    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                    borderRadius: 18, overflow: 'hidden',
                    shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
                  }}>
                    {anamneseItens.map((item, i) => (
                      <AnamneseRow
                        key={item.key}
                        pergunta={item.pergunta}
                        resposta={anamnese[item.key] ?? '—'}
                        tipo={item.tipo}
                        last={i === anamneseItens.length - 1}
                      />
                    ))}
                  </View>
                </>
              )}
            </View>
          </MotiView>
        )}

        {/* ── Aba: Fotos ── */}
        {aba === 'fotos' && (
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 280 }}>
            <View style={{ paddingHorizontal: 24 }}>
              <TouchableOpacity style={{
                backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                borderRadius: 16, padding: 36, alignItems: 'center', gap: 12,
              }}>
                <Camera size={32} color={C.text4} strokeWidth={1.5} />
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                  Nenhuma foto registrada
                </Text>
              </TouchableOpacity>
            </View>
          </MotiView>
        )}
      </ScrollView>
    </View>
  );
}
