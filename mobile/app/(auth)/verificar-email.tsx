import { useState } from 'react';
import {
  View, Text, TouchableOpacity, Alert,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { Mail } from 'lucide-react-native';
import { useFonts, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';

import { supabase } from '@/lib/supabase';
import { BarraDeStatus, comTemaDoUsuario, useTema } from '@/lib/tema';

const PASSOS = [
  'Abra o e-mail que enviamos',
  'Clique no link de confirmação',
  'Você será redirecionado para configurar seu estúdio',
];

/** Tela "Verifique seu e-mail", mesmo conteúdo do web (/verificar-email). */
function VerificarEmail() {
  const { C } = useTema();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = params.email ?? '';
  const [reenviando, setReenviando] = useState(false);

  const [fontsLoaded] = useFonts({
    Fraunces_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  async function reenviar() {
    if (!email) {
      Alert.alert('Atenção', 'Volte e faça o cadastro novamente.');
      return;
    }
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!apiUrl) {
      Alert.alert('Erro', 'App sem URL da API configurada (EXPO_PUBLIC_API_URL). Avise o suporte.');
      return;
    }
    setReenviando(true);
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${apiUrl}/auth/callback` },
    });
    setReenviando(false);
    if (error) Alert.alert('Erro', error.message);
    else Alert.alert('Pronto', 'Reenviamos o e-mail de confirmação. Verifique também a pasta de spam.');
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <BarraDeStatus />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24,
          paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24,
        }}
      >
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 420 }}
          style={{ alignItems: 'center' }}
        >
          <View style={{
            width: 64, height: 64, borderRadius: 20, backgroundColor: C.primarySoft,
            alignItems: 'center', justifyContent: 'center', marginBottom: 24,
          }}>
            <Mail size={28} color={C.primaryTexto}strokeWidth={1.8} />
          </View>

          <Text style={{ fontFamily: 'Fraunces_700Bold', fontSize: 30, color: C.text, marginBottom: 8 }}>
            Verifique seu e-mail
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text3, textAlign: 'center' }}>
            Enviamos um link de confirmação para
          </Text>
          <Text style={{
            fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text2,
            textAlign: 'center', marginTop: 2, marginBottom: 24,
          }}>
            {email || 'seu e-mail'}
          </Text>

          <View style={{
            alignSelf: 'stretch', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 16, padding: 18, gap: 12, marginBottom: 24,
          }}>
            {PASSOS.map((passo, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                <View style={{
                  width: 20, height: 20, borderRadius: 10, backgroundColor: C.primarySoft,
                  alignItems: 'center', justifyContent: 'center', marginTop: 1,
                }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.primaryTexto }}>
                    {i + 1}
                  </Text>
                </View>
                <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2 }}>
                  {passo}
                </Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            onPress={() => router.replace('/(auth)/login' as any)}
            activeOpacity={0.85}
            style={{ alignSelf: 'stretch', marginBottom: 12 }}
          >
            <LinearGradient
              colors={[C.primary, '#5B2D99']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={{ borderRadius: 16, paddingVertical: 16, alignItems: 'center' }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff' }}>
                Já confirmei, entrar
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity onPress={reenviar} disabled={reenviando} style={{ paddingVertical: 10 }}>
            {reenviando
              ? <ActivityIndicator color={C.accent} />
              : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.accent }}>
                  Reenviar e-mail
                </Text>}
          </TouchableOpacity>

          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text4, marginTop: 8 }}>
            Não recebeu? Verifique a pasta de spam.
          </Text>
        </MotiView>
      </ScrollView>
    </View>
  );
}

export default comTemaDoUsuario(VerificarEmail);
