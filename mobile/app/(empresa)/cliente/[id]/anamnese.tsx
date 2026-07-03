import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StatusBar, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, Check } from 'lucide-react-native';
import {
  useFonts,
  Fraunces_600SemiBold,
} from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useClienteDetalhe } from '@/hooks/useClientes';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  red: '#C0392B', redSoft: '#FEF2F2',
  text: '#1A1228', text3: '#8878A6', text4: '#B8AECC',
};

// ── Perguntas da ficha ────────────────────────────────────────

const PERGUNTAS: { key: string; label: string; tipo: 'texto' | 'opcoes'; opcoes?: string[] }[] = [
  { key: 'alergia',               label: 'Possui alguma alergia?',          tipo: 'texto' },
  { key: 'medicamentos',          label: 'Usa medicamentos?',               tipo: 'texto' },
  { key: 'tipo_pele',             label: 'Tipo de pele',                    tipo: 'opcoes', opcoes: ['Normal', 'Seca', 'Oleosa', 'Mista', 'Sensível'] },
  { key: 'gestante',              label: 'Gestante ou lactante?',           tipo: 'opcoes', opcoes: ['Não', 'Gestante', 'Lactante'] },
  { key: 'sensibilidade',         label: 'Sensibilidade nos olhos?',        tipo: 'opcoes', opcoes: ['Nenhuma', 'Leve', 'Moderada', 'Alta'] },
  { key: 'autoimune',             label: 'Doenças autoimunes?',             tipo: 'texto' },
  { key: 'procedimento_anterior', label: 'Já fez procedimento anterior?',   tipo: 'texto' },
  { key: 'observacoes',           label: 'Observações adicionais',          tipo: 'texto' },
];

// ── Tela ─────────────────────────────────────────────────────

export default function Anamnese() {
  const { id }  = useLocalSearchParams<{ id: string }>();
  const insets  = useSafeAreaInsets();
  const qc      = useQueryClient();
  const { empresaAtiva } = useAuthStore();

  const { data: cliente } = useClienteDetalhe(id);
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [salvando, setSalvando]   = useState(false);
  const existeAnamnese = !!cliente?.anamnese;

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  });

  useEffect(() => {
    if (cliente?.anamnese?.respostas) {
      setRespostas(cliente.anamnese.respostas as Record<string, string>);
    }
  }, [cliente]);

  if (!fontsLoaded || !cliente) return null;

  function setResposta(key: string, valor: string) {
    setRespostas((prev) => ({ ...prev, [key]: valor }));
  }

  async function salvar() {
    if (!empresaAtiva) return;
    setSalvando(true);

    if (existeAnamnese) {
      const { error } = await supabase
        .from('anamnese_fichas')
        .update({ respostas, updated_at: new Date().toISOString() })
        .eq('empresa_id', empresaAtiva.id)
        .eq('cliente_id', id);
      setSalvando(false);
      if (error) { Alert.alert('Erro', error.message); return; }
    } else {
      const { error } = await supabase.from('anamnese_fichas').insert({
        empresa_id:      empresaAtiva.id,
        cliente_id:      id,
        profissional_id: null,
        respostas,
      });
      setSalvando(false);
      if (error) { Alert.alert('Erro', error.message); return; }
    }

    qc.invalidateQueries({ queryKey: ['cliente-detalhe', empresaAtiva.id, id] });
    Alert.alert('Ficha salva!', 'Anamnese atualizada com sucesso.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <LinearGradient colors={['#2C1654', '#3D1F72']} style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 24 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <ChevronLeft size={16} color="#fff" strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
            {cliente.nome}
          </Text>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: '#fff' }}>
            Ficha de Anamnese
          </Text>
        </LinearGradient>

        <View style={{ padding: 24 }}>
          {PERGUNTAS.map((pergunta, i) => {
            const resposta = respostas[pergunta.key] ?? '';
            const isAlerta = pergunta.key === 'alergia' || pergunta.key === 'medicamentos' || pergunta.key === 'gestante' || pergunta.key === 'autoimune';

            return (
              <View key={pergunta.key} style={{ marginBottom: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  {isAlerta && resposta && resposta !== 'Não' && (
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.red }} />
                  )}
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
                    {pergunta.label}
                  </Text>
                </View>

                {pergunta.tipo === 'opcoes' ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {pergunta.opcoes!.map((op) => (
                      <TouchableOpacity
                        key={op}
                        onPress={() => setResposta(pergunta.key, op)}
                        style={{
                          paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
                          backgroundColor: resposta === op ? C.primary : C.surface,
                          borderWidth: 1, borderColor: resposta === op ? C.primary : C.border,
                          flexDirection: 'row', alignItems: 'center', gap: 6,
                        }}
                      >
                        {resposta === op && <Check size={11} color="#fff" strokeWidth={2.5} />}
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: resposta === op ? '#fff' : C.text3 }}>
                          {op}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : (
                  <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingTop: 12, shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}>
                    <TextInput
                      value={resposta}
                      onChangeText={(v) => setResposta(pergunta.key, v)}
                      placeholder="Não"
                      placeholderTextColor={C.text4}
                      multiline
                      numberOfLines={2}
                      autoCapitalize="sentences"
                      style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text, minHeight: 52, paddingBottom: 12, textAlignVertical: 'top' }}
                    />
                  </View>
                )}

                {i < PERGUNTAS.length - 1 && (
                  <View style={{ height: 1, backgroundColor: C.border, marginTop: 16 }} />
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Botão fixo */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: 24, paddingTop: 12, paddingBottom: insets.bottom + 12 }}>
        <TouchableOpacity onPress={salvar} disabled={salvando} activeOpacity={0.85}>
          <LinearGradient colors={['#2C1654', '#4A2480']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ borderRadius: 16, paddingVertical: 16, alignItems: 'center', shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
            {salvando ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff', letterSpacing: 0.3 }}>{existeAnamnese ? 'Atualizar Ficha' : 'Salvar Ficha'}</Text>}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
