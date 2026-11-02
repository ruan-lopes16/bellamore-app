/**
 * Trocar e-mail de login (Configurações → perfil, todos os papéis). Igual ao web:
 * `updateUser({ email })` e o aviso de confirmação; o e-mail só muda depois do link.
 */
import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Mail } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useTema } from '@/lib/tema';
import { MENSAGEM_EMAIL_CONFIRMACAO, validarTrocaEmail } from '@shared/configuracoes-empresa';

export function TrocarEmail() {
  const { C } = useTema();
  const [atual, setAtual] = useState<string | null>(null);
  const [pendente, setPendente] = useState('');
  const [aberto, setAberto] = useState(false);
  const [novo, setNovo] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    supabase.auth.getUser()
      .then(({ data, error }) => {
        if (error || !data.user) { setAtual(''); return; }
        setAtual(data.user.email ?? '');
        setPendente(data.user.new_email ?? '');
      })
      .catch(() => setAtual(''));
  }, []);

  async function enviar() {
    setMsg(null);
    const erro = validarTrocaEmail(novo, confirmacao, atual ?? '');
    if (erro) { setMsg({ ok: false, texto: erro }); return; }
    setEnviando(true);
    const email = novo.trim().toLowerCase();
    const { error } = await supabase.auth.updateUser({ email });
    setEnviando(false);
    if (error) { setMsg({ ok: false, texto: 'Não foi possível pedir a troca de e-mail. Tente de novo.' }); return; }
    setPendente(email);
    setAberto(false); setNovo(''); setConfirmacao('');
    setMsg({ ok: true, texto: MENSAGEM_EMAIL_CONFIRMACAO });
  }

  const campo = (valor: string, onChange: (v: string) => void, placeholder: string) => (
    <TextInput
      value={valor}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={C.text4}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="email-address"
      style={{
        height: 42, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg,
        paddingHorizontal: 12, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text,
      }}
    />
  );

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border, gap: 8 }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.8 }}>
        E-mail
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Mail size={13} color={C.primary} strokeWidth={1.8} />
        </View>
        <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text }} numberOfLines={1}>
          {atual === null ? '…' : atual || '—'}
        </Text>
        {!aberto && (
          <TouchableOpacity onPress={() => { setAberto(true); setMsg(null); }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.accent }}>Alterar</Text>
          </TouchableOpacity>
        )}
      </View>
      {!!pendente && pendente !== atual && (
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.amber }}>
          Aguardando confirmação de {pendente}.
        </Text>
      )}
      {aberto && (
        <View style={{ gap: 8 }}>
          {campo(novo, setNovo, 'Novo e-mail')}
          {campo(confirmacao, setConfirmacao, 'Confirme o novo e-mail')}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={() => { setAberto(false); setNovo(''); setConfirmacao(''); setMsg(null); }}
              style={{ flex: 1, height: 40, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text2 }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void enviar()}
              disabled={enviando}
              style={{ flex: 1, height: 40, borderRadius: 10, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', opacity: enviando ? 0.7 : 1 }}
            >
              {enviando
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' }}>Enviar link</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}
      {msg && (
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: msg.ok ? C.green : C.red }}>{msg.texto}</Text>
      )}
    </View>
  );
}
