import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert,
  ActivityIndicator, StatusBar, ScrollView,
} from 'react-native';
import { Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { Eye, EyeOff, Mail, Lock } from 'lucide-react-native';
import {
  useFonts,
  CormorantGaramond_700Bold,
} from '@expo-google-fonts/cormorant-garamond';
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
  secureTextEntry, keyboardType,
  icon, rightIcon,
}: {
  label: string; value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: any;
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
          autoCapitalize="none"
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

export default function Login() {
  const insets = useSafeAreaInsets();
  const [email, setEmail]          = useState('');
  const [senha, setSenha]          = useState('');
  const [mostrarSenha, setMostrar] = useState(false);
  const [loading, setLoading]      = useState(false);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  async function entrar() {
    if (!email || !senha) {
      Alert.alert('Atenção', 'Preencha e-mail e senha.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setLoading(false);
    if (error) Alert.alert('Erro ao entrar', error.message);
    // Redirecionamento via onAuthStateChange no _layout
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
          style={{ paddingTop: insets.top + 48, paddingHorizontal: 32, paddingBottom: 48 }}
        >
          <View style={{
            position: 'absolute', top: -60, right: -60,
            width: 200, height: 200, borderRadius: 100,
            backgroundColor: 'rgba(255,255,255,0.04)',
          }} />
          <View style={{
            position: 'absolute', bottom: -40, left: -40,
            width: 160, height: 160, borderRadius: 80,
            backgroundColor: 'rgba(255,255,255,0.03)',
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
              <Text style={{ fontFamily: 'CormorantGaramond_700Bold', fontSize: 26, color: '#fff' }}>
                ✦
              </Text>
            </View>
            <Text style={{
              fontFamily: 'CormorantGaramond_700Bold',
              fontSize: 34, color: '#fff', lineHeight: 40, marginBottom: 8,
            }}>
              Bem-vinda de{'\n'}volta
            </Text>
            <Text style={{
              fontFamily: 'PlusJakartaSans_400Regular',
              fontSize: 13, color: 'rgba(255,255,255,0.5)',
            }}>
              Entre na sua conta para continuar
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
            placeholder="••••••••"
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

          <TouchableOpacity style={{ alignSelf: 'flex-end', marginBottom: 24, marginTop: -4 }}>
            <Text style={{
              fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.accent,
            }}>
              Esqueci a senha
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={entrar} disabled={loading} activeOpacity={0.85} style={{ marginBottom: 16 }}>
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
                    Entrar
                  </Text>
              }
            </LinearGradient>
          </TouchableOpacity>

          <Link href="/(auth)/register" asChild>
            <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text3 }}>
                Não tem conta?{' '}
                <Text style={{ color: C.accent, fontFamily: 'PlusJakartaSans_700Bold' }}>
                  Cadastre-se
                </Text>
              </Text>
            </TouchableOpacity>
          </Link>
        </MotiView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
