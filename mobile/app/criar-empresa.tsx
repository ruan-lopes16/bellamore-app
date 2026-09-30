import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform,
  ActivityIndicator, StatusBar, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { Building2, Phone, MapPin } from 'lucide-react-native';
import { useFonts, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { maskPhone } from '@shared/mascaras';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654',
  text: '#1A1228', text3: '#8878A6', text4: '#B8AECC',
  red: '#C0392B',
};

function Campo({
  label, value, onChangeText, placeholder, keyboardType, icon, maxLength, autoCapitalize,
}: {
  label: string; value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  keyboardType?: any;
  maxLength?: number;
  autoCapitalize?: any;
  icon: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 6 }}>
        {label}
      </Text>
      <View style={{
        backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
        borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14,
        shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
      }}>
        <View style={{ marginRight: 10 }}>{icon}</View>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={C.text4}
          keyboardType={keyboardType}
          maxLength={maxLength}
          autoCapitalize={autoCapitalize ?? 'none'}
          style={{ flex: 1, paddingVertical: 14, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text }}
        />
      </View>
    </View>
  );
}

/**
 * Criação do primeiro estúdio (mesmo fluxo do web /criar-empresa).
 * Chama a RPC `criar_empresa_completo`; o _layout raiz redireciona para a home
 * quando o papel aparece após recarregar a sessão.
 */
export default function CriarEmpresa() {
  const insets = useSafeAreaInsets();
  const [nome, setNome]         = useState('');
  const [telefone, setTelefone] = useState('');
  const [endereco, setEndereco] = useState('');
  const [erro, setErro]         = useState('');
  const [salvando, setSalvando] = useState(false);

  const [fontsLoaded] = useFonts({
    Fraunces_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  async function criar() {
    setErro('');
    setSalvando(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/(auth)/login' as any); return; }

    const { error } = await supabase.rpc('criar_empresa_completo', {
      p_nome:     nome.trim(),
      p_telefone: telefone.trim() || null,
      p_endereco: endereco.trim() || null,
    });
    if (error) { setErro(error.message); setSalvando(false); return; }

    await useAuthStore.getState().carregarSessao();
    setSalvando(false);
    // o _layout raiz redireciona para o dashboard quando roleAtivo aparece
  }

  const desabilitado = salvando || !nome.trim();

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <StatusBar barStyle="light-content" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <LinearGradient
          colors={['#2C1654', '#3D1F72']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ paddingTop: insets.top + 40, paddingHorizontal: 32, paddingBottom: 40 }}
        >
          <MotiView
            from={{ opacity: 0, translateY: -12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500 }}
          >
            <View style={{
              width: 56, height: 56, borderRadius: 18,
              backgroundColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)',
              alignItems: 'center', justifyContent: 'center', marginBottom: 20,
            }}>
              <Text style={{ fontFamily: 'Fraunces_700Bold', fontSize: 26, color: '#fff' }}>✦</Text>
            </View>
            <Text style={{ fontFamily: 'Fraunces_700Bold', fontSize: 34, color: '#fff', lineHeight: 40, marginBottom: 8 }}>
              Seu estúdio
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
              Cadastre as informações do seu negócio
            </Text>
          </MotiView>
        </LinearGradient>

        <MotiView
          from={{ opacity: 0, translateY: 16 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 420, delay: 100 }}
          style={{ flex: 1, paddingHorizontal: 24, paddingTop: 32, paddingBottom: insets.bottom + 24 }}
        >
          <Campo
            label="Nome do estúdio / salão *"
            value={nome}
            onChangeText={setNome}
            placeholder="Ex: Studio Bella Arte"
            autoCapitalize="words"
            icon={<Building2 size={16} color={C.text4} strokeWidth={1.8} />}
          />
          <Campo
            label="Telefone (opcional)"
            value={telefone}
            onChangeText={(v) => setTelefone(maskPhone(v))}
            placeholder="(11) 99999-9999"
            keyboardType="phone-pad"
            maxLength={15}
            icon={<Phone size={16} color={C.text4} strokeWidth={1.8} />}
          />
          <Campo
            label="Endereço (opcional)"
            value={endereco}
            onChangeText={setEndereco}
            placeholder="Rua, número, bairro"
            autoCapitalize="sentences"
            icon={<MapPin size={16} color={C.text4} strokeWidth={1.8} />}
          />

          {erro ? (
            <Text style={{ color: C.red, fontSize: 13, textAlign: 'center', marginBottom: 12 }}>{erro}</Text>
          ) : null}

          <TouchableOpacity onPress={criar} disabled={desabilitado} activeOpacity={0.85} style={{ marginTop: 10, marginBottom: 16 }}>
            <LinearGradient
              colors={['#2C1654', '#4A2480']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={{
                borderRadius: 16, paddingVertical: 16, alignItems: 'center',
                shadowColor: C.primary, shadowOpacity: 0.3,
                shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
                opacity: desabilitado ? 0.6 : 1,
              }}
            >
              {salvando
                ? <ActivityIndicator color="#fff" />
                : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff', letterSpacing: 0.3 }}>
                    Criar estúdio
                  </Text>}
            </LinearGradient>
          </TouchableOpacity>

          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3, textAlign: 'center' }}>
            Você poderá editar essas informações depois em Configurações.
          </Text>
        </MotiView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
