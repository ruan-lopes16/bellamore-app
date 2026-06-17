import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StatusBar, Alert, ActivityIndicator, Modal, FlatList,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import {
  ChevronLeft, User, Scissors, Users, Calendar,
  Clock, DollarSign, FileText, Check, Search, X,
} from 'lucide-react-native';
import {
  useFonts,
  CormorantGaramond_600SemiBold,
} from '@expo-google-fonts/cormorant-garamond';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  addDays, format, isSameDay, startOfWeek, addWeeks, subWeeks,
  setHours, setMinutes, addMinutes,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { useAuthStore } from '@/stores/authStore';
import { useProfissionais } from '@/hooks/useAgenda';
import { useServicosEmpresa } from '@/hooks/useCliente';
import { useClientes } from '@/hooks/useClientes';
import { supabase } from '@/lib/supabase';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8', accentSoft: '#F3EFFE',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const AVATAR_COLORS: [string, string][] = [
  ['#7C3AED', '#A855F7'], ['#D4608A', '#F472B6'],
  ['#0D7E5F', '#34D399'], ['#B45309', '#F59E0B'],
  ['#1D4ED8', '#60A5FA'], ['#7C2D12', '#EA580C'],
];

// Slots de horário: 07:00 até 20:00 em intervalos de 30min
const HORARIOS = Array.from({ length: 27 }, (_, i) => {
  const totalMin = 7 * 60 + i * 30;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return { label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, h, m };
});

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
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
}

// ── Seção do formulário ───────────────────────────────────────

function Secao({ numero, titulo, completo, children }: {
  numero: number; titulo: string; completo?: boolean; children: React.ReactNode;
}) {
  return (
    <View style={{ marginHorizontal: 24, marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <View style={{
          width: 24, height: 24, borderRadius: 8,
          backgroundColor: completo ? C.green : C.primary,
          alignItems: 'center', justifyContent: 'center',
        }}>
          {completo
            ? <Check size={13} color="#fff" strokeWidth={2.5} />
            : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: '#fff' }}>{numero}</Text>
          }
        </View>
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text }}>
          {titulo}
        </Text>
      </View>
      {children}
    </View>
  );
}

// ── Tela principal ───────────────────────────────────────────

export default function NovoAgendamento() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva } = useAuthStore();
  const params = useLocalSearchParams<{ clienteId?: string; hora?: string }>();

  // Pré-preenche data/hora se vem da agenda
  const horaInicial = useMemo(() => {
    if (params.hora) return new Date(params.hora);
    return new Date();
  }, []);

  // Estado do formulário
  const [clienteSelecionado, setClienteSelecionado] = useState<{ id: string; nome: string; telefone?: string } | null>(null);
  const [servicoSelecionado, setServicoSelecionado] = useState<{ id: string; nome: string; preco: number; duracao_minutos: number } | null>(null);
  const [profSelecionado, setProfSelecionado]       = useState<{ id: string; nome: string } | null>(null);
  const [dataSelecionada, setDataSelecionada]       = useState<Date>(horaInicial);
  const [semanaRef, setSemanaRef]                   = useState<Date>(horaInicial);
  const [horaSelecionada, setHoraSelecionada]       = useState<{ h: number; m: number } | null>(
    params.hora ? { h: horaInicial.getHours(), m: horaInicial.getMinutes() } : null
  );
  const [valor, setValor]       = useState('');
  const [obs, setObs]           = useState('');
  const [salvando, setSalvando] = useState(false);

  // Modal de busca de cliente
  const [modalCliente, setModalCliente] = useState(false);
  const [buscaCliente, setBuscaCliente] = useState('');

  // Dados
  const { data: clientes = [] }     = useClientes('todas', buscaCliente);
  const { data: profissionais = [] } = useProfissionais();
  const { data: servicos = [] }     = useServicosEmpresa();

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  // Pré-seleciona cliente se veio de clienteId
  const clientePreSelecionado = params.clienteId;
  useMemo(() => {
    if (clientePreSelecionado && clientes.length > 0 && !clienteSelecionado) {
      const c = clientes.find((c) => c.id === clientePreSelecionado);
      if (c) setClienteSelecionado({ id: c.id, nome: c.nome, telefone: c.telefone });
    }
  }, [clientePreSelecionado, clientes]);

  if (!fontsLoaded) return null;

  const semana = Array.from({ length: 7 }, (_, i) =>
    addDays(startOfWeek(semanaRef, { weekStartsOn: 1 }), i)
  );

  function selecionarServico(s: typeof servicos[0]) {
    setServicoSelecionado({ id: s.id, nome: s.nome, preco: s.preco, duracao_minutos: s.duracao_minutos });
    setValor(s.preco.toFixed(2));
  }

  const podeSalvar = !!(
    clienteSelecionado && servicoSelecionado &&
    profSelecionado && horaSelecionada
  );

  async function confirmar() {
    if (!podeSalvar || !empresaAtiva) return;
    setSalvando(true);

    const inicio = setMinutes(setHours(dataSelecionada, horaSelecionada!.h), horaSelecionada!.m);
    const fim    = addMinutes(inicio, servicoSelecionado!.duracao_minutos);
    const valorFinal = parseFloat(valor.replace(',', '.')) || servicoSelecionado!.preco;

    const { error } = await supabase.from('agendamentos').insert({
      empresa_id:       empresaAtiva.id,
      profissional_id:  profSelecionado!.id,
      cliente_id:       clienteSelecionado!.id,
      servico_id:       servicoSelecionado!.id,
      data_hora_inicio: inicio.toISOString(),
      data_hora_fim:    fim.toISOString(),
      valor:            valorFinal,
      observacao:       obs || null,
      status:           'agendado',
    });

    setSalvando(false);

    if (error) {
      if (error.message.includes('Conflito')) {
        Alert.alert('Conflito de horário', 'Este profissional já tem um agendamento nesse período.');
      } else {
        Alert.alert('Erro', error.message);
      }
      return;
    }

    Alert.alert('Agendamento criado!', `${clienteSelecionado!.nome} · ${format(inicio, "dd/MM 'às' HH:mm")}`, [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />

      {/* ── Header ── */}
      <LinearGradient
        colors={['#2C1654', '#3D1F72']}
        style={{ paddingTop: insets.top + 12, paddingHorizontal: 24, paddingBottom: 20 }}
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
        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
          {empresaAtiva?.nome}
        </Text>
        <Text style={{ fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 26, color: '#fff' }}>
          Novo Agendamento
        </Text>
      </LinearGradient>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 20, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── 1. Cliente ── */}
        <Secao numero={1} titulo="Cliente" completo={!!clienteSelecionado}>
          <TouchableOpacity
            onPress={() => setModalCliente(true)}
            style={{
              backgroundColor: C.surface, borderWidth: 1,
              borderColor: clienteSelecionado ? C.green : C.border,
              borderRadius: 14, padding: 14,
              flexDirection: 'row', alignItems: 'center', gap: 12,
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}
          >
            {clienteSelecionado ? (
              <>
                <LinearGradient
                  colors={avatarColors(clienteSelecionado.nome)}
                  style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: '#fff' }}>
                    {iniciaisNome(clienteSelecionado.nome)}
                  </Text>
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>
                    {clienteSelecionado.nome}
                  </Text>
                  {clienteSelecionado.telefone && (
                    <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3 }}>
                      {clienteSelecionado.telefone}
                    </Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => setClienteSelecionado(null)}>
                  <X size={16} color={C.text4} strokeWidth={2} />
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                  <User size={16} color={C.primary} strokeWidth={2} />
                </View>
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 14, color: C.text3, flex: 1 }}>
                  Selecionar cliente…
                </Text>
                <Search size={14} color={C.text4} strokeWidth={2} />
              </>
            )}
          </TouchableOpacity>
        </Secao>

        {/* ── 2. Serviço ── */}
        <Secao numero={2} titulo="Serviço" completo={!!servicoSelecionado}>
          <View style={{ gap: 6 }}>
            {servicos.map((s) => {
              const ativo = servicoSelecionado?.id === s.id;
              return (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => selecionarServico(s)}
                  style={{
                    backgroundColor: ativo ? C.primarySoft : C.surface,
                    borderWidth: 1,
                    borderColor: ativo ? C.primary : C.border,
                    borderRadius: 14, padding: 12,
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                    shadowColor: C.primary, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
                  }}
                >
                  <View style={{
                    width: 8, height: 8, borderRadius: 4,
                    backgroundColor: s.categoriaCor, marginTop: 1,
                  }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: ativo ? C.primary : C.text }}>
                      {s.nome}
                    </Text>
                    <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 1 }}>
                      {s.duracao_minutos} min
                    </Text>
                  </View>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: ativo ? C.primary : C.text }}>
                    {formatBRL(s.preco)}
                  </Text>
                  {ativo && <Check size={14} color={C.primary} strokeWidth={2.5} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </Secao>

        {/* ── 3. Profissional ── */}
        <Secao numero={3} titulo="Profissional" completo={!!profSelecionado}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {profissionais.map((p) => {
              const ativo = profSelecionado?.id === p.id;
              const [c1, c2] = avatarColors(p.nome);
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setProfSelecionado({ id: p.id, nome: p.nome })}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 8,
                    backgroundColor: ativo ? C.primarySoft : C.surface,
                    borderWidth: 1, borderColor: ativo ? C.primary : C.border,
                    borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12,
                    shadowColor: C.primary, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
                  }}
                >
                  <LinearGradient
                    colors={[c1, c2]}
                    style={{ width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, color: '#fff' }}>
                      {iniciaisNome(p.nome)}
                    </Text>
                  </LinearGradient>
                  <Text style={{
                    fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12,
                    color: ativo ? C.primary : C.text2,
                  }}>
                    {p.nome.split(' ')[0]}
                  </Text>
                  {ativo && <Check size={12} color={C.primary} strokeWidth={2.5} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </Secao>

        {/* ── 4. Data ── */}
        <Secao numero={4} titulo="Data e Horário" completo={!!horaSelecionada}>
          {/* Nav semana */}
          <View style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 18, padding: 14, marginBottom: 10,
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <TouchableOpacity onPress={() => setSemanaRef(d => subWeeks(d, 1))} style={{ padding: 4 }}>
                <ChevronLeft size={16} color={C.text2} strokeWidth={2.5} />
              </TouchableOpacity>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
                {format(semanaRef, 'MMMM yyyy', { locale: ptBR }).replace(/^\w/, c => c.toUpperCase())}
              </Text>
              <TouchableOpacity onPress={() => setSemanaRef(d => addWeeks(d, 1))} style={{ padding: 4 }}>
                <ChevronLeft size={16} color={C.text2} strokeWidth={2.5} style={{ transform: [{ rotate: '180deg' }] }} />
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', gap: 4 }}>
              {semana.map((dia) => {
                const ativo  = isSameDay(dia, dataSelecionada);
                const isPast = dia < new Date(new Date().setHours(0, 0, 0, 0));
                const nomeD  = format(dia, 'EEE', { locale: ptBR }).slice(0, 3);
                return (
                  <TouchableOpacity
                    key={dia.toISOString()}
                    onPress={() => !isPast && setDataSelecionada(dia)}
                    disabled={isPast}
                    style={{
                      flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 12, gap: 4,
                      backgroundColor: ativo ? C.primary : 'transparent',
                      opacity: isPast ? 0.3 : 1,
                    }}
                  >
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: ativo ? 'rgba(255,255,255,0.6)' : C.text3 }}>
                      {nomeD}
                    </Text>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: ativo ? '#fff' : C.text }}>
                      {format(dia, 'd')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Horários */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
            <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 2, paddingVertical: 2 }}>
              {HORARIOS.map((slot) => {
                const ativo = horaSelecionada?.h === slot.h && horaSelecionada?.m === slot.m;
                return (
                  <TouchableOpacity
                    key={slot.label}
                    onPress={() => setHoraSelecionada({ h: slot.h, m: slot.m })}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
                      backgroundColor: ativo ? C.primary : C.surface,
                      borderWidth: 1, borderColor: ativo ? C.primary : C.border,
                      shadowColor: C.primary, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
                    }}
                  >
                    <Text style={{
                      fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13,
                      color: ativo ? '#fff' : C.text2,
                    }}>
                      {slot.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          {/* Duração estimada */}
          {servicoSelecionado && horaSelecionada && (
            <MotiView
              from={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ type: 'timing', duration: 250 }}
              style={{
                marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6,
                backgroundColor: C.accentSoft, borderRadius: 10, padding: 10,
              }}
            >
              <Clock size={12} color={C.accent} strokeWidth={2} />
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.accent }}>
                {format(setMinutes(setHours(dataSelecionada, horaSelecionada.h), horaSelecionada.m), "HH:mm")}
                {' → '}
                {format(addMinutes(setMinutes(setHours(dataSelecionada, horaSelecionada.h), horaSelecionada.m), servicoSelecionado.duracao_minutos), "HH:mm")}
                {' · '}{servicoSelecionado.duracao_minutos} min
              </Text>
            </MotiView>
          )}
        </Secao>

        {/* ── 5. Valor ── */}
        <Secao numero={5} titulo="Valor" completo={!!valor}>
          <View style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
            paddingHorizontal: 14,
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
          }}>
            <DollarSign size={16} color={C.text4} strokeWidth={1.8} />
            <TextInput
              value={valor}
              onChangeText={setValor}
              placeholder="0,00"
              placeholderTextColor={C.text4}
              keyboardType="numeric"
              style={{
                flex: 1, paddingVertical: 14,
                fontFamily: 'PlusJakartaSans_600SemiBold',
                fontSize: 16, color: C.text,
              }}
            />
            {servicoSelecionado && (
              <TouchableOpacity onPress={() => setValor(servicoSelecionado.preco.toFixed(2))}>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.accent }}>
                  Padrão
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </Secao>

        {/* ── 6. Observação ── */}
        <Secao numero={6} titulo="Observação (opcional)">
          <View style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 14, paddingHorizontal: 14, paddingTop: 12,
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
          }}>
            <TextInput
              value={obs}
              onChangeText={setObs}
              placeholder="Ex: cliente prefere atendimento silencioso…"
              placeholderTextColor={C.text4}
              multiline
              numberOfLines={3}
              style={{
                fontFamily: 'PlusJakartaSans_400Regular',
                fontSize: 13, color: C.text, minHeight: 72,
                textAlignVertical: 'top', paddingBottom: 12,
              }}
            />
          </View>
        </Secao>
      </ScrollView>

      {/* ── Botão confirmar (fixo) ── */}
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border,
        paddingHorizontal: 24, paddingTop: 12, paddingBottom: insets.bottom + 12,
      }}>
        {/* Resumo */}
        {podeSalvar && (
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 250 }}
            style={{ marginBottom: 10 }}
          >
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, textAlign: 'center' }}>
              {clienteSelecionado?.nome?.split(' ')[0]} · {servicoSelecionado?.nome} · {format(dataSelecionada, "d MMM", { locale: ptBR })} {horaSelecionada ? `${String(horaSelecionada.h).padStart(2, '0')}:${String(horaSelecionada.m).padStart(2, '0')}` : ''}
            </Text>
          </MotiView>
        )}

        <TouchableOpacity
          onPress={confirmar}
          disabled={!podeSalvar || salvando}
          activeOpacity={0.85}
        >
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
                  Confirmar Agendamento
                </Text>
            }
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* ── Modal busca de cliente ── */}
      <Modal
        visible={modalCliente}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModalCliente(false)}
      >
        <View style={{ flex: 1, backgroundColor: C.bg }}>
          {/* Header modal */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 12,
            padding: 20, paddingTop: 24,
            borderBottomWidth: 1, borderBottomColor: C.border,
          }}>
            <View style={{
              flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 12, flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 12, gap: 8,
            }}>
              <Search size={15} color={C.text4} strokeWidth={1.8} />
              <TextInput
                value={buscaCliente}
                onChangeText={setBuscaCliente}
                placeholder="Buscar cliente…"
                placeholderTextColor={C.text4}
                autoFocus
                style={{
                  flex: 1, paddingVertical: 11,
                  fontFamily: 'PlusJakartaSans_400Regular',
                  fontSize: 14, color: C.text,
                }}
              />
            </View>
            <TouchableOpacity onPress={() => { setModalCliente(false); setBuscaCliente(''); }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.accent }}>
                Cancelar
              </Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={clientes}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16, gap: 6 }}
            renderItem={({ item }) => {
              const [c1, c2] = avatarColors(item.nome);
              return (
                <TouchableOpacity
                  onPress={() => {
                    setClienteSelecionado({ id: item.id, nome: item.nome, telefone: item.telefone });
                    setModalCliente(false);
                    setBuscaCliente('');
                  }}
                  style={{
                    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                    borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
                    shadowColor: C.primary, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
                  }}
                >
                  <LinearGradient
                    colors={[c1, c2]}
                    style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: '#fff' }}>
                      {iniciaisNome(item.nome)}
                    </Text>
                  </LinearGradient>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>
                      {item.nome}
                    </Text>
                    {item.telefone && (
                      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginTop: 1 }}>
                        {item.telefone}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={() => (
              <View style={{ padding: 32, alignItems: 'center' }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.text3 }}>
                  Nenhuma cliente encontrada
                </Text>
              </View>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}
