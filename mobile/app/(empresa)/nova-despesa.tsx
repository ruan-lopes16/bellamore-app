import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StatusBar, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { ChevronLeft, DollarSign, FileText, RefreshCw, Calendar, Check } from 'lucide-react-native';
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

import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F',
  amber: '#B45309', amberSoft: '#FEF3E2',
  text: '#1A1228', text3: '#8878A6', text4: '#B8AECC',
};

const CATEGORIAS = [
  'Aluguel', 'Energia', 'Água', 'Internet', 'Produtos / Insumos',
  'Manutenção', 'Marketing', 'Contabilidade', 'Outros',
];

const PERIODICIDADES = [
  { key: 'semanal', label: 'Semanal' },
  { key: 'mensal', label: 'Mensal' },
  { key: 'trimestral', label: 'Trimestral' },
  { key: 'semestral', label: 'Semestral' },
  { key: 'anual', label: 'Anual' },
];

// ── Campo simples ─────────────────────────────────────────────

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 6 }}>
        {label}
      </Text>
      {children}
    </View>
  );
}

// ── Tela ─────────────────────────────────────────────────────

export default function NovaDespesa() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva } = useAuthStore();
  const qc = useQueryClient();

  const [descricao, setDescricao]       = useState('');
  const [valor, setValor]               = useState('');
  const [categoria, setCategoria]       = useState('');
  const [recorrente, setRecorrente]     = useState(false);
  const [periodicidade, setPeriodicidade] = useState<'mensal' | 'semanal' | 'trimestral' | 'semestral' | 'anual'>('mensal');
  const [vencimento, setVencimento]     = useState('');
  const [salvando, setSalvando]         = useState(false);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  function mascaraData(v: string) {
    const n = v.replace(/\D/g, '').slice(0, 8);
    if (n.length <= 2) return n;
    if (n.length <= 4) return `${n.slice(0, 2)}/${n.slice(2)}`;
    return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n.slice(4)}`;
  }

  function dataParaBanco(v: string): string | null {
    const p = v.split('/');
    if (p.length !== 3 || p[2].length !== 4) return null;
    return `${p[2]}-${p[1]}-${p[0]}`;
  }

  const podeSalvar = descricao.trim().length > 1 && parseFloat(valor.replace(',', '.')) > 0;

  async function salvar() {
    if (!podeSalvar || !empresaAtiva) return;
    setSalvando(true);

    const { error } = await supabase.from('despesas').insert({
      empresa_id:      empresaAtiva.id,
      descricao:       descricao.trim(),
      categoria:       categoria || null,
      valor:           parseFloat(valor.replace(',', '.')),
      recorrente,
      periodicidade:   recorrente ? periodicidade : null,
      data_vencimento: dataParaBanco(vencimento),
      status:          'pendente',
    });

    setSalvando(false);
    if (error) { Alert.alert('Erro', error.message); return; }

    qc.invalidateQueries({ queryKey: ['fin-resumo'] });
    qc.invalidateQueries({ queryKey: ['fin-despesas'] });
    qc.invalidateQueries({ queryKey: ['fin-evolucao'] });
    Alert.alert('Despesa registrada!', descricao, [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <StatusBar barStyle="light-content" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header ── */}
        <LinearGradient
          colors={['#2C1654', '#3D1F72']}
          style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 24 }}
        >
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}
          >
            <ChevronLeft size={16} color="#fff" strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
            {empresaAtiva?.nome}
          </Text>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: '#fff' }}>
            Nova Despesa
          </Text>
        </LinearGradient>

        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 350, delay: 60 }}
          style={{ padding: 24 }}
        >
          {/* Descrição */}
          <Campo label="Descrição *">
            <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}>
              <FileText size={16} color={C.text4} strokeWidth={1.8} style={{ marginRight: 10 }} />
              <TextInput
                value={descricao}
                onChangeText={setDescricao}
                placeholder="Ex: Aluguel do espaço"
                placeholderTextColor={C.text4}
                autoCapitalize="sentences"
                style={{ flex: 1, paddingVertical: 14, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text }}
              />
            </View>
          </Campo>

          {/* Valor */}
          <Campo label="Valor *">
            <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}>
              <DollarSign size={16} color={C.text4} strokeWidth={1.8} style={{ marginRight: 10 }} />
              <TextInput
                value={valor}
                onChangeText={setValor}
                placeholder="0,00"
                placeholderTextColor={C.text4}
                keyboardType="numeric"
                style={{ flex: 1, paddingVertical: 14, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 18, color: C.text, letterSpacing: -0.5 }}
              />
            </View>
          </Campo>

          {/* Categoria */}
          <Campo label="Categoria">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {CATEGORIAS.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setCategoria(c === categoria ? '' : c)}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                    backgroundColor: categoria === c ? C.primary : C.surface,
                    borderWidth: 1, borderColor: categoria === c ? C.primary : C.border,
                  }}
                >
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: categoria === c ? '#fff' : C.text3 }}>
                    {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Campo>

          {/* Vencimento */}
          <Campo label="Data de vencimento">
            <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}>
              <Calendar size={16} color={C.text4} strokeWidth={1.8} style={{ marginRight: 10 }} />
              <TextInput
                value={vencimento}
                onChangeText={(v) => setVencimento(mascaraData(v))}
                placeholder="DD/MM/AAAA"
                placeholderTextColor={C.text4}
                keyboardType="numeric"
                style={{ flex: 1, paddingVertical: 14, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text }}
              />
            </View>
          </Campo>

          {/* Recorrente */}
          <View style={{ height: 1, backgroundColor: C.border, marginBottom: 20 }} />

          <TouchableOpacity
            onPress={() => setRecorrente(!recorrente)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: recorrente ? 16 : 0 }}
          >
            <View style={{
              width: 22, height: 22, borderRadius: 6,
              backgroundColor: recorrente ? C.primary : C.surface,
              borderWidth: 1, borderColor: recorrente ? C.primary : C.border,
              alignItems: 'center', justifyContent: 'center',
            }}>
              {recorrente && <Check size={13} color="#fff" strokeWidth={2.5} />}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <RefreshCw size={15} color={recorrente ? C.primary : C.text3} strokeWidth={2} />
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: recorrente ? C.primary : C.text3 }}>
                Despesa recorrente
              </Text>
            </View>
          </TouchableOpacity>

          {recorrente && (
            <MotiView from={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ type: 'timing', duration: 250 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {PERIODICIDADES.map((p) => (
                  <TouchableOpacity
                    key={p.key}
                    onPress={() => setPeriodicidade(p.key as any)}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
                      backgroundColor: periodicidade === p.key ? C.amberSoft : C.surface,
                      borderWidth: 1, borderColor: periodicidade === p.key ? C.amber : C.border,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: periodicidade === p.key ? C.amber : C.text3 }}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </MotiView>
          )}
        </MotiView>
      </ScrollView>

      {/* Botão fixo */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: 24, paddingTop: 12, paddingBottom: insets.bottom + 12 }}>
        <TouchableOpacity onPress={salvar} disabled={!podeSalvar || salvando} activeOpacity={0.85}>
          <LinearGradient
            colors={podeSalvar ? ['#2C1654', '#4A2480'] : ['#C4BAD4', '#C4BAD4']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={{ borderRadius: 16, paddingVertical: 16, alignItems: 'center', shadowColor: podeSalvar ? C.primary : 'transparent', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: podeSalvar ? 6 : 0 }}
          >
            {salvando ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff', letterSpacing: 0.3 }}>Registrar Despesa</Text>}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
