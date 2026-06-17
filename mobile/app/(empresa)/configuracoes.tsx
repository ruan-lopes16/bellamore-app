import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, StatusBar, Switch,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import {
  Store, Phone, MapPin, FileText, User, Lock,
  Camera, LogOut, Save, ChevronLeft, Image as ImageIcon,
} from 'lucide-react-native';
import {
  useFonts,
  CormorantGaramond_600SemiBold,
} from '@expo-google-fonts/cormorant-garamond';
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
  accent: '#9B6FE8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  red: '#C0392B', redSoft: '#FEF2F2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'] as const;
const DIAS_LABEL: Record<typeof DIAS[number], string> = {
  seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui',
  sex: 'Sex', sab: 'Sáb', dom: 'Dom',
};

type Dia = typeof DIAS[number];

interface HorarioDia {
  aberto: boolean;
  inicio: string;
  fim: string;
}

type Horarios = Record<Dia, HorarioDia>;

const HORARIO_DEFAULT: Horarios = {
  seg: { aberto: true,  inicio: '08:00', fim: '18:00' },
  ter: { aberto: true,  inicio: '08:00', fim: '18:00' },
  qua: { aberto: true,  inicio: '08:00', fim: '18:00' },
  qui: { aberto: true,  inicio: '08:00', fim: '18:00' },
  sex: { aberto: true,  inicio: '08:00', fim: '18:00' },
  sab: { aberto: true,  inicio: '09:00', fim: '14:00' },
  dom: { aberto: false, inicio: '09:00', fim: '13:00' },
};

// ── Helpers ──────────────────────────────────────────────────

function initials(nome: string) {
  return nome.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}

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
  keyboardType?: 'default' | 'phone-pad' | 'numeric';
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

export default function Configuracoes() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva, user, signOut } = useAuthStore();
  const qc = useQueryClient();

  // Dados da empresa
  const [nomeEmpresa,  setNomeEmpresa]  = useState(empresaAtiva?.nome ?? '');
  const [telefoneEmp,  setTelefoneEmp]  = useState(empresaAtiva?.telefone ?? '');
  const [endereco,     setEndereco]     = useState(empresaAtiva?.endereco ?? '');
  const [cnpj,         setCnpj]         = useState(empresaAtiva?.cnpj ?? '');

  // Horários — carrega do banco ou usa default
  const horariosRaw = (empresaAtiva?.horario_funcionamento ?? {}) as Partial<Horarios>;
  const [horarios, setHorarios] = useState<Horarios>(() => ({
    ...HORARIO_DEFAULT,
    ...horariosRaw,
  }));

  // Minha conta
  const [nomeUser,     setNomeUser]     = useState(user?.nome ?? '');
  const [telefoneUser, setTelefoneUser] = useState(user?.telefone ?? '');
  const [novaSenha,    setNovaSenha]    = useState('');

  const [salvando, setSalvando] = useState(false);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  // ── Toggle de dia ─────────────────────────────────────────
  function toggleDia(dia: Dia) {
    setHorarios((h) => ({ ...h, [dia]: { ...h[dia], aberto: !h[dia].aberto } }));
  }

  function setHorarioDia(dia: Dia, campo: 'inicio' | 'fim', val: string) {
    setHorarios((h) => ({ ...h, [dia]: { ...h[dia], [campo]: val } }));
  }

  // ── Salvar tudo ───────────────────────────────────────────
  async function salvar() {
    if (!empresaAtiva || !user) return;
    setSalvando(true);

    const ops: Promise<any>[] = [
      // Atualiza empresa
      supabase.from('empresas').update({
        nome:                 nomeEmpresa.trim(),
        telefone:             telefoneEmp.trim() || null,
        endereco:             endereco.trim() || null,
        cnpj:                 cnpj.trim() || null,
        horario_funcionamento: horarios,
      }).eq('id', empresaAtiva.id),

      // Atualiza perfil do usuário
      supabase.from('users').update({
        nome:     nomeUser.trim(),
        telefone: telefoneUser.trim() || null,
      }).eq('id', user.id),
    ];

    // Atualiza senha se preenchida
    if (novaSenha.trim().length >= 6) {
      ops.push(supabase.auth.updateUser({ password: novaSenha.trim() }));
    }

    const results = await Promise.all(ops);
    setSalvando(false);

    const erros = results.filter((r) => r.error);
    if (erros.length > 0) {
      Alert.alert('Erro ao salvar', erros[0].error.message);
      return;
    }

    // Invalida cache para refletir mudanças
    qc.invalidateQueries({ queryKey: ['empresa'] });
    qc.invalidateQueries({ queryKey: ['user'] });

    Alert.alert('Salvo!', 'Configurações atualizadas com sucesso.');
    setNovaSenha('');
  }

  // ── Logout ────────────────────────────────────────────────
  function handleLogout() {
    Alert.alert(
      'Sair da conta',
      'Tem certeza que deseja sair?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sair', style: 'destructive',
          onPress: async () => {
            await signOut();
            router.replace('/(auth)/login' as any);
          },
        },
      ]
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <StatusBar barStyle="light-content" />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Hero ── */}
          <LinearGradient
            colors={['#2C1654', '#3D1F72']}
            style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 24 }}
          >
            <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 350 }}>
              <TouchableOpacity
                onPress={() => router.back()}
                style={{
                  width: 34, height: 34, borderRadius: 10,
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
                  alignItems: 'center', justifyContent: 'center', marginBottom: 16,
                }}
              >
                <ChevronLeft size={16} color="#fff" strokeWidth={2.5} />
              </TouchableOpacity>

              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
                Gerenciar
              </Text>
              <Text style={{ fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 26, color: '#fff', marginBottom: 20 }}>
                Configurações
              </Text>

              {/* Logo + nome */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                <TouchableOpacity style={{
                  width: 64, height: 64, borderRadius: 18,
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.25)',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <ImageIcon size={22} color="rgba(255,255,255,0.3)" strokeWidth={1.5} />
                </TouchableOpacity>
                <View>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff', marginBottom: 3 }}>
                    {nomeEmpresa || 'Nome do estúdio'}
                  </Text>
                  <TouchableOpacity>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: 'rgba(155,111,232,0.9)' }}>
                      Alterar logo
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </MotiView>
          </LinearGradient>

          {/* ── Dados da Empresa ── */}
          <MotiView from={{ opacity: 0, translateY: 6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 380, delay: 60 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 20, marginBottom: 10, marginHorizontal: 24 }}>
              Dados da Empresa
            </Text>
            <View style={{
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 18, marginHorizontal: 24, overflow: 'hidden',
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              <Campo label="Nome" icon={<Store size={13} color={C.primary} strokeWidth={1.8} />}
                value={nomeEmpresa} onChange={setNomeEmpresa} placeholder="Nome do estúdio" />
              <Campo label="Telefone" icon={<Phone size={13} color={C.primary} strokeWidth={1.8} />}
                value={telefoneEmp} onChange={setTelefoneEmp} placeholder="(00) 00000-0000" keyboardType="phone-pad" />
              <Campo label="Endereço" icon={<MapPin size={13} color={C.primary} strokeWidth={1.8} />}
                value={endereco} onChange={setEndereco} placeholder="Rua, número — Cidade" />
              <View style={{ borderBottomWidth: 0 }}>
                <Campo label="CNPJ" icon={<FileText size={13} color={C.primary} strokeWidth={1.8} />}
                  value={cnpj} onChange={setCnpj} placeholder="00.000.000/0001-00" keyboardType="numeric" />
              </View>
            </View>
          </MotiView>

          {/* ── Horários de Funcionamento ── */}
          <MotiView from={{ opacity: 0, translateY: 6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 380, delay: 120 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 20, marginBottom: 10, marginHorizontal: 24 }}>
              Horários de Funcionamento
            </Text>
            <View style={{
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 18, marginHorizontal: 24, overflow: 'hidden',
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              {DIAS.map((dia, i) => {
                const h = horarios[dia];
                return (
                  <View
                    key={dia}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      paddingHorizontal: 16, paddingVertical: 11,
                      borderBottomWidth: i < DIAS.length - 1 ? 1 : 0, borderBottomColor: C.border,
                    }}
                  >
                    {/* Nome do dia */}
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12,
                      color: h.aberto ? C.text : C.text4, width: 32,
                    }}>
                      {DIAS_LABEL[dia]}
                    </Text>

                    {/* Toggle */}
                    <Switch
                      value={h.aberto}
                      onValueChange={() => toggleDia(dia)}
                      trackColor={{ false: C.border, true: C.green }}
                      thumbColor="#fff"
                      style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
                    />

                    {/* Horário ou "Fechado" */}
                    {h.aberto ? (
                      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <TextInput
                          value={h.inicio}
                          onChangeText={(v) => setHorarioDia(dia, 'inicio', v)}
                          style={{
                            backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
                            borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
                            fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text,
                            width: 60, textAlign: 'center',
                          }}
                        />
                        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }}>
                          até
                        </Text>
                        <TextInput
                          value={h.fim}
                          onChangeText={(v) => setHorarioDia(dia, 'fim', v)}
                          style={{
                            backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
                            borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
                            fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text,
                            width: 60, textAlign: 'center',
                          }}
                        />
                      </View>
                    ) : (
                      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text4, fontStyle: 'italic', flex: 1 }}>
                        Fechado
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </MotiView>

          {/* ── Minha Conta ── */}
          <MotiView from={{ opacity: 0, translateY: 6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 380, delay: 180 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 20, marginBottom: 10, marginHorizontal: 24 }}>
              Minha Conta
            </Text>
            <View style={{
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 18, marginHorizontal: 24, overflow: 'hidden',
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              {/* Avatar */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <View style={{ position: 'relative' }}>
                  <TouchableOpacity style={{
                    width: 56, height: 56, borderRadius: 16,
                    backgroundColor: C.primarySoft,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20, color: C.primary }}>
                      {initials(nomeUser || 'U')}
                    </Text>
                  </TouchableOpacity>
                  <View style={{
                    position: 'absolute', bottom: -2, right: -2,
                    width: 20, height: 20, borderRadius: 6,
                    backgroundColor: C.accent, borderWidth: 2, borderColor: C.surface,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Camera size={9} color="#fff" strokeWidth={2} />
                  </View>
                </View>
                <View>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text, marginBottom: 2 }}>
                    {nomeUser || 'Usuário'}
                  </Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3 }}>
                    {user?.id ? 'Conta conectada' : ''}
                  </Text>
                </View>
              </View>

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

          {/* ── Botão Salvar ── */}
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 380, delay: 240 }}
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
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 380, delay: 300 }}
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
