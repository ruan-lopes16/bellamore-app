import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  RefreshControl, StatusBar, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { Ban, Plus, X } from 'lucide-react-native';
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
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { useAuthStore } from '@/stores/authStore';
import { SecretText } from '@/components/Secret';
import {
  useAgendaProfissional, useKpisDiaProfissional, useDiasProfissional,
  useBloqueiosProfissionalDia, useCriarBloqueioProfissional,
} from '@/hooks/useProfissional';
import { CATEGORIA_CONFIG, useRemoverBloqueio, type AgendamentoCompleto } from '@/hooks/useAgenda';
import { BloqueioModal } from '@/components/BloqueioModal';
import { ConfirmarRemoverBloqueio } from '@/components/ConfirmarRemoverBloqueio';
import { motivoBloqueioLabel } from '@shared/bloqueios';
import { janelaDoDia } from '@shared/agenda';
import { hojeBRT, horaBRT } from '@shared/periodos';
import { FaixaSemana } from '@/components/agenda/FaixaSemana';
import { VisaoMes } from '@/components/agenda/VisaoMes';
import { AlternarVisao, type VisaoAgenda } from '@/components/agenda/AlternarVisao';
import {
  agruparPorHora, bloqueiosPorHora, dataDoDia, horasDaJanela, itensDaJanela,
} from '@/components/agenda/grade';
import { formatarMoeda } from '@shared/moeda';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

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
// ── Card de agendamento da profissional ──────────────────────

function AgendamentoCard({ ag, index }: {
  ag: AgendamentoCompleto; index: number;
}) {
  const cfg       = CATEGORIA_CONFIG[ag.categoria];
  const statusCfg = STATUS_CONFIG[ag.status] ?? STATUS_CONFIG.agendado;

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
              {horaBRT(ag.data_hora_inicio)} – {horaBRT(ag.data_hora_fim)}
            </Text>
          </View>
        </View>

        {/* Linha 2: serviço */}
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginBottom: 8 }} numberOfLines={1}>
          {ag.servico?.nome}
        </Text>

        {/* Linha 3: valor + status. A comissão real vem da tabela comissoes
            (gerada na conclusão) — nunca valor × percentual atual. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text }}>
              <SecretText>{formatarMoeda(ag.valor)}</SecretText>
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

/** Horário vazio. Quem chama não o desenha em hora com bloqueio dela ou geral (aprovado ou pendente). */
function SlotVazio({ hora, dia, profissionalId }: { hora: number; dia: string; profissionalId: string }) {
  return (
    <TouchableOpacity
      onPress={() => router.push(`/(profissional)/novo-agendamento?data=${dia}&hora=${String(hora).padStart(2, '0')}:00&profissional=${profissionalId}` as any)}
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

  // Dia exibido ("AAAA-MM-DD", Brasília) e visão (Dia / Mês, na mesma tela).
  const hoje = hojeBRT();
  const [dia, setDia] = useState(hoje);
  const [visao, setVisao] = useState<VisaoAgenda>('dia');
  const [mesVisto, setMesVisto] = useState(hoje.slice(0, 7));
  const dataDia = dataDoDia(dia);

  const { data: agendamentos = [], isLoading, refetch } = useAgendaProfissional(dataDia);
  const { data: kpis, isError: erroKpis, error: errKpis, refetch: refetchKpis } = useKpisDiaProfissional(dataDia);
  // Uma consulta do mês: o da visão Mês, ou o do dia exibido (pontinhos da faixa da semana).
  const {
    data: contagemMes, isLoading: carregandoMes, isError: erroMes, refetch: refetchMes,
  } = useDiasProfissional(visao === 'mes' ? mesVisto : dia.slice(0, 7));
  const { data: bloqueios = [], refetch: refetchBloqueios } = useBloqueiosProfissionalDia(dia);
  const criarBloqueio = useCriarBloqueioProfissional();
  const remover = useRemoverBloqueio();
  const [modalBloqueio, setModalBloqueio] = useState(false);
  const [bloqueioParaRemover, setBloqueioParaRemover] = useState<typeof bloqueios[number] | null>(null);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const onRefresh = useCallback(() => {
    refetch(); refetchMes(); refetchBloqueios();
  }, [refetch, refetchMes, refetchBloqueios]);

  if (!fontsLoaded) return null;

  // Janela do dia: 7–21, esticada para cobrir atendimentos e bloqueios (nada fica cortado).
  // O hook já traz só os bloqueios dela e os gerais.
  const horas = horasDaJanela(janelaDoDia(itensDaJanela(dia, agendamentos, bloqueios)));
  const agPorHora: Record<number, AgendamentoCompleto[]> = agruparPorHora(agendamentos);
  // Um bloqueio ocupa todas as horas que cruza no dia (em Brasília).
  const bloqPorHora = bloqueiosPorHora(bloqueios, dia, horas);

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
                { value: erroKpis ? '—' : String(kpis?.total ?? 0),            label: 'Hoje',         color: '#fff' },
                { value: erroKpis ? '—' : formatarMoeda(kpis?.comissaoDia ?? 0),   label: 'Comissão do dia', color: '#6EE7B7' },
                { value: erroKpis ? '—' : formatarMoeda(kpis?.totalPendente ?? 0), label: 'A receber',    color: '#FCD34D' },
              ].map((k) => (
                <View key={k.label} style={{
                  flex: 1,
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
                  borderRadius: 12, padding: 10,
                }}>
                  <SecretText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: k.color, letterSpacing: -0.5, lineHeight: 18, marginBottom: 3 }}>{k.value}</SecretText>
                  <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                    {k.label}
                  </Text>
                </View>
              ))}
            </View>
            {erroKpis && (
              <TouchableOpacity onPress={() => refetchKpis()} activeOpacity={0.8} style={{ marginTop: 10 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: '#FCA5A5' }}>
                  Não foi possível carregar os números do dia ({errKpis?.message ?? 'erro'}). Toque para tentar de novo.
                </Text>
              </TouchableOpacity>
            )}
          </LinearGradient>

          {/* Dia / Mês + semana ou mês */}
          <View style={{ backgroundColor: C.bg, paddingTop: 14 }}>
            <AlternarVisao
              visao={visao}
              onMudar={(v) => { if (v === 'mes') setMesVisto(dia.slice(0, 7)); setVisao(v); }}
            />

            {visao === 'mes' ? (
              <VisaoMes
                mes={mesVisto}
                diaSelecionado={dia}
                hoje={hoje}
                contagem={contagemMes}
                carregando={carregandoMes}
                erro={erroMes}
                onMudarMes={setMesVisto}
                onAbrirDia={(d) => { setDia(d); setVisao('dia'); }}
              />
            ) : (
              <FaixaSemana dia={dia} hoje={hoje} contagem={contagemMes} onSelecionar={setDia} />
            )}

            {/* Resumo do dia */}
            <View style={{
              marginHorizontal: 24, marginBottom: 14,
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 14, padding: 12, paddingHorizontal: 16,
              flexDirection: 'row', alignItems: 'center',
              shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
            }}>
              {[
                { value: erroKpis ? '—' : String(kpis?.total ?? 0), label: 'Atendimentos', color: C.primary },
                { value: erroKpis ? '—' : formatarMoeda(kpis?.comissaoDia ?? 0), label: 'Comissão do dia', color: C.green },
                { value: `${agendamentos.reduce((s, a) => s + (a.servico?.duracao_minutos ?? 0), 0)}min`, label: 'Tempo total', color: C.text },
              ].map((s, i, arr) => (
                <View key={s.label} style={{ flex: 1, alignItems: 'center', position: 'relative' }}>
                  <SecretText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: s.color, letterSpacing: -0.5 }}>{s.value}</SecretText>
                  <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 8, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 2 }}>{s.label}</Text>
                  {i < arr.length - 1 && <View style={{ position: 'absolute', right: 0, top: '10%', bottom: '10%', width: 1, backgroundColor: C.border }} />}
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ── Pedir bloqueio ── */}
        <View style={{ marginHorizontal: 24, marginTop: 4, marginBottom: 12 }}>
          <TouchableOpacity
            onPress={() => setModalBloqueio(true)}
            style={{
              height: 42, borderRadius: 12, borderWidth: 1, borderColor: C.border,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: 8, backgroundColor: C.surface,
            }}
          >
            <Ban size={14} color="#C9527F" strokeWidth={2} />
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: '#C9527F' }}>
              Bloquear horário
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Timeline (visão Dia) ── */}
        {visao === 'dia' && (
        <View style={{ paddingHorizontal: 24 }}>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 18, color: C.text, marginBottom: 12 }}>
            Minha Agenda · {format(dataDia, "EEEE',' d", { locale: ptBR }).replace(/^\w/, c => c.toUpperCase())}
          </Text>

          {horas.map((hora) => {
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
                    ? ags.map((ag, i) => <AgendamentoCard key={ag.id} ag={ag} index={i} />)
                    : (bloqPorHora[hora]?.length ? null : (
                        <SlotVazio hora={hora} dia={dia} profissionalId={user?.id ?? ''} />
                      ))
                  }
                  {(bloqPorHora[hora] ?? []).map((b) => {
                    // Nesta tela o papel é sempre profissional: só o próprio pedido pendente ganha o X.
                    const podeRemover = b.situacao === 'pendente' && b.criado_por === user?.id;
                    return (
                      <View
                        key={b.id}
                        style={{
                          borderRadius: 10, borderWidth: 1, borderColor: 'rgba(201,82,127,0.35)',
                          backgroundColor: b.situacao === 'pendente' ? 'rgba(201,82,127,0.06)' : '#FDF0F5',
                          padding: 10, marginBottom: 6,
                          opacity: b.situacao === 'pendente' ? 0.6 : 1,
                          flexDirection: 'row', alignItems: 'flex-start', gap: 8,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#C9527F' }}>
                            {b.titulo || motivoBloqueioLabel(b.motivo)}
                          </Text>
                          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text3 }}>
                            {horaBRT(b.data_inicio)}–{horaBRT(b.data_fim)}
                            {b.situacao === 'pendente' ? '  · aguardando aprovação' : ''}
                          </Text>
                        </View>
                        {podeRemover && (
                          <TouchableOpacity
                            onPress={() => setBloqueioParaRemover(b)}
                            disabled={remover.isPending}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={{ padding: 2, opacity: remover.isPending ? 0.4 : 1 }}>
                            <X size={14} color="#C9527F" strokeWidth={2.5} />
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
        )}
      </ScrollView>

      <BloqueioModal
        key={dia}
        visible={modalBloqueio}
        podeAprovarBloqueios={false}
        meuUserId={user?.id ?? ''}
        meuNome={user?.nome ?? 'Você'}
        membros={[]}
        dataInicial={dataDia}
        onClose={() => setModalBloqueio(false)}
        onSubmit={async (input) => {
          const r = await criarBloqueio.mutateAsync(input);
          return { situacao: r.situacao };
        }}
      />

      <ConfirmarRemoverBloqueio
        visible={!!bloqueioParaRemover}
        bloqueio={bloqueioParaRemover}
        profNome={user?.nome ?? null}
        removendo={remover.isPending}
        onCancelar={() => setBloqueioParaRemover(null)}
        onConfirmar={() => {
          if (!bloqueioParaRemover) return;
          remover.mutate(bloqueioParaRemover.id, {
            onSuccess: () => setBloqueioParaRemover(null),
            onError: (e: any) => {
              setBloqueioParaRemover(null);
              Alert.alert('Erro', e?.message ?? 'Não foi possível remover o bloqueio.');
            },
          });
        }}
      />
    </View>
  );
}
