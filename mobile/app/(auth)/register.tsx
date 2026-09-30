import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert,
  ActivityIndicator, StatusBar, ScrollView,
} from 'react-native';
import { Link, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { Eye, EyeOff, Mail, Lock, User } from 'lucide-react-native';
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

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654',
  accent: '#9B6FE8',
  text: '#1A1228', text3: '#8878A6', text4: '#B8AECC',
};

// ── Campo de input ───────────────────────────────────────────

function Campo({
  label, value, onChangeText, placeholder,
  secureTextEntry, keyboardType, autoCapitalize,
  icon, rightIcon,
}: {
  label: string; value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: any;
  autoCapitalize?: any;
  icon: React.ReactNode;
  rightIcon?: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{
        fontFamily: 'PlusJakartaSans_600SemiBold',
        fontSize: 12, color: C.text, marginBottom: 6,
      }}>
        {label}
      </Text>
      <View style={{
        backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
        borderRadius: 14, flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 14,
        shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
      }}>
        <View style={{ marginRight: 10 }}>{icon}</View>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={C.text4}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize ?? 'none'}
          style={{
            flex: 1, paddingVertical: 14,
            fontFamily: 'PlusJakartaSans_400Regular',
            fontSize: 14, color: C.text,
          }}
        />
        {rightIcon && <View style={{ marginLeft: 10 }}>{rightIcon}</View>}
      </View>
    </View>
  );
}

// ── Tela ─────────────────────────────────────────────────────

export default function Register() {
  const insets = useSafeAreaInsets();
  const [nome, setNome]            = useState('');
  const [email, setEmail]          = useState('');
  const [senha, setSenha]          = useState('');
  const [confirmar, setConfirmar]  = useState('');
  const [mostrarSenha, setMostrar] = useState(false);
  const [mostrarConfirmar, setMostrarConfirmar] = useState(false);
  const [loading, setLoading]      = useState(false);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  async function cadastrar() {
    if (!nome || !email || !senha) {
      Alert.alert('Atenção', 'Preencha nome, e-mail e senha.');
      return;
    }
    if (senha.length < 6) {
      Alert.alert('Atenção', 'Senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (senha !== confirmar) {
      Alert.alert('Atenção', 'As senhas não coincidem.');
      return;
    }
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!apiUrl) {
      Alert.alert('Erro', 'App sem URL da API configurada (EXPO_PUBLIC_API_URL). Avise o suporte.');
      return;
    }
    setLoading(true);

    // O perfil em `users` é criado pelo trigger handle_new_user (nome vem do metadata).
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password: senha,
      options: {
        data: { nome: nome.trim() },
        emailRedirectTo: `${apiUrl}/auth/callback`,
      },
    });
    setLoading(false);

    if (error) {
      Alert.alert(
        'Erro ao cadastrar',
        error.message.includes('not allowed') || error.message.includes('disabled')
          ? 'Cadastros estão desativados. Entre em contato com o administrador.'
          : error.message
      );
      return;
    }

    router.replace({ pathname: '/(auth)/verificar-email', params: { email: email.trim() } } as any);
  }

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
        {/* ── Hero ── */}
        <LinearGradient
          colors={['#2C1654', '#3D1F72']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ paddingTop: insets.top + 40, paddingHorizontal: 32, paddingBottom: 40 }}
        >
          <View style={{
            position: 'absolute', top: -60, right: -60,
            width: 200, height: 200, borderRadius: 100,
            backgroundColor: 'rgba(255,255,255,0.04)',
          }} />

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
              <Text style={{ fontFamily: 'Fraunces_700Bold', fontSize: 26, color: '#fff' }}>
                ✦
              </Text>
            </View>
            <Text style={{
              fontFamily: 'Fraunces_700Bold',
              fontSize: 34, color: '#fff', lineHeight: 40, marginBottom: 8,
            }}>
              Criar conta
            </Text>
            <Text style={{
              fontFamily: 'PlusJakartaSans_400Regular',
              fontSize: 13, color: 'rgba(255,255,255,0.5)',
            }}>
              Acesso mediante convite do administrador
            </Text>
          </MotiView>
        </LinearGradient>

        {/* ── Formulário ── */}
        <MotiView
          from={{ opacity: 0, translateY: 16 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 420, delay: 100 }}
          style={{
            flex: 1, paddingHorizontal: 24,
            paddingTop: 32, paddingBottom: insets.bottom + 24,
          }}
        >
          <Campo
            label="Nome completo"
            value={nome}
            onChangeText={setNome}
            placeholder="Seu nome"
            autoCapitalize="words"
            icon={<User size={16} color={C.text4} strokeWidth={1.8} />}
          />

          <Campo
            label="E-mail"
            value={email}
            onChangeText={setEmail}
            placeholder="seu@email.com"
            keyboardType="email-address"
            icon={<Mail size={16} color={C.text4} strokeWidth={1.8} />}
          />

          <Campo
            label="Senha"
            value={senha}
            onChangeText={setSenha}
            placeholder="Mínimo 6 caracteres"
            secureTextEntry={!mostrarSenha}
            icon={<Lock size={16} color={C.text4} strokeWidth={1.8} />}
            rightIcon={
              <TouchableOpacity onPress={() => setMostrar(!mostrarSenha)}>
                {mostrarSenha
                  ? <EyeOff size={16} color={C.text4} strokeWidth={1.8} />
                  : <Eye   size={16} color={C.text4} strokeWidth={1.8} />
                }
              </TouchableOpacity>
            }
          />

          <Campo
            label="Confirmar senha"
            value={confirmar}
            onChangeText={setConfirmar}
            placeholder="Repita a senha"
            secureTextEntry={!mostrarConfirmar}
            icon={<Lock size={16} color={C.text4} strokeWidth={1.8} />}
            rightIcon={
              <TouchableOpacity onPress={() => setMostrarConfirmar(!mostrarConfirmar)}>
                {mostrarConfirmar
                  ? <EyeOff size={16} color={C.text4} strokeWidth={1.8} />
                  : <Eye   size={16} color={C.text4} strokeWidth={1.8} />
                }
              </TouchableOpacity>
            }
          />
          {confirmar && senha !== confirmar ? (
            <Text style={{ color: '#C0392B', fontSize: 12, marginTop: -8, marginBottom: 12 }}>
              As senhas não coincidem
            </Text>
          ) : null}

          <TouchableOpacity
            onPress={cadastrar}
            disabled={loading}
            activeOpacity={0.85}
            style={{ marginTop: 10, marginBottom: 16 }}
          >
            <LinearGradient
              colors={['#2C1654', '#4A2480']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={{
                borderRadius: 16, paddingVertical: 16, alignItems: 'center',
                shadowColor: C.primary, shadowOpacity: 0.3,
                shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
              }}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff', letterSpacing: 0.3 }}>
                    Criar conta
                  </Text>
              }
            </LinearGradient>
          </TouchableOpacity>

          <Link href="/(auth)/login" asChild>
            <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text3 }}>
                Já tem conta?{' '}
                <Text style={{ color: C.accent, fontFamily: 'PlusJakartaSans_700Bold' }}>
                  Entrar
                </Text>
              </Text>
            </TouchableOpacity>
          </Link>
        </MotiView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
