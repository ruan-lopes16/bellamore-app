import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StatusBar, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { ChevronLeft, Mail, User, Phone, Percent } from 'lucide-react-native';
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
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/stores/authStore';
import { usePermissoes } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { maskPhone } from '@shared/mascaras';
import { mensagemErroBanco } from '@shared/erros';
import { podeGerenciarMembro } from '@shared/permissoes';
import { rotuloContrato, normalizarComissao, type TipoContrato } from '@shared/equipe';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8', green: '#0D7E5F',
  rose: '#C9527F', roseSoft: '#FCEEF3',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

type MembroEditavel = {
  id: string; user_id: string; role: 'owner' | 'gestor' | 'profissional';
  percentual_comissao: number; tipo_contrato: TipoContrato | null;
  user: { id: string; nome: string; telefone: string | null; email: string | null };
};

const CONTRATOS: { valor: TipoContrato | ''; label: string }[] = [
  { valor: '', label: 'Sem informar' },
  { valor: 'pj', label: rotuloContrato('pj') },
  { valor: 'clt', label: rotuloContrato('clt') },
];

/**
 * Corpo do PATCH (igual ao web): empresaId/userId/membroId/nome/telefone sempre; e-mail, comissão e tipo
 * de contrato só quando mudaram em relação ao carregado (conta antiga com e-mail divergente responderia
 * 409 a qualquer edição se o e-mail fosse sempre enviado). A comissão vai como texto cru: a API valida.
 */
function camposAlterados(membro: MembroEditavel, empresaId: string, v: {
  nome: string; telefone: string | null; emailNovo: string; emailAntigo: string; comissao: string; tipoContrato: TipoContrato | '';
}) {
  const corpo: Record<string, unknown> = {
    empresaId, userId: membro.user_id, membroId: membro.id, nome: v.nome, telefone: v.telefone,
  };
  if (v.emailNovo !== v.emailAntigo) corpo.email = v.emailNovo || null;
  if (normalizarComissao(v.comissao.trim()) !== membro.percentual_comissao) corpo.percentual_comissao = v.comissao.trim();
  if ((v.tipoContrato || null) !== membro.tipo_contrato) corpo.tipo_contrato = v.tipoContrato || null;
  return corpo;
}

// ── Campo ─────────────────────────────────────────────────────

function Campo({
  label, icon, value, onChange, placeholder, keyboardType = 'default', sufixo, maxLength,
}: {
  label: string; icon: React.ReactNode;
  value: string; onChange: (v: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'decimal-pad';
  sufixo?: string; maxLength?: number;
}) {
  return (
    <View style={{ marginBottom: 6 }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 8 }}>
        {label}
      </Text>
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
          keyboardType={keyboardType} maxLength={maxLength}
          autoCapitalize={keyboardType === 'email-address' ? 'none' : 'words'}
          style={{ flex: 1, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text }}
        />
        {sufixo ? <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text3 }}>{sufixo}</Text> : null}
      </View>
    </View>
  );
}

// ── Tela ─────────────────────────────────────────────────────

export default function EditarProfissional() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { empresaAtiva, user } = useAuthStore();
  const empresaId = empresaAtiva?.id;
  const { pode, isOwner, permissoesCarregadas } = usePermissoes();
  const podeEquipe = pode('equipe.gerenciar');
  const qc = useQueryClient();

  const { data: membro, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['equipe-membro', empresaId, id],
    enabled: !!empresaId && !!id && podeEquipe,
    queryFn: async (): Promise<MembroEditavel | null> => {
      const { data, error: e } = await supabase
        .from('empresa_membros')
        .select('id, user_id, role, percentual_comissao, tipo_contrato, user:users(id, nome, telefone, email)')
        .eq('id', id!)
        .eq('empresa_id', empresaId!)
        .maybeSingle();
      if (e) throw new Error(mensagemErroBanco(e, 'carregar esta pessoa'));
      if (!data) return null;
      const m = data as unknown as MembroEditavel;
      return {
        ...m,
        percentual_comissao: Number(m.percentual_comissao ?? 0),
        tipo_contrato: (m.tipo_contrato === 'pj' || m.tipo_contrato === 'clt') ? m.tipo_contrato : null,
      };
    },
  });

  const [nome,         setNome]         = useState('');
  const [telefone,     setTelefone]     = useState('');
  const [email,        setEmail]        = useState('');
  const [comissao,     setComissao]     = useState('');
  const [tipoContrato, setTipoContrato] = useState<TipoContrato | ''>('');
  const [salvando,     setSalvando]     = useState(false);
  const [erro,         setErro]         = useState('');
  const [erroEmail,    setErroEmail]    = useState(false);
  const salvandoRef = useRef(false);
  const preenchidoRef = useRef<string | null>(null);

  // Preenche o formulário uma vez por pessoa carregada (recarregas depois do parcial não apagam a digitação).
  useEffect(() => {
    if (!membro || preenchidoRef.current === membro.id) return;
    preenchidoRef.current = membro.id;
    setNome(membro.user.nome ?? '');
    setTelefone(maskPhone(membro.user.telefone ?? ''));
    setEmail(membro.user.email ?? '');
    setComissao(String(membro.percentual_comissao));
    setTipoContrato(membro.tipo_contrato ?? '');
  }, [membro]);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  });

  if (!fontsLoaded) return null;

  const podeEditar = !!membro && podeGerenciarMembro(
    { isOwner, userId: user?.id ?? '' }, podeEquipe, { role: membro.role, userId: membro.user_id },
  );

  async function salvar() {
    if (salvandoRef.current || !membro || !empresaId || !nome.trim()) return;
    salvandoRef.current = true;
    setSalvando(true);
    setErro(''); setErroEmail(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const apiUrl = process.env.EXPO_PUBLIC_API_URL;
      if (!session || !apiUrl) {
        setErro('Não foi possível salvar. Tente novamente mais tarde.');
        return;
      }
      const emailNovo = email.trim();
      const emailAntigo = (membro.user.email ?? '').trim();
      let res: Response;
      try {
        res = await fetch(`${apiUrl}/api/profissionais`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(camposAlterados(membro, empresaId, {
            nome: nome.trim(), telefone: telefone.trim() || null, emailNovo, emailAntigo, comissao, tipoContrato,
          })),
        });
      } catch {
        setErro('Falha de conexão. Verifique sua internet.');
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg: string = json.error ?? 'Não foi possível salvar.';
        setErro(msg);
        setErroEmail(res.status === 409);
        // Salvamento parcial (400): nome e contato já foram gravados; a lista recarrega.
        if (res.status === 400 && /salvos?, mas/.test(msg)) {
          qc.invalidateQueries({ queryKey: ['equipe'] });
          qc.invalidateQueries({ queryKey: ['profissionais'] });
        }
        return;
      }
      qc.invalidateQueries({ queryKey: ['equipe'] });
      qc.invalidateQueries({ queryKey: ['profissionais'] });
      qc.invalidateQueries({ queryKey: ['equipe-membro'] });
      router.back();
    } finally {
      salvandoRef.current = false;
      setSalvando(false);
    }
  }

  function Aviso({ texto, tentar }: { texto: string; tentar?: boolean }) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 20, color: C.text3, textAlign: 'center' }}>
          {texto}
        </Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
          {tentar && (
            <TouchableOpacity onPress={() => refetch()} style={{ borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.primary }}>Tentar de novo</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => router.back()} style={{ backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: '#fff' }}>Voltar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (permissoesCarregadas && !podeEquipe) return <Aviso texto="Sem permissão para gerenciar a equipe" />;
  if (isLoading || !permissoesCarregadas) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.primary} />
      </View>
    );
  }
  if (isError) return <Aviso texto={error instanceof Error ? error.message : 'Não foi possível carregar esta pessoa.'} tentar />;
  if (!membro) return <Aviso texto="Pessoa não encontrada nesta empresa" />;
  if (!podeEditar) return <Aviso texto="Você só pode editar profissionais da equipe (não a dona, outra gestora ou você mesma)." />;

  const podeSalvar = nome.trim().length > 0 && !salvando;

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
            Editar profissional
          </Text>
        </LinearGradient>

        <MotiView from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 350, delay: 60 }} style={{ padding: 24 }}>

          {erro && !erroEmail ? (
            <View style={{ backgroundColor: C.roseSoft, borderRadius: 12, padding: 12, marginBottom: 16 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.rose, lineHeight: 18 }}>{erro}</Text>
            </View>
          ) : null}

          <View style={{ marginBottom: 16 }}>
            <Campo
              label="Nome *"
              icon={<User size={13} color={C.primary} strokeWidth={1.8} />}
              value={nome} onChange={setNome}
              placeholder="Nome completo"
            />
          </View>

          <View style={{ marginBottom: 16 }}>
            <Campo
              label="Telefone"
              icon={<Phone size={13} color={C.primary} strokeWidth={1.8} />}
              value={telefone} onChange={(v) => setTelefone(maskPhone(v))}
              placeholder="(11) 99999-9999"
              keyboardType="phone-pad" maxLength={15}
            />
          </View>

          <View style={{ marginBottom: 16 }}>
            <Campo
              label="E-mail"
              icon={<Mail size={13} color={C.primary} strokeWidth={1.8} />}
              value={email} onChange={setEmail}
              placeholder="email@exemplo.com"
              keyboardType="email-address"
            />
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, lineHeight: 16 }}>
              Trocar o e-mail troca também o login dela no app.
            </Text>
            {erro && erroEmail ? (
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.rose, marginTop: 6, lineHeight: 16 }}>{erro}</Text>
            ) : null}
          </View>

          <View style={{ marginBottom: 16 }}>
            <Campo
              label="Comissão por atendimento (%)"
              icon={<Percent size={13} color={C.primary} strokeWidth={1.8} />}
              value={comissao} onChange={setComissao}
              placeholder="0"
              keyboardType="decimal-pad" sufixo="%"
            />
          </View>

          <View style={{ marginBottom: 24 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text, marginBottom: 8 }}>
              Tipo de contrato
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {CONTRATOS.map((c) => {
                const ativo = tipoContrato === c.valor;
                return (
                  <TouchableOpacity key={c.valor || 'nenhum'} onPress={() => setTipoContrato(c.valor)}
                    style={{
                      height: 40, borderRadius: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center',
                      borderWidth: 1,
                      borderColor: ativo ? C.primary : C.border,
                      backgroundColor: ativo ? C.primarySoft : C.surface,
                    }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? C.primary : C.text2 }}>
                      {c.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <TouchableOpacity
            onPress={salvar} disabled={!podeSalvar}
            style={{
              backgroundColor: nome.trim() ? C.primary : C.border,
              borderRadius: 14, height: 54,
              alignItems: 'center', justifyContent: 'center',
              opacity: salvando ? 0.7 : 1,
            }}
          >
            {salvando
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: nome.trim() ? '#fff' : C.text3 }}>
                  Salvar
                </Text>
            }
          </TouchableOpacity>

        </MotiView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
