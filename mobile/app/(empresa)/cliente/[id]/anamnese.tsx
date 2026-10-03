import { useState, useEffect, useRef } from 'react';
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
import { usePermissoes } from '@/lib/permissions';
import { useClienteDetalhe } from '@/hooks/useClientes';
import {
  ANAMNESE_VAZIA, normalizarAnamnese, ehRestricao, PERGUNTAS_SIM_NAO, PERGUNTAS_OPCOES,
  TEXTO_DECLARACAO, type AnamneseRespostas,
} from '@shared/anamnese';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  red: '#C0392B', redSoft: '#FEF2F2',
  text: '#1A1228', text3: '#8878A6', text4: '#B8AECC',
};

/** Chip de seleção (mesmo visual para Sim/Não e para as demais opções). */
function Chip({ ativo, rotulo, onPress }: { ativo: boolean; rotulo: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
        backgroundColor: ativo ? C.primary : C.surface,
        borderWidth: 1, borderColor: ativo ? C.primary : C.border,
        flexDirection: 'row', alignItems: 'center', gap: 6,
      }}
    >
      {ativo && <Check size={11} color="#fff" strokeWidth={2.5} />}
      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? '#fff' : C.text3 }}>
        {rotulo}
      </Text>
    </TouchableOpacity>
  );
}

const caixaTexto = {
  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14,
  paddingHorizontal: 14, paddingTop: 12,
  shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
} as const;
const inputTexto = {
  fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text,
  minHeight: 52, paddingBottom: 12, textAlignVertical: 'top',
} as const;

// ── Tela ─────────────────────────────────────────────────────

export default function Anamnese() {
  const { id }  = useLocalSearchParams<{ id: string }>();
  const insets  = useSafeAreaInsets();
  const qc      = useQueryClient();
  const { empresaAtiva } = useAuthStore();
  const { pode } = usePermissoes();
  const podeEditarAnamnese = pode('anamnese.editar');

  // Edição da ficha só com 'anamnese.editar'; sem ela, volta com aviso.
  useEffect(() => {
    if (podeEditarAnamnese) return;
    Alert.alert('Sem permissão', 'Você não tem permissão para editar a ficha de anamnese.');
    router.back();
  }, [podeEditarAnamnese]);

  const { data: cliente } = useClienteDetalhe(id);
  const [respostas, setRespostas] = useState<AnamneseRespostas>(ANAMNESE_VAZIA);
  const [salvando, setSalvando]   = useState(false);
  const existeAnamnese = !!cliente?.anamnese;
  // Se a ficha existente falhou ao carregar, não deixamos salvar (sobrescreveria a ficha real).
  const erroAnamnese = cliente?.erroAnamnese;

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  });

  // Inicializa o formulário UMA vez com a ficha carregada: um refetch em segundo
  // plano não pode apagar o que a pessoa já está preenchendo.
  const iniciado = useRef(false);
  useEffect(() => {
    if (!cliente || iniciado.current) return;
    iniciado.current = true;
    setRespostas(normalizarAnamnese(cliente.anamnese?.respostas));
  }, [cliente]);

  if (!fontsLoaded || !cliente) return null;

  async function salvar() {
    if (!empresaAtiva || erroAnamnese) return;
    if (!respostas.declaracao_aceita) {
      Alert.alert('Declaração', 'A cliente precisa aceitar a declaração antes de salvar.');
      return;
    }
    setSalvando(true);
    const { data: { user } } = await supabase.auth.getUser();
    const dados: AnamneseRespostas = { ...respostas, salvo_em: new Date().toISOString() };
    const { data, error } = await supabase.from('anamnese_fichas')
      .upsert({
        empresa_id: empresaAtiva.id, cliente_id: id, respostas: dados,
        profissional_id: user?.id ?? null, updated_at: new Date().toISOString(),
      }, { onConflict: 'empresa_id,cliente_id' })
      .select('id');
    setSalvando(false);
    if (error) { Alert.alert('Erro', error.message); return; }
    if (!data || data.length === 0) { Alert.alert('Erro', 'Sem permissão para salvar a ficha.'); return; }
    qc.invalidateQueries({ queryKey: ['cliente-detalhe', empresaAtiva.id, id] });
    Alert.alert('Ficha salva!', 'Anamnese atualizada com sucesso.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  const bloqueado = !respostas.declaracao_aceita || salvando || !!erroAnamnese;

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
          {erroAnamnese && (
            <View style={{ backgroundColor: C.redSoft, borderWidth: 1, borderColor: C.red, borderRadius: 14, padding: 14, marginBottom: 20 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.red }}>
                Não foi possível carregar a ficha de anamnese: {erroAnamnese}
              </Text>
            </View>
          )}

          {PERGUNTAS_SIM_NAO.map((p) => {
            const r = respostas[p.key];
            return (
              <View key={p.key} style={{ marginBottom: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  {r.resposta === 'sim' && ehRestricao(p.key) && (
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.red }} />
                  )}
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>{p.label}</Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(['sim', 'nao'] as const).map((v) => (
                    <Chip
                      key={v} ativo={r.resposta === v} rotulo={v === 'sim' ? 'Sim' : 'Não'}
                      onPress={() => setRespostas((s) => ({ ...s, [p.key]: { ...s[p.key], resposta: v } }))}
                    />
                  ))}
                </View>
                {r.resposta === 'sim' && (
                  <View style={[caixaTexto, { marginTop: 10 }]}>
                    <TextInput
                      value={r.detalhe}
                      onChangeText={(t) => setRespostas((s) => ({ ...s, [p.key]: { ...s[p.key], detalhe: t } }))}
                      placeholder={p.placeholder}
                      placeholderTextColor={C.text4}
                      multiline
                      numberOfLines={2}
                      autoCapitalize="sentences"
                      style={inputTexto}
                    />
                  </View>
                )}
                <View style={{ height: 1, backgroundColor: C.border, marginTop: 16 }} />
              </View>
            );
          })}

          {PERGUNTAS_OPCOES.map((p) => (
            <View key={p.key} style={{ marginBottom: 20 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text, marginBottom: 8 }}>{p.label}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {p.opcoes.map((o) => (
                  <Chip
                    key={o.valor} ativo={respostas[p.key] === o.valor} rotulo={o.rotulo}
                    onPress={() => setRespostas((s) => ({ ...s, [p.key]: o.valor } as AnamneseRespostas))}
                  />
                ))}
              </View>
              <View style={{ height: 1, backgroundColor: C.border, marginTop: 16 }} />
            </View>
          ))}

          <View style={{ marginBottom: 20 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text, marginBottom: 8 }}>Informações adicionais</Text>
            <View style={caixaTexto}>
              <TextInput
                value={respostas.info_adicionais}
                onChangeText={(t) => setRespostas((s) => ({ ...s, info_adicionais: t }))}
                placeholder="Observações relevantes"
                placeholderTextColor={C.text4}
                multiline
                numberOfLines={3}
                autoCapitalize="sentences"
                style={inputTexto}
              />
            </View>
          </View>

          {/* Declaração obrigatória */}
          <TouchableOpacity
            onPress={() => setRespostas((s) => ({ ...s, declaracao_aceita: !s.declaracao_aceita }))}
            activeOpacity={0.8}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: C.primarySoft, borderRadius: 14, padding: 14 }}
          >
            <View style={{
              width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, marginTop: 1,
              borderColor: C.primary, backgroundColor: respostas.declaracao_aceita ? C.primary : C.surface,
              alignItems: 'center', justifyContent: 'center',
            }}>
              {respostas.declaracao_aceita && <Check size={14} color="#fff" strokeWidth={3} />}
            </View>
            <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, lineHeight: 18, color: C.text }}>
              {TEXTO_DECLARACAO}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Botão fixo */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: 24, paddingTop: 12, paddingBottom: insets.bottom + 12 }}>
        <TouchableOpacity onPress={salvar} disabled={bloqueado} activeOpacity={0.85} style={{ opacity: bloqueado ? 0.5 : 1 }}>
          <LinearGradient colors={['#2C1654', '#4A2480']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ borderRadius: 16, paddingVertical: 16, alignItems: 'center', shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
            {salvando ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff', letterSpacing: 0.3 }}>{existeAnamnese ? 'Atualizar Ficha' : 'Salvar Ficha'}</Text>}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
