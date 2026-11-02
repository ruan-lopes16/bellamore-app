import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import {
  User, Phone, Lock, LogOut, Save,
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
import { BarraDeStatus, comTemaDoUsuario, useTema } from '@/lib/tema';
import { validarSenhaOpcionalComConfirmacao } from '@shared/senha';
import { mensagemErroBanco } from '@shared/erros';
import { maskPhone } from '@shared/mascaras';
import { SeletorEmpresa } from '@/components/SeletorEmpresa';
import { CampoConfig as Campo } from '@/components/configuracoes/CampoConfig';
import { CardNotificacoesCelular } from '@/components/configuracoes/CardNotificacoesCelular';
import { SeletorModoTema } from '@/components/configuracoes/SeletorModoTema';
import { TrocarEmail } from '@/components/configuracoes/TrocarEmail';

// ── Tela principal ───────────────────────────────────────────

/**
 * Configurações da profissional — versão enxuta da tela de gestão: a própria conta (nome,
 * telefone, e-mail, senha), notificações no celular, aparência e a troca de empresa (só com 2+
 * vínculos). Nada de dados da empresa, horários ou taxas — isso é papel de gestor/owner.
 */
function ConfiguracoesProfissional() {
  const { C } = useTema();
  const insets = useSafeAreaInsets();
  const { user, sair } = useAuthStore();

  const [nomeUser,     setNomeUser]     = useState(user?.nome ?? '');
  const [telefoneUser, setTelefoneUser] = useState(maskPhone(user?.telefone ?? ''));
  const [novaSenha,    setNovaSenha]    = useState('');
  const [confirmaSenha, setConfirmaSenha] = useState('');

  const [salvando, setSalvando] = useState(false);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  // Perfil e senha (as preferências de notificação ficam no card, salvas na hora).
  async function salvar() {
    if (!user) return;
    // Senha preenchida (curta ou sem confirmação igual): avisa (antes era ignorada em silêncio e a tela dizia "Salvo!").
    const erroSenhaCurta = validarSenhaOpcionalComConfirmacao(novaSenha, confirmaSenha);
    if (erroSenhaCurta) { Alert.alert('Senha', erroSenhaCurta); return; }
    setSalvando(true);

    const { data, error: erroPerfil } = await supabase.from('users').update({
      nome:     nomeUser.trim(),
      telefone: telefoneUser.trim() || null,
    }).eq('id', user.id).select('id');
    if (erroPerfil || !data || data.length === 0) {
      setSalvando(false);
      Alert.alert('Erro ao salvar', mensagemErroBanco(erroPerfil ?? { code: '42501' }, 'salvar o perfil'));
      return;
    }

    if (novaSenha.length > 0) {
      const { error } = await supabase.auth.updateUser({ password: novaSenha });
      if (error) {
        setSalvando(false);
        Alert.alert('Erro ao salvar', /different from the old/i.test(error.message)
          ? 'A nova senha deve ser diferente da atual.'
          : 'Não foi possível trocar a senha. Tente de novo.');
        return;
      }
    }

    setSalvando(false);
    const atual = useAuthStore.getState().user;
    if (atual) useAuthStore.setState({ user: { ...atual, nome: nomeUser.trim(), telefone: telefoneUser.trim() || undefined } });
    Alert.alert('Salvo!', 'Configurações atualizadas com sucesso.');
    setNovaSenha(''); setConfirmaSenha('');
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
        <BarraDeStatus />

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

          {/* Trocar de empresa (só com 2+ vínculos) */}
          <SeletorEmpresa style={{ marginHorizontal: 24, marginBottom: 16 }} />

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
                value={telefoneUser} onChange={(v) => setTelefoneUser(maskPhone(v))} placeholder="(00) 00000-0000" keyboardType="phone-pad" />
              <TrocarEmail />
              <Campo label="Nova senha" icon={<Lock size={13} color={C.primary} strokeWidth={1.8} />}
                value={novaSenha} onChange={setNovaSenha} placeholder="Deixe em branco para manter" secureTextEntry />
              <Campo label="Confirmar nova senha" icon={<Lock size={13} color={C.primary} strokeWidth={1.8} />}
                value={confirmaSenha} onChange={setConfirmaSenha} placeholder="Repita a nova senha" secureTextEntry ultimo />
            </View>
          </MotiView>

          {/* ── Notificações no celular (status, Ativar e preferências salvas na hora) ── */}
          <View style={{ marginHorizontal: 24, marginTop: 20 }}>
            <CardNotificacoesCelular />
          </View>

          {/* ── Aparência (modo escuro) ── */}
          <View style={{ marginHorizontal: 24, marginTop: 20 }}>
            <SeletorModoTema />
          </View>

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

export default comTemaDoUsuario(ConfiguracoesProfissional);
