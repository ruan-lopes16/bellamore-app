import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StatusBar, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { ChevronLeft } from 'lucide-react-native';
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
import { CategoriaIcon } from '@/components/CategoriaIcon';
import { resolverCategoria } from '@/hooks/useAgenda';
import type { CategoriaServico } from '@/components/CategoriaIcon';
import type { Servico } from '@/types';

// ── Constantes ────────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const VALIDADE_OPTS = [
  { label: '30 dias',  value: 30  },
  { label: '90 dias',  value: 90  },
  { label: '180 dias', value: 180 },
  { label: '365 dias', value: 365 },
];

const inputStyle = {
  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  borderRadius: 12, paddingHorizontal: 14, height: 48,
  fontFamily: 'PlusJakartaSans_500Medium', fontSize: 15, color: C.text,
} as const;

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 8 }}>
        {label}
      </Text>
      {children}
    </View>
  );
}

// ── Tela ─────────────────────────────────────────────────────

export default function NovoPacote() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva } = useAuthStore();
  const qc = useQueryClient();

  const [nome,        setNome]        = useState('');
  const [preco,       setPreco]       = useState('');
  const [validade,    setValidade]    = useState(90);
  // Record<servicoId, quantidade>
  const [selecionados, setSelecionados] = useState<Record<string, number>>({});
  const [salvando,    setSalvando]    = useState(false);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  });

  const { data: servicos = [] } = useQuery<Servico[]>({
    queryKey: ['servicos-empresa', empresaAtiva?.id],
    enabled: !!empresaAtiva?.id,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('servicos')
        .select('*')
        .eq('empresa_id', empresaAtiva!.id)
        .eq('ativo', true)
        .order('categoria')
        .order('nome');
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!fontsLoaded) return null;

  const qtdSelecionados = Object.keys(selecionados).length;
  const podeSalvar = nome.trim().length > 1 && parseFloat(preco.replace(',', '.')) > 0 && qtdSelecionados > 0;

  function toggleServico(id: string) {
    setSelecionados((prev) => {
      if (prev[id] !== undefined) {
        const { [id]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: 1 };
    });
  }

  function changeQtd(id: string, delta: number) {
    setSelecionados((prev) => ({
      ...prev,
      [id]: Math.max(1, (prev[id] ?? 1) + delta),
    }));
  }

  async function salvar() {
    if (!podeSalvar || !empresaAtiva) return;
    setSalvando(true);

    const { data: pacote, error: errPacote } = await supabase
      .from('pacotes')
      .insert({
        empresa_id:   empresaAtiva.id,
        nome:         nome.trim(),
        preco:        parseFloat(preco.replace(',', '.')),
        validade_dias: validade,
        ativo:        true,
      })
      .select()
      .single();

    if (errPacote || !pacote) {
      setSalvando(false);
      Alert.alert('Erro', errPacote?.message ?? 'Erro ao criar pacote');
      return;
    }

    const linhas = Object.entries(selecionados).map(([servico_id, quantidade]) => ({
      pacote_id: pacote.id,
      servico_id,
      quantidade,
    }));

    const { error: errServicos } = await supabase.from('pacote_servicos').insert(linhas);
    setSalvando(false);

    if (errServicos) { Alert.alert('Erro', errServicos.message); return; }

    qc.invalidateQueries({ queryKey: ['pacotes'] });
    Alert.alert('Pacote criado!', nome, [{ text: 'OK', onPress: () => router.back() }]);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <LinearGradient colors={['#2C1654', '#3D1F72']} style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 24 }}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}
          >
            <ChevronLeft size={16} color="#fff" strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
            {empresaAtiva?.nome}
          </Text>
          <Text style={{ fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 26, color: '#fff' }}>
            Novo Pacote
          </Text>
        </LinearGradient>

        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 350, delay: 60 }}
          style={{ padding: 24 }}
        >
          {/* Nome */}
          <Campo label="Nome do pacote *">
            <TextInput
              value={nome} onChangeText={setNome}
              placeholder="Ex: Pacote Cílios Gold"
              placeholderTextColor={C.text4}
              style={inputStyle}
            />
          </Campo>

          {/* Preço */}
          <Campo label="Preço *">
            <View style={{ ...inputStyle, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text3 }}>R$</Text>
              <TextInput
                value={preco} onChangeText={setPreco}
                placeholder="0,00" placeholderTextColor={C.text4}
                keyboardType="decimal-pad"
                style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 16, color: C.text }}
              />
            </View>
          </Campo>

          {/* Validade */}
          <Campo label="Validade">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {VALIDADE_OPTS.map(({ label, value }) => (
                <TouchableOpacity
                  key={value}
                  onPress={() => setValidade(value)}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
                    backgroundColor: validade === value ? C.primarySoft : C.surface,
                    borderWidth: 1, borderColor: validade === value ? C.primary : C.border,
                  }}
                >
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: validade === value ? C.primary : C.text3 }}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Campo>

          {/* Serviços */}
          <View style={{ marginBottom: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text }}>
                Serviços incluídos *
              </Text>
              {qtdSelecionados > 0 && (
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.accent }}>
                  {qtdSelecionados} {qtdSelecionados === 1 ? 'selecionado' : 'selecionados'}
                </Text>
              )}
            </View>

            {servicos.map((s) => {
              const isSel = selecionados[s.id] !== undefined;
              const cat   = resolverCategoria(s.categoria ?? 'outros') as CategoriaServico;
              return (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => toggleServico(s.id)}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    backgroundColor: isSel ? '#FAF8FF' : C.surface,
                    borderWidth: 1, borderColor: isSel ? C.accent : C.border,
                    borderRadius: 12, padding: 12, marginBottom: 6,
                  }}
                >
                  <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <CategoriaIcon categoria={cat} size={15} color={C.accent} />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
                      {s.nome}
                    </Text>
                    <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3 }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(s.preco)}
                    </Text>
                  </View>

                  {/* Qty (só quando selecionado) */}
                  {isSel && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <TouchableOpacity
                        onPress={() => changeQtd(s.id, -1)}
                        style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.primary, lineHeight: 16 }}>−</Text>
                      </TouchableOpacity>
                      <View style={{ alignItems: 'center' }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.primary }}>
                          {selecionados[s.id]}
                        </Text>
                        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 8, color: C.text4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          sessões
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => changeQtd(s.id, 1)}
                        style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.primary, lineHeight: 16 }}>+</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Checkbox */}
                  <View style={{
                    width: 20, height: 20, borderRadius: 6,
                    backgroundColor: isSel ? C.primary : C.surface,
                    borderWidth: 1.5, borderColor: isSel ? C.primary : C.border,
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    {isSel && <Text style={{ color: '#fff', fontSize: 10, fontFamily: 'PlusJakartaSans_700Bold' }}>✓</Text>}
                  </View>
                </TouchableOpacity>
              );
            })}

            {servicos.length === 0 && (
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3, textAlign: 'center', paddingVertical: 16 }}>
                Nenhum serviço ativo cadastrado.
              </Text>
            )}
          </View>

          {/* Botão */}
          <TouchableOpacity
            onPress={salvar}
            disabled={!podeSalvar || salvando}
            style={{
              backgroundColor: podeSalvar ? C.primary : C.border,
              borderRadius: 14, height: 54,
              alignItems: 'center', justifyContent: 'center',
              opacity: salvando ? 0.7 : 1,
            }}
          >
            {salvando
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: podeSalvar ? '#fff' : C.text3 }}>
                  Criar pacote
                </Text>
            }
          </TouchableOpacity>
        </MotiView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
