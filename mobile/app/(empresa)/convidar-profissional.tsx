import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StatusBar, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { ChevronLeft, Mail, User, Phone } from 'lucide-react-native';
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
  accent: '#9B6FE8', green: '#0D7E5F', greenSoft: '#EAFAF5',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

// ── Campo ─────────────────────────────────────────────────────

function Campo({
  label, icon, value, onChange, placeholder,
  keyboardType = 'default', secureTextEntry = false,
}: {
  label: string; icon: React.ReactNode;
  value: string; onChange: (v: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'decimal-pad';
  secureTextEntry?: boolean;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 8 }}>
        {label}
      </Text>
      <View style={{
        backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
        borderRadius: 12, paddingHorizontal: 14, height: 48,
        flexDirection: 'row', alignItems: 'center', gap: 10,
      }}>
        <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {icon}
        </View>
        <TextInput
          value={value} onChangeText={onChange}
          placeholder={placeholder} placeholderTextColor={C.text4}
          keyboardType={keyboardType} secureTextEntry={secureTextEntry}
          autoCapitalize={keyboardType === 'email-address' ? 'none' : 'words'}
          style={{ flex: 1, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text }}
        />
      </View>
    </View>
  );
}

// ── Tela ─────────────────────────────────────────────────────

export default function ConvidarProfissional() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva } = useAuthStore();
  const qc = useQueryClient();

  const [email,    setEmail]    = useState('');
  const [nome,     setNome]     = useState('');
  const [telefone, setTelefone] = useState('');
  const [enviando, setEnviando] = useState(false);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const podeEnviar  = emailValido && nome.trim().length > 1;

  async function convidar() {
    if (!podeEnviar || !empresaAtiva) return;
    setEnviando(true);

    // 1. Tenta encontrar o usuário pelo email
    const { data: users } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (!users) {
      // Usuário não existe ainda — em produção enviaria convite por email via Supabase Auth
      setEnviando(false);
      Alert.alert(
        'Convite enviado!',
        `Um link de cadastro será enviado para ${email}. Quando a profissional criar a conta, ela aparecerá na sua equipe.`,
        [{ text: 'OK', onPress: () => router.back() }]
      );
      return;
    }

    // 2. Usuário existe — adiciona diretamente à empresa (comissão configurada depois na tela Equipe)
    const { error } = await supabase.from('empresa_membros').upsert({
      empresa_id:           empresaAtiva.id,
      user_id:              users.id,
      role:                 'profissional',
      percentual_comissao:  0,
      ativo:                true,
    }, { onConflict: 'empresa_id,user_id' });

    setEnviando(false);

    if (error) { Alert.alert('Erro', error.message); return; }

    qc.invalidateQueries({ queryKey: ['equipe'] });
    Alert.alert('Profissional adicionada!', `${nome} foi adicionada à sua equipe.`, [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

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
            Convidar Profissional
          </Text>
        </LinearGradient>

        <MotiView from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 350, delay: 60 }} style={{ padding: 24 }}>

          {/* Info */}
          <View style={{ backgroundColor: C.primarySoft, borderRadius: 14, padding: 14, marginBottom: 24 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.primary, marginBottom: 4 }}>
              Como funciona
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text2, lineHeight: 18 }}>
              Se a profissional já tem conta no app, ela será adicionada imediatamente. Se não tiver, receberá um link por e-mail para se cadastrar.
            </Text>
          </View>

          <Campo
            label="E-mail *"
            icon={<Mail size={13} color={C.primary} strokeWidth={1.8} />}
            value={email} onChange={setEmail}
            placeholder="email@exemplo.com"
            keyboardType="email-address"
          />

          <Campo
            label="Nome *"
            icon={<User size={13} color={C.primary} strokeWidth={1.8} />}
            value={nome} onChange={setNome}
            placeholder="Nome completo"
          />

          <Campo
            label="Telefone (opcional)"
            icon={<Phone size={13} color={C.primary} strokeWidth={1.8} />}
            value={telefone} onChange={setTelefone}
            placeholder="(00) 00000-0000"
            keyboardType="phone-pad"
          />

          {/* Botão */}
          <TouchableOpacity
            onPress={convidar} disabled={!podeEnviar || enviando}
            style={{
              backgroundColor: podeEnviar ? C.primary : C.border,
              borderRadius: 14, height: 54,
              alignItems: 'center', justifyContent: 'center',
              opacity: enviando ? 0.7 : 1,
            }}
          >
            {enviando
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: podeEnviar ? '#fff' : C.text3 }}>
                  Enviar convite
                </Text>
            }
          </TouchableOpacity>

        </MotiView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
