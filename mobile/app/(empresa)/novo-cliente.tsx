import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StatusBar, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import {
  ChevronLeft, User, Phone, Mail, MapPin, FileText,
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
import AniversarioChips from '@/components/AniversarioChips';
import { maskPhone } from '@shared/mascaras';
import { montarAniversario, serializarEndereco, type EnderecoCliente } from '@shared/clientes';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  rose: '#D4608A', roseSoft: '#FDF0F5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  text: '#1A1228', text3: '#8878A6', text4: '#B8AECC',
};

// ── Campo de input ───────────────────────────────────────────

function Campo({
  label, value, onChangeText, placeholder,
  keyboardType, autoCapitalize, icon, multiline, obrigatorio, maxLength,
}: {
  label: string; value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  keyboardType?: any;
  autoCapitalize?: any;
  icon: React.ReactNode;
  multiline?: boolean;
  obrigatorio?: boolean;
  maxLength?: number;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text }}>
          {label}
        </Text>
        {obrigatorio && (
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.rose }}>*</Text>
        )}
      </View>
      <View style={{
        backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
        borderRadius: 14, flexDirection: 'row', alignItems: multiline ? 'flex-start' : 'center',
        paddingHorizontal: 14, paddingTop: multiline ? 12 : 0,
        shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
      }}>
        <View style={{ marginRight: 10, marginTop: multiline ? 2 : 0 }}>{icon}</View>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={C.text4}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize ?? 'none'}
          multiline={multiline}
          maxLength={maxLength}
          numberOfLines={multiline ? 3 : 1}
          style={{
            flex: 1,
            paddingVertical: multiline ? 0 : 14,
            paddingBottom: multiline ? 12 : 0,
            fontFamily: 'PlusJakartaSans_400Regular',
            fontSize: 14, color: C.text,
            textAlignVertical: multiline ? 'top' : 'center',
            minHeight: multiline ? 72 : undefined,
          }}
        />
      </View>
    </View>
  );
}

// ── Tela ─────────────────────────────────────────────────────

export default function NovoCliente() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva } = useAuthStore();
  const qc = useQueryClient();

  const [nome, setNome]           = useState('');
  const [telefone, setTelefone]   = useState('');
  const [email, setEmail]         = useState('');
  const [nascMes, setNascMes]   = useState('');
  const [nascDia, setNascDia]   = useState('');
  const [endereco, setEndereco] = useState<EnderecoCliente>({ logradouro: '', numero: '', bairro: '', complemento: '' });
  const [obs, setObs]             = useState('');
  const [salvando, setSalvando]   = useState(false);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  async function salvar() {
    if (nome.trim().length <= 1) {
      Alert.alert('Atenção', 'O nome é obrigatório.');
      return;
    }
    if (!empresaAtiva) return;

    setSalvando(true);
    const { data, error } = await supabase.from('clientes').insert({
      empresa_id:      empresaAtiva.id,
      nome:            nome.trim(),
      telefone:        telefone.trim() || null,
      email:           email.trim() || null,
      data_nascimento: montarAniversario(nascMes, nascDia),
      endereco:        serializarEndereco(endereco),
      observacoes:     obs.trim() || null,
    }).select('id, nome').single();
    setSalvando(false);
    if (error || !data) { Alert.alert('Erro', error?.message ?? 'Não foi possível cadastrar.'); return; }
    qc.invalidateQueries({ queryKey: ['clientes'] });
    qc.invalidateQueries({ queryKey: ['clientes-stats'] });
    router.replace(`/(empresa)/cliente/${data.id}/anamnese` as any);
  }

  const podeSalvar = nome.trim().length > 1;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <StatusBar barStyle="light-content" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header ── */}
        <LinearGradient
          colors={['#2C1654', '#3D1F72']}
          style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 24 }}
        >
          <TouchableOpacity
            onPress={() => router.back()}
            style={{
              width: 34, height: 34,
              backgroundColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
              borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 16,
            }}
          >
            <ChevronLeft size={16} color="#fff" strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={{
            fontFamily: 'PlusJakartaSans_500Medium',
            fontSize: 11, color: 'rgba(255,255,255,0.5)',
            letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4,
          }}>
            {empresaAtiva?.nome}
          </Text>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: '#fff' }}>
            Nova Cliente
          </Text>
        </LinearGradient>

        {/* ── Formulário ── */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 380, delay: 60 }}
          style={{ padding: 24 }}
        >
          {/* Dados pessoais */}
          <Text style={{
            fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11,
            color: C.text3, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 14,
          }}>
            Dados Pessoais
          </Text>

          <Campo
            label="Nome completo" value={nome} onChangeText={setNome}
            placeholder="Nome da cliente" autoCapitalize="words" obrigatorio
            icon={<User size={16} color={C.text4} strokeWidth={1.8} />}
          />
          <Campo
            label="Telefone / WhatsApp" value={telefone} onChangeText={(v) => setTelefone(maskPhone(v))} maxLength={15}
            placeholder="(00) 00000-0000" keyboardType="phone-pad"
            icon={<Phone size={16} color={C.text4} strokeWidth={1.8} />}
          />
          <Campo
            label="E-mail" value={email} onChangeText={setEmail}
            placeholder="email@exemplo.com" keyboardType="email-address"
            icon={<Mail size={16} color={C.text4} strokeWidth={1.8} />}
          />
          <AniversarioChips mes={nascMes} dia={nascDia} onMes={setNascMes} onDia={setNascDia} />
          <Campo
            label="Logradouro" value={endereco.logradouro}
            onChangeText={(v) => setEndereco((e) => ({ ...e, logradouro: v }))}
            placeholder="Rua, avenida…" autoCapitalize="words"
            icon={<MapPin size={16} color={C.text4} strokeWidth={1.8} />}
          />
          <Campo
            label="Número" value={endereco.numero}
            onChangeText={(v) => setEndereco((e) => ({ ...e, numero: v }))}
            placeholder="Nº" keyboardType="numbers-and-punctuation"
            icon={<MapPin size={16} color={C.text4} strokeWidth={1.8} />}
          />
          <Campo
            label="Bairro" value={endereco.bairro}
            onChangeText={(v) => setEndereco((e) => ({ ...e, bairro: v }))}
            placeholder="Bairro" autoCapitalize="words"
            icon={<MapPin size={16} color={C.text4} strokeWidth={1.8} />}
          />
          <Campo
            label="Complemento" value={endereco.complemento}
            onChangeText={(v) => setEndereco((e) => ({ ...e, complemento: v }))}
            placeholder="Apto, sala…" autoCapitalize="words"
            icon={<MapPin size={16} color={C.text4} strokeWidth={1.8} />}
          />

          {/* Separador */}
          <View style={{ height: 1, backgroundColor: C.border, marginVertical: 20 }} />

          {/* Observações */}
          <Text style={{
            fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11,
            color: C.text3, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 14,
          }}>
            Observações internas
          </Text>

          <Campo
            label="Observação" value={obs} onChangeText={setObs}
            placeholder="Ex: preferências, restrições, como nos conheceu…"
            autoCapitalize="sentences" multiline
            icon={<FileText size={16} color={C.text4} strokeWidth={1.8} />}
          />

          {/* Info */}
          <View style={{
            backgroundColor: C.primarySoft, borderRadius: 12, padding: 12,
            flexDirection: 'row', gap: 10, alignItems: 'flex-start',
          }}>
            <Text style={{ fontSize: 14 }}>💡</Text>
            <Text style={{
              fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11,
              color: C.primary, lineHeight: 16, flex: 1,
            }}>
              Depois de cadastrar, você segue direto para a ficha de anamnese.
            </Text>
          </View>
        </MotiView>
      </ScrollView>

      {/* ── Botão fixo ── */}
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border,
        paddingHorizontal: 24, paddingTop: 12, paddingBottom: insets.bottom + 12,
      }}>
        <TouchableOpacity onPress={salvar} disabled={!podeSalvar || salvando} activeOpacity={0.85}>
          <LinearGradient
            colors={podeSalvar ? ['#2C1654', '#4A2480'] : ['#C4BAD4', '#C4BAD4']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={{
              borderRadius: 16, paddingVertical: 16, alignItems: 'center',
              shadowColor: podeSalvar ? C.primary : 'transparent',
              shadowOpacity: 0.3, shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 }, elevation: podeSalvar ? 6 : 0,
            }}
          >
            {salvando
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff', letterSpacing: 0.3 }}>
                  Cadastrar Cliente
                </Text>
            }
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
