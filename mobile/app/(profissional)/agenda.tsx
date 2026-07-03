import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  RefreshControl, StatusBar,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react-native';
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
import {
  addDays, subMonths, addMonths,
  format, isSameDay, startOfWeek,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { useAuthStore } from '@/stores/authStore';
import {
  useAgendaProfissional, useKpisDiaProfissional, useDiasProfissional,
} from '@/hooks/useProfissional';
import { CATEGORIA_CONFIG, type AgendamentoCompleto } from '@/hooks/useAgenda';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const HORAS = Array.from({ length: 13 }, (_, i) => i + 7);

const STATUS_CONFIG = {
  agendado:   { label: 'Agendado',   bg: C.primarySoft, color: C.primary },
  confirmado: { label: 'Confirmado', bg: C.greenSoft,   color: C.green },
  concluido:  { label: 'Concluído',  bg: '#F3F4F6',     color: '#6B7280' },
  faltou:     { label: 'Faltou',     bg: C.amberSoft,   color: C.amber },
  cancelado:  { label: 'Cancelado',  bg: '#FEF2F2',     color: '#C0392B' },
};

const AVATAR_COLORS: [string, string][] = [
  ['#7C3AED', '#A855F7'], ['#D4608A', '#F472B6'],
  ['#0D7E5F', '#34D399'], ['#B45309', '#F59E0B'],
];

function avatarColors(nome: string): [string, string] {
  return AVATAR_COLORS[(nome?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length];
}
function iniciaisNome(nome: string) {
  return (nome ?? '').split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}
function formatBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

// ── Card de agendamento da profissional ──────────────────────

function AgendamentoCard({ ag, percentual, index }: {
  ag: AgendamentoCompleto; percentual: number; index: number;
}) {
  const cfg       = CATEGORIA_CONFIG[ag.categoria];
  const statusCfg = STATUS_CONFIG[ag.status] ?? STATUS_CONFIG.agendado;
  const comissao  = ag.valor * (percentual / 100);

  return (
    <MotiView
      from={{ opacity: 0, translateX: -6 }}
      animate={{ opacity: 1, translateX: 0 }}
      transition={{ type: 'timing', duration: 280, delay: index * 50 }}
    >
      <TouchableOpacity
        onPress={() => router.push(`/(profissional)/agendamento/${ag.id}` as any)}
        activeOpacity={0.85}
        style={{
          backgroundColor: cfg.bg,
          borderRadius: 14,
          borderLeftWidth: 3,
          borderLeftColor: cfg.border,
          borderWidth: 1,
          borderColor: `${cfg.border}25`,
          padding: 11,
          marginBottom: 6,
        }}
      >
        {/* Linha 1: cliente + horário */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text, flex: 1 }} numberOfLines={1}>
            {ag.cliente?.nome}
          </Text>
          <View style={{ backgroundColor: 'rgba(255,255,255,0.75)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 8 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3 }}>
              {format(new Date(ag.data_hora_inicio), 'HH:mm')} – {format(new Date(ag.data_hora_fim), 'HH:mm')}
            </Text>
          </View>
        </View>

        {/* Linha 2: serviço */}
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginBottom: 8 }} numberOfLines={1}>
          {ag.servico?.nome}
        </Text>

        {/* Linha 3: comissão + valor + status */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Cálculo da comissão */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3 }}>
              Minha comissão ({percentual}%):
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.green }}>
              {formatBRL(comissao)}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text }}>
              {formatBRL(ag.valor)}
            </Text>
            <View style={{ backgroundColor: statusCfg.bg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: statusCfg.color, textTransform: 'uppercase' }}>
                {statusCfg.label}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </MotiView>
  );
}

// ── Slot vazio ───────────────────────────────────────────────

function SlotVazio({ hora, dia }: { hora: number; dia: Date }) {
  return (
    <TouchableOpacity
      onPress={() => router.push(`/(profissional)/novo-agendamento?hora=${hora}` as any)}
      style={{
        height: 48, borderRadius: 10,
        borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#C4BAD4',
        marginBottom: 6, flexDirection: 'row',
        alignItems: 'center', justifyContent: 'center', gap: 6,
        backgroundColor: 'rgba(155,111,232,0.03)',
      }}
    >
      <View style={{
        width: 18, height: 18, borderRadius: 6,
        backgroundColor: 'rgba(155,111,232,0.15)',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Plus size={11} color={C.accent} strokeWidth={2.5} />
      </View>
      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.text3 }}>
        Agendar neste horário
      </Text>
    </TouchableOpacity>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function AgendaProfissional() {
  const insets = useSafeAreaInsets();
  const { user, empresaAtiva } = useAuthStore();

  const [diaSelecionado, setDiaSelecionado] = useState(new Date());
  const [mesRef, setMesRef] = useState(new Date());

  const semana = Array.from({ length: 7 }, (_, i) =>
    addDays(startOfWeek(diaSelecionado, { weekStartsOn: 1 }), i)
  );

  const { data: agendamentos = [], isLoading, refetch } = useAgendaProfissional(diaSelecionado);
  const { data: kpis } = useKpisDiaProfissional(diaSelecionado);
  const { data: diasComAg } = useDiasProfissional(mesRef);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const onRefresh = useCallback(() => refetch(), [refetch]);

  if (!fontsLoaded) return null;

  const percentual = kpis?.percentual ?? 0;

  const agPorHora: Record<number, AgendamentoCompleto[]> = {};
  agendamentos.forEach((ag) => {
    const h = new Date(ag.data_hora_inicio).getHours();
    if (!agPorHora[h]) agPorHora[h] = [];
    agPorHora[h].push(ag);
  });

  const [c1, c2] = avatarColors(user?.nome ?? '');

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={onRefresh} tintColor="#fff" />}
        stickyHeaderIndices={[0]}
      >
        {/* ── Hero sticky ── */}
        <View>
          <LinearGradient
            colors={['#2C1654', '#3D1F72']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 20 }}
          >
            {/* Perfil */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              <LinearGradient
                colors={[c1, c2]}
                style={{ width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' }}
              >
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18, color: '#fff' }}>
                  {iniciaisNome(user?.nome ?? '')}
                </Text>
              </LinearGradient>
              <View>
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 2 }}>
                  Bom dia
                </Text>
                <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 22, color: '#fff', lineHeight: 26 }}>
                  {user?.nome?.split(' ')[0]}
                </Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                  {empresaAtiva?.nome}
                </Text>
              </View>
            </View>

            {/* KPIs do dia */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[
                { value: String(kpis?.total ?? 0),              label: 'Hoje',         color: '#fff' },
                { value: formatBRL(kpis?.comissaoDia ?? 0),     label: 'Comissão hoje', color: '#6EE7B7' },
                { value: formatBRL(kpis?.totalPendente ?? 0),   label: 'A receber',    color: '#FCD34D' },
              ].map((k) => (
                <View key={k.label} style={{
                  flex: 1,
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
                  borderRadius: 12, padding: 10,
                }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: k.color, letterSpacing: -0.5, lineHeight: 18, marginBottom: 3 }}>
                    {k.value}
                  </Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                    {k.label}
                  </Text>
                </View>
              ))}
            </View>
          </LinearGradient>

          {/* Strip semanal */}
          <View style={{ backgroundColor: C.bg, paddingTop: 14 }}>
            {/* Nav mês */}
            <View style={{ marginHorizontal: 24, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <TouchableOpacity onPress={() => setMesRef(m => subMonths(m, 1))} style={{ width: 26, height: 26, borderRadius: 7, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
                <ChevronLeft size={12} color={C.text2} strokeWidth={2.5} />
              </TouchableOpacity>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
                {format(mesRef, 'MMMM yyyy', { locale: ptBR }).replace(/^\w/, c => c.toUpperCase())}
              </Text>
              <TouchableOpacity onPress={() => setMesRef(m => addMonths(m, 1))} style={{ width: 26, height: 26, borderRadius: 7, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
                <ChevronRight size={12} color={C.text2} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>

            <View style={{ marginHorizontal: 24, marginBottom: 14, flexDirection: 'row', gap: 4 }}>
              {semana.map((dia) => {
                const ativo = isSameDay(dia, diaSelecionado);
                const temAg = diasComAg?.has(format(dia, 'yyyy-MM-dd')) ?? false;
                const nomeD = format(dia, 'EEE', { locale: ptBR }).slice(0, 3);
                return (
                  <TouchableOpacity
                    key={dia.toISOString()}
                    onPress={() => { setDiaSelecionado(dia); setMesRef(dia); }}
                    style={{
                      flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 14, gap: 4,
                      backgroundColor: ativo ? C.primary : temAg ? C.surface : 'transparent',
                      borderWidth: ativo || temAg ? 1 : 0,
                      borderColor: ativo ? C.primary : C.border,
                    }}
                  >
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: ativo ? 'rgba(255,255,255,0.6)' : C.text3 }}>
                      {nomeD}
                    </Text>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, lineHeight: 18, color: ativo ? '#fff' : C.text }}>
                      {format(dia, 'd')}
                    </Text>
                    <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: ativo ? 'rgba(255,255,255,0.5)' : temAg ? C.accent : 'transparent' }} />
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Resumo do dia */}
            <View style={{
              marginHorizontal: 24, marginBottom: 14,
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 14, padding: 12, paddingHorizontal: 16,
              flexDirection: 'row', alignItems: 'center',
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              {[
                { value: String(kpis?.total ?? 0), label: 'Atendimentos', color: C.primary },
                { value: formatBRL(kpis?.comissaoDia ?? 0), label: 'Comissão prev.', color: C.green },
                { value: `${agendamentos.reduce((s, a) => s + (a.servico?.duracao_minutos ?? 0), 0)}min`, label: 'Tempo total', color: C.text },
              ].map((s, i, arr) => (
                <View key={s.label} style={{ flex: 1, alignItems: 'center', position: 'relative' }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: s.color, letterSpacing: -0.5 }}>{s.value}</Text>
                  <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 8, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 2 }}>{s.label}</Text>
                  {i < arr.length - 1 && <View style={{ position: 'absolute', right: 0, top: '10%', bottom: '10%', width: 1, backgroundColor: C.border }} />}
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ── Timeline ── */}
        <View style={{ paddingHorizontal: 24 }}>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text, marginBottom: 12 }}>
            Minha Agenda · {format(diaSelecionado, "EEEE',' d", { locale: ptBR }).replace(/^\w/, c => c.toUpperCase())}
          </Text>

          {HORAS.map((hora) => {
            const ags = agPorHora[hora] ?? [];
            return (
              <View key={hora} style={{ flexDirection: 'row', gap: 12, minHeight: 64 }}>
                <View style={{ minWidth: 44, alignItems: 'flex-end' }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text2, letterSpacing: -0.3, marginTop: -6 }}>
                    {String(hora).padStart(2, '0')}:00
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ height: 1, backgroundColor: '#D8D0C8', marginBottom: 6 }} />
                  {ags.length > 0
                    ? ags.map((ag, i) => <AgendamentoCard key={ag.id} ag={ag} percentual={percentual} index={i} />)
                    : <SlotVazio hora={hora} dia={diaSelecionado} />
                  }
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
