import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StatusBar, Alert, Switch, RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { Plus, Clock, Edit3 } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { resolverCategoria, CATEGORIA_CONFIG } from '@/hooks/useAgenda';
import { CategoriaIcon, CATEGORIA_COR, CATEGORIA_BG } from '@/components/CategoriaIcon';
import type { Servico } from '@/types';
import type { CategoriaServico } from '@/components/CategoriaIcon';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

// ── Hook ─────────────────────────────────────────────────────

function useServicos() {
  const { empresaAtiva } = useAuthStore();
  const empresaId = empresaAtiva?.id;

  return useQuery({
    queryKey: ['servicos-gestao', empresaId],
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('servicos')
        .select('*')
        .eq('empresa_id', empresaId!)
        .order('categoria')
        .order('nome');
      if (error) throw error;
      return (data ?? []) as Servico[];
    },
  });
}

// ── Card de serviço ───────────────────────────────────────────

function ServicoCard({ servico, onToggle, onEdit }: {
  servico: Servico;
  onToggle: () => void;
  onEdit: () => void;
}) {
  return (
    <MotiView
      from={{ opacity: 0, translateY: 4 }}
      animate={{ opacity: servico.ativo ? 1 : 0.55, translateY: 0 }}
      transition={{ type: 'timing', duration: 280 }}
      style={{
        backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
        borderRadius: 14, padding: 14, marginBottom: 8,
        shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
      }}
    >
      {/* Linha superior */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text, marginBottom: 2 }}>
            {servico.nome}
          </Text>
          {servico.descricao ? (
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, lineHeight: 15 }} numberOfLines={2}>
              {servico.descricao}
            </Text>
          ) : null}
        </View>
        <Switch
          value={servico.ativo}
          onValueChange={onToggle}
          trackColor={{ false: '#E5E7EB', true: C.green }}
          thumbColor="#fff"
          style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
        />
      </View>

      {/* Linha inferior */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Clock size={11} color={C.text4} strokeWidth={2} />
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3 }}>
              {servico.duracao_minutos} min
            </Text>
          </View>
          {servico.custo > 0 && (
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }}>
              Custo R$ {servico.custo.toFixed(0)}
            </Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: servico.ativo ? C.primary : C.text3, letterSpacing: -0.5 }}>
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(servico.preco)}
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
      </View>
    </MotiView>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function Servicos() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva } = useAuthStore();
  const qc = useQueryClient();

  const { data: servicos = [], isLoading, refetch } = useServicos();

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const onRefresh = useCallback(() => refetch(), [refetch]);

  if (!fontsLoaded) return null;

  // Agrupa por categoria
  const porCategoria = servicos.reduce<Record<string, Servico[]>>((acc, s) => {
    const cat = s.categoria ?? 'outros';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  const total  = servicos.length;
  const ativos = servicos.filter((s) => s.ativo).length;

  async function toggleServico(s: Servico) {
    const { error } = await supabase
      .from('servicos')
      .update({ ativo: !s.ativo })
      .eq('id', s.id);
    if (error) { Alert.alert('Erro', error.message); return; }
    qc.invalidateQueries({ queryKey: ['servicos-gestao'] });
    qc.invalidateQueries({ queryKey: ['servicos-empresa'] });
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
                Serviços
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => router.push('/(empresa)/novo-servico' as any)}
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
            { value: total,           label: 'Total',    color: C.primary },
            { value: ativos,          label: 'Ativos',   color: C.green },
            { value: total - ativos,  label: 'Inativos', color: C.text3 },
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

        {/* ── Seções por categoria ── */}
        {Object.entries(porCategoria).map(([cat, items], gi) => {
          const catKey = resolverCategoria(cat) as CategoriaServico;
          const cfg    = CATEGORIA_CONFIG[catKey];
          const cor    = CATEGORIA_COR[catKey];
          const bg     = CATEGORIA_BG[catKey];

          return (
            <MotiView
              key={cat}
              from={{ opacity: 0, translateY: 8 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 320, delay: 80 + gi * 50 }}
              style={{ marginHorizontal: 24, marginBottom: 20 }}
            >
              {/* Header da categoria */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
                  <CategoriaIcon categoria={catKey} size={15} color={cor} />
                </View>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: cor }}>
                  {cfg.label}
                </Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text4, marginLeft: 'auto' as any }}>
                  {items.length} {items.length === 1 ? 'serviço' : 'serviços'}
                </Text>
              </View>

              {/* Cards */}
              {items.map((s) => (
                <ServicoCard
                  key={s.id}
                  servico={s}
                  onToggle={() => toggleServico(s)}
                  onEdit={() => router.push(`/(empresa)/editar-servico/${s.id}` as any)}
                />
              ))}
            </MotiView>
          );
        })}

        {servicos.length === 0 && !isLoading && (
          <View style={{ marginHorizontal: 24, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 32, alignItems: 'center', gap: 12 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
              Nenhum serviço cadastrado ainda.
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/(empresa)/novo-servico' as any)}
              style={{ backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: '#fff' }}>
                Adicionar primeiro serviço
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        onPress={() => router.push('/(empresa)/novo-servico' as any)}
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
