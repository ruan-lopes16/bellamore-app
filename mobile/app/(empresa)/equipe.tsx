import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StatusBar, Alert, RefreshControl, Linking, Modal,
  TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, Calendar, Edit3, Plus, RotateCcw, Percent } from 'lucide-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
import { format, startOfMonth, endOfMonth } from 'date-fns';

import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
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

// ── Tipos ────────────────────────────────────────────────────

interface MembroEquipe {
  id: string;
  user_id: string;
  percentual_comissao: number;
  ativo: boolean;
  created_at: string;
  user: { id: string; nome: string; telefone?: string; foto_url?: string };
  total_mes: number;
  atendimentos_mes: number;
}

// ── Hook ─────────────────────────────────────────────────────

function useEquipe() {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  return useQuery({
    queryKey: ['equipe', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data: membros, error } = await supabase
        .from('empresa_membros')
        .select('*, user:users(id, nome, telefone, foto_url)')
        .eq('empresa_id', empresaId!)
        .eq('role', 'profissional')
        .order('ativo', { ascending: false })
        .order('created_at');

      if (error) throw error;

      // Stats do mês atual por profissional
      const inicio = startOfMonth(new Date()).toISOString();
      const fim    = endOfMonth(new Date()).toISOString();

      const { data: ags } = await supabase
        .from('agendamentos')
        .select('profissional_id, valor, status')
        .eq('empresa_id', empresaId!)
        .eq('status', 'concluido')
        .gte('data_hora_inicio', inicio)
        .lte('data_hora_inicio', fim);

      const statsPorProf: Record<string, { total: number; count: number }> = {};
      (ags ?? []).forEach((a) => {
        if (!statsPorProf[a.profissional_id]) statsPorProf[a.profissional_id] = { total: 0, count: 0 };
        statsPorProf[a.profissional_id].total += Number(a.valor);
        statsPorProf[a.profissional_id].count += 1;
      });

      return (membros ?? []).map((m: any) => ({
        ...m,
        total_mes:        statsPorProf[m.user_id]?.total ?? 0,
        atendimentos_mes: statsPorProf[m.user_id]?.count ?? 0,
      })) as MembroEquipe[];
    },
  });
}

// ── Modal editar comissão ─────────────────────────────────────

function ModalComissao({ membro, onClose, onSalvar }: {
  membro: MembroEquipe;
  onClose: () => void;
  onSalvar: (pct: number) => void;
}) {
  const [pct, setPct] = useState(String(membro.percentual_comissao));

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}
      >
        <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.text, marginBottom: 6 }}>
            Comissão de {membro.user.nome.split(' ')[0]}
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3, marginBottom: 20 }}>
            Percentual sobre cada atendimento concluído
          </Text>

          <View style={{
            backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
            borderRadius: 14, flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 16, marginBottom: 20,
          }}>
            <TextInput
              value={pct}
              onChangeText={setPct}
              keyboardType="numeric"
              autoFocus
              style={{
                flex: 1, paddingVertical: 16,
                fontFamily: 'PlusJakartaSans_700Bold',
                fontSize: 28, color: C.primary, letterSpacing: -0.5,
              }}
            />
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 20, color: C.text3 }}>%</Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity
              onPress={onClose}
              style={{ flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text3 }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { const n = parseFloat(pct); if (!isNaN(n) && n >= 0 && n <= 100) onSalvar(n); }}
              style={{ flex: 1, borderRadius: 14, overflow: 'hidden' }}
            >
              <LinearGradient
                colors={['#2C1654', '#4A2480']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={{ paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: '#fff' }}>Salvar</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Card de profissional ──────────────────────────────────────

function ProfCard({ membro, onEditComissao, onToggle }: {
  membro: MembroEquipe;
  onEditComissao: () => void;
  onToggle: () => void;
}) {
  const [c1, c2] = membro.ativo ? avatarColors(membro.user.nome) : ['#9CA3AF', '#6B7280'];

  function ligar() {
    if (membro.user.telefone) Linking.openURL(`tel:${membro.user.telefone}`);
  }
  function whatsapp() {
    if (membro.user.telefone) Linking.openURL(`https://wa.me/55${membro.user.telefone.replace(/\D/g, '')}`);
  }

  return (
    <MotiView
      from={{ opacity: 0, translateY: 6 }}
      animate={{ opacity: membro.ativo ? 1 : 0.55, translateY: 0 }}
      transition={{ type: 'timing', duration: 320 }}
      style={{
        backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
        borderRadius: 18, padding: 16, marginBottom: 12,
        shadowColor: C.primary, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
      }}
    >
      {/* Topo: avatar + info + editar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <LinearGradient
          colors={[c1, c2]}
          style={{ width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: '#fff' }}>
            {iniciaisNome(membro.user.nome)}
          </Text>
        </LinearGradient>

        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.text, marginBottom: 2 }}>
            {membro.user.nome}
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3 }}>
            {membro.user.telefone ?? 'Sem telefone'}
          </Text>
          <View style={{
            alignSelf: 'flex-start', marginTop: 4,
            backgroundColor: membro.ativo ? C.greenSoft : '#F3F4F6',
            borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2,
          }}>
            <Text style={{
              fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9,
              color: membro.ativo ? C.green : C.text4,
              textTransform: 'uppercase', letterSpacing: 0.3,
            }}>
              {membro.ativo ? 'Ativa' : 'Inativa'}
            </Text>
          </View>
        </View>

        <TouchableOpacity onPress={() => router.push(`/(empresa)/editar-profissional/${membro.id}` as any)}>
          <Edit3 size={16} color={C.text4} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {/* Stats do mês */}
      {membro.ativo && (
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          {[
            { value: String(membro.atendimentos_mes), label: 'Atendimentos', color: C.primary },
            { value: formatBRL(membro.total_mes),     label: 'Faturado · mês', color: C.green },
          ].map((s) => (
            <View key={s.label} style={{
              flex: 1, backgroundColor: C.bg, borderRadius: 10, padding: 10, alignItems: 'center',
            }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: s.color, letterSpacing: -0.3, marginBottom: 2 }}>
                {s.value}
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'center' }}>
                {s.label}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Comissão */}
      <TouchableOpacity
        onPress={onEditComissao}
        style={{
          backgroundColor: membro.ativo ? C.primarySoft : '#F3F4F6',
          borderRadius: 12, padding: 12, paddingHorizontal: 14,
          flexDirection: 'row', alignItems: 'center', gap: 10,
          marginBottom: 12,
        }}
      >
        <Percent size={14} color={membro.ativo ? C.primary : C.text4} strokeWidth={2} />
        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, flex: 1 }}>
          Comissão por atendimento
        </Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20, color: membro.ativo ? C.primary : C.text4, letterSpacing: -0.5 }}>
          {membro.percentual_comissao}%
        </Text>
        {membro.ativo && <Edit3 size={13} color={C.text3} strokeWidth={2} />}
      </TouchableOpacity>

      {/* Ações */}
      {membro.ativo ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[
            { icon: <Phone size={13} color={C.text2} strokeWidth={2} />, label: 'Ligar', onPress: ligar },
            { icon: <MaterialCommunityIcons name="whatsapp" size={15} color={C.green} />, label: 'WhatsApp', onPress: whatsapp },
            { icon: <Calendar size={13} color={C.text2} strokeWidth={2} />, label: 'Agenda', onPress: () => {} },
          ].map((a) => (
            <TouchableOpacity
              key={a.label}
              onPress={a.onPress}
              style={{
                flex: 1, padding: 10, borderRadius: 10,
                borderWidth: 1, borderColor: C.border,
                backgroundColor: C.bg,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
              }}
            >
              {a.icon}
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text2 }}>
                {a.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <TouchableOpacity
          onPress={onToggle}
          style={{
            padding: 10, borderRadius: 10,
            borderWidth: 1, borderColor: C.border,
            backgroundColor: C.bg,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <RotateCcw size={14} color={C.primary} strokeWidth={2} />
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.primary }}>
            Reativar profissional
          </Text>
        </TouchableOpacity>
      )}
    </MotiView>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function Equipe() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva } = useAuthStore();
  const qc = useQueryClient();

  const { data: membros = [], isLoading, refetch } = useEquipe();
  const [editando, setEditando] = useState<MembroEquipe | null>(null);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const onRefresh = useCallback(() => refetch(), [refetch]);

  if (!fontsLoaded) return null;

  const ativos   = membros.filter((m) => m.ativo).length;
  const inativos = membros.length - ativos;

  async function toggleAtivo(m: MembroEquipe) {
    const { error } = await supabase
      .from('empresa_membros')
      .update({ ativo: !m.ativo })
      .eq('id', m.id);
    if (error) { Alert.alert('Erro', error.message); return; }
    qc.invalidateQueries({ queryKey: ['equipe'] });
    qc.invalidateQueries({ queryKey: ['profissionais'] });
  }

  async function salvarComissao(membro: MembroEquipe, pct: number) {
    const { error } = await supabase
      .from('empresa_membros')
      .update({ percentual_comissao: pct })
      .eq('id', membro.id);
    setEditando(null);
    if (error) { Alert.alert('Erro', error.message); return; }
    qc.invalidateQueries({ queryKey: ['equipe'] });
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={onRefresh} tintColor="#fff" />}
      >
        {/* ── Header ── */}
        <LinearGradient
          colors={['#2C1654', '#3D1F72']}
          style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 20 }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
                {empresaAtiva?.nome}
              </Text>
              <Text style={{ fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 26, color: '#fff' }}>
                Equipe
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => router.push('/(empresa)/convidar-profissional' as any)}
              style={{
                width: 38, height: 38,
                backgroundColor: 'rgba(255,255,255,0.15)',
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
                borderRadius: 12, alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Plus size={18} color="#fff" strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
        </LinearGradient>

        {/* ── Stats ── */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 350, delay: 60 }}
          style={{ flexDirection: 'row', gap: 8, marginHorizontal: 24, marginTop: 16, marginBottom: 20 }}
        >
          {[
            { value: membros.length, label: 'Total',    color: C.primary },
            { value: ativos,         label: 'Ativas',   color: C.green },
            { value: inativos,       label: 'Inativas', color: C.text3 },
          ].map((s) => (
            <View key={s.label} style={{
              flex: 1, backgroundColor: C.surface,
              borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12,
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
              alignItems: 'center',
            }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 22, color: s.color, letterSpacing: -0.5, lineHeight: 24, marginBottom: 3 }}>
                {s.value}
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                {s.label}
              </Text>
            </View>
          ))}
        </MotiView>

        {/* ── Seção profissionais ── */}
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.5, marginHorizontal: 24, marginBottom: 12 }}>
          Profissionais
        </Text>

        <View style={{ paddingHorizontal: 24 }}>
          {membros.map((m) => (
            <ProfCard
              key={m.id}
              membro={m}
              onEditComissao={() => setEditando(m)}
              onToggle={() => toggleAtivo(m)}
            />
          ))}

          {membros.length === 0 && !isLoading && (
            <View style={{
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 16, padding: 32, alignItems: 'center', gap: 12,
            }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                Nenhuma profissional na equipe ainda.
              </Text>
              <TouchableOpacity
                onPress={() => router.push('/(empresa)/convidar-profissional' as any)}
                style={{ backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}
              >
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: '#fff' }}>
                  Adicionar profissional
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Modal editar comissão */}
      {editando && (
        <ModalComissao
          membro={editando}
          onClose={() => setEditando(null)}
          onSalvar={(pct) => salvarComissao(editando, pct)}
        />
      )}
    </View>
  );
}
