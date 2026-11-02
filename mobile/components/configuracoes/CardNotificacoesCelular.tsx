/**
 * Card "Notificações no celular" (Configurações da empresa e da profissional): status do aparelho,
 * o botão "Ativar notificações" (único lugar que pede a permissão do sistema) e as duas
 * preferências por pessoa, salvas na hora (sem botão Salvar), com o resultado conferido.
 */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Switch, ActivityIndicator, AppState, Linking } from 'react-native';
import { Bell } from 'lucide-react-native';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { useTema } from '@/lib/tema';
import {
  ativarNotificacoes, statusPermissaoNotificacoes, erroRegistroPush, resultadoRegistroPush,
} from '@/lib/notifications';
import { salvarPreferenciaNotificacao, type PreferenciaNotificacao } from '@shared/configuracoes-empresa';
import type { ResultadoRegistroPush } from '@shared/lembretes-locais';

type Permissao = Awaited<ReturnType<typeof statusPermissaoNotificacoes>>;

const PREFERENCIAS: { campo: PreferenciaNotificacao; titulo: string; detalhe: string }[] = [
  { campo: 'notif_resumo_diario', titulo: 'Resumo do dia', detalhe: '1x por dia, às 07:00' },
  { campo: 'notif_lembrete_atendimento', titulo: 'Lembrete de atendimento', detalhe: '30 min antes de cada atendimento' },
];

export function CardNotificacoesCelular() {
  const { C } = useTema();
  const { user, empresaAtiva } = useAuthStore();
  const [permissao, setPermissao] = useState<Permissao | null>(null);
  const [resultado, setResultado] = useState<ResultadoRegistroPush | null>(resultadoRegistroPush());
  const [erro, setErro] = useState<string | null>(erroRegistroPush());
  const [ativando, setAtivando] = useState(false);

  // Preferências: valor local (otimista) + qual está gravando + mensagem do último resultado.
  const [prefs, setPrefs] = useState<Record<PreferenciaNotificacao, boolean>>({
    notif_resumo_diario: user?.notif_resumo_diario ?? true,
    notif_lembrete_atendimento: user?.notif_lembrete_atendimento ?? true,
  });
  const [gravando, setGravando] = useState<PreferenciaNotificacao | null>(null);
  const [msgPref, setMsgPref] = useState<{ ok: boolean; texto: string } | null>(null);

  const atualizarStatus = useCallback(async () => {
    try { setPermissao(await statusPermissaoNotificacoes()); } catch { setPermissao(null); }
    setResultado(resultadoRegistroPush());
    setErro(erroRegistroPush());
  }, []);

  useEffect(() => {
    void atualizarStatus();
    // Voltando dos ajustes do aparelho: relê a permissão.
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void atualizarStatus(); });
    return () => sub.remove();
  }, [atualizarStatus]);

  async function ativar() {
    if (!user || !empresaAtiva || ativando) return;
    setAtivando(true);
    try {
      await ativarNotificacoes(user.id, empresaAtiva.id);
    } catch { /* a mensagem fica em erroRegistroPush() */ }
    await atualizarStatus();
    setAtivando(false);
  }

  async function alterarPref(campo: PreferenciaNotificacao, valor: boolean) {
    if (!user || gravando) return;
    setPrefs((p) => ({ ...p, [campo]: valor }));
    setGravando(campo); setMsgPref(null);
    try {
      await salvarPreferenciaNotificacao(supabase, user.id, campo, valor);
      // A sessão guarda o perfil: sem isto a tela reabriria com o valor antigo.
      const atual = useAuthStore.getState().user;
      if (atual) useAuthStore.setState({ user: { ...atual, [campo]: valor } });
      setMsgPref({ ok: true, texto: 'Preferência salva.' });
    } catch (e) {
      setPrefs((p) => ({ ...p, [campo]: !valor }));
      setMsgPref({ ok: false, texto: e instanceof Error ? e.message : 'Não foi possível salvar a preferência.' });
    } finally {
      setGravando(null);
    }
  }

  const ativado = permissao === 'concedida' && (resultado === 'registrado' || resultado === 'sem_migration') && !erro;

  let status: { cor: string; texto: string };
  if (permissao === null) status = { cor: C.text3, texto: 'Verificando…' };
  else if (permissao === 'sem_suporte') status = { cor: C.text3, texto: 'Este aparelho não recebe notificações (simulador).' };
  else if (erro) status = { cor: C.red, texto: `Não foi possível registrar este aparelho: ${erro}` };
  else if (ativado) status = { cor: C.green, texto: 'Ativadas neste aparelho.' };
  else if (permissao === 'negada') status = {
    cor: C.amber,
    texto: 'Permissão negada. Abra os ajustes do aparelho → Notificações → App Estética e permita.',
  };
  else status = { cor: C.text3, texto: 'Desativadas neste aparelho.' };

  const botao = (rotulo: string, onPress: () => void) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={ativando}
      style={{
        height: 44, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
        flexDirection: 'row', gap: 8, opacity: ativando ? 0.7 : 1,
      }}
    >
      {ativando
        ? <ActivityIndicator color="#fff" size="small" />
        : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: '#fff' }}>{rotulo}</Text>}
    </TouchableOpacity>
  );

  return (
    <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 18, gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Bell size={16} color={C.primary} strokeWidth={1.8} />
        <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 16, color: C.text }}>Notificações no celular</Text>
      </View>

      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: status.cor }}>{status.texto}</Text>

      {permissao !== null && permissao !== 'sem_suporte' && (
        erro
          ? botao('Tentar de novo', () => void ativar())
          : permissao === 'negada'
            ? botao('Abrir ajustes do aparelho', () => void Linking.openSettings())
            : !ativado && botao('Ativar notificações', () => void ativar())
      )}

      {PREFERENCIAS.map((p) => (
        <TouchableOpacity
          key={p.campo}
          onPress={() => void alterarPref(p.campo, !prefs[p.campo])}
          disabled={!!gravando}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
        >
          <Switch
            value={prefs[p.campo]}
            onValueChange={(v) => void alterarPref(p.campo, v)}
            disabled={!!gravando}
            trackColor={{ false: C.border, true: C.primary }}
            thumbColor="#fff"
          />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>{p.titulo}</Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3 }}>{p.detalhe}</Text>
          </View>
          {gravando === p.campo && <ActivityIndicator size="small" color={C.accent} />}
        </TouchableOpacity>
      ))}
      {msgPref && (
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: msgPref.ok ? C.green : C.red }}>
          {msgPref.texto}
        </Text>
      )}
    </View>
  );
}
