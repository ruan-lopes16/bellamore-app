import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform,
  ActivityIndicator, StatusBar, ScrollView,
} from 'react-native';
import { Link, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { ChevronLeft, Mail } from 'lucide-react-native';
import {
  useFonts,
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
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
  red: '#C0392B',
};

// ── Campo de input ───────────────────────────────────────────

function Campo({
  label, value, onChangeText, placeholder, keyboardType, icon,
}: {
  label: string; value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  keyboardType?: any;
  icon: React.ReactNode;
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
          keyboardType={keyboardType}
          autoCapitalize="none"
          style={{
            flex: 1, paddingVertical: 14,
            fontFamily: 'PlusJakartaSans_400Regular',
            fontSize: 14, color: C.text,
          }}
        />
      </View>
    </View>
  );
}

// ── Tela ─────────────────────────────────────────────────────

export default function EsqueciSenha() {
  const insets = useSafeAreaInsets();
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro]       = useState('');

  const [fontsLoaded] = useFonts({
    Fraunces_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  async function enviar() {
    if (!email) return;
    setErro('');
    setLoading(true);
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${apiUrl}/auth/callback?next=/redefinir-senha`,
    });
    setLoading(false);
    if (error) {
      setErro(error.message);
      return;
    }
    setEnviado(true);
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
          style={{ paddingTop: insets.top + 12, paddingHorizontal: 32, paddingBottom: 40 }}
        >
          <TouchableOpacity
            onPress={() => router.back()}
            style={{
              width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 10,
              alignItems: 'center', justifyContent: 'center', marginBottom: 20,
            }}
          >
            <ChevronLeft size={16} color="#fff" strokeWidth={2.5} />
          </TouchableOpacity>

          <MotiView
            from={{ opacity: 0, translateY: -12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500 }}
          >
            <Text style={{
              fontFamily: 'Fraunces_700Bold',
              fontSize: 30, color: '#fff', lineHeight: 36, marginBottom: 8,
            }}>
              Esqueceu a{'\n'}senha?
            </Text>
            <Text style={{
              fontFamily: 'PlusJakartaSans_400Regular',
              fontSize: 13, color: 'rgba(255,255,255,0.5)',
            }}>
              Informe seu e-mail e enviaremos um link para redefinir
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
          {enviado ? (
            <View>
              <Text style={{
                fontFamily: 'PlusJakartaSans_400Regular',
                fontSize: 14, color: C.text2, lineHeight: 20, marginBottom: 20,
              }}>
                Se <Text style={{ fontFamily: 'PlusJakartaSans_700Bold' }}>{email}</Text> estiver
                cadastrado, você vai receber um e-mail com o link para redefinir sua senha em instantes.
              </Text>
              <Link href="/(auth)/login" asChild>
                <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 8 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.accent }}>
                    Voltar para o login
                  </Text>
                </TouchableOpacity>
              </Link>
            </View>
          ) : (
            <>
              <Campo
                label="E-mail"
                value={email}
                onChangeText={setEmail}
                placeholder="seu@email.com"
                keyboardType="email-address"
                icon={<Mail size={16} color={C.text4} strokeWidth={1.8} />}
              />

              {erro ? (
                <Text style={{ color: C.red, fontSize: 13, textAlign: 'center', marginBottom: 12 }}>
                  {erro}
                </Text>
              ) : null}

              <TouchableOpacity
                onPress={enviar} disabled={loading || !email} activeOpacity={0.85}
                style={{ marginTop: 10, marginBottom: 16 }}
              >
                <LinearGradient
                  colors={['#2C1654', '#4A2480']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={{
                    borderRadius: 16, paddingVertical: 16, alignItems: 'center',
                    shadowColor: C.primary, shadowOpacity: 0.3,
                    shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
                    opacity: !email ? 0.6 : 1,
                  }}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff', letterSpacing: 0.3 }}>
                        Enviar link
                      </Text>
                  }
                </LinearGradient>
              </TouchableOpacity>
            </>
          )}
        </MotiView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
