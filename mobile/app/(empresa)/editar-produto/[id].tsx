import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform,
  StatusBar, ActivityIndicator, Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { ChevronLeft, Trash2 } from 'lucide-react-native';
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
import { useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

// ── Constantes (iguais ao novo-produto) ────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  red: '#C0392B', redSoft: '#FEF2F2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const CATEGORIAS = [
  'Cabelo', 'Depilação', 'Higiene', 'Maquiagem',
  'Massagem', 'Outros', 'Pele', 'Unhas',
];

const UNIDADES = ['un', 'ml', 'L', 'g', 'kg', 'cx', 'fr', 'par'];

// ── Helpers ──────────────────────────────────────────────────

function parseBRLFloat(str: string): number {
  return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
}

// ── Componentes auxiliares (iguais ao novo-produto) ────────────

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

export default function EditarProdutoScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { empresaAtiva } = useAuthStore();
  const qc = useQueryClient();

  const [nome,           setNome]           = useState('');
  const [categoria,      setCategoria]      = useState('');
  const [unidade,        setUnidade]        = useState('un');
  const [precoCusto,     setPrecoCusto]     = useState('');
  const [estoqueAtual,   setEstoqueAtual]   = useState('');
  const [estoqueMinimo,  setEstoqueMinimo]  = useState('');
  const [carregando,     setCarregando]     = useState(true);
  const [salvando,       setSalvando]       = useState(false);
  const [excluindo,      setExcluindo]      = useState(false);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  // Carrega dados do produto
  useEffect(() => {
    if (!id) return;
    supabase.from('produtos').select('*').eq('id', id).single()
      .then(({ data }) => {
        if (data) {
          setNome(data.nome ?? '');
          setCategoria(data.categoria ?? '');
          setUnidade(data.unidade ?? 'un');
          setPrecoCusto(data.preco_custo ? String(data.preco_custo) : '');
          setEstoqueAtual(data.estoque_atual != null ? String(data.estoque_atual) : '');
          setEstoqueMinimo(data.estoque_minimo != null ? String(data.estoque_minimo) : '');
        }
        setCarregando(false);
      });
  }, [id]);

  if (!fontsLoaded || carregando) return null;

  async function handleSalvar() {
    if (!nome.trim()) {
      Alert.alert('Campo obrigatório', 'Informe o nome do produto.');
      return;
    }
    if (!categoria) {
      Alert.alert('Campo obrigatório', 'Selecione uma categoria.');
      return;
    }

    setSalvando(true);
    const { error } = await supabase.from('produtos').update({
      nome:            nome.trim(),
      categoria,
      unidade,
      preco_custo:     parseBRLFloat(precoCusto),
      estoque_minimo:  parseBRLFloat(estoqueMinimo),
      estoque_atual:   parseBRLFloat(estoqueAtual),
    }).eq('id', id!).eq('empresa_id', empresaAtiva!.id);
    setSalvando(false);
    if (error) { Alert.alert('Erro', error.message); return; }
    qc.invalidateQueries({ queryKey: ['estoque', empresaAtiva?.id] });
    router.back();
  }

  function confirmarExcluir() {
    Alert.alert(
      'Excluir produto',
      `"${nome}" será removido do estoque. Essa ação não pode ser desfeita.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir', style: 'destructive', onPress: excluir },
      ]
    );
  }

  async function excluir() {
    if (!id) return;
    setExcluindo(true);
    const { error } = await supabase.from('produtos')
      .delete().eq('id', id).eq('empresa_id', empresaAtiva!.id);
    if (error) {
      // Produto tem movimentações/vendas/comandas vinculadas (FK) — desativa em vez de excluir
      const { error: errDesativar } = await supabase.from('produtos')
        .update({ ativo: false }).eq('id', id).eq('empresa_id', empresaAtiva!.id);
      setExcluindo(false);
      if (errDesativar) { Alert.alert('Erro', errDesativar.message); return; }
      qc.invalidateQueries({ queryKey: ['estoque', empresaAtiva?.id] });
      router.back();
      return;
    }
    setExcluindo(false);
    qc.invalidateQueries({ queryKey: ['estoque', empresaAtiva?.id] });
    router.back();
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
          <Text style={{ fontFamily: 'Fraunces_700Bold', fontSize: 22, color: C.text }} numberOfLines={1}>
            {nome || 'Editar Produto'}
          </Text>
        </View>
        <TouchableOpacity
          onPress={confirmarExcluir}
          disabled={excluindo}
          style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: C.redSoft, alignItems: 'center', justifyContent: 'center', opacity: excluindo ? 0.6 : 1 }}
        >
          {excluindo
            ? <ActivityIndicator size="small" color={C.red} />
            : <Trash2 size={16} color={C.red} strokeWidth={2} />
          }
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 100 }} keyboardShouldPersistTaps="handled">
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

          {/* Estoque atual */}
          <Field
            label="Estoque atual"
            value={estoqueAtual}
            onChange={setEstoqueAtual}
            placeholder={`Quantidade em ${unidade}`}
            keyboardType="decimal-pad"
            opcional
          />

          {/* Estoque mínimo */}
          <Field
            label="Estoque mínimo (alerta)"
            value={estoqueMinimo}
            onChange={setEstoqueMinimo}
            placeholder="Qtd. mínima antes do alerta"
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
          disabled={salvando}
          style={{ backgroundColor: C.primary, borderRadius: 16, padding: 17, alignItems: 'center' }}
        >
          {salvando
            ? <ActivityIndicator color="#fff" />
            : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff' }}>
                Salvar alterações
              </Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
