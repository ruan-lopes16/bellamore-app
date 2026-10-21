import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  RefreshControl, StatusBar, Pressable, Alert, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import {
  Plus, Search, Ban, X,
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
  useAgendamentoDia, useProfissionais, useDiasComAgendamento,
  CATEGORIA_CONFIG,
  useBloqueiosDia, useBloqueiosPendentes, useCriarBloqueio,
  useAprovarBloqueio, useRecusarBloqueio, useRemoverBloqueio,
  type AgendamentoCompleto, type ProfissionalAgenda, type BloqueioAgenda,
} from '@/hooks/useAgenda';
import { useAuthStore } from '@/stores/authStore';
import { usePreferenciaAgenda } from '@/hooks/usePreferenciaAgenda';
import { usePermissoes } from '@/lib/permissions';
import { agendarLembretesLocais } from '@/lib/notifications';
import { motivoBloqueioLabel } from '@shared/bloqueios';
import { janelaDoDia, resumoDoDia } from '@shared/agenda';
import { hojeBRT, horaBRT } from '@shared/periodos';
import { FaixaSemana } from '@/components/agenda/FaixaSemana';
import { VisaoMes } from '@/components/agenda/VisaoMes';
import { AlternarVisao, type VisaoAgenda } from '@/components/agenda/AlternarVisao';
import { TimelineColunas } from '@/components/agenda/TimelineColunas';
import {
  TODAS, filtroInicialAgenda, type FiltroProfissional, agruparPorHora, bloqueiosDaProfissional, bloqueiosPorHora, colunasComExtras,
  dataDoDia, horasDaJanela, itensDaJanela, juntarContagens, mesesDaSemana,
} from '@shared/agenda-grade';
import { BloqueioModal } from '@/components/BloqueioModal';
import { PendentesBloqueioSheet } from '@/components/PendentesBloqueioSheet';
import { BotaoExportar } from '@/components/BotaoExportar';
import { definicaoAgenda } from '@shared/exportacao/agenda';
import { ConfirmarRemoverBloqueio } from '@/components/ConfirmarRemoverBloqueio';
import { formatarMoeda } from '@shared/moeda';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8', accentSoft: 'rgba(155,111,232,0.06)',
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
  ['#1D4ED8', '#60A5FA'], ['#0891B2', '#22D3EE'],
];

// ── Helpers ──────────────────────────────────────────────────

function avatarColors(nome: string): [string, string] {
  return AVATAR_COLORS[(nome?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length];
}
function iniciaisNome(nome: string) {
  return (nome ?? '').split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}
/** "HH:mm" em Brasília (a grade agrupa pela hora de Brasília, não do aparelho). */
function horaStr(iso: string) {
  return horaBRT(iso);
}
/** Nomes de todos os serviços do agendamento, unidos por " + " (fallback: serviço único). */
function nomesServicos(ag: AgendamentoCompleto): string {
  const multi = ag.agendamento_servicos ?? [];
  if (multi.length > 0) {
    return [...multi].sort((a, b) => a.ordem - b.ordem).map(s => s.servico?.nome).filter(Boolean).join(' + ') || '—';
  }
  return ag.servico?.nome ?? '—';
}

// ── Card de agendamento ──────────────────────────────────────

function AgendamentoCard({ ag, index }: { ag: AgendamentoCompleto; index: number }) {
  const cfgBase    = CATEGORIA_CONFIG[ag.categoria];
  const cfg        = {
    bg:     ag.categoriaResolvida?.bg  ?? cfgBase.bg,
    border: ag.categoriaResolvida?.cor ?? cfgBase.border,
  };
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

        {/* Linha 2: serviço(s) */}
        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, marginBottom: 8 }} numberOfLines={1}>
          {nomesServicos(ag)}
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
              {formatarMoeda(ag.valor)}
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

/**
 * Horário vazio da grade: abre o novo agendamento já no dia, na hora e na profissional da coluna.
 * Quem chama só o desenha quando não há bloqueio dessa profissional nem bloqueio geral na hora.
 */
function SlotVazio({ hora, dia, profissionalId }: { hora: number; dia: string; profissionalId: string }) {
  return (
    <TouchableOpacity
      onPress={() => router.push(`/(empresa)/novo-agendamento?data=${dia}&hora=${String(hora).padStart(2, '0')}:00&profissional=${profissionalId}` as any)}
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
  const { empresaAtiva, user } = useAuthStore();
  const { pode, permissoesCarregadas } = usePermissoes();
  const preferencia = usePreferenciaAgenda();
  const podeAprovarBloqueios = pode('agenda.aprovar_bloqueios');
  // Sem `agenda.ver_equipe` só a própria agenda (igual ao web): sem chips de equipe.
  const podeVerEquipe = pode('agenda.ver_equipe');

  // Dia exibido ("AAAA-MM-DD", Brasília) e visão (Dia / Mês, na mesma tela).
  const hoje = hojeBRT();
  const [dia, setDia] = useState(hoje);
  const [visao, setVisao] = useState<VisaoAgenda>('dia');
  const [mesVisto, setMesVisto] = useState(hoje.slice(0, 7));
  // Escolha manual na tela (null = ainda não mexeu). Não altera a preferência salva.
  const [filtroManual, setFiltroManual] = useState<string | null>(null);
  // Só aplica o valor inicial depois de carregar permissões e preferência: antes disso o filtro
  // fica '' (nenhuma consulta dispara) e a tela mostra "Carregando", sem trocar de agenda depois.
  // Erro ao ler a preferência = própria agenda. "Todas" exige `agenda.ver_equipe` mesmo com a
  // preferência gravada (a gestora pode mudar a de outras pessoas pelo banco).
  const aguardandoFiltro = !permissoesCarregadas || preferencia.isPending;
  const filtroProfissional = filtroManual
    ?? filtroInicialAgenda(preferencia.data ?? 'propria', podeVerEquipe, user?.id ?? '');
  const setFiltroProfissional = setFiltroManual;
  // Sem `agenda.ver_equipe` só a própria agenda (igual ao web): nunca "Todas" nem outra pessoa.
  const filtro: FiltroProfissional = aguardandoFiltro ? '' : podeVerEquipe ? (filtroProfissional || user?.id || '') : (user?.id ?? '');
  const [modalBloqueio, setModalBloqueio] = useState(false);
  const [sheetPendentes, setSheetPendentes] = useState(false);
  const remover = useRemoverBloqueio();
  const [bloqueioParaRemover, setBloqueioParaRemover] = useState<BloqueioAgenda | null>(null);

  const {
    data: agendamentos = [], isLoading, isError: erroAgendamentos, refetch,
  } = useAgendamentoDia(dia, filtro);
  const {
    data: profissionais = [], isError: erroProfissionais, refetch: refetchProfissionais,
  } = useProfissionais();
  // Contagem por mês: na visão Mês, o mês visto; na faixa da semana, os meses que a semana toca
  // (dois na virada do mês, senão os pontinhos dos dias do mês vizinho sumiriam).
  const mesesSemana = mesesDaSemana(dia);
  const ultimoMesSemana = mesesSemana[mesesSemana.length - 1];
  const {
    data: contagemMes, isLoading: carregandoMes, isError: erroMes, refetch: refetchMes,
  } = useDiasComAgendamento(visao === 'mes' ? mesVisto : mesesSemana[0], filtro);
  const { data: contagemMes2, refetch: refetchMes2 } = useDiasComAgendamento(
    visao === 'mes' ? mesVisto : ultimoMesSemana, filtro,
  );
  const contagemSemana = juntarContagens(mesesSemana.length > 1 ? [contagemMes, contagemMes2] : [contagemMes]);
  const {
    data: bloqueios = [], isError: erroBloqueios, refetch: refetchBloqueios,
  } = useBloqueiosDia(dia, filtro);
  // Carga do dia com erro: aviso na tela, sem horário vazio nem zeros (em "Todas" as colunas
  // dependem também da lista de profissionais).
  const erroDia = erroAgendamentos || erroBloqueios || (filtro === TODAS && erroProfissionais);
  const { data: pendentes = [], isError: pendentesErro } = useBloqueiosPendentes();
  const criarBloqueio = useCriarBloqueio();
  const aprovar = useAprovarBloqueio();
  const recusar = useRecusarBloqueio();
  // Mesmos 4 números do web (sem cancelados; receita prevista sem faltas e sessões de pacote).
  const resumo = resumoDoDia(agendamentos);

  // Categorias personalizadas presentes no dia (para a legenda, além das 8 fixas)
  const customsNoDia = Array.from(
    new Map(
      agendamentos
        .filter((a) => a.categoriaResolvida?.iconeCustom)
        .map((a) => [a.categoriaResolvida!.label, a.categoriaResolvida!]),
    ).values(),
  );

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const onRefresh = useCallback(() => {
    refetch(); refetchMes(); refetchMes2(); refetchBloqueios(); refetchProfissionais();
  }, [refetch, refetchMes, refetchMes2, refetchBloqueios, refetchProfissionais]);

  // Reprograma os lembretes locais (30 min antes) sempre que a lista muda.
  useEffect(() => {
    const futuros = agendamentos
      .filter((a) => new Date(a.data_hora_inicio) > new Date() && (a.status === 'agendado' || a.status === 'confirmado'))
      .map((a) => ({
        id: a.id,
        dataHoraInicio: a.data_hora_inicio,
        clienteNome: a.cliente?.nome ?? null,
        servicoNome: nomesServicos(a),
      }));
    agendarLembretesLocais(futuros, user?.notif_lembrete_atendimento ?? true).catch(() => {});
  }, [agendamentos, user?.notif_lembrete_atendimento]);

  if (!fontsLoaded) return null;
  if (aguardandoFiltro) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  // Bloqueios que valem para a profissional escolhida (os dela e os gerais; em "Todas", todos).
  const bloqueiosVisiveis = bloqueiosDaProfissional(bloqueios, filtro);
  // Janela do dia: 7–21, esticada para cobrir atendimentos e bloqueios (nada fica cortado).
  const horas = horasDaJanela(janelaDoDia(itensDaJanela(dia, agendamentos, bloqueiosVisiveis)));
  const agPorHora = agruparPorHora(agendamentos);
  // Um bloqueio ocupa todas as horas que cruza no dia (em Brasília); o horário vazio só some
  // com bloqueio da profissional escolhida ou geral.
  const bloqPorHora = bloqueiosPorHora(bloqueiosVisiveis, dia, horas);

  // "Todas": uma coluna por profissional ativa. Quem tem atendimento no dia e não está na lista
  // (ex.: desativada) ganha coluna também, para nenhum atendimento sumir da grade.
  const colunas = filtro === TODAS
    ? colunasComExtras(
        agendamentos,
        profissionais.map((p) => ({ id: p.id, nome: p.nome })),
        TODAS,
        (a) => (a.profissional_id ? { id: a.profissional_id, nome: a.profissional?.nome } : null),
      )
    : [];
  // Cada coluna considera os bloqueios daquela profissional mais os gerais.
  const bloqPorColuna = new Map(
    colunas.map((c) => [c.profissional.id, bloqueiosPorHora(bloqueiosDaProfissional(bloqueios, c.profissional.id), dia, horas)]),
  );

  const renderBloqueio = (b: BloqueioAgenda) => {
    const podeRemover =
      podeAprovarBloqueios
      || (b.situacao === 'pendente' && b.criado_por === user?.id);
    return (
      <View key={b.id} style={{
        borderRadius: 10, borderWidth: 1, borderColor: 'rgba(201,82,127,0.35)',
        backgroundColor: b.situacao === 'pendente' ? 'rgba(201,82,127,0.06)' : '#FDF0F5',
        padding: 10, marginBottom: 6, flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#C9527F' }}>
            {b.titulo || motivoBloqueioLabel(b.motivo)}
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: '#8878A6' }}>
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
  };

  /** Conteúdo de uma hora para uma profissional: atendimentos, bloqueios ou o horário vazio. */
  const renderCelula = (
    profissionalId: string, ags: AgendamentoCompleto[], bloqs: BloqueioAgenda[], hora: number,
  ) => (
    <>
      {ags.length > 0
        ? ags.map((ag, i) => <AgendamentoCard key={ag.id} ag={ag} index={i} />)
        : bloqs.length > 0 ? null : <SlotVazio hora={hora} dia={dia} profissionalId={profissionalId} />}
      {bloqs.map(renderBloqueio)}
    </>
  );

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
              <BotaoExportar
                definicao={definicaoAgenda(dia)}
                getLinhas={() => agendamentos.map((a) => ({ inicio: a.data_hora_inicio, cliente: a.cliente?.nome ?? null, servico: a.servico?.nome ?? null, profissional: a.profissional?.nome ?? null, valor: a.valor, status: STATUS_CONFIG[a.status]?.label ?? a.status }))}
                cor={C.text2}
              />
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

          {/* Ações de bloqueio */}
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 24, marginBottom: 12, alignItems: 'center' }}>
            <TouchableOpacity onPress={() => setModalBloqueio(true)}
              style={{ height: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#E8E2DC', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ban size={14} color="#C9527F" strokeWidth={2} />
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#C9527F' }}>Bloquear</Text>
            </TouchableOpacity>
            {pendentes.length > 0 && (
              <TouchableOpacity onPress={() => setSheetPendentes(true)}
                style={{ height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: '#FEF3E2', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#B45309' }}>Pendentes ({pendentes.length})</Text>
              </TouchableOpacity>
            )}
            {pendentesErro && (
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: '#C0392B' }}>
                Erro ao carregar pendentes
              </Text>
            )}
          </View>

          {/* Dia / Mês */}
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
            <FaixaSemana dia={dia} hoje={hoje} contagem={contagemSemana} onSelecionar={setDia} />
          )}

          {visao === 'dia' && (<>
          {/* Resumo do dia */}
          <View style={{
            marginHorizontal: 24, marginBottom: 14,
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 14, padding: 12, paddingHorizontal: 16,
            flexDirection: 'row', alignItems: 'center',
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
          }}>
            {[
              { value: erroDia ? '—' : String(resumo.total),           label: 'Agendamentos', color: C.text },
              { value: erroDia ? '—' : formatarMoeda(resumo.receitaPrevista),  label: 'Receita prev.',  color: C.green },
              { value: erroDia ? '—' : String(resumo.profissionais),   label: 'Profissionais',  color: C.text },
              { value: erroDia ? '—' : String(resumo.pendentes),       label: 'Pendentes',      color: !erroDia && resumo.pendentes > 0 ? C.amber : C.text },
            ].map((s, i, arr) => (
              <View key={s.label} style={{ flex: 1, alignItems: 'center' }}>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: s.color, letterSpacing: -0.5 }}>
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
            {customsNoDia.map((info) => (
              <View key={info.label} style={{
                flexDirection: 'row', alignItems: 'center', gap: 4,
                backgroundColor: info.bg, borderWidth: 1,
                borderColor: `${info.cor}40`,
                borderRadius: 20, paddingVertical: 4, paddingHorizontal: 9,
              }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: info.cor }} />
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, color: info.cor, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {info.label}
                </Text>
              </View>
            ))}
          </ScrollView>
          </>)}

          {/* Filtro profissional: "Todas" e as colegas só com agenda.ver_equipe */}
          {podeVerEquipe && (
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 24, gap: 6, paddingBottom: 14 }}
          >
            <TouchableOpacity
              onPress={() => setFiltroProfissional(TODAS)}
              accessibilityState={{ selected: filtro === TODAS }}
              style={{
                paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20,
                backgroundColor: filtro === TODAS ? C.primary : C.surface,
                borderWidth: 1, borderColor: filtro === TODAS ? C.primary : C.border,
              }}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: filtro === TODAS ? '#fff' : C.text3 }}>
                Todas
              </Text>
            </TouchableOpacity>

            {profissionais.map((prof) => {
              const ativo = filtro === prof.id;
              const [c1, c2] = avatarColors(prof.nome);
              return (
                <TouchableOpacity
                  key={prof.id}
                  onPress={() => setFiltroProfissional(prof.id)}
                  accessibilityState={{ selected: ativo }}
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
          )}
        </View>

        {/* ── Timeline (visão Dia) ── */}
        {visao === 'dia' && (erroDia ? (
          <Text style={{ marginHorizontal: 24, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: '#C0392B' }}>
            Não foi possível carregar a agenda do dia. Puxe para atualizar.
          </Text>
        ) : filtro === TODAS ? (
          <TimelineColunas
            colunas={colunas}
            horas={horas}
            renderCelula={(profissionalId, ags, hora) =>
              renderCelula(profissionalId, ags, bloqPorColuna.get(profissionalId)?.[hora] ?? [], hora)}
          />
        ) : (
          <View style={{ paddingHorizontal: 24 }}>
            {horas.map((hora) => (
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
                  {renderCelula(filtro, agPorHora[hora] ?? [], bloqPorHora[hora] ?? [], hora)}
                </View>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>

      <BloqueioModal
        key={dia}
        visible={modalBloqueio}
        podeAprovarBloqueios={podeAprovarBloqueios}
        meuUserId={user?.id ?? ''}
        meuNome={user?.nome ?? 'Você'}
        membros={profissionais.map((p) => ({ id: p.id, nome: p.nome }))}
        dataInicial={dataDoDia(dia)}
        onClose={() => setModalBloqueio(false)}
        onSubmit={async (input) => {
          const r = await criarBloqueio.mutateAsync(input);
          return { situacao: r.situacao };
        }}
      />
      <PendentesBloqueioSheet
        visible={sheetPendentes}
        pendentes={pendentes}
        onClose={() => setSheetPendentes(false)}
        onAprovar={(id) =>
          aprovar.mutate(id, { onError: (e: any) => Alert.alert('Erro', e?.message ?? 'Não foi possível aprovar.') })
        }
        onRecusar={(id) =>
          recusar.mutate(id, { onError: (e: any) => Alert.alert('Erro', e?.message ?? 'Não foi possível recusar.') })
        }
      />
      <ConfirmarRemoverBloqueio
        visible={!!bloqueioParaRemover}
        bloqueio={bloqueioParaRemover}
        profNome={
          bloqueioParaRemover && bloqueioParaRemover.escopo === 'profissional'
            ? (profissionais.find((p) => p.id === bloqueioParaRemover.profissional_id)?.nome ?? null)
            : null
        }
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
