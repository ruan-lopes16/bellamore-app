import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StatusBar, Linking, Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import {
  ChevronLeft, Phone, MessageCircle, CalendarPlus,
  MoreHorizontal, Edit3, AlertTriangle, Camera,
} from 'lucide-react-native';
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
import { format, differenceInDays, differenceInYears } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { useClienteDetalhe, type ClienteTag } from '@/hooks/useClientes';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  rose: '#D4608A', roseSoft: '#FDF0F5',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  red: '#C0392B', redSoft: '#FEF2F2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const AVATAR_COLORS: [string, string][] = [
  ['#7C3AED', '#A855F7'], ['#D4608A', '#F472B6'],
  ['#0D7E5F', '#34D399'], ['#B45309', '#F59E0B'],
  ['#1D4ED8', '#60A5FA'], ['#7C2D12', '#EA580C'],
];

const TAG_CONFIG: Record<ClienteTag, { label: string; bg: string; color: string }> = {
  vip:        { label: 'VIP',        bg: C.amberSoft,  color: C.amber },
  nova:       { label: 'Nova',       bg: C.greenSoft,  color: C.green },
  recorrente: { label: 'Recorrente', bg: C.primarySoft, color: C.primary },
  sumida:     { label: 'Sumida',     bg: C.redSoft,    color: C.red },
};

const STATUS_CONFIG = {
  agendado:   { label: 'Agendado',   bg: C.primarySoft, color: C.primary },
  confirmado: { label: 'Confirmado', bg: C.greenSoft,  color: C.green },
  concluido:  { label: 'Concluído',  bg: C.greenSoft,  color: C.green },
  cancelado:  { label: 'Cancelado',  bg: C.redSoft,    color: C.red },
  faltou:     { label: 'Faltou',     bg: C.amberSoft,  color: C.amber },
};

type Aba = 'perfil' | 'historico' | 'anamnese' | 'fotos';

// ── Helpers ──────────────────────────────────────────────────

function avatarColors(nome: string): [string, string] {
  return AVATAR_COLORS[(nome?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length];
}
function iniciaisNome(nome: string) {
  return (nome ?? '').split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}
function formatBRL(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

// ── Seção info ───────────────────────────────────────────────

function InfoRow({ icon, label, value, iconBg, iconColor }: {
  icon: React.ReactNode; label: string; value: string;
  iconBg: string; iconColor: string;
}) {
  return (
    <View style={{
      paddingVertical: 11, paddingHorizontal: 16,
      flexDirection: 'row', alignItems: 'center', gap: 12,
      borderBottomWidth: 1, borderBottomColor: C.border,
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

// ── Anamnese row ─────────────────────────────────────────────

function AnamneseRow({ pergunta, resposta, tipo }: {
  pergunta: string; resposta: string;
  tipo: 'alerta' | 'ok' | 'neutro';
}) {
  const dotColor = tipo === 'alerta' ? '#EF4444' : tipo === 'ok' ? C.green : C.text4;
  const respostaColor = tipo === 'alerta' ? C.red : tipo === 'ok' ? C.green : C.text2;

  return (
    <View style={{
      paddingVertical: 11, paddingHorizontal: 16,
      flexDirection: 'row', alignItems: 'flex-start', gap: 10,
      borderBottomWidth: 1, borderBottomColor: C.border,
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
        fontSize: 12, color: respostaColor, textAlign: 'right', flex: 1, lineHeight: 16,
      }}>
        {resposta}
      </Text>
    </View>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function ClientePerfil() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [aba, setAba] = useState<Aba>('perfil');

  const { data: cliente, isLoading } = useClienteDetalhe(id);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded || isLoading || !cliente) return null;

  const [c1, c2] = avatarColors(cliente.nome ?? '');

  const idadeLabel = cliente.data_nascimento
    ? `${differenceInYears(new Date(), new Date(cliente.data_nascimento))} anos`
    : null;

  const anamnese = cliente.anamnese?.respostas as Record<string, string> | undefined;

  // Respostas da anamnese com classificação
  const anamneseItens = anamnese ? [
    { pergunta: 'Possui alguma alergia?',       key: 'alergia',        tipo: anamnese['alergia'] && anamnese['alergia'] !== 'Não' ? 'alerta' : 'ok' },
    { pergunta: 'Usa medicamentos?',            key: 'medicamentos',   tipo: anamnese['medicamentos'] && anamnese['medicamentos'] !== 'Não' ? 'alerta' : 'ok' },
    { pergunta: 'Tipo de pele',                 key: 'tipo_pele',      tipo: 'neutro' },
    { pergunta: 'Gestante ou lactante?',        key: 'gestante',       tipo: anamnese['gestante'] === 'Sim' ? 'alerta' : 'ok' },
    { pergunta: 'Sensibilidade nos olhos?',     key: 'sensibilidade',  tipo: anamnese['sensibilidade'] === 'Nenhuma' ? 'ok' : 'neutro' },
    { pergunta: 'Doenças autoimunes?',          key: 'autoimune',      tipo: anamnese['autoimune'] && anamnese['autoimune'] !== 'Não' ? 'alerta' : 'ok' },
    { pergunta: 'Já fez procedimento anterior?', key: 'procedimento_anterior', tipo: 'neutro' },
    { pergunta: 'Observações adicionais',       key: 'observacoes',    tipo: 'neutro' },
  ] as const : [];

  const temAlertas = anamneseItens.some((i) => i.tipo === 'alerta' && anamnese?.[i.key] && anamnese[i.key] !== 'Não');

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* ── Hero ── */}
        <LinearGradient
          colors={['#2C1654', '#3D1F72']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 24 }}
        >
          {/* Back */}
          <TouchableOpacity
            onPress={() => router.back()}
            style={{
              width: 34, height: 34,
              backgroundColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
              borderRadius: 10, alignItems: 'center', justifyContent: 'center',
              marginBottom: 20,
            }}
          >
            <ChevronLeft size={16} color="#fff" strokeWidth={2.5} />
          </TouchableOpacity>

          {/* Info */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <LinearGradient
              colors={[c1, c2]}
              style={{
                width: 60, height: 60, borderRadius: 18,
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
              }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20, color: '#fff' }}>
                {iniciaisNome(cliente.nome ?? '')}
              </Text>
            </LinearGradient>

            <View style={{ flex: 1 }}>
              <Text style={{
                fontFamily: 'Fraunces_600SemiBold',
                fontSize: 22, color: '#fff', lineHeight: 26, marginBottom: 4,
              }}>
                {cliente.nome}
              </Text>
              <Text style={{
                fontFamily: 'PlusJakartaSans_400Regular',
                fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6,
              }}>
                {cliente.telefone ?? 'Sem telefone'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 5 }}>
                {cliente.tags?.map((tag) => {
                  const cfg = TAG_CONFIG[tag];
                  return (
                    <View key={tag} style={{
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
                      borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
                    }}>
                      <Text style={{
                        fontFamily: 'PlusJakartaSans_700Bold',
                        fontSize: 9, color: '#fff',
                        textTransform: 'uppercase', letterSpacing: 0.5,
                      }}>
                        {cfg.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Ações rápidas */}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
            {[
              { icon: <Phone size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />, label: 'Ligar', onPress: () => cliente.telefone && Linking.openURL(`tel:${cliente.telefone}`) },
              { icon: <MessageCircle size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />, label: 'Mensagem', onPress: () => cliente.telefone && Linking.openURL(`https://wa.me/55${cliente.telefone.replace(/\D/g, '')}`) },
              { icon: <CalendarPlus size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />, label: 'Agendar', onPress: () => router.push(`/(empresa)/novo-agendamento?clienteId=${id}` as any) },
              { icon: <MoreHorizontal size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />, label: 'Mais', onPress: () => {} },
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
          </View>
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
            { value: String(cliente.total_visitas), label: 'Visitas', color: C.primary },
            { value: formatBRL(cliente.total_gasto), label: 'Total gasto', color: C.green },
            { value: cliente.ultima_visita ? `há ${differenceInDays(new Date(), new Date(cliente.ultima_visita))}d` : '—', label: 'Última visita', color: C.text },
          ].map((k) => (
            <View key={k.label} style={{
              flex: 1, backgroundColor: C.surface,
              borderWidth: 1, borderColor: C.border,
              borderRadius: 14, padding: 12,
              shadowColor: C.primary, shadowOpacity: 0.08, shadowRadius: 8,
              shadowOffset: { width: 0, height: 4 }, elevation: 3,
              alignItems: 'center',
            }}>
              <Text style={{
                fontFamily: 'PlusJakartaSans_700Bold',
                fontSize: 16, color: k.color,
                letterSpacing: -0.5, marginBottom: 2,
              }}>
                {k.value}
              </Text>
              <Text style={{
                fontFamily: 'PlusJakartaSans_500Medium',
                fontSize: 9, color: C.text3,
                textTransform: 'uppercase', letterSpacing: 0.8,
              }}>
                {k.label}
              </Text>
            </View>
          ))}
        </MotiView>

        {/* ── Tabs internos ── */}
        <View style={{
          marginHorizontal: 24, marginTop: 16, marginBottom: 16,
          backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
          borderRadius: 12, padding: 3, flexDirection: 'row',
          shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
        }}>
          {(['perfil', 'historico', 'anamnese', 'fotos'] as Aba[]).map((a) => (
            <TouchableOpacity
              key={a}
              onPress={() => setAba(a)}
              style={{
                flex: 1, paddingVertical: 8,
                borderRadius: 10, alignItems: 'center',
                backgroundColor: aba === a ? C.primary : 'transparent',
              }}
            >
              <Text style={{
                fontFamily: 'PlusJakartaSans_600SemiBold',
                fontSize: 11,
                color: aba === a ? '#fff' : C.text3,
                textTransform: 'capitalize',
              }}>
                {a === 'historico' ? 'Histórico' : a.charAt(0).toUpperCase() + a.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Aba: Perfil ── */}
        {aba === 'perfil' && (
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 300 }}>

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
                <TouchableOpacity onPress={() => router.push(`/(empresa)/cliente/${id}/editar` as any)}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.accent }}>
                    Editar
                  </Text>
                </TouchableOpacity>
              </View>
              <InfoRow icon={<Edit3 size={13} color={C.primary} strokeWidth={2} />} label="Nome completo" value={cliente.nome ?? '—'} iconBg={C.primarySoft} iconColor={C.primary} />
              {cliente.telefone && <InfoRow icon={<Phone size={13} color={C.green} strokeWidth={2} />} label="Telefone" value={cliente.telefone} iconBg={C.greenSoft} iconColor={C.green} />}
              {cliente.email && <InfoRow icon={<MessageCircle size={13} color={C.rose} strokeWidth={2} />} label="E-mail" value={cliente.email} iconBg={C.roseSoft} iconColor={C.rose} />}
              {cliente.data_nascimento && (
                <InfoRow
                  icon={<CalendarPlus size={13} color={C.amber} strokeWidth={2} />}
                  label="Data de nascimento"
                  value={`${format(new Date(cliente.data_nascimento), "d 'de' MMMM", { locale: ptBR })}${idadeLabel ? ` · ${idadeLabel}` : ''}`}
                  iconBg={C.amberSoft} iconColor={C.amber}
                />
              )}
              {/* Remove border from last item */}
              <View style={{ borderBottomWidth: 0 }}>
                {cliente.endereco && <InfoRow icon={<Phone size={13} color={C.accent} strokeWidth={2} />} label="Endereço" value={cliente.endereco} iconBg={C.primarySoft} iconColor={C.accent} />}
              </View>
            </View>

            {/* Alerta se tiver alertas na anamnese */}
            {temAlertas && anamnese && (
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
                    Atenção: restrições na anamnese
                  </Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3, marginTop: 1 }}>
                    Toque para ver a ficha completa
                  </Text>
                </View>
                <ChevronLeft size={14} color={C.amber} strokeWidth={2} style={{ transform: [{ rotate: '180deg' }] }} />
              </TouchableOpacity>
            )}
          </MotiView>
        )}

        {/* ── Aba: Histórico ── */}
        {aba === 'historico' && (
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 300 }}>
            <View style={{ paddingHorizontal: 24, gap: 6 }}>
              {(cliente.historico ?? []).length === 0 ? (
                <View style={{
                  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                  borderRadius: 16, padding: 24, alignItems: 'center',
                }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                    Nenhum atendimento registrado
                  </Text>
                </View>
              ) : (
                (cliente.historico ?? []).map((ag, i) => {
                  const statusCfg = STATUS_CONFIG[ag.status] ?? STATUS_CONFIG.agendado;
                  const data = new Date(ag.data_hora_inicio);
                  return (
                    <TouchableOpacity
                      key={ag.id}
                      onPress={() => router.push(`/(empresa)/agendamento/${ag.id}` as any)}
                      style={{
                        backgroundColor: C.surface, borderWidth: 1,
                        borderColor: C.border, borderRadius: 14,
                        padding: 13, flexDirection: 'row',
                        alignItems: 'center', gap: 12,
                        shadowColor: C.primary, shadowOpacity: 0.04,
                        shadowRadius: 6, elevation: 1,
                      }}
                    >
                      <View style={{ minWidth: 42, alignItems: 'center' }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18, color: C.text, lineHeight: 20 }}>
                          {format(data, 'dd')}
                        </Text>
                        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          {format(data, 'MMM', { locale: ptBR })}
                        </Text>
                      </View>
                      <View style={{ width: 1, height: 32, backgroundColor: C.border }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text, marginBottom: 2 }}>
                          {ag.servico?.nome ?? 'Serviço'}
                        </Text>
                        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3 }}>
                          {ag.profissional?.nome ?? 'Profissional'}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text, marginBottom: 4 }}>
                          {formatBRL(ag.valor)}
                        </Text>
                        <View style={{ backgroundColor: statusCfg.bg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: statusCfg.color, textTransform: 'uppercase' }}>
                            {statusCfg.label}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </MotiView>
        )}

        {/* ── Aba: Anamnese ── */}
        {aba === 'anamnese' && (
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 300 }}>
            <View style={{ paddingHorizontal: 24 }}>
              {!anamnese ? (
                <View style={{
                  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                  borderRadius: 16, padding: 24, alignItems: 'center', gap: 12,
                }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                    Ficha de anamnese não preenchida
                  </Text>
                  <TouchableOpacity
                    onPress={() => router.push(`/(empresa)/cliente/${id}/anamnese` as any)}
                    style={{
                      backgroundColor: C.primary, borderRadius: 12,
                      paddingHorizontal: 20, paddingVertical: 10,
                    }}
                  >
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: '#fff' }}>
                      Preencher agora
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <View style={{
                    flexDirection: 'row', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 10,
                  }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.5 }}>
                      Ficha de Anamnese
                    </Text>
                    <TouchableOpacity onPress={() => router.push(`/(empresa)/cliente/${id}/anamnese` as any)}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.accent }}>Editar</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{
                    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                    borderRadius: 18, overflow: 'hidden',
                    shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
                  }}>
                    {anamneseItens.map((item, i) => (
                      <View key={item.key} style={{ borderBottomWidth: i < anamneseItens.length - 1 ? 1 : 0, borderBottomColor: C.border }}>
                        <AnamneseRow
                          pergunta={item.pergunta}
                          resposta={anamnese[item.key] ?? '—'}
                          tipo={item.tipo as 'alerta' | 'ok' | 'neutro'}
                        />
                      </View>
                    ))}
                  </View>
                </>
              )}
            </View>
          </MotiView>
        )}

        {/* ── Aba: Fotos ── */}
        {aba === 'fotos' && (
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 300 }}>
            <View style={{ paddingHorizontal: 24 }}>
              <TouchableOpacity style={{
                backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                borderRadius: 16, padding: 32, alignItems: 'center', gap: 12,
              }}>
                <Camera size={28} color={C.text4} strokeWidth={1.5} />
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                  Nenhuma foto registrada
                </Text>
                <View style={{
                  backgroundColor: C.primary, borderRadius: 10,
                  paddingHorizontal: 20, paddingVertical: 10,
                }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: '#fff' }}>
                    Adicionar foto
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          </MotiView>
        )}

      </ScrollView>
    </View>
  );
}
