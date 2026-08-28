import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StatusBar, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { ChevronLeft, Clock } from 'lucide-react-native';
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
import { CategoriaIcon, CategoriaIconCustom } from '@/components/CategoriaIcon';
import { CategoriaPicker } from '@/components/CategoriaPicker';
import { resolverCategoriaServico, type CategoriaCustom } from '@shared/categorias';
import SuccessCheck from '@/components/SuccessCheck';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F',
  text: '#1A1228', text3: '#8878A6', text4: '#B8AECC',
};

const DURACOES = [
  { label: '30 min', valor: 30 },
  { label: '45 min', valor: 45 },
  { label: '1h',     valor: 60 },
  { label: '1h30',   valor: 90 },
  { label: '2h',     valor: 120 },
  { label: '3h',     valor: 180 },
];

// ── Campo simples ─────────────────────────────────────────────

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

const inputStyle = {
  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  borderRadius: 12, paddingHorizontal: 14, height: 48,
  fontFamily: 'PlusJakartaSans_500Medium', fontSize: 15, color: C.text,
} as const;

// ── Tela ─────────────────────────────────────────────────────

export default function NovoServico() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva } = useAuthStore();
  const qc = useQueryClient();

  const [nome,      setNome]      = useState('');
  const [descricao, setDescricao] = useState('');
  const [categoria,   setCategoria]   = useState<string | null>('outros');
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [customs,     setCustoms]      = useState<CategoriaCustom[]>([]);
  const [preco,     setPreco]     = useState('');
  const [custo,     setCusto]     = useState('');
  const [duracao,   setDuracao]   = useState(60);
  const [salvando,  setSalvando]  = useState(false);
  const [sucesso,   setSucesso]   = useState(false);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  });

  useEffect(() => {
    if (!empresaAtiva) return;
    supabase.from('categorias_servico').select('*').eq('empresa_id', empresaAtiva.id).order('nome')
      .then(({ data }) => setCustoms((data ?? []) as CategoriaCustom[]));
  }, [empresaAtiva]);

  if (!fontsLoaded) return null;

  const podeSalvar = nome.trim().length > 1 && parseFloat(preco.replace(',', '.')) > 0;

  function parseValor(v: string) {
    return parseFloat(v.replace(',', '.')) || 0;
  }

  async function salvar() {
    if (!podeSalvar || !empresaAtiva) return;
    setSalvando(true);

    const { error } = await supabase.from('servicos').insert({
      empresa_id:       empresaAtiva.id,
      nome:             nome.trim(),
      descricao:        descricao.trim() || null,
      categoria:        categoriaId ? null : categoria,
      categoria_id:     categoriaId,
      preco:            parseValor(preco),
      custo:            parseValor(custo),
      duracao_minutos:  duracao,
      ativo:            true,
    });

    setSalvando(false);
    if (error) { Alert.alert('Erro', error.message); return; }

    qc.invalidateQueries({ queryKey: ['servicos-gestao'] });
    qc.invalidateQueries({ queryKey: ['servicos-empresa'] });
    setSucesso(true);
    setTimeout(() => router.back(), 1300);
  }

  if (sucesso) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: insets.top }}>
        <StatusBar barStyle="dark-content" />
        <SuccessCheck size={72} />
        <MotiView from={{ translateY: 12, opacity: 0 }} animate={{ translateY: 0, opacity: 1 }}
          transition={{ type: 'timing', duration: 350, delay: 150 }}
          style={{ alignItems: 'center', marginTop: 16 }}>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 22, color: C.text, textAlign: 'center' }}>
            Serviço criado!
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text3, textAlign: 'center', marginTop: 6 }}>
            {nome}
          </Text>
        </MotiView>
      </View>
    );
  }

  const catRes = resolverCategoriaServico(categoria, categoriaId, customs);
  const catCor = catRes.cor;
  const catBg  = catRes.bg;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">

        {/* Hero */}
        <LinearGradient colors={['#2C1654', '#3D1F72']} style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 24 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <ChevronLeft size={16} color="#fff" strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
            {empresaAtiva?.nome}
          </Text>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: '#fff' }}>
            Novo Serviço
          </Text>
        </LinearGradient>

        <MotiView from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 350, delay: 60 }} style={{ padding: 24 }}>

          {/* Nome */}
          <Campo label="Nome do serviço *">
            <TextInput
              value={nome} onChangeText={setNome}
              placeholder="Ex: Design de Sobrancelha"
              placeholderTextColor={C.text4}
              style={inputStyle}
            />
          </Campo>

          {/* Descrição */}
          <Campo label="Descrição (opcional)">
            <TextInput
              value={descricao} onChangeText={setDescricao}
              placeholder="Detalhes do serviço..."
              placeholderTextColor={C.text4}
              multiline numberOfLines={3}
              style={[inputStyle, { height: 80, paddingTop: 12, textAlignVertical: 'top' }]}
            />
          </Campo>

          {/* Categoria */}
          <Campo label="Categoria">
            <CategoriaPicker
              empresaId={empresaAtiva?.id ?? ''}
              customs={customs}
              categoria={categoria}
              categoriaId={categoriaId}
              onSelect={(c, id) => { setCategoria(c); setCategoriaId(id); }}
              onCustomCriada={(c) => setCustoms((prev) => [...prev, c])}
            />
          </Campo>

          {/* Preço e Custo */}
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 8 }}>
                Preço cobrado *
              </Text>
              <View style={{ ...inputStyle, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text3 }}>R$</Text>
                <TextInput
                  value={preco} onChangeText={setPreco}
                  placeholder="0,00" placeholderTextColor={C.text4}
                  keyboardType="decimal-pad"
                  style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 16, color: C.text }}
                />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 8 }}>
                Custo (opcional)
              </Text>
              <View style={{ ...inputStyle, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text3 }}>R$</Text>
                <TextInput
                  value={custo} onChangeText={setCusto}
                  placeholder="0,00" placeholderTextColor={C.text4}
                  keyboardType="decimal-pad"
                  style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 16, color: C.text }}
                />
              </View>
            </View>
          </View>

          {/* Duração */}
          <Campo label="Duração">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {DURACOES.map(({ label, valor }) => (
                <TouchableOpacity
                  key={valor}
                  onPress={() => setDuracao(valor)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 5,
                    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
                    backgroundColor: duracao === valor ? C.primarySoft : C.surface,
                    borderWidth: 1,
                    borderColor: duracao === valor ? C.primary : C.border,
                  }}
                >
                  <Clock size={12} color={duracao === valor ? C.primary : C.text3} strokeWidth={2} />
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12,
                    color: duracao === valor ? C.primary : C.text3,
                  }}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Campo>

          {/* Preview do card */}
          <View style={{ backgroundColor: catBg, borderWidth: 1, borderColor: `${catCor}30`, borderRadius: 14, padding: 14, marginBottom: 24, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {catRes.iconeCustom
              ? <CategoriaIconCustom name={catRes.iconeCustom} size={36} color={catCor} />
              : <CategoriaIcon categoria={catRes.iconeBuiltin ?? 'outros'} size={36} color={catCor} />}
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text }}>
                {nome || 'Nome do serviço'}
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 2 }}>
                {duracao} min · {preco ? `R$ ${preco}` : 'Preço não definido'}
              </Text>
            </View>
          </View>

          {/* Botão */}
          <TouchableOpacity
            onPress={salvar} disabled={!podeSalvar || salvando}
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
                  Criar serviço
                </Text>
            }
          </TouchableOpacity>

        </MotiView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
