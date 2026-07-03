import { useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  RefreshControl, StatusBar, Pressable,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import {
  ChevronLeft, ChevronRight, Plus, Search,
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
import {
  addDays, subDays, addMonths, subMonths,
  format, isSameDay, startOfWeek,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

import {
  useAgendamentoDia, useProfissionais, useDiasComAgendamento,
  useResumoDia, CATEGORIA_CONFIG,
  type AgendamentoCompleto, type ProfissionalAgenda,
} from '@/hooks/useAgenda';
import { useAuthStore } from '@/stores/authStore';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8', accentSoft: 'rgba(155,111,232,0.06)',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const HORAS = Array.from({ length: 13 }, (_, i) => i + 7); // 07:00 – 19:00

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
  ['#1D4ED8', '#60A5FA'], ['#0891B2', '#22D3EE'],
];

// ── Helpers ──────────────────────────────────────────────────

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
function horaStr(iso: string) {
  return format(new Date(iso), 'HH:mm');
}

// ── Card de agendamento ──────────────────────────────────────

function AgendamentoCard({ ag, index }: { ag: AgendamentoCompleto; index: number }) {
  const cfg        = CATEGORIA_CONFIG[ag.categoria];
  const statusCfg  = STATUS_CONFIG[ag.status] ?? STATUS_CONFIG.agendado;
  const [c1, c2]   = avatarColors(ag.profissional?.nome ?? '');

  return (
    <MotiView
      from={{ opacity: 0, translateX: -6 }}
      animate={{ opacity: 1, translateX: 0 }}
      transition={{ type: 'timing', duration: 280, delay: index * 50 }}
    >
      <TouchableOpacity
        onPress={() => router.push(`/(empresa)/agendamento/${ag.id}` as any)}
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
          <View style={{ backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 8 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3 }}>
              {horaStr(ag.data_hora_inicio)} – {horaStr(ag.data_hora_fim)}
            </Text>
          </View>
        </View>

        {/* Linha 2: serviço */}
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginBottom: 8 }} numberOfLines={1}>
          {ag.servico?.nome}
        </Text>

        {/* Linha 3: profissional + valor + status */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <LinearGradient
              colors={[c1, c2]}
              style={{ width: 20, height: 20, borderRadius: 6, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 8, color: '#fff' }}>
                {iniciaisNome(ag.profissional?.nome ?? '')}
              </Text>
            </LinearGradient>
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3 }}>
              {ag.profissional?.nome?.split(' ')[0]}
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
  const horaISO = format(new Date(dia.setHours(hora, 0, 0, 0)), "yyyy-MM-dd'T'HH:mm");

  return (
    <TouchableOpacity
      onPress={() => router.push(`/(empresa)/novo-agendamento?hora=${horaISO}` as any)}
      style={{
        height: 48, borderRadius: 10,
        borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#C4BAD4',
        marginBottom: 6, flexDirection: 'row',
        alignItems: 'center', justifyContent: 'center', gap: 6,
        backgroundColor: C.accentSoft,
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

export default function Agenda() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva } = useAuthStore();

  const [diaSelecionado, setDiaSelecionado] = useState(new Date());
  const [mesRef, setMesRef] = useState(new Date());
  const [profFiltro, setProfFiltro] = useState<string | undefined>(undefined);

  const semana = Array.from({ length: 7 }, (_, i) =>
    addDays(startOfWeek(diaSelecionado, { weekStartsOn: 1 }), i)
  );

  const { data: agendamentos = [], isLoading, refetch } = useAgendamentoDia(diaSelecionado, profFiltro);
  const { data: profissionais = [] } = useProfissionais();
  const { data: diasComAg } = useDiasComAgendamento(mesRef);
  const resumo = useResumoDia(agendamentos);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const onRefresh = useCallback(() => refetch(), [refetch]);

  if (!fontsLoaded) return null;

  // Agrupa agendamentos por hora
  const agPorHora: Record<number, AgendamentoCompleto[]> = {};
  agendamentos.forEach((ag) => {
    const hora = new Date(ag.data_hora_inicio).getHours();
    if (!agPorHora[hora]) agPorHora[hora] = [];
    agPorHora[hora].push(ag);
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={onRefresh} tintColor={C.accent} />
        }
        stickyHeaderIndices={[0]}
      >
        {/* ── Header sticky ── */}
        <View style={{ backgroundColor: C.bg }}>
          {/* Título */}
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 350 }}
            style={{
              paddingTop: insets.top + 12,
              paddingHorizontal: 24, paddingBottom: 12,
              flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
            }}
          >
            <View>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
                {empresaAtiva?.nome}
              </Text>
              <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: C.text }}>
                Agenda
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, paddingTop: 4 }}>
              <TouchableOpacity style={{
                width: 38, height: 38, borderRadius: 12,
                backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                alignItems: 'center', justifyContent: 'center',
                shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
              }}>
                <Search size={16} color={C.text2} strokeWidth={1.8} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push('/(empresa)/novo-agendamento' as any)}
                style={{
                  width: 38, height: 38, borderRadius: 12,
                  backgroundColor: C.primary,
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: C.primary, shadowOpacity: 0.3,
                  shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4,
                }}
              >
                <Plus size={18} color="#fff" strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          </MotiView>

          {/* Nav de mês */}
          <View style={{
            marginHorizontal: 24, marginBottom: 12,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <TouchableOpacity
              onPress={() => setMesRef((m) => subMonths(m, 1))}
              style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}
            >
              <ChevronLeft size={13} color={C.text2} strokeWidth={2.5} />
            </TouchableOpacity>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
              {format(mesRef, 'MMMM yyyy', { locale: ptBR }).replace(/^\w/, c => c.toUpperCase())}
            </Text>
            <TouchableOpacity
              onPress={() => setMesRef((m) => addMonths(m, 1))}
              style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}
            >
              <ChevronRight size={13} color={C.text2} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>

          {/* Strip semanal */}
          <View style={{ marginHorizontal: 24, marginBottom: 14, flexDirection: 'row', gap: 4 }}>
            {semana.map((dia) => {
              const ativo   = isSameDay(dia, diaSelecionado);
              const temAg   = diasComAg?.has(format(dia, 'yyyy-MM-dd')) ?? false;
              const nomeD   = format(dia, 'EEE', { locale: ptBR }).slice(0, 3);

              return (
                <TouchableOpacity
                  key={dia.toISOString()}
                  onPress={() => { setDiaSelecionado(dia); setMesRef(dia); }}
                  style={{
                    flex: 1, alignItems: 'center', paddingVertical: 8,
                    borderRadius: 14, gap: 4,
                    backgroundColor: ativo ? C.primary : temAg ? C.surface : 'transparent',
                    borderWidth: ativo || temAg ? 1 : 0,
                    borderColor: ativo ? C.primary : C.border,
                    shadowColor: C.primary,
                    shadowOpacity: temAg && !ativo ? 0.04 : 0,
                    shadowRadius: 4, elevation: temAg && !ativo ? 1 : 0,
                  }}
                >
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_600SemiBold',
                    fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5,
                    color: ativo ? 'rgba(255,255,255,0.6)' : C.text3,
                  }}>
                    {nomeD}
                  </Text>
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_700Bold',
                    fontSize: 16, lineHeight: 18,
                    color: ativo ? '#fff' : C.text,
                  }}>
                    {format(dia, 'd')}
                  </Text>
                  <View style={{
                    width: 4, height: 4, borderRadius: 2,
                    backgroundColor: ativo ? 'rgba(255,255,255,0.5)' : temAg ? C.accent : 'transparent',
                  }} />
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
              { value: String(resumo.total),           label: 'Agendamentos', color: C.text },
              { value: formatBRL(resumo.receita),       label: 'Receita prev.',  color: C.green },
              { value: String(resumo.profissionais),    label: 'Profissionais',  color: C.text },
              { value: String(resumo.pendentes),        label: 'Pendentes',      color: resumo.pendentes > 0 ? C.amber : C.text },
            ].map((s, i, arr) => (
              <View key={s.label} style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: s.color, letterSpacing: -0.5 }}>
                  {s.value}
                </Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 8, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 2 }}>
                  {s.label}
                </Text>
                {i < arr.length - 1 && (
                  <View style={{ position: 'absolute', right: 0, top: '10%', bottom: '10%', width: 1, backgroundColor: C.border }} />
                )}
              </View>
            ))}
          </View>

          {/* Legenda categorias */}
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 24, gap: 5, paddingBottom: 2 }}
            style={{ marginBottom: 14 }}
          >
            {Object.entries(CATEGORIA_CONFIG).map(([key, cfg]) => (
              <View key={key} style={{
                flexDirection: 'row', alignItems: 'center', gap: 4,
                backgroundColor: cfg.bg, borderWidth: 1,
                borderColor: `${cfg.border}40`,
                borderRadius: 20, paddingVertical: 4, paddingHorizontal: 9,
              }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: cfg.accent }} />
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, color: cfg.accent, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {cfg.label}
                </Text>
              </View>
            ))}
          </ScrollView>

          {/* Filtro profissional */}
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 24, gap: 6, paddingBottom: 14 }}
          >
            <TouchableOpacity
              onPress={() => setProfFiltro(undefined)}
              style={{
                paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20,
                backgroundColor: !profFiltro ? C.primary : C.surface,
                borderWidth: 1, borderColor: !profFiltro ? C.primary : C.border,
              }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: !profFiltro ? '#fff' : C.text3 }}>
                Todas
              </Text>
            </TouchableOpacity>

            {profissionais.map((prof) => {
              const ativo = profFiltro === prof.id;
              const [c1, c2] = avatarColors(prof.nome);
              return (
                <TouchableOpacity
                  key={prof.id}
                  onPress={() => setProfFiltro(ativo ? undefined : prof.id)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                    backgroundColor: ativo ? C.primarySoft : C.surface,
                    borderWidth: 1, borderColor: ativo ? C.primary : C.border,
                    shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
                  }}
                >
                  <LinearGradient
                    colors={[c1, c2]}
                    style={{ width: 20, height: 20, borderRadius: 6, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 8, color: '#fff' }}>
                      {iniciaisNome(prof.nome)}
                    </Text>
                  </LinearGradient>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: ativo ? C.primary : C.text2 }}>
                    {prof.nome.split(' ')[0]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* ── Timeline ── */}
        <View style={{ paddingHorizontal: 24 }}>
          {HORAS.map((hora) => {
            const ags = agPorHora[hora] ?? [];

            return (
              <View key={hora} style={{ flexDirection: 'row', gap: 12, minHeight: 64 }}>
                {/* Hora */}
                <View style={{ minWidth: 44, alignItems: 'flex-end', paddingTop: 0 }}>
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_700Bold',
                    fontSize: 12, color: C.text2,
                    letterSpacing: -0.3, marginTop: -6,
                  }}>
                    {String(hora).padStart(2, '0')}:00
                  </Text>
                </View>

                {/* Conteúdo */}
                <View style={{ flex: 1 }}>
                  <View style={{ height: 1, backgroundColor: '#D8D0C8', marginBottom: 6 }} />
                  {ags.length > 0 ? (
                    ags.map((ag, i) => <AgendamentoCard key={ag.id} ag={ag} index={i} />)
                  ) : (
                    <SlotVazio hora={hora} dia={new Date(diaSelecionado)} />
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
