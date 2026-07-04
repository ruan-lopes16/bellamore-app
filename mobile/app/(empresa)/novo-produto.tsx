import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform,
  StatusBar, ActivityIndicator, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { ChevronLeft, Package } from 'lucide-react-native';
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

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  red: '#C0392B',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const CATEGORIAS = [
  'Cabelo', 'Pele', 'Unhas', 'Maquiagem',
  'Depilação', 'Massagem', 'Higiene', 'Outros',
];

const UNIDADES = ['un', 'ml', 'L', 'g', 'kg', 'cx', 'fr', 'par'];

// ── Helpers ──────────────────────────────────────────────────

function parseBRLFloat(str: string): number {
  return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
}

// ── Componentes auxiliares ───────────────────────────────────

function Label({ children }: { children: string }) {
  return (
    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
      {children}
    </Text>
  );
}

function Field({
  label, value, onChange, placeholder, keyboardType = 'default', opcional = false,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; keyboardType?: 'default' | 'decimal-pad' | 'numeric';
  opcional?: boolean;
}) {
  return (
    <View style={{ marginBottom: 20 }}>
      <View style={{ flexDirection: 'row', gap: 4, marginBottom: 8 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3, letterSpacing: 1, textTransform: 'uppercase' }}>
          {label}
        </Text>
        {opcional && (
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }}>
            (opcional)
          </Text>
        )}
      </View>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.text4}
        keyboardType={keyboardType}
        style={{
          backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
          borderRadius: 12, padding: 14,
          fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text,
        }}
      />
    </View>
  );
}

function ChipSelector({ label, options, value, onChange }: {
  label: string; options: string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Label>{label}</Label>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {options.map((opt) => {
          const ativo = value === opt;
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => onChange(opt)}
              style={{
                paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20,
                backgroundColor: ativo ? C.primary : C.surface,
                borderWidth: 1, borderColor: ativo ? C.primary : C.border,
              }}
            >
              <Text style={{
                fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13,
                color: ativo ? '#fff' : C.text3,
              }}>
                {opt}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── Tela ─────────────────────────────────────────────────────

export default function NovoProdutoScreen() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva } = useAuthStore();

  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState('');
  const [unidade, setUnidade] = useState('un');
  const [precoCusto, setPrecoCusto] = useState('');
  const [estoqueMinimo, setEstoqueMinimo] = useState('');
  const [estoqueInicial, setEstoqueInicial] = useState('');
  const [loading, setLoading] = useState(false);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  async function handleSalvar() {
    if (!nome.trim()) {
      Alert.alert('Campo obrigatório', 'Informe o nome do produto.');
      return;
    }
    if (!categoria) {
      Alert.alert('Campo obrigatório', 'Selecione uma categoria.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from('produtos').insert({
        empresa_id:      empresaAtiva!.id,
        nome:            nome.trim(),
        categoria,
        unidade,
        preco_custo:     parseBRLFloat(precoCusto),
        estoque_minimo:  parseBRLFloat(estoqueMinimo),
        estoque_atual:   parseBRLFloat(estoqueInicial),
        ativo:           true,
      });

      if (error) throw error;

      router.back();
    } catch (err: any) {
      Alert.alert('Erro', err?.message ?? 'Não foi possível salvar o produto.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={{
        paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 16,
        flexDirection: 'row', alignItems: 'center', gap: 12,
      }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
          <ChevronLeft size={22} color={C.text} strokeWidth={2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 2 }}>
            Estoque
          </Text>
          <Text style={{ fontFamily: 'Fraunces_700Bold', fontSize: 22, color: C.text }}>
            Novo Produto
          </Text>
        </View>
        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Package size={18} color={C.primary} strokeWidth={2} />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 100 }}>
        <MotiView from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 350 }}>

          {/* Nome */}
          <Field
            label="Nome do produto"
            value={nome}
            onChange={setNome}
            placeholder="Ex: Shampoo Profissional 1L"
          />

          {/* Categoria */}
          <ChipSelector
            label="Categoria"
            options={CATEGORIAS}
            value={categoria}
            onChange={setCategoria}
          />

          {/* Unidade */}
          <ChipSelector
            label="Unidade"
            options={UNIDADES}
            value={unidade}
            onChange={setUnidade}
          />

          {/* Preço de custo */}
          <Field
            label="Preço de custo"
            value={precoCusto}
            onChange={setPrecoCusto}
            placeholder="0,00"
            keyboardType="decimal-pad"
            opcional
          />

          {/* Estoque inicial */}
          <Field
            label="Estoque inicial"
            value={estoqueInicial}
            onChange={setEstoqueInicial}
            placeholder={`Quantidade em ${unidade}`}
            keyboardType="decimal-pad"
            opcional
          />

          {/* Estoque mínimo */}
          <Field
            label="Estoque mínimo (alerta)"
            value={estoqueMinimo}
            onChange={setEstoqueMinimo}
            placeholder={`Qtd. mínima antes do alerta`}
            keyboardType="decimal-pad"
            opcional
          />

        </MotiView>
      </ScrollView>

      {/* Botão salvar fixo */}
      <View style={{
        position: 'absolute', bottom: insets.bottom + 16, left: 24, right: 24,
      }}>
        <TouchableOpacity
          onPress={handleSalvar}
          disabled={loading}
          style={{ backgroundColor: C.primary, borderRadius: 16, padding: 17, alignItems: 'center' }}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff' }}>
                Salvar Produto
              </Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
