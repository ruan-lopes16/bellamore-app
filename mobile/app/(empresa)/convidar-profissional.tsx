import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StatusBar, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { ChevronLeft, Mail, User, Phone, Eye, EyeOff, Sparkles, Copy, Check, Lock } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
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
import { podeAtribuirRole } from '@/lib/permissions';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8', green: '#0D7E5F', greenSoft: '#EAFAF5',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

function gerarSenha() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ── Campo ─────────────────────────────────────────────────────

function Campo({
  label, icon, value, onChange, placeholder,
  keyboardType = 'default', secureTextEntry = false, rightIcon,
}: {
  label: string; icon: React.ReactNode;
  value: string; onChange: (v: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'decimal-pad';
  secureTextEntry?: boolean;
  rightIcon?: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      {label ? (
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 8 }}>
          {label}
        </Text>
      ) : null}
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
        {rightIcon}
      </View>
    </View>
  );
}

// ── Tela ─────────────────────────────────────────────────────

export default function ConvidarProfissional() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva, isOwner } = useAuthStore();
  const qc = useQueryClient();

  const [email,      setEmail]      = useState('');
  const [nome,       setNome]       = useState('');
  const [telefone,   setTelefone]   = useState('');
  const [modoAcesso, setModoAcesso] = useState<'convite' | 'senha'>('convite');
  const [senha,      setSenha]      = useState('');
  const [verSenha,   setVerSenha]   = useState(false);
  const [enviando,   setEnviando]   = useState(false);
  const [role, setRole] = useState<'gestor' | 'profissional'>('profissional');
  const [credenciais, setCredenciais] = useState<{ email: string; senha: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const podeEnviar  = emailValido && nome.trim().length > 1
    && (modoAcesso === 'convite' || senha.length >= 6);

  async function convidar() {
    if (!podeEnviar || !empresaAtiva) return;
    setEnviando(true);

    const { data: { session } } = await supabase.auth.getSession();
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;

    if (!session || !apiUrl) {
      setEnviando(false);
      Alert.alert('Erro', 'Não foi possível salvar. Tente novamente mais tarde.');
      return;
    }

    const usarConvite = modoAcesso === 'convite';
    let resposta: Response;
    try {
      resposta = await fetch(`${apiUrl}/api/${usarConvite ? 'convites' : 'profissionais'}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          empresaId: empresaAtiva.id,
          nome:      nome.trim(),
          telefone:  telefone.trim() || undefined,
          email:     email.toLowerCase().trim(),
          senha:     usarConvite ? undefined : senha,
          role,
        }),
      });
    } catch {
      setEnviando(false);
      Alert.alert('Erro', 'Falha de conexão. Verifique sua internet.');
      return;
    }

    const resultado = await resposta.json();
    setEnviando(false);

    if (!resposta.ok) {
      Alert.alert('Erro', resultado.error ?? 'Não foi possível salvar.');
      return;
    }

    qc.invalidateQueries({ queryKey: ['equipe'] });

    if (!usarConvite && resultado.status === 'criado') {
      setCredenciais({ email: email.toLowerCase().trim(), senha });
      return;
    }

    if (resultado.status === 'adicionado') {
      Alert.alert('Profissional adicionada!', `${nome} já tinha conta e foi adicionada à sua equipe.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } else {
      Alert.alert(
        'Convite enviado!',
        `Um e-mail foi enviado para ${email} com um link para criar a senha e acessar a equipe.`,
        [{ text: 'OK', onPress: () => router.back() }]
      );
    }
  }

  async function copiarCredenciais() {
    if (!credenciais) return;
    await Clipboard.setStringAsync(`E-mail: ${credenciais.email}\nSenha: ${credenciais.senha}`);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  if (credenciais) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <StatusBar barStyle="light-content" />
        <LinearGradient colors={['#2C1654', '#3D1F72']} style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 24 }}>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: '#fff' }}>
            Conta criada!
          </Text>
        </LinearGradient>
        <View style={{ padding: 24 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text2, lineHeight: 20, marginBottom: 20 }}>
            Repasse esses dados para {nome.trim()} acessar o app. Eles só aparecem aqui, uma vez —
            não ficam salvos em nenhum outro lugar.
          </Text>
          <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 16, gap: 12, marginBottom: 20 }}>
            <View>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>E-mail</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>{credenciais.email}</Text>
            </View>
            <View>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Senha</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>{credenciais.senha}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={copiarCredenciais}
            style={{ height: 48, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            {copiado ? <Check size={15} color={C.text2} /> : <Copy size={15} color={C.text2} />}
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text2 }}>
              {copiado ? 'Copiado!' : 'Copiar e-mail e senha'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()}
            style={{ backgroundColor: C.primary, borderRadius: 14, height: 54, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: '#fff' }}>Concluir</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
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
              Se a profissional já tem conta no app, ela será adicionada imediatamente. Se não tiver, escolha abaixo como ela vai acessar.
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

          <View style={{ marginBottom: 16 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 8 }}>
              Como dar acesso
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity onPress={() => setModoAcesso('convite')}
                style={{
                  flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, paddingHorizontal: 4,
                  borderColor: modoAcesso === 'convite' ? C.primary : C.border,
                  backgroundColor: modoAcesso === 'convite' ? C.primarySoft : C.surface,
                }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: modoAcesso === 'convite' ? C.primary : C.text2, textAlign: 'center' }}>
                  Enviar convite
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setModoAcesso('senha')}
                style={{
                  flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, paddingHorizontal: 4,
                  borderColor: modoAcesso === 'senha' ? C.primary : C.border,
                  backgroundColor: modoAcesso === 'senha' ? C.primarySoft : C.surface,
                }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: modoAcesso === 'senha' ? C.primary : C.text2, textAlign: 'center' }}>
                  Definir senha agora
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 8, lineHeight: 16 }}>
              {modoAcesso === 'convite'
                ? 'Ela recebe um e-mail e cria a própria senha.'
                : 'Você define a senha agora e repassa pra ela por fora (WhatsApp, pessoalmente).'}
            </Text>
          </View>

          {modoAcesso === 'senha' && (
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text }}>
                  Senha *
                </Text>
                <TouchableOpacity onPress={() => { setSenha(gerarSenha()); setVerSenha(true); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Sparkles size={12} color={C.accent} strokeWidth={1.8} />
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.accent }}>Gerar senha</Text>
                </TouchableOpacity>
              </View>
              <Campo
                label=""
                icon={<Lock size={13} color={C.primary} strokeWidth={1.8} />}
                value={senha} onChange={setSenha}
                placeholder="mínimo 6 caracteres"
                secureTextEntry={!verSenha}
                rightIcon={
                  <TouchableOpacity onPress={() => setVerSenha(v => !v)}>
                    {verSenha
                      ? <EyeOff size={15} color={C.text3} strokeWidth={1.8} />
                      : <Eye size={15} color={C.text3} strokeWidth={1.8} />}
                  </TouchableOpacity>
                }
              />
            </View>
          )}

          {podeAtribuirRole(isOwner ? 'owner' : 'gestor', 'gestor') && (
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 8 }}>
                Papel
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity onPress={() => setRole('profissional')}
                  style={{
                    flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: role === 'profissional' ? C.primary : C.border,
                    backgroundColor: role === 'profissional' ? C.primarySoft : C.surface,
                  }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: role === 'profissional' ? C.primary : C.text2 }}>
                    Profissional
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setRole('gestor')}
                  style={{
                    flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: role === 'gestor' ? C.primary : C.border,
                    backgroundColor: role === 'gestor' ? C.primarySoft : C.surface,
                  }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: role === 'gestor' ? C.primary : C.text2 }}>
                    Gestora
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

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
