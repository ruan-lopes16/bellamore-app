import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl, StatusBar, ActivityIndicator, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft, ChevronRight, Bell, CalendarDays, ClipboardList, Package, Ban, Check, X, DollarSign, Wallet, Receipt, Gift,
} from 'lucide-react-native';
import {
  useFonts, Fraunces_600SemiBold,
} from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';

import { useAlertas, useAvisos, useAvisosNaoLidos, useMarcarLidas, type AvisoRow, type Alerta } from '@/hooks/useNotificacoes';
import {
  alertaTemRota, avisoTemRota, resumoAgendamentosHoje, rotaDoAviso, rotaDoDestino, rotuloNaoLidas, separarAlertas,
  TEXTOS_NOTIFICACOES as T, TIPOS_NOTIFICACAO, VISUAL_ALERTA, tipoNotificacao, type AreaApp, type CorAviso,
} from '@shared/notificacoes';
import { rotuloDataHoraBRT } from '@shared/periodos';
import { BarraDeStatus, useTema, type Paleta } from '@/lib/tema';


/** Cores dos tokens de shared (`CorAviso`) na paleta do app. */
const corAviso = (C: Paleta): Record<CorAviso, { fg: string; bg: string }> => ({
  primary: { fg: C.primary, bg: C.primarySoft },
  amber: { fg: C.amber, bg: C.amberSoft },
  green: { fg: C.green, bg: C.greenSoft },
  red: { fg: C.red, bg: C.redSoft },
  rose: { fg: C.rose, bg: C.roseSoft },
});

/** Ícones pelo nome lucide de shared (iguais em lucide-react e lucide-react-native). */
const ICONES: Record<string, typeof Bell> = {
  CalendarDays, ClipboardList, Package, Ban, Check, X, DollarSign, Wallet, Receipt, Gift,
};

function Icone({ nome, cor }: { nome: string; cor: CorAviso }) {
  const I = ICONES[nome] ?? Bell;
  const { C } = useTema();
  const c = corAviso(C)[cor];
  return (
    <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
      <I size={15} color={c.fg} strokeWidth={1.8} />
    </View>
  );
}

function Pilula({ texto, fundo, cor }: { texto: string; fundo: string; cor: string }) {
  return (
    <View style={{ backgroundColor: fundo, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: cor }}>{texto}</Text>
    </View>
  );
}

function Secao({ titulo, extra, children }: { titulo: string; extra?: React.ReactNode; children: React.ReactNode }) {
  const { C } = useTema();
  return (
    <View style={{ marginBottom: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 24, marginBottom: 8 }}>
        <Text style={{
          fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.5,
        }}>
          {titulo}
        </Text>
        {extra}
      </View>
      {children}
    </View>
  );
}

function Caixa({ children }: { children: React.ReactNode }) {
  const { C } = useTema();
  return (
    <View style={{ backgroundColor: C.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border }}>
      {children}
    </View>
  );
}

function Mensagem({ texto, titulo }: { texto: string; titulo?: string }) {
  const { C } = useTema();
  return (
    <View style={{ paddingHorizontal: 24, paddingVertical: 14 }}>
      {!!titulo && <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text, marginBottom: 2 }}>{titulo}</Text>}
      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>{texto}</Text>
    </View>
  );
}

/** Erro de carga com "Tentar de novo" (igual ao web: nunca lista vazia por falha). */
function ErroCarga({ texto, onTentar }: { texto: string; onTentar: () => void }) {
  const { C } = useTema();
  return (
    <View style={{ paddingHorizontal: 24, paddingVertical: 14, backgroundColor: C.redSoft }}>
      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.red, marginBottom: 8 }}>{texto}</Text>
      <TouchableOpacity onPress={onTentar}>
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text2 }}>{T.tentarDeNovo}</Text>
      </TouchableOpacity>
    </View>
  );
}

function LinhaAlerta({ alerta, ultimo, onPress }: { alerta: Alerta; ultimo: boolean; onPress: (() => void) | null }) {
  const { C } = useTema();
  const v = VISUAL_ALERTA[alerta.grupo];
  return (
    <TouchableOpacity
      onPress={onPress ?? undefined}
      disabled={!onPress}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: ultimo ? 0 : 1, borderBottomColor: C.border,
        backgroundColor: alerta.urgente ? C.roseSoft : C.surface,
      }}
    >
      <Icone nome={v.icone} cor={v.cor} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: alerta.urgente ? C.rose : C.text, marginBottom: 3 }}>{alerta.titulo}</Text>
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>{alerta.descricao}</Text>
      </View>
      {!!onPress && <ChevronRight size={14} color={C.text4} strokeWidth={2} />}
    </TouchableOpacity>
  );
}

function LinhaAviso({ aviso, ultimo, onPress, onMarcar }: {
  aviso: AvisoRow; ultimo: boolean; onPress: () => void; onMarcar: () => void;
}) {
  const { C } = useTema();
  const t = tipoNotificacao(aviso.tipo);
  const v = t ? TIPOS_NOTIFICACAO[t] : null;
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: ultimo ? 0 : 1, borderBottomColor: C.border,
        backgroundColor: aviso.lida ? C.surface : C.primarySoft,
        opacity: aviso.lida ? 0.7 : 1,
      }}
    >
      {v ? <Icone nome={v.icone} cor={v.cor} /> : (
        <View style={{ width: 7, height: 7, borderRadius: 4, marginTop: 6, backgroundColor: aviso.lida ? C.border : C.accent }} />
      )}
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: aviso.lida ? C.text2 : C.text }}>{aviso.titulo}</Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text4 }}>{rotuloDataHoraBRT(aviso.created_at)}</Text>
        </View>
        {!!v && <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: corAviso(C)[v.cor].fg, marginTop: 2 }}>{v.rotulo}</Text>}
        {!!aviso.mensagem && (
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3, lineHeight: 17, marginTop: 3 }}>{aviso.mensagem}</Text>
        )}
      </TouchableOpacity>
      {!aviso.lida && (
        <TouchableOpacity
          onPress={onMarcar}
          accessibilityLabel={T.marcarUma}
          hitSlop={8}
          style={{ width: 28, height: 28, borderRadius: 10, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}
        >
          <Check size={13} color={C.primary} strokeWidth={2} />
        </TouchableOpacity>
      )}
    </View>
  );
}

/**
 * Tela de Notificações do app, igual à do web (textos e regras de @shared/notificacoes):
 * - **Alertas** (calculados na hora, pela permissão de quem vê): os agendamentos de hoje viram
 *   uma linha-resumo expansível; tocar abre a tela do alerta. Na área da profissional, o alerta
 *   sem tela própria (aniversário, estoque...) não navega (`alertaTemRota`).
 * - **Avisos** (gravados): filtro Todas/Não lidas, contador de não lidas, marcar um (botão) ou
 *   todos; tocar marca como lido e abre a tela do aviso, quando ela existe na área.
 * Uma tela só para as duas áreas.
 */
export function TelaNotificacoes({ area }: { area: AreaApp }) {
  const { C } = useTema();
  const insets = useSafeAreaInsets();
  const [filtro, setFiltro] = useState<'todas' | 'nao-lidas'>('todas');
  const [agsExpandido, setAgsExpandido] = useState(false);

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

  /** Marca um aviso: avisa quando o banco não confirmou (apagado ou de outra pessoa). */
  async function marcar(id: string) {
    try {
      const { confirmados } = await marcarUma(id);
      if (confirmados.length === 0) Alert.alert(T.erroMarcar, T.avisoNaoMarcado);
    } catch (e) {
      Alert.alert(T.erroMarcar, e instanceof Error ? e.message : T.tentarDeNovo);
    }
  }

  async function abrirAviso(a: AvisoRow) {
    if (!a.lida) await marcar(a.id);
    if (avisoTemRota(a.tipo, 'app', area)) router.push(rotaDoAviso(a.tipo, 'app', area) as any);
  }

  async function marcarTodasComoLidas() {
    try {
      await marcarTodas();
    } catch (e) {
      Alert.alert(T.erroMarcarTodas, e instanceof Error ? e.message : T.tentarDeNovo);
    }
  }

  const abrirAlerta = (a: Alerta) => (alertaTemRota(a.destino, 'app', area)
    ? () => router.push(rotaDoDestino(a.destino, 'app', area) as any)
    : null);

  const alertas = alertasQ.alertas;
  const { agendamentos: ags, outros } = separarAlertas(alertas ?? []);
  const resumoAg = resumoAgendamentosHoje(ags);
  const urgentes = (alertas ?? []).filter(a => a.urgente).length;
  const avisos = avisosQ.avisos;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <BarraDeStatus comFundo />
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
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: C.text }}>{T.titulo}</Text>
            {(naoLidas ?? 0) > 0 && (
              <TouchableOpacity onPress={marcarTodasComoLidas} disabled={marcandoTodas} style={{ opacity: marcandoTodas ? 0.5 : 1, paddingBottom: 4 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.accent }}>
                  {marcandoTodas ? T.marcando : T.marcarTodas}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Alertas ── */}
        <Secao
          titulo={T.secaoAlertas}
          extra={alertas && alertas.length > 0
            ? <Pilula texto={String(alertas.length)} fundo={urgentes > 0 ? C.rose : C.amberSoft} cor={urgentes > 0 ? '#fff' : C.amber} />
            : null}
        >
          <Caixa>
            {alertasQ.isError ? (
              <ErroCarga
                texto={alertasQ.error instanceof Error ? alertasQ.error.message : T.erroAlertas}
                onTentar={() => void alertasQ.refetch()}
              />
            ) : alertas === null ? (
              <View style={{ padding: 16 }}><ActivityIndicator color={C.accent} /></View>
            ) : alertas.length === 0 ? (
              <Mensagem titulo={T.semAlertasTitulo} texto={T.semAlertas} />
            ) : (
              <>
                {resumoAg && (
                  <View style={{ borderBottomWidth: outros.length > 0 ? 1 : 0, borderBottomColor: C.border }}>
                    <TouchableOpacity
                      onPress={() => setAgsExpandido(x => !x)}
                      activeOpacity={0.7}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 }}
                    >
                      <Icone nome={VISUAL_ALERTA.agendamentos.icone} cor={VISUAL_ALERTA.agendamentos.cor} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text, marginBottom: 3 }}>{resumoAg.titulo}</Text>
                        <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>{resumoAg.descricao}</Text>
                      </View>
                      <ChevronRight size={14} color={C.text4} strokeWidth={2} style={{ transform: [{ rotate: agsExpandido ? '90deg' : '0deg' }] }} />
                    </TouchableOpacity>
                    {agsExpandido && ags.map((a, i) => (
                      <LinhaAlerta key={a.id} alerta={a} ultimo={i === ags.length - 1} onPress={abrirAlerta(a)} />
                    ))}
                  </View>
                )}
                {outros.map((a, i) => (
                  <LinhaAlerta key={a.id} alerta={a} ultimo={i === outros.length - 1} onPress={abrirAlerta(a)} />
                ))}
              </>
            )}
          </Caixa>
        </Secao>

        {/* ── Avisos ── */}
        <Secao titulo={T.secaoAvisos} extra={<Pilula texto={rotuloNaoLidas(naoLidas)} fundo={C.primary} cor="#fff" />}>
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
                  {f === 'todas' ? T.filtroTodas : T.filtroNaoLidas}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Caixa>
            {avisosQ.isError ? (
              <ErroCarga
                texto={avisosQ.error instanceof Error ? avisosQ.error.message : T.erroAvisos}
                onTentar={() => void avisosQ.refetch()}
              />
            ) : avisos === null ? (
              <View style={{ padding: 16 }}><ActivityIndicator color={C.accent} /></View>
            ) : avisos.length === 0 ? (
              <Mensagem texto={filtro === 'nao-lidas' ? T.semAvisosNaoLidos : T.semAvisos} />
            ) : (
              avisos.map((a, i) => (
                <LinhaAviso
                  key={a.id} aviso={a} ultimo={i === avisos.length - 1}
                  onPress={() => void abrirAviso(a)} onMarcar={() => void marcar(a.id)}
                />
              ))
            )}
          </Caixa>
          {avisosQ.temMais && (
            <TouchableOpacity onPress={avisosQ.carregarMais} disabled={avisosQ.carregandoMais} style={{ alignItems: 'center', paddingVertical: 14 }}>
              {avisosQ.carregandoMais
                ? <ActivityIndicator color={C.accent} />
                : <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.accent }}>{T.mostrarMais}</Text>}
            </TouchableOpacity>
          )}
        </Secao>
      </ScrollView>
    </View>
  );
}
