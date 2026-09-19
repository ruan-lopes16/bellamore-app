import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, StatusBar, Switch,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import {
  User, Phone, Lock, LogOut, Save, Bell,
} from 'lucide-react-native';
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

import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  red: '#C0392B', redSoft: '#FEF2F2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

// ── Campo de formulário ───────────────────────────────────────

function Campo({
  label, icon, value, onChange, placeholder, secureTextEntry = false, keyboardType = 'default',
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'phone-pad' | 'numeric' | 'decimal-pad';
}) {
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {icon}
        </View>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={C.text4}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          style={{
            flex: 1,
            fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text,
          }}
        />
      </View>
    </View>
  );
}

// ── Tela principal ───────────────────────────────────────────

/**
 * Configurações da profissional — versão enxuta da tela de gestão: só a
 * própria conta (nome, telefone, senha) e preferências de notificação.
 * Nada de dados da empresa, horários ou taxas — isso é papel de gestor/owner.
 */
export default function ConfiguracoesProfissional() {
  const insets = useSafeAreaInsets();
  const { user, sair } = useAuthStore();

  const [nomeUser,     setNomeUser]     = useState(user?.nome ?? '');
  const [telefoneUser, setTelefoneUser] = useState(user?.telefone ?? '');
  const [novaSenha,    setNovaSenha]    = useState('');

  // Preferências de notificação (por usuário, migration 077)
  const [notifResumo,   setNotifResumo]   = useState(user?.notif_resumo_diario ?? true);
  const [notifLembrete, setNotifLembrete] = useState(user?.notif_lembrete_atendimento ?? true);

  const [salvando, setSalvando] = useState(false);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  async function salvar() {
    if (!user) return;
    setSalvando(true);

    const { error: erroPerfil } = await supabase.from('users').update({
      nome:     nomeUser.trim(),
      telefone: telefoneUser.trim() || null,
      notif_resumo_diario:        notifResumo,
      notif_lembrete_atendimento: notifLembrete,
    }).eq('id', user.id);

    let erroSenha: { message: string } | null = null;
    if (novaSenha.trim().length >= 6) {
      const { error } = await supabase.auth.updateUser({ password: novaSenha.trim() });
      erroSenha = error;
    }

    setSalvando(false);

    const erro = erroPerfil ?? erroSenha;
    if (erro) {
      Alert.alert('Erro ao salvar', erro.message);
      return;
    }

    Alert.alert('Salvo!', 'Configurações atualizadas com sucesso.');
    setNovaSenha('');
  }

  function handleLogout() {
    Alert.alert(
      'Sair da conta',
      'Tem certeza que deseja sair?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sair', style: 'destructive',
          onPress: async () => {
            await sair();
            router.replace('/(auth)/login' as any);
          },
        },
      ]
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <StatusBar barStyle="dark-content" />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Header ── */}
          <MotiView
            from={{ opacity: 0, translateY: -8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 380 }}
            style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 16 }}
          >
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
              {user?.nome?.split(' ')[0]}
            </Text>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: C.text }}>
              Ajustes
            </Text>
          </MotiView>

          {/* ── Minha Conta ── */}
          <MotiView from={{ opacity: 0, translateY: 6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 380, delay: 60 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10, marginHorizontal: 24 }}>
              Minha Conta
            </Text>
            <View style={{
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 18, marginHorizontal: 24, overflow: 'hidden',
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              <Campo label="Nome" icon={<User size={13} color={C.primary} strokeWidth={1.8} />}
                value={nomeUser} onChange={setNomeUser} placeholder="Seu nome" />
              <Campo label="Telefone" icon={<Phone size={13} color={C.primary} strokeWidth={1.8} />}
                value={telefoneUser} onChange={setTelefoneUser} placeholder="(00) 00000-0000" keyboardType="phone-pad" />
              <View style={{ borderBottomWidth: 0 }}>
                <Campo label="Nova senha" icon={<Lock size={13} color={C.primary} strokeWidth={1.8} />}
                  value={novaSenha} onChange={setNovaSenha} placeholder="Deixe em branco para manter" secureTextEntry />
              </View>
            </View>
          </MotiView>

          {/* ── Notificações ── */}
          <MotiView from={{ opacity: 0, translateY: 6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 380, delay: 120 }}
            style={{ marginHorizontal: 24, marginTop: 20 }}
          >
            <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 18, gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Bell size={16} color={C.primary} strokeWidth={1.8} />
                <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 16, color: C.text }}>
                  Notificações
                </Text>
              </View>
              <TouchableOpacity onPress={() => setNotifResumo((v) => !v)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Switch value={notifResumo} onValueChange={setNotifResumo}
                  trackColor={{ false: C.border, true: C.primary }} thumbColor="#fff" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
                    Resumo do dia
                  </Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3 }}>
                    1x por dia, às 07:00
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setNotifLembrete((v) => !v)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Switch value={notifLembrete} onValueChange={setNotifLembrete}
                  trackColor={{ false: C.border, true: C.primary }} thumbColor="#fff" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
                    Lembrete de atendimento
                  </Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3 }}>
                    30 min antes de cada atendimento
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          </MotiView>

          {/* ── Botão Salvar ── */}
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 380, delay: 180 }}
            style={{ marginHorizontal: 24, marginTop: 20 }}
          >
            <TouchableOpacity
              onPress={salvar}
              disabled={salvando}
              style={{
                backgroundColor: C.primary, borderRadius: 14,
                height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: salvando ? 0.7 : 1,
                shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 12, elevation: 4,
              }}
            >
              {salvando
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <Save size={16} color="#fff" strokeWidth={2} />
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff' }}>
                      Salvar alterações
                    </Text>
                  </>
              }
            </TouchableOpacity>
          </MotiView>

          {/* ── Zona de perigo ── */}
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 380, delay: 240 }}
            style={{ marginHorizontal: 24, marginTop: 16 }}
          >
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.red, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10 }}>
              Zona de Perigo
            </Text>
            <TouchableOpacity
              onPress={handleLogout}
              style={{
                backgroundColor: C.redSoft, borderWidth: 1, borderColor: 'rgba(192,57,43,0.15)',
                borderRadius: 14, height: 48,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              <LogOut size={15} color={C.red} strokeWidth={2} />
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.red }}>
                Sair da conta
              </Text>
            </TouchableOpacity>
          </MotiView>

        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
