import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StatusBar, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, User, Phone, Mail, MapPin, FileText } from 'lucide-react-native';
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

import { supabase } from '@/lib/supabase';
import { useClienteDetalhe } from '@/hooks/useClientes';
import { useAuthStore } from '@/stores/authStore';
import AniversarioChips from '@/components/AniversarioChips';
import { maskPhone } from '@shared/mascaras';
import { montarAniversario, partesAniversario, parseEndereco, serializarEndereco, type EnderecoCliente } from '@shared/clientes';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654',
  text: '#1A1228', text3: '#8878A6', text4: '#B8AECC',
};

function Campo({ label, icon, value, onChangeText, placeholder, keyboardType, autoCapitalize, maxLength, multiline }: {
  label: string; icon: React.ReactNode; value: string;
  onChangeText: (v: string) => void; placeholder: string;
  keyboardType?: any; autoCapitalize?: any; maxLength?: number; multiline?: boolean;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 6 }}>
        {label}
      </Text>
      <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}>
        <View style={{ marginRight: 10 }}>{icon}</View>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={C.text4}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize ?? 'none'}
          maxLength={maxLength}
          multiline={multiline}
          style={{ flex: 1, paddingVertical: 14, minHeight: multiline ? 72 : undefined, textAlignVertical: multiline ? 'top' : 'center', fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text }}
        />
      </View>
    </View>
  );
}

export default function EditarCliente() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets  = useSafeAreaInsets();
  const qc      = useQueryClient();
  const { empresaAtiva } = useAuthStore();

  const { data: cliente } = useClienteDetalhe(id);

  const [nome, setNome]         = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail]       = useState('');
  const [nascMes, setNascMes]   = useState('');
  const [nascDia, setNascDia]   = useState('');
  const [endereco, setEndereco] = useState<EnderecoCliente>({ logradouro: '', numero: '', bairro: '', complemento: '' });
  const [obs, setObs]           = useState('');
  const [salvando, setSalvando] = useState(false);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  });

  useEffect(() => {
    if (cliente) {
      setNome(cliente.nome ?? '');
      setTelefone(maskPhone(cliente.telefone ?? ''));
      setEmail(cliente.email ?? '');
      setEndereco(parseEndereco(cliente.endereco));
      const { mes, dia } = partesAniversario(cliente.data_nascimento);
      setNascMes(mes ? String(Number(mes)) : '');
      setNascDia(dia ? String(Number(dia)) : '');
      setObs(cliente.observacoes ?? '');
    }
  }, [cliente]);

  if (!fontsLoaded || !cliente) return null;

  async function salvar() {
    if (nome.trim().length <= 1) { Alert.alert('Atenção', 'O nome é obrigatório.'); return; }
    if (!empresaAtiva) return;
    if (!!nascMes !== !!nascDia) {
      Alert.alert('Aniversário', 'Escolha o mês e o dia do aniversário, ou deixe os dois em branco.');
      return;
    }
    setSalvando(true);

    const { data, error } = await supabase.from('clientes').update({
      nome: nome.trim(), telefone: telefone.trim() || null, email: email.trim() || null,
      data_nascimento: montarAniversario(nascMes, nascDia),
      endereco: serializarEndereco(endereco), observacoes: obs.trim() || null,
    }).eq('id', id).eq('empresa_id', empresaAtiva.id).select('id');
    setSalvando(false);
    if (error) { Alert.alert('Erro', error.message); return; }
    if (!data || data.length === 0) { Alert.alert('Erro', 'Sem permissão para editar esta cliente.'); return; }
    qc.invalidateQueries({ queryKey: ['cliente-detalhe', empresaAtiva.id, id] });
    qc.invalidateQueries({ queryKey: ['clientes'] });
    router.back();
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <LinearGradient colors={['#2C1654', '#3D1F72']} style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 24 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 34, height: 34, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <ChevronLeft size={16} color="#fff" strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>Editar</Text>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: '#fff' }}>{cliente.nome}</Text>
        </LinearGradient>

        <View style={{ padding: 24 }}>
          <Campo label="Nome completo *" value={nome} onChangeText={setNome} placeholder="Nome da cliente" autoCapitalize="words" icon={<User size={16} color={C.text4} strokeWidth={1.8} />} />
          <Campo label="Telefone / WhatsApp" value={telefone} onChangeText={(v) => setTelefone(maskPhone(v))} maxLength={15} placeholder="(00) 00000-0000" keyboardType="phone-pad" icon={<Phone size={16} color={C.text4} strokeWidth={1.8} />} />
          <Campo label="E-mail" value={email} onChangeText={setEmail} placeholder="email@exemplo.com" keyboardType="email-address" icon={<Mail size={16} color={C.text4} strokeWidth={1.8} />} />
          <AniversarioChips mes={nascMes} dia={nascDia} onMes={setNascMes} onDia={setNascDia} />
          <Campo label="Logradouro" value={endereco.logradouro} onChangeText={(v) => setEndereco((e) => ({ ...e, logradouro: v }))} placeholder="Rua, avenida…" autoCapitalize="words" icon={<MapPin size={16} color={C.text4} strokeWidth={1.8} />} />
          <Campo label="Número" value={endereco.numero} onChangeText={(v) => setEndereco((e) => ({ ...e, numero: v }))} placeholder="Nº" keyboardType="numbers-and-punctuation" icon={<MapPin size={16} color={C.text4} strokeWidth={1.8} />} />
          <Campo label="Bairro" value={endereco.bairro} onChangeText={(v) => setEndereco((e) => ({ ...e, bairro: v }))} placeholder="Bairro" autoCapitalize="words" icon={<MapPin size={16} color={C.text4} strokeWidth={1.8} />} />
          <Campo label="Complemento" value={endereco.complemento} onChangeText={(v) => setEndereco((e) => ({ ...e, complemento: v }))} placeholder="Apto, sala…" autoCapitalize="words" icon={<MapPin size={16} color={C.text4} strokeWidth={1.8} />} />
          <Campo label="Observações internas" value={obs} onChangeText={setObs} placeholder="Ex: preferências, como nos conheceu…" autoCapitalize="sentences" multiline icon={<FileText size={16} color={C.text4} strokeWidth={1.8} />} />
        </View>
      </ScrollView>

      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: 24, paddingTop: 12, paddingBottom: insets.bottom + 12 }}>
        <TouchableOpacity onPress={salvar} disabled={salvando} activeOpacity={0.85}>
          <LinearGradient colors={['#2C1654', '#4A2480']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ borderRadius: 16, paddingVertical: 16, alignItems: 'center', shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
            {salvando ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff', letterSpacing: 0.3 }}>Salvar alterações</Text>}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
