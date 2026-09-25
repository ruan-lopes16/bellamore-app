import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StatusBar, RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Target, Pencil, AlertTriangle, UserX, CalendarDays } from 'lucide-react-native';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
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
import {
  useAgendaProfissional, useKpisDiaProfissional, useResumoComissoes,
  useMetaPessoal, useDefinirMetaPessoal, useClientesReconquistaProfissional,
} from '@/hooks/useProfissional';
import { progressoMetaPessoal } from '@shared/dashboard-profissional';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  rose: '#C0392B', roseSoft: '#FEF2F2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 0,
  }).format(v);
}

// ── Card de meta pessoal ──────────────────────────────────────

function MetaPessoalCard({ meta, faturamentoBruto }: { meta: number | null; faturamentoBruto: number }) {
  const definirMeta = useDefinirMetaPessoal();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(meta ? String(meta) : '');
  const progresso = progressoMetaPessoal(faturamentoBruto, meta);

  async function salvar() {
    const num = valor.trim() ? parseFloat(valor.replace(',', '.')) : null;
    if (valor.trim() && (!Number.isFinite(num) || (num as number) < 0)) return;
    await definirMeta.mutateAsync(num);
    setEditando(false);
  }

  return (
    <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, marginHorizontal: 24, marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Target size={14} color={progresso.temMeta && progresso.percentual >= 100 ? C.green : C.accent} />
        <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Minha meta do mês
        </Text>
        <TouchableOpacity onPress={() => { setValor(meta ? String(meta) : ''); setEditando((v) => !v); }}>
          <Pencil size={14} color={C.text3} />
        </TouchableOpacity>
      </View>
      {editando ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            value={valor} onChangeText={setValor} keyboardType="decimal-pad" placeholder="Sem meta"
            style={{ flex: 1, height: 38, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text }}
          />
          <TouchableOpacity onPress={salvar} disabled={definirMeta.isPending}
            style={{ height: 38, paddingHorizontal: 14, borderRadius: 10, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' }}>Salvar</Text>
          </TouchableOpacity>
        </View>
      ) : progresso.temMeta ? (
        <>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: progresso.percentual >= 100 ? C.green : C.text2, marginBottom: 6 }}>
            {fmtBRL(faturamentoBruto)} / {fmtBRL(meta!)}
          </Text>
          <View style={{ height: 8, borderRadius: 999, backgroundColor: C.bg, overflow: 'hidden' }}>
            <View style={{ height: 8, borderRadius: 999, width: `${progresso.percentual}%`, backgroundColor: progresso.percentual >= 100 ? C.green : C.accent }} />
          </View>
        </>
      ) : (
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text4 }}>
          Sem meta definida — toque no lápis para definir.
        </Text>
      )}
    </View>
  );
}

// ── Tela principal ────────────────────────────────────────────

export default function Inicio() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva } = useAuthStore();
  const hoje = new Date();

  const { data: agendaHoje, isLoading: loadingAgenda, refetch: refetchAgenda } = useAgendaProfissional(hoje);
  const { data: kpisDia, refetch: refetchKpis } = useKpisDiaProfissional(hoje);
  const { data: resumoMes, refetch: refetchResumo } = useResumoComissoes(hoje);
  const { data: meta, refetch: refetchMeta } = useMetaPessoal();
  const { data: reconquista, refetch: refetchReconquista } = useClientesReconquistaProfissional();

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  async function onRefresh() {
    await Promise.all([refetchAgenda(), refetchKpis(), refetchResumo(), refetchMeta(), refetchReconquista()]);
  }

  if (!fontsLoaded) return null;

  const ags = agendaHoje ?? [];
  const concluidos = ags.filter((a) => a.status === 'concluido').length;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={loadingAgenda} onRefresh={onRefresh} tintColor="#fff" />}
      >
        <LinearGradient colors={['#2C1654', '#3D1F72']} style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 20 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
            {empresaAtiva?.nome}
          </Text>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: '#fff' }}>
            {format(hoje, "EEEE, d 'de' MMMM", { locale: ptBR })}
          </Text>
        </LinearGradient>

        {/* KPIs */}
        <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 24, marginTop: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { value: String(ags.length),                          label: 'Agenda hoje',       color: C.accent },
            { value: fmtBRL(kpisDia?.receitaDia ?? 0),              label: 'Fat. hoje',         color: C.primary },
            { value: fmtBRL(resumoMes?.faturamentoBruto ?? 0),      label: 'Fat. bruto do mês', color: C.primary },
            { value: fmtBRL((resumoMes?.pago ?? 0) + (resumoMes?.pendente ?? 0)), label: 'Comissão do mês', color: C.green },
          ].map((s) => (
            <View key={s.label} style={{
              width: '47%', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 14, padding: 12,
            }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: s.color, letterSpacing: -0.3 }}>{s.value}</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 3 }}>{s.label}</Text>
            </View>
          ))}
        </View>

        <MetaPessoalCard meta={meta ?? null} faturamentoBruto={resumoMes?.faturamentoBruto ?? 0} />

        {/* Agenda de hoje */}
        <View style={{ marginHorizontal: 24, marginBottom: 20 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            Atendimentos de hoje ({concluidos} concluído{concluidos !== 1 ? 's' : ''})
          </Text>
          {ags.length === 0 ? (
            <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 20, alignItems: 'center' }}>
              <CalendarDays size={20} color={C.text4} />
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text4, marginTop: 8 }}>Nenhum atendimento hoje.</Text>
            </View>
          ) : (
            ags.map((ag) => (
              <TouchableOpacity key={ag.id} onPress={() => router.push(`/(profissional)/agendamento/${ag.id}` as any)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12, marginBottom: 8 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text, width: 44 }}>
                  {format(new Date(ag.data_hora_inicio), 'HH:mm')}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
                    {ag.cliente?.nome ?? 'Cliente'} · {ag.servico?.nome ?? 'Serviço'}
                  </Text>
                </View>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.primary }}>
                  {fmtBRL(Number(ag.valor))}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Reconquista */}
        {reconquista && (reconquista.emRisco.length > 0 || reconquista.naoRetornou.length > 0) && (
          <View style={{ marginHorizontal: 24 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Clientes para reconquistar
            </Text>
            {reconquista.naoRetornou.slice(0, 6).map((c) => (
              <TouchableOpacity key={c.clienteId} onPress={() => router.push(`/(empresa)/cliente/${c.clienteId}` as any)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12, marginBottom: 8 }}>
                <UserX size={16} color={C.text3} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>{c.nome}</Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }}>Veio 1x há {c.diasSemVisita} dias e não voltou</Text>
                </View>
              </TouchableOpacity>
            ))}
            {reconquista.emRisco.slice(0, 6).map((c) => (
              <TouchableOpacity key={c.clienteId} onPress={() => router.push(`/(empresa)/cliente/${c.clienteId}` as any)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.roseSoft, borderWidth: 1, borderColor: 'rgba(192,57,43,0.2)', borderRadius: 14, padding: 12, marginBottom: 8 }}>
                <AlertTriangle size={16} color={C.rose} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>{c.nome}</Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.rose }}>{c.totalVisitas} atendimentos · sem vir há {c.diasSemVisita} dias</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
