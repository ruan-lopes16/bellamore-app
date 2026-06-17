import { useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StatusBar, Alert, Switch, RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { Plus, Edit3 } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
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

import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { usePacotes, type PacoteComServicos } from '@/hooks/usePacotes';
import { CategoriaIcon } from '@/components/CategoriaIcon';
import { resolverCategoria } from '@/hooks/useAgenda';
import type { CategoriaServico } from '@/components/CategoriaIcon';

// ── Constantes ────────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

// ── Card de pacote ────────────────────────────────────────────

function PacoteCard({ pacote, onToggle, onEdit }: {
  pacote: PacoteComServicos;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const totalSessoes = pacote.pacote_servicos.reduce((s, ps) => s + ps.quantidade, 0);
  const subtitle = `${totalSessoes} ${totalSessoes === 1 ? 'aplicação' : 'aplicações'} · válido por ${pacote.validade_dias} dias`;
  const tagsVisiveis = pacote.pacote_servicos.slice(0, 3);
  const overflow = pacote.pacote_servicos.length - 3;

  return (
    <MotiView
      from={{ opacity: 0, translateY: 4 }}
      animate={{ opacity: pacote.ativo ? 1 : 0.55, translateY: 0 }}
      transition={{ type: 'timing', duration: 280 }}
      style={{
        backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
        borderRadius: 14, padding: 14, marginBottom: 8,
        shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
      }}
    >
      {/* Nome + toggle */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 2 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>
            {pacote.nome}
          </Text>
        </View>
        <Switch
          value={pacote.ativo}
          onValueChange={onToggle}
          trackColor={{ false: '#E5E7EB', true: C.green }}
          thumbColor="#fff"
          style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
        />
      </View>

      {/* Validade / sessões */}
      <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, marginBottom: 10 }}>
        {subtitle}
      </Text>

      {/* Tags de serviços */}
      {tagsVisiveis.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
          {tagsVisiveis.map(({ servico }) => {
            const cat = resolverCategoria(servico.categoria ?? 'outros') as CategoriaServico;
            return (
              <View
                key={servico.id}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  backgroundColor: C.primarySoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
                }}
              >
                <CategoriaIcon categoria={cat} size={10} color={C.accent} />
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text2 }} numberOfLines={1}>
                  {servico.nome}
                </Text>
              </View>
            );
          })}
          {overflow > 0 && (
            <View style={{ backgroundColor: C.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, justifyContent: 'center' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3 }}>
                +{overflow}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Preço + editar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{
          fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18,
          color: pacote.ativo ? C.primary : C.text3, letterSpacing: -0.5,
        }}>
          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(pacote.preco)}
        </Text>
        <TouchableOpacity
          onPress={onEdit}
          style={{
            width: 30, height: 30, borderRadius: 8,
            backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Edit3 size={13} color={C.text3} strokeWidth={2} />
        </TouchableOpacity>
      </View>
    </MotiView>
  );
}

// ── Tela principal ────────────────────────────────────────────

export default function Pacotes() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva } = useAuthStore();
  const qc = useQueryClient();

  const { data: pacotes = [], isLoading, refetch } = usePacotes();
  const onRefresh = useCallback(() => refetch(), [refetch]);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  const ativos   = pacotes.filter((p) => p.ativo);
  const inativos = pacotes.filter((p) => !p.ativo);

  async function togglePacote(p: PacoteComServicos) {
    const { error } = await supabase
      .from('pacotes')
      .update({ ativo: !p.ativo })
      .eq('id', p.id);
    if (error) { Alert.alert('Erro', error.message); return; }
    qc.invalidateQueries({ queryKey: ['pacotes'] });
  }

  function renderSection(lista: PacoteComServicos[], titulo: string, delay: number) {
    if (lista.length === 0) return null;
    return (
      <MotiView
        from={{ opacity: 0, translateY: 8 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: 320, delay }}
        style={{ marginHorizontal: 24, marginBottom: 20 }}
      >
        <Text style={{
          fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3,
          textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10,
        }}>
          {titulo}
        </Text>
        {lista.map((p) => (
          <PacoteCard
            key={p.id}
            pacote={p}
            onToggle={() => togglePacote(p)}
            onEdit={() => router.push(`/(empresa)/editar-pacote/${p.id}` as any)}
          />
        ))}
      </MotiView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={onRefresh} tintColor="#fff" />}
      >
        {/* Header */}
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
                Pacotes
              </Text>
            </View>
          </View>
        </LinearGradient>

        {/* Stats */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 350, delay: 60 }}
          style={{ flexDirection: 'row', gap: 8, marginHorizontal: 24, marginTop: 16, marginBottom: 20 }}
        >
          {[
            { value: pacotes.length,  label: 'Total',    color: C.primary },
            { value: ativos.length,   label: 'Ativos',   color: C.green   },
            { value: inativos.length, label: 'Inativos', color: C.text3   },
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

        {renderSection(ativos,   'Pacotes ativos', 100)}
        {renderSection(inativos, 'Inativos',       160)}

        {pacotes.length === 0 && !isLoading && (
          <View style={{ marginHorizontal: 24, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 32, alignItems: 'center', gap: 12 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
              Nenhum pacote cadastrado ainda.
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/(empresa)/novo-pacote' as any)}
              style={{ backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: '#fff' }}>
                Criar primeiro pacote
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        onPress={() => router.push('/(empresa)/novo-pacote' as any)}
        style={{
          position: 'absolute', bottom: insets.bottom + 24, right: 24,
          width: 52, height: 52, borderRadius: 16,
          backgroundColor: C.primary,
          alignItems: 'center', justifyContent: 'center',
          shadowColor: C.primary, shadowOpacity: 0.35,
          shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8,
        }}
      >
        <Plus size={22} color="#fff" strokeWidth={2.5} />
      </TouchableOpacity>
    </View>
  );
}
