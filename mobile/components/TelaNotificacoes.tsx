import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl, StatusBar, ActivityIndicator, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft, Bell, CalendarDays, ClipboardList, Package, Ban, Check, X, DollarSign, Wallet, Receipt, Gift,
} from 'lucide-react-native';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  useFonts, Fraunces_600SemiBold,
} from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';

import { useAlertas, useAvisos, useAvisosNaoLidos, useMarcarLidas, type AvisoRow, type Alerta } from '@/hooks/useNotificacoes';
import {
  TIPOS_NOTIFICACAO, VISUAL_ALERTA, rotaDoAviso, rotaDoDestino, tipoNotificacao, type AreaApp, type CorAviso,
} from '@shared/notificacoes';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  red: '#C0392B', redSoft: '#FEF2F2',
  amber: '#B45309', amberSoft: '#FEF3E2',
  rose: '#D4608A', roseSoft: '#FDF0F5',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

/** Cores dos tokens de shared (`CorAviso`) na paleta do app. */
const COR: Record<CorAviso, { fg: string; bg: string }> = {
  primary: { fg: C.primary, bg: C.primarySoft },
  amber: { fg: C.amber, bg: C.amberSoft },
  green: { fg: C.green, bg: C.greenSoft },
  red: { fg: C.red, bg: C.redSoft },
  rose: { fg: C.rose, bg: C.roseSoft },
};

/** Ícones pelo nome lucide de shared (iguais em lucide-react e lucide-react-native). */
const ICONES: Record<string, typeof Bell> = {
  CalendarDays, ClipboardList, Package, Ban, Check, X, DollarSign, Wallet, Receipt, Gift,
};

function Icone({ nome, cor }: { nome: string; cor: CorAviso }) {
  const I = ICONES[nome] ?? Bell;
  const c = COR[cor];
  return (
    <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
      <I size={15} color={c.fg} strokeWidth={1.8} />
    </View>
  );
}

function tempoRelativo(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : formatDistanceToNow(d, { locale: ptBR, addSuffix: true });
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={{
        fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase',
        letterSpacing: 1.5, marginLeft: 24, marginBottom: 8,
      }}>
        {titulo}
      </Text>
      {children}
    </View>
  );
}

function Caixa({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: C.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border }}>
      {children}
    </View>
  );
}

function Mensagem({ texto, onPress }: { texto: string; onPress?: () => void }) {
  return (
    <TouchableOpacity disabled={!onPress} onPress={onPress} style={{ paddingHorizontal: 24, paddingVertical: 14 }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>{texto}</Text>
    </TouchableOpacity>
  );
}

function LinhaAlerta({ alerta, ultimo, onPress }: { alerta: Alerta; ultimo: boolean; onPress: () => void }) {
  const v = VISUAL_ALERTA[alerta.grupo];
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: ultimo ? 0 : 1, borderBottomColor: C.border,
        borderLeftWidth: alerta.urgente ? 3 : 0, borderLeftColor: C.red,
      }}
    >
      <Icone nome={v.icone} cor={v.cor} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text, marginBottom: 3 }}>{alerta.titulo}</Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: alerta.urgente ? C.red : C.text3 }}>{alerta.descricao}</Text>
      </View>
    </TouchableOpacity>
  );
}

function LinhaAviso({ aviso, ultimo, onPress }: { aviso: AvisoRow; ultimo: boolean; onPress: () => void }) {
  const t = tipoNotificacao(aviso.tipo);
  const v = t ? TIPOS_NOTIFICACAO[t] : { icone: 'Bell', cor: 'primary' as CorAviso, rotulo: 'Aviso' };
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: ultimo ? 0 : 1, borderBottomColor: C.border,
        backgroundColor: aviso.lida ? C.surface : '#FDFBFF',
        borderLeftWidth: aviso.lida ? 0 : 3, borderLeftColor: C.accent,
        opacity: aviso.lida ? 0.75 : 1,
      }}
    >
      <Icone nome={v.icone} cor={v.cor} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text, marginBottom: 3 }}>{aviso.titulo}</Text>
        {!!aviso.mensagem && (
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3, lineHeight: 17, marginBottom: 6 }}>{aviso.mensagem}</Text>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {!aviso.lida && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.accent }} />}
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text4 }}>
            {v.rotulo} · {tempoRelativo(aviso.created_at)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

/**
 * Tela de Notificações do app, igual à do web: seção **Alertas** (calculados na hora, pela
 * permissão de quem vê) e seção **Avisos** (gravados), com filtro Todas/Não lidas, marcar um ou
 * todos como lidos e o toque abrindo a rota do aviso. Uma tela só para as duas áreas.
 */
export function TelaNotificacoes({ area }: { area: AreaApp }) {
  const insets = useSafeAreaInsets();
  const [filtro, setFiltro] = useState<'todas' | 'nao-lidas'>('todas');

  const alertasQ = useAlertas();
  const avisosQ = useAvisos(filtro === 'nao-lidas');
  const { naoLidas } = useAvisosNaoLidos();
  const { marcarUma, marcarTodas, marcandoTodas } = useMarcarLidas();

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold, PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  });
  if (!fontsLoaded) return null;

  const recarregando = alertasQ.isLoading || avisosQ.isLoading;
  const recarregar = () => { void alertasQ.refetch(); void avisosQ.refetch(); };

  async function abrirAviso(a: AvisoRow) {
    if (!a.lida) {
      try {
        await marcarUma(a.id);
      } catch (e) {
        Alert.alert('Não foi possível marcar como lida', e instanceof Error ? e.message : 'Tente de novo.');
      }
    }
    router.push(rotaDoAviso(a.tipo, 'app', area) as any);
  }

  async function marcarTodasComoLidas() {
    try {
      await marcarTodas();
    } catch (e) {
      Alert.alert('Não foi possível marcar como lidas', e instanceof Error ? e.message : 'Tente de novo.');
    }
  }

  const alertas = alertasQ.alertas;
  const avisos = avisosQ.avisos;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={recarregando} onRefresh={recarregar} tintColor={C.accent} />}
      >
        {/* ── Header ── */}
        <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 16 }}>
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace(rotaDoDestino({ tela: 'dashboard' }, 'app', area) as any))}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 }}
          >
            <ChevronLeft size={18} color={C.text3} strokeWidth={2} />
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text3 }}>Voltar</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: C.text }}>Notificações</Text>
            {!!naoLidas && naoLidas > 0 && (
              <TouchableOpacity onPress={marcarTodasComoLidas} disabled={marcandoTodas} style={{ opacity: marcandoTodas ? 0.5 : 1, paddingBottom: 4 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.accent }}>Marcar todas como lidas</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Alertas ── */}
        <Secao titulo="Alertas">
          <Caixa>
            {alertasQ.isError ? (
              <Mensagem texto={`— ${alertasQ.error instanceof Error ? alertasQ.error.message : 'Não foi possível carregar os alertas.'} Toque para tentar de novo.`} onPress={() => void alertasQ.refetch()} />
            ) : alertas === null ? (
              <View style={{ padding: 16 }}><ActivityIndicator color={C.accent} /></View>
            ) : alertas.length === 0 ? (
              <Mensagem texto="Nenhum alerta no momento." />
            ) : (
              alertas.map((a, i) => (
                <LinhaAlerta key={a.id} alerta={a} ultimo={i === alertas.length - 1}
                  onPress={() => router.push(rotaDoDestino(a.destino, 'app', area) as any)} />
              ))
            )}
          </Caixa>
        </Secao>

        {/* ── Avisos ── */}
        <Secao titulo="Avisos">
          <View style={{ flexDirection: 'row', gap: 6, marginHorizontal: 24, marginBottom: 12 }}>
            {(['todas', 'nao-lidas'] as const).map((f) => (
              <TouchableOpacity
                key={f}
                onPress={() => setFiltro(f)}
                style={{
                  paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
                  backgroundColor: filtro === f ? C.primary : C.surface,
                  borderWidth: 1, borderColor: filtro === f ? C.primary : C.border,
                }}
              >
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: filtro === f ? '#fff' : C.text3 }}>
                  {f === 'todas' ? 'Todas' : 'Não lidas'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Caixa>
            {avisosQ.isError ? (
              <Mensagem texto={`— ${avisosQ.error instanceof Error ? avisosQ.error.message : 'Não foi possível carregar os avisos.'} Toque para tentar de novo.`} onPress={() => void avisosQ.refetch()} />
            ) : avisos === null ? (
              <View style={{ padding: 16 }}><ActivityIndicator color={C.accent} /></View>
            ) : avisos.length === 0 ? (
              <Mensagem texto={filtro === 'nao-lidas' ? 'Nenhum aviso não lido.' : 'Nenhum aviso no momento.'} />
            ) : (
              avisos.map((a, i) => (
                <LinhaAviso key={a.id} aviso={a} ultimo={i === avisos.length - 1} onPress={() => void abrirAviso(a)} />
              ))
            )}
          </Caixa>
          {avisosQ.temMais && (
            <TouchableOpacity onPress={avisosQ.carregarMais} disabled={avisosQ.carregandoMais} style={{ alignItems: 'center', paddingVertical: 14 }}>
              {avisosQ.carregandoMais
                ? <ActivityIndicator color={C.accent} />
                : <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.accent }}>Mostrar mais</Text>}
            </TouchableOpacity>
          )}
        </Secao>
      </ScrollView>
    </View>
  );
}
