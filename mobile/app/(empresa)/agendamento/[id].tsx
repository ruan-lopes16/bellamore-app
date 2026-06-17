import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StatusBar, Alert, ActivityIndicator, Linking,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, Phone, MessageCircle, User,
  Clock, DollarSign, FileText, Check, X, AlertTriangle,
  Calendar, Scissors,
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
import { format, differenceInMinutes } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import type { AgendamentoStatus } from '@/types';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  rose: '#D4608A', roseSoft: '#FDF0F5',
  red: '#C0392B', redSoft: '#FEF2F2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const AVATAR_COLORS: [string, string][] = [
  ['#7C3AED', '#A855F7'], ['#D4608A', '#F472B6'],
  ['#0D7E5F', '#34D399'], ['#B45309', '#F59E0B'],
  ['#1D4ED8', '#60A5FA'], ['#7C2D12', '#EA580C'],
];

const STATUS_CONFIG: Record<AgendamentoStatus, { label: string; bg: string; color: string; heroBg: [string, string] }> = {
  agendado:   { label: 'Agendado',   bg: C.primarySoft, color: C.primary,  heroBg: ['#2C1654', '#3D1F72'] },
  confirmado: { label: 'Confirmado', bg: C.greenSoft,   color: C.green,    heroBg: ['#065F46', '#0D7E5F'] },
  concluido:  { label: 'Concluído',  bg: C.greenSoft,   color: C.green,    heroBg: ['#065F46', '#0D7E5F'] },
  cancelado:  { label: 'Cancelado',  bg: C.redSoft,     color: C.red,      heroBg: ['#7F1D1D', '#991B1B'] },
  faltou:     { label: 'Faltou',     bg: C.amberSoft,   color: C.amber,    heroBg: ['#78350F', '#92400E'] },
};

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
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
}

// ── Hook de detalhe ──────────────────────────────────────────

function useAgendamentoDetalhe(id: string) {
  const { empresaAtiva } = useAuthStore();
  return useQuery({
    queryKey: ['agendamento', id],
    enabled: !!id && !!empresaAtiva?.id,
    staleTime: 1000 * 30,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agendamentos')
        .select(`
          *,
          cliente:users!agendamentos_cliente_id_fkey(id, nome, telefone, email, foto_url),
          profissional:users!agendamentos_profissional_id_fkey(id, nome, foto_url),
          servico:servicos(id, nome, duracao_minutos, categoria, preco)
        `)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as any;
    },
  });
}

// ── Linha de info ────────────────────────────────────────────

function InfoRow({ icon, label, value, last = false }: {
  icon: React.ReactNode; label: string; value: string; last?: boolean;
}) {
  return (
    <View style={{
      paddingVertical: 11, paddingHorizontal: 16,
      flexDirection: 'row', alignItems: 'center', gap: 12,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: C.border,
    }}>
      <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, marginBottom: 1 }}>{label}</Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>{value}</Text>
      </View>
    </View>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function AgendamentoDetalhe() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets  = useSafeAreaInsets();
  const qc      = useQueryClient();
  const { empresaAtiva } = useAuthStore();

  const [atualizando, setAtualizando] = useState(false);

  const { data: ag, isLoading } = useAgendamentoDetalhe(id);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    CormorantGaramond_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded || isLoading || !ag) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.primary} />
      </View>
    );
  }

  const statusCfg = STATUS_CONFIG[ag.status as AgendamentoStatus] ?? STATUS_CONFIG.agendado;
  const inicio    = new Date(ag.data_hora_inicio);
  const fim       = new Date(ag.data_hora_fim);
  const duracao   = differenceInMinutes(fim, inicio);

  const [c1Cliente, c2Cliente]   = avatarColors(ag.cliente?.nome ?? '');
  const [c1Prof,    c2Prof]      = avatarColors(ag.profissional?.nome ?? '');

  async function atualizarStatus(novoStatus: AgendamentoStatus) {
    setAtualizando(true);
    const { error } = await supabase
      .from('agendamentos')
      .update({ status: novoStatus })
      .eq('id', id);
    setAtualizando(false);

    if (error) { Alert.alert('Erro', error.message); return; }

    // Invalida caches relevantes
    qc.invalidateQueries({ queryKey: ['agendamento', id] });
    qc.invalidateQueries({ queryKey: ['agenda-dia'] });
    qc.invalidateQueries({ queryKey: ['cliente-detalhe'] });
  }

  function confirmarCancelamento() {
    Alert.alert('Cancelar agendamento', 'Tem certeza? Esta ação não pode ser desfeita.', [
      { text: 'Não', style: 'cancel' },
      { text: 'Cancelar', style: 'destructive', onPress: () => atualizarStatus('cancelado') },
    ]);
  }

  const podeConfirmar  = ag.status === 'agendado';
  const podeConcluir   = ag.status === 'agendado' || ag.status === 'confirmado';
  const podeFaltou     = ag.status === 'agendado' || ag.status === 'confirmado';
  const podeCancelar   = ag.status !== 'cancelado' && ag.status !== 'concluido';
  const estaConcluido  = ag.status === 'concluido';
  const estaCancelado  = ag.status === 'cancelado';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* ── Hero ── */}
        <LinearGradient
          colors={statusCfg.heroBg}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 24 }}
        >
          <TouchableOpacity
            onPress={() => router.back()}
            style={{
              width: 34, height: 34,
              backgroundColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
              borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 20,
            }}
          >
            <ChevronLeft size={16} color="#fff" strokeWidth={2.5} />
          </TouchableOpacity>

          {/* Cliente */}
          <MotiView
            from={{ opacity: 0, translateY: -8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 380 }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 }}
          >
            <LinearGradient
              colors={[c1Cliente, c2Cliente]}
              style={{ width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18, color: '#fff' }}>
                {iniciaisNome(ag.cliente?.nome ?? '')}
              </Text>
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'CormorantGaramond_700Bold', fontSize: 22, color: '#fff', lineHeight: 26, marginBottom: 3 }}>
                {ag.cliente?.nome}
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
                {ag.cliente?.telefone ?? 'Sem telefone'}
              </Text>
              {/* Badge status */}
              <View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {statusCfg.label}
                </Text>
              </View>
            </View>
          </MotiView>

          {/* Ações rápidas */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[
              { icon: <Phone size={15} color="rgba(255,255,255,0.7)" strokeWidth={2} />, label: 'Ligar', onPress: () => ag.cliente?.telefone && Linking.openURL(`tel:${ag.cliente.telefone}`) },
              { icon: <MessageCircle size={15} color="rgba(255,255,255,0.7)" strokeWidth={2} />, label: 'WhatsApp', onPress: () => ag.cliente?.telefone && Linking.openURL(`https://wa.me/55${ag.cliente.telefone.replace(/\D/g, '')}`) },
              { icon: <User size={15} color="rgba(255,255,255,0.7)" strokeWidth={2} />, label: 'Perfil', onPress: () => router.push(`/(empresa)/cliente/${ag.cliente_id}` as any) },
            ].map((a) => (
              <TouchableOpacity
                key={a.label}
                onPress={a.onPress}
                style={{
                  flex: 1, backgroundColor: 'rgba(255,255,255,0.08)',
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
                  borderRadius: 12, paddingVertical: 10, alignItems: 'center', gap: 4,
                }}
              >
                {a.icon}
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
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
          style={{ marginHorizontal: 24, marginTop: -16, flexDirection: 'row', gap: 8 }}
        >
          {[
            { value: format(inicio, 'HH:mm'), label: 'Início', color: C.primary },
            { value: format(fim,    'HH:mm'), label: 'Término', color: C.primary },
            { value: `${duracao} min`,        label: 'Duração', color: C.text },
          ].map((k) => (
            <View key={k.label} style={{
              flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 14, padding: 12, alignItems: 'center',
              shadowColor: C.primary, shadowOpacity: 0.08, shadowRadius: 8,
              shadowOffset: { width: 0, height: 4 }, elevation: 3,
            }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18, color: k.color, letterSpacing: -0.5, marginBottom: 2 }}>
                {k.value}
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                {k.label}
              </Text>
            </View>
          ))}
        </MotiView>

        {/* ── Detalhes ── */}
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 350, delay: 80 }}
          style={{ marginHorizontal: 24, marginTop: 16, marginBottom: 14 }}
        >
          <View style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 18, overflow: 'hidden',
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
          }}>
            <InfoRow icon={<Calendar size={13} color={C.primary} strokeWidth={2} />} label="Data" value={format(inicio, "EEEE',' d 'de' MMMM 'de' yyyy", { locale: ptBR }).replace(/^\w/, c => c.toUpperCase())} />
            <InfoRow icon={<Scissors size={13} color={C.primary} strokeWidth={2} />} label="Serviço" value={ag.servico?.nome ?? '—'} />
            <InfoRow
              icon={<User size={13} color={C.primary} strokeWidth={2} />}
              label="Profissional"
              value={ag.profissional?.nome ?? '—'}
            />
            <InfoRow icon={<DollarSign size={13} color={C.primary} strokeWidth={2} />} label="Valor" value={formatBRL(ag.valor)} />
            {ag.observacao && (
              <InfoRow icon={<FileText size={13} color={C.primary} strokeWidth={2} />} label="Observação" value={ag.observacao} last />
            )}
          </View>
        </MotiView>

        {/* ── Ações de status ── */}
        {!estaConcluido && !estaCancelado && (
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 350, delay: 120 }}
            style={{ marginHorizontal: 24, marginBottom: 14 }}
          >
            <Text style={{
              fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11,
              color: C.text3, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10,
            }}>
              Atualizar status
            </Text>
            <View style={{ gap: 8 }}>
              {podeConfirmar && (
                <TouchableOpacity
                  onPress={() => atualizarStatus('confirmado')}
                  disabled={atualizando}
                  style={{
                    backgroundColor: C.greenSoft, borderWidth: 1, borderColor: 'rgba(13,126,95,0.2)',
                    borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
                  }}
                >
                  <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(13,126,95,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                    <Check size={16} color={C.green} strokeWidth={2.5} />
                  </View>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.green, flex: 1 }}>
                    Confirmar agendamento
                  </Text>
                  {atualizando && <ActivityIndicator color={C.green} size="small" />}
                </TouchableOpacity>
              )}

              {podeConcluir && (
                <TouchableOpacity
                  onPress={() => atualizarStatus('concluido')}
                  disabled={atualizando}
                  style={{
                    backgroundColor: C.primarySoft, borderWidth: 1, borderColor: 'rgba(44,22,84,0.15)',
                    borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
                  }}
                >
                  <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(44,22,84,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                    <Check size={16} color={C.primary} strokeWidth={2.5} />
                  </View>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.primary, flex: 1 }}>
                    Marcar como concluído
                  </Text>
                  {atualizando && <ActivityIndicator color={C.primary} size="small" />}
                </TouchableOpacity>
              )}

              {podeFaltou && (
                <TouchableOpacity
                  onPress={() => atualizarStatus('faltou')}
                  disabled={atualizando}
                  style={{
                    backgroundColor: C.amberSoft, borderWidth: 1, borderColor: 'rgba(180,83,9,0.15)',
                    borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
                  }}
                >
                  <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(180,83,9,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                    <AlertTriangle size={16} color={C.amber} strokeWidth={2} />
                  </View>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.amber, flex: 1 }}>
                    Cliente faltou
                  </Text>
                </TouchableOpacity>
              )}

              {podeCancelar && (
                <TouchableOpacity
                  onPress={confirmarCancelamento}
                  disabled={atualizando}
                  style={{
                    backgroundColor: C.redSoft, borderWidth: 1, borderColor: 'rgba(192,57,43,0.15)',
                    borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
                  }}
                >
                  <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(192,57,43,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                    <X size={16} color={C.red} strokeWidth={2.5} />
                  </View>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.red, flex: 1 }}>
                    Cancelar agendamento
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </MotiView>
        )}

        {/* ── Status final ── */}
        {(estaConcluido || estaCancelado) && (
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 300, delay: 100 }}
            style={{ marginHorizontal: 24, marginBottom: 14 }}
          >
            <View style={{
              backgroundColor: estaConcluido ? C.greenSoft : C.redSoft,
              borderWidth: 1, borderColor: estaConcluido ? 'rgba(13,126,95,0.2)' : 'rgba(192,57,43,0.15)',
              borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12,
            }}>
              <View style={{
                width: 36, height: 36, borderRadius: 10,
                backgroundColor: estaConcluido ? 'rgba(13,126,95,0.15)' : 'rgba(192,57,43,0.1)',
                alignItems: 'center', justifyContent: 'center',
              }}>
                {estaConcluido
                  ? <Check size={18} color={C.green} strokeWidth={2.5} />
                  : <X     size={18} color={C.red}   strokeWidth={2.5} />
                }
              </View>
              <View>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: estaConcluido ? C.green : C.red }}>
                  {estaConcluido ? 'Atendimento concluído' : 'Agendamento cancelado'}
                </Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 2 }}>
                  {estaConcluido ? `Valor: ${formatBRL(ag.valor)}` : 'Não gera comissão'}
                </Text>
              </View>
            </View>
          </MotiView>
        )}

      </ScrollView>
    </View>
  );
}
