import { useState, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StatusBar, Alert, ActivityIndicator, Modal, FlatList, Switch,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import {
  ChevronLeft, User, Clock, DollarSign, Check, Search, X, UserPlus,
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
import { addDays, format } from 'date-fns';

import { useAuthStore } from '@/stores/authStore';
import { usePermissoes } from '@/lib/permissions';
import { useProfissionais } from '@/hooks/useAgenda';
import { useServicosEmpresa } from '@/hooks/useServicosEmpresa';
import { useClientes } from '@/hooks/useClientes';
import { supabase } from '@/lib/supabase';
import { invalidarFinanceiro } from '@/lib/invalidarFinanceiro';
import SuccessCheck from '@/components/SuccessCheck';
import LinhasServicoEditor, {
  linhaVazia, novaChaveLinha, valorParaCampo, duracaoDigitada,
  type LinhaServicoForm,
} from '@/components/agenda/LinhasServicoEditor';
import SeletorHorario, { horaValida } from '@/components/agenda/SeletorHorario';
import {
  montarAgendamento, horariosDoDia, janelaDoDia, conflitosDeHorario, instanteNoPassado,
  linhasIniciaisEdicao, msgConflito, diasDaSemana, semanaVizinha,
  MSG_HORARIO_PASSADO, MSG_CONCLUIDO_COM_COMANDA, msgBloqueio, valorDigitadoValido,
} from '@shared/agenda';
import { bloqueioEmConflito, type BlocoParaChecagem } from '@shared/bloqueios';
import { podeMexerNoAgendamento } from '@shared/agendamentos';
import {
  chaveDiaBRT, horaBRT, hojeBRT, instanteMs, limitesDias, diaDaSemana,
  DIAS_SEMANA_ABREV, rotuloMesAno, rotuloDiaCurto,
} from '@shared/periodos';
import { parseValorBR } from '@shared/comanda-fechamento';
import { buildTaxaReservaInsert } from '@shared/taxa-reserva';
import { valorTaxaReservaSugerida } from '@shared/taxas-atendimento';
import { maskPhone } from '@shared/mascaras';
import { nomeClienteValido } from '@shared/clientes';
import { mensagemErroBanco } from '@shared/erros';
import { formatarMoeda } from '@shared/moeda';
import { novoUuid } from '@shared/uuid';

// ── Constantes ───────────────────────────────────────────────

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  accent: '#9B6FE8', accentSoft: '#F3EFFE',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  rose: '#B42318', roseSoft: '#FEF3F2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const AVATAR_COLORS: [string, string][] = [
  ['#7C3AED', '#A855F7'], ['#D4608A', '#F472B6'],
  ['#0D7E5F', '#34D399'], ['#B45309', '#F59E0B'],
  ['#1D4ED8', '#60A5FA'], ['#7C2D12', '#EA580C'],
];

type MetodoPagTaxa = 'dinheiro' | 'pix' | 'credito' | 'debito' | 'cortesia';
/** Formas de pagamento da taxa de reserva quando marcada como já cobrada — mesmas 5 opções de `pagamentos.metodo` usadas no checkout da comanda. */
const METODOS_TAXA: { key: MetodoPagTaxa; label: string }[] = [
  { key: 'dinheiro', label: 'Dinheiro' },
  { key: 'pix',      label: 'Pix' },
  { key: 'credito',  label: 'Crédito' },
  { key: 'debito',   label: 'Débito' },
  { key: 'cortesia', label: 'Cortesia' },
];

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

// ── Helpers ──────────────────────────────────────────────────

function avatarColors(nome: string): [string, string] {
  return AVATAR_COLORS[(nome?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length];
}
function iniciaisNome(nome: string) {
  return (nome ?? '').split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}
/** Data curta de uma sessão de pacote; nunca lança em data inválida. */
function fmtSessaoData(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : format(d, 'dd/MM/yy');
}
/** Instante ISO (UTC) de um dia 'AAAA-MM-DD' e hora 'HH:MM' de Brasília. */
function instanteBRT(dia: string, hhmm: string): string {
  return new Date(instanteMs(`${dia}T${hhmm}:00-03:00`)).toISOString();
}
/** Pergunta Sim/Voltar; resolve true só se a pessoa confirmar. */
function confirmarAlerta(titulo: string, mensagem: string, confirmar: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(titulo, mensagem, [
      { text: 'Voltar', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmar, onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

type PacoteSessaoFeita = { id: string; data: string; servico: string | null; viaAg: boolean };
type PacoteClienteOpt  = {
  id: string; nome: string;
  restantes: number | null; total: number | null; usadas: number;
  servicoIds: string[];
  sessoes: PacoteSessaoFeita[];
};
type PacoteCatalogoOpt = { id: string; nome: string; preco: number; validade_dias: number | null; servicoIds: string[] };

/** Atendimento carregado para edição (`?id=`). */
type AgEdicao = {
  id: string; profissional_id: string; servico_id: string | null;
  data_hora_inicio: string; data_hora_fim: string;
  valor: number | null; observacao: string | null; status: string;
  comanda_id: string | null; pacote_cliente_id: string | null;
  cliente: { id: string; nome: string; telefone: string | null } | null;
  profissional: { id: string; nome: string } | null;
  servico: { id: string; nome: string; preco: number; duracao_minutos: number } | null;
  agendamento_servicos: { servico_id: string; valor: number; duracao_minutos: number; ordem: number; servico: { nome: string; preco: number } | null }[] | null;
};

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

/**
 * Criar e editar agendamento (igual ao modal do web). Parâmetros:
 * `?id=` edição · `?data=AAAA-MM-DD` · `?hora=HH:MM` (ISO completo também é aceito) ·
 * `?profissional=<user_id>` · `?clienteId=`.
 */
export default function NovoAgendamento() {
  const insets = useSafeAreaInsets();
  const { empresaAtiva, user } = useAuthStore();
  const { pode } = usePermissoes();
  const podeOutras = pode('agenda.gerenciar_outras');
  const podeCadastrarCliente = pode('clientes.cadastrar');
  const podeVenderPacote = pode('pacotes.vender');
  const params = useLocalSearchParams<{ id?: string; clienteId?: string; data?: string; hora?: string; profissional?: string }>();
  const editId = typeof params.id === 'string' && params.id ? params.id : null;
  const empresaId = empresaAtiva?.id;
  const queryClient = useQueryClient();

  // Config de taxa de reserva da empresa
  const taxaReservaAtiva    = empresaAtiva?.taxa_reserva_ativa ?? false;
  const taxaReservaModo     = (empresaAtiva?.taxa_reserva_modo as 'percentual' | 'fixo') ?? 'percentual';
  const taxaReservaCfgValor = Number(empresaAtiva?.taxa_reserva_valor ?? 0);

  // Dia e hora iniciais (em Brasília). `?hora=` com ISO completo é o formato antigo da agenda.
  const inicial = useMemo(() => {
    const h = typeof params.hora === 'string' ? params.hora : '';
    if (h.includes('T')) return { dia: chaveDiaBRT(h), hora: horaBRT(h) };
    const dia = typeof params.data === 'string' && RE_DIA.test(params.data) ? params.data : hojeBRT();
    return { dia, hora: horaValida(h) ? h : null };
  }, []);

  // Estado do formulário
  const [clienteSelecionado, setClienteSelecionado] = useState<{ id: string; nome: string; telefone?: string | null } | null>(null);
  const [linhas, setLinhas]                         = useState<LinhaServicoForm[]>(() => [linhaVazia()]);
  const [duracaoTxt, setDuracaoTxt]                 = useState('');
  const [profSelecionado, setProfSelecionado]       = useState<{ id: string; nome: string } | null>(null);
  const [dataChave, setDataChave]                   = useState<string>(inicial.dia);
  const [semanaRef, setSemanaRef]                   = useState<string>(inicial.dia);
  const [hora, setHora]                             = useState<string | null>(inicial.hora);
  // `cobrarTaxaReserva`: "Cobrar taxa de reserva neste atendimento" (padrão ligado quando a chave
  // da empresa está ligada). Desligado, nenhuma linha de `taxas_reserva` é criada.
  const [cobrarTaxaReserva, setCobrarTaxaReserva] = useState(true);
  const [taxaReserva, setTaxaReserva]             = useState('');
  const [taxaReservaEditada, setTaxaReservaEditada] = useState(false);
  const [taxaReservaCobrada, setTaxaReservaCobrada] = useState(false);
  const [taxaReservaMetodo, setTaxaReservaMetodo]   = useState<MetodoPagTaxa | null>(null);
  const [obs, setObs]           = useState('');
  const [salvando, setSalvando] = useState(false);
  const [sucesso, setSucesso] = useState<{ clienteNome: string; servicoNome: string; profNome: string; inicioIso: string; fimIso: string } | null>(null);
  const [avisoTaxaReserva, setAvisoTaxaReserva] = useState('');
  // Criação que gravou o agendamento mas falhou nos serviços: a nova tentativa só regrava os
  // serviços desse id (nunca cria um segundo agendamento nem uma segunda taxa).
  const [idCriado, setIdCriado] = useState<string | null>(null);
  const pacoteVendidoRef = useRef<string | null>(null);
  const [preenchidoEdit, setPreenchidoEdit] = useState(false);

  // Pacote do cliente (vincular sessão existente) ou vender um pacote novo agora
  const [pacotesCliente,  setPacotesCliente]  = useState<PacoteClienteOpt[]>([]);
  const [pacoteClienteId, setPacoteClienteId] = useState('');
  const [pacotesCatalogo, setPacotesCatalogo] = useState<PacoteCatalogoOpt[]>([]);
  const [pacoteVenderId,  setPacoteVenderId]  = useState('');

  // Modal de busca de cliente
  const [modalCliente, setModalCliente] = useState(false);
  const [buscaCliente, setBuscaCliente] = useState('');

  // Cadastro rápido de cliente novo, sem sair do modal de agendamento
  const [criandoCliente, setCriandoCliente]         = useState(false);
  const [novoClienteNome, setNovoClienteNome]       = useState('');
  const [novoClienteTelefone, setNovoClienteTelefone] = useState('');
  const [salvandoCliente, setSalvandoCliente]       = useState(false);
  const [clienteCriadoFlash, setClienteCriadoFlash] = useState(false);

  // Dados
  const { data: clientes = [] }     = useClientes('todas', buscaCliente);
  const { data: todasProfissionais = [] } = useProfissionais();
  const { data: servicos = [] }     = useServicosEmpresa();

  // Atendimento em edição (?id=)
  const { data: agEdit, isLoading: carregandoEdit, error: erroEdit } = useQuery({
    queryKey: ['agendamento-editar', empresaId, editId],
    enabled: !!editId && !!empresaId,
    staleTime: 0,
    queryFn: async (): Promise<AgEdicao | null> => {
      const { data, error } = await supabase.from('agendamentos')
        .select(`id, profissional_id, servico_id, data_hora_inicio, data_hora_fim, valor, observacao, status,
          comanda_id, pacote_cliente_id,
          cliente:clientes!agendamentos_cliente_id_fkey(id, nome, telefone),
          profissional:users!agendamentos_profissional_id_fkey(id, nome),
          servico:servicos(id, nome, preco, duracao_minutos),
          agendamento_servicos(servico_id, valor, duracao_minutos, ordem, servico:servicos(nome, preco))`)
        .eq('id', editId!)
        .eq('empresa_id', empresaId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as AgEdicao | null;
    },
  });

  // Atendimentos e bloqueios do dia: só para a janela de horários (`janelaDoDia`).
  const { data: itensDia = [] } = useQuery({
    queryKey: ['agendar-janela', empresaId, dataChave],
    enabled: !!empresaId,
    staleTime: 1000 * 30,
    queryFn: async () => {
      const l = limitesDias(dataChave, dataChave);
      const [ags, bls] = await Promise.all([
        supabase.from('agendamentos').select('data_hora_inicio, data_hora_fim')
          .eq('empresa_id', empresaId!)
          .lt('data_hora_inicio', l.endIso).gt('data_hora_fim', l.startIso)
          .not('status', 'in', '("cancelado","faltou")'),
        supabase.from('agenda_bloqueios').select('data_inicio, data_fim')
          .eq('empresa_id', empresaId!)
          .lt('data_inicio', l.endIso).gt('data_fim', l.startIso),
      ]);
      return [
        ...((ags.data ?? []) as any[]).map((a) => ({ inicio: a.data_hora_inicio as string, fim: a.data_hora_fim as string })),
        ...((bls.data ?? []) as any[]).map((b) => ({ inicio: b.data_inicio as string, fim: b.data_fim as string })),
      ];
    },
  });
  const horarios = useMemo(() => horariosDoDia(janelaDoDia(itensDia)), [itensDia]);

  // Sem 'agenda.gerenciar_outras' só aparece a própria pessoa (o banco recusa gravar para outra).
  const profissionais = useMemo(
    () => {
      if (podeOutras) return todasProfissionais;
      const eu = todasProfissionais.find((p) => p.id === user?.id)
        ?? (user ? { id: user.id, nome: user.nome, foto_url: user.foto_url ?? undefined } : null);
      return eu ? [eu] : [];
    },
    [podeOutras, todasProfissionais, user],
  );
  useEffect(() => {
    if (editId || profSelecionado || profissionais.length === 0) return;
    if (!podeOutras) { setProfSelecionado({ id: profissionais[0].id, nome: profissionais[0].nome }); return; }
    const pedida = typeof params.profissional === 'string' ? profissionais.find((p) => p.id === params.profissional) : null;
    if (pedida) setProfSelecionado({ id: pedida.id, nome: pedida.nome });
  }, [editId, podeOutras, profissionais, profSelecionado, params.profissional]);

  // Preenche o formulário com o atendimento em edição (uma vez).
  useEffect(() => {
    if (!agEdit || preenchidoEdit) return;
    const ordenadas = [...(agEdit.agendamento_servicos ?? [])].sort((a, b) => a.ordem - b.ordem);
    const base = linhasIniciaisEdicao(
      {
        servico_id: agEdit.servico_id, profissional_id: agEdit.profissional_id,
        valor: agEdit.valor, duracao_min: agEdit.servico?.duracao_minutos ?? null,
      },
      ordenadas.map((s) => ({
        servico_id: s.servico_id, profissional_id: agEdit.profissional_id,
        valor: Number(s.valor), duracao_min: s.duracao_minutos,
      })),
    );
    const info = (id: string) => {
      const doJoin = ordenadas.find((s) => s.servico_id === id)?.servico
        ?? (agEdit.servico?.id === id ? agEdit.servico : null);
      const doCatalogo = servicos.find((s) => s.id === id);
      return { nome: doCatalogo?.nome ?? doJoin?.nome ?? 'Serviço', preco: doCatalogo?.preco ?? doJoin?.preco ?? null };
    };
    setLinhas(base.length > 0
      ? base.map((l) => {
          const i = info(l.servico_id);
          return {
            uid: novaChaveLinha(), servico_id: l.servico_id, nome: i.nome, preco: Number(i.preco ?? l.valor),
            valor: valorParaCampo(l.valor), duracao: l.duracao_min > 0 ? String(l.duracao_min) : '',
          };
        })
      : [linhaVazia()]);
    // Mantém o fim atual do atendimento: se a duração real difere da soma das linhas, ela vira a duração editada.
    const real = Math.round((instanteMs(agEdit.data_hora_fim) - instanteMs(agEdit.data_hora_inicio)) / 60000);
    const soma = base.reduce((s, l) => s + (l.duracao_min || 0), 0);
    setDuracaoTxt(real > 0 && real !== soma ? String(real) : '');
    setDataChave(chaveDiaBRT(agEdit.data_hora_inicio));
    setSemanaRef(chaveDiaBRT(agEdit.data_hora_inicio));
    setHora(horaBRT(agEdit.data_hora_inicio));
    if (agEdit.cliente) setClienteSelecionado({ id: agEdit.cliente.id, nome: agEdit.cliente.nome, telefone: agEdit.cliente.telefone });
    setProfSelecionado({ id: agEdit.profissional_id, nome: agEdit.profissional?.nome ?? 'Profissional' });
    setObs(agEdit.observacao ?? '');
    setPacoteClienteId(agEdit.pacote_cliente_id ?? '');
    setPreenchidoEdit(true);
  }, [agEdit, preenchidoEdit, servicos]);

  // Catálogo de pacotes (uma vez, por empresa)
  useEffect(() => {
    if (!empresaId) return;
    supabase.from('pacotes')
      .select('id, nome, preco, validade_dias, servicos:pacote_servicos(servico_id)')
      .eq('empresa_id', empresaId).eq('ativo', true)
      .then(({ data }) => {
        setPacotesCatalogo(((data ?? []) as any[]).map(p => ({
          id: p.id, nome: p.nome, preco: p.preco, validade_dias: p.validade_dias,
          servicoIds: (p.servicos ?? []).map((s: any) => s.servico_id),
        })));
      });
  }, [empresaId]);

  // Pacotes ativos do cliente selecionado
  useEffect(() => {
    if (!clienteSelecionado || !empresaId) { setPacotesCliente([]); return; }
    const pacoteOriginal = agEdit?.pacote_cliente_id ?? null;
    supabase.from('pacote_clientes')
      .select('id, data_validade, pacote:pacotes(nome, controla_sessoes, servicos:pacote_servicos(servico_id, quantidade)), uso:pacote_uso(id, created_at, agendamento_id, servico:servicos(nome))')
      .eq('empresa_id', empresaId)
      .eq('cliente_id', clienteSelecionado.id)
      .eq('status', 'ativo')
      .then(({ data }) => {
        const hoje = new Date();
        const opts = ((data ?? []) as any[])
          .filter(pc => (pc.pacote?.controla_sessoes ?? true) && (!pc.data_validade || new Date(pc.data_validade) >= hoje))
          .map(pc => {
            const servicosPac = (pc.pacote?.servicos ?? []) as { servico_id: string; quantidade: number | null }[];
            const ilimitado = servicosPac.some(s => s.quantidade == null);
            const total = ilimitado ? null : servicosPac.reduce((s, x) => s + (x.quantidade ?? 0), 0);
            const usoRows = (pc.uso ?? []) as any[];
            const usadas = usoRows.length;
            const restantes = total != null ? total - usadas : null;
            const sessoes: PacoteSessaoFeita[] = usoRows
              .map((u: any) => ({ id: u.id, data: u.created_at as string, servico: u.servico?.nome ?? null, viaAg: !!u.agendamento_id }))
              .sort((a: PacoteSessaoFeita, b: PacoteSessaoFeita) => (b.data ?? '').localeCompare(a.data ?? ''));
            return { id: pc.id, nome: pc.pacote?.nome ?? 'Pacote', restantes, total, usadas, servicoIds: servicosPac.map(s => s.servico_id), sessoes };
          })
          .filter(p => p.restantes === null || p.restantes > 0);
        setPacotesCliente(opts);
        // Na edição, o pacote já vinculado ao atendimento nunca é desvinculado em silêncio.
        setPacoteClienteId(prev => opts.some(o => o.id === prev) || (!!prev && prev === pacoteOriginal) ? prev : '');
      });
  }, [clienteSelecionado?.id, empresaId, agEdit?.pacote_cliente_id]);

  // Pré-seleciona cliente se veio de clienteId
  const clientePreSelecionado = params.clienteId;
  useEffect(() => {
    if (editId || !clientePreSelecionado || clientes.length === 0 || clienteSelecionado) return;
    const c = clientes.find((x) => x.id === clientePreSelecionado);
    if (c) setClienteSelecionado({ id: c.id, nome: c.nome, telefone: c.telefone });
  }, [editId, clientePreSelecionado, clientes, clienteSelecionado]);

  // Montagem (valor total, duração, fim) pela regra única de shared/agenda.
  const linhasPreenchidas = linhas.filter((l) => l.servico_id);
  const duracaoEditadaMin = duracaoTxt.trim() === '' ? null : duracaoDigitada(duracaoTxt);
  const inicioIso = hora && horaValida(hora) ? instanteBRT(dataChave, hora) : null;
  const montado = montarAgendamento({
    linhas: linhasPreenchidas.map((l) => ({
      servico_id: l.servico_id, profissional_id: profSelecionado?.id ?? '',
      valor: l.valor, duracao_min: duracaoDigitada(l.duracao) ?? 0, preco: l.preco,
    })),
    inicioIso: inicioIso ?? instanteBRT(dataChave, '00:00'),
    duracaoEditadaMin,
  });
  const valorTotal = montado.valorTotal;

  // Taxa de reserva sugerida sobre o total, recalculada até a pessoa digitar um valor próprio.
  useEffect(() => {
    if (!taxaReservaAtiva || taxaReservaEditada || editId) return;
    const sugerido = valorTaxaReservaSugerida({ ativa: true, modo: taxaReservaModo, valor: taxaReservaCfgValor }, valorTotal);
    setTaxaReserva(sugerido > 0 ? valorParaCampo(sugerido) : '');
  }, [valorTotal, taxaReservaAtiva, taxaReservaEditada, taxaReservaModo, taxaReservaCfgValor, editId]);

  useEffect(() => {
    if (!sucesso) return;
    const t = setTimeout(() => router.back(), avisoTaxaReserva ? 2800 : 1500);
    return () => clearTimeout(t);
  }, [sucesso]);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  // ── Regras de bloqueio do formulário ──
  const usaTaxaReserva = !editId && taxaReservaAtiva && cobrarTaxaReserva;
  const valoresOk  = linhasPreenchidas.every((l) => valorDigitadoValido(l.valor));
  const duracoesOk = linhasPreenchidas.every((l) => duracaoDigitada(l.duracao) != null);
  const duracaoTotalOk = duracaoTxt.trim() === '' || duracaoEditadaMin != null;
  const taxaOk = !usaTaxaReserva || valorDigitadoValido(taxaReserva);
  const motivoEdicaoTravada: string | null = !editId ? null
    : erroEdit ? mensagemErroBanco(erroEdit as any, 'carregar o agendamento')
    : carregandoEdit || !preenchidoEdit ? (agEdit === null ? 'Agendamento não encontrado.' : null)
    : agEdit?.comanda_id ? MSG_CONCLUIDO_COM_COMANDA
    : !podeMexerNoAgendamento(agEdit?.profissional_id, user?.id ?? '', podeOutras)
      ? 'Você não pode editar o agendamento de outra profissional.'
      : null;
  const formTravado = !!motivoEdicaoTravada || !!idCriado;
  const podeSalvar = !!(
    clienteSelecionado && profSelecionado && inicioIso &&
    linhasPreenchidas.length > 0 && montado.duracaoMin > 0 &&
    valoresOk && duracoesOk && duracaoTotalOk && taxaOk &&
    (!editId || preenchidoEdit) && !motivoEdicaoTravada
  );
  const motivoNaoSalva = podeSalvar ? null
    : motivoEdicaoTravada
      ?? (!clienteSelecionado ? 'Escolha a cliente.'
      : linhasPreenchidas.length === 0 ? 'Escolha pelo menos um serviço.'
      : !profSelecionado ? 'Escolha a profissional.'
      : !inicioIso ? 'Escolha o horário.'
      : !valoresOk ? 'Corrija o valor do serviço (use 0 para cortesia).'
      : !duracoesOk || !duracaoTotalOk || montado.duracaoMin <= 0 ? 'Informe a duração em minutos.'
      : !taxaOk ? 'Corrija o valor da taxa de reserva.'
      : null);

  if (!fontsLoaded) return null;

  const semana = diasDaSemana(semanaRef);
  const hoje = hojeBRT();

  function selecionarProf(p: { id: string; nome: string }) {
    if (formTravado) return;
    setProfSelecionado({ id: p.id, nome: p.nome });
  }

  /** Acrescenta as linhas dos serviços do pacote (sem duplicar), igual ao web. */
  function preencherServicosDoPacote(servicoIds: string[]) {
    setLinhas((prev) => {
      const jaTem = new Set(prev.map((l) => l.servico_id).filter(Boolean));
      const novas: LinhaServicoForm[] = servicoIds
        .filter((id) => !jaTem.has(id))
        .map((id) => servicos.find((x) => x.id === id))
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => ({
          uid: novaChaveLinha(), servico_id: s.id, nome: s.nome, preco: s.preco,
          valor: valorParaCampo(s.preco), duracao: String(s.duracao_minutos),
        }));
      if (novas.length === 0) return prev;
      return [...prev.filter((l) => l.servico_id), ...novas];
    });
  }

  function onPacoteClienteChange(opt: PacoteClienteOpt) {
    const novo = opt.id === pacoteClienteId ? '' : opt.id;
    setPacoteClienteId(novo);
    if (novo) { setPacoteVenderId(''); preencherServicosDoPacote(opt.servicoIds); }
  }

  function onPacoteVenderChange(opt: PacoteCatalogoOpt) {
    const novo = opt.id === pacoteVenderId ? '' : opt.id;
    setPacoteVenderId(novo);
    if (novo) { setPacoteClienteId(''); preencherServicosDoPacote(opt.servicoIds); }
  }

  async function salvarNovoCliente() {
    if (!nomeClienteValido(novoClienteNome) || !empresaAtiva?.id) return;
    setSalvandoCliente(true);

    const { data: nova, error: errNova } = await supabase.from('clientes').insert({
      empresa_id: empresaAtiva.id,
      nome: novoClienteNome.trim(),
      telefone: novoClienteTelefone.trim() || null,
    }).select('id, nome, telefone').single();
    setSalvandoCliente(false);
    if (errNova || !nova) { Alert.alert('Erro', mensagemErroBanco(errNova, 'cadastrar cliente')); return; }

    queryClient.invalidateQueries({ queryKey: ['clientes'] });
    setClienteSelecionado({ id: nova.id, nome: nova.nome, telefone: nova.telefone });
    setCriandoCliente(false);
    setNovoClienteNome('');
    setNovoClienteTelefone('');
    setModalCliente(false);
    setBuscaCliente('');
    setClienteCriadoFlash(true);
    setTimeout(() => setClienteCriadoFlash(false), 2000);
  }

  /**
   * Checagens antes de gravar, na ordem: bloqueio (recusa, mesma regra do trigger 074),
   * conflito de horário (confirma) e horário passado (confirma).
   */
  async function confirmar() {
    if (!podeSalvar || !empresaId || !inicioIso || salvando) return;
    const profId = profSelecionado!.id;
    const fimIso = montado.fimIso;
    setSalvando(true);
    try {
      // Nova tentativa de uma criação que já gravou o agendamento: só os serviços.
      if (idCriado) { await executarSalvar(inicioIso, fimIso); return; }

      const [bls, ags] = await Promise.all([
        supabase.from('agenda_bloqueios')
          .select('escopo, profissional_id, situacao, motivo, titulo, data_inicio, data_fim')
          .eq('empresa_id', empresaId)
          .lt('data_inicio', fimIso).gt('data_fim', inicioIso),
        supabase.from('agendamentos')
          .select('id, profissional_id, data_hora_inicio, data_hora_fim, status, cliente:clientes!agendamentos_cliente_id_fkey(nome)')
          .eq('empresa_id', empresaId).eq('profissional_id', profId)
          .lt('data_hora_inicio', fimIso).gt('data_hora_fim', inicioIso),
      ]);
      if (bls.error || ags.error) {
        Alert.alert('Erro', mensagemErroBanco(bls.error ?? ags.error, 'conferir a agenda'));
        return;
      }

      // Na edição, o trigger 074 só recusa se o intervalo ou a profissional mudou.
      const mudouIntervalo = !agEdit
        || instanteMs(inicioIso) !== instanteMs(agEdit.data_hora_inicio)
        || instanteMs(fimIso) !== instanteMs(agEdit.data_hora_fim)
        || profId !== agEdit.profissional_id;
      if (mudouIntervalo) {
        const bloqueio = bloqueioEmConflito((bls.data ?? []) as BlocoParaChecagem[], profId, inicioIso, fimIso);
        if (bloqueio) { Alert.alert('Horário bloqueado', msgBloqueio(bloqueio.motivo)); return; }
      }

      const conflitos = conflitosDeHorario(
        { profissional_id: profId, inicioIso, fimIso },
        ((ags.data ?? []) as any[]).map((a) => ({
          id: a.id, profissional_id: a.profissional_id, inicio: a.data_hora_inicio, fim: a.data_hora_fim,
          status: a.status, cliente_nome: a.cliente?.nome ?? null,
        })),
        editId ?? undefined,
      );
      if (conflitos.length > 0) {
        const ok = await confirmarAlerta(
          'Conflito de horário', msgConflito(profSelecionado!.nome, horaBRT(conflitos[0].inicio)),
          editId ? 'Salvar mesmo assim' : 'Agendar mesmo assim',
        );
        if (!ok) return;
      }

      const mudouInicio = !agEdit || instanteMs(inicioIso) !== instanteMs(agEdit.data_hora_inicio);
      if (mudouInicio && instanteNoPassado(inicioIso, Date.now())) {
        const ok = await confirmarAlerta('Horário passado', MSG_HORARIO_PASSADO, 'Registrar');
        if (!ok) return;
      }

      await executarSalvar(inicioIso, fimIso);
    } finally {
      setSalvando(false);
    }
  }

  /** Grava `agendamentos` e depois `agendamento_servicos`, na mesma ordem e formato do web. */
  async function executarSalvar(inicio: string, fim: string) {
    if (!empresaId) return;
    const cliente = clienteSelecionado!;
    const prof = profSelecionado!;
    let agId = '';

    if (!idCriado) {
      // Se escolheu vender um pacote novo do catálogo, cria a venda antes de tudo (uma vez só,
      // mesmo que a gravação do agendamento falhe e a pessoa tente de novo).
      let pacoteClienteIdFinal: string | null = pacoteClienteId || null;
      if (pacoteVenderId && pacoteVendidoRef.current) {
        pacoteClienteIdFinal = pacoteVendidoRef.current;
      } else if (pacoteVenderId) {
        const pacote = pacotesCatalogo.find(p => p.id === pacoteVenderId);
        if (pacote) {
          const { data: novaVenda, error: errVenda } = await supabase.from('pacote_clientes').insert({
            empresa_id:    empresaId,
            pacote_id:     pacote.id,
            cliente_id:    cliente.id,
            data_inicio:   format(new Date(), 'yyyy-MM-dd'),
            data_validade: pacote.validade_dias != null
              ? format(addDays(new Date(), pacote.validade_dias), 'yyyy-MM-dd')
              : null,
            valor_pago:    pacote.preco,
            status:        'ativo',
          }).select('id').single();
          if (errVenda || !novaVenda) {
            Alert.alert('Erro ao vender pacote', mensagemErroBanco(errVenda, 'vender o pacote'));
            return;
          }
          pacoteClienteIdFinal = novaVenda.id;
          pacoteVendidoRef.current = novaVenda.id;

          // Registra a venda do pacote como faturamento (uma vez, no ato).
          const { error: errVendaPac } = await supabase.from('vendas').insert({
            empresa_id:  empresaId,
            cliente_id:  cliente.id,
            valor_total: pacote.preco,
            desconto:    0,
            observacao:  `Venda de pacote: ${pacote.nome}`,
          });
          // O pacote já foi vendido: só avisa (abortar deixaria o pacote sem agendamento).
          if (errVendaPac) Alert.alert('Venda do pacote', `O pacote foi vendido, mas a receita não foi registrada: ${mensagemErroBanco(errVendaPac, 'registrar a venda do pacote')}`);
        }
      }

      const cabecalho = {
        cliente_id:        cliente.id,
        profissional_id:   prof.id,
        servico_id:        montado.linhas[0].servico_id,
        data_hora_inicio:  inicio,
        data_hora_fim:     fim,
        valor:             montado.valorTotal,
        observacao:        obs.trim() || null,
        pacote_cliente_id: pacoteClienteIdFinal,
      };

      if (editId) {
        const { data: atualizados, error } = await supabase.from('agendamentos').update(cabecalho)
          .eq('id', editId).eq('empresa_id', empresaId).select('id');
        // 0 linhas sem erro = RLS recusou. Para aqui, antes de apagar/regravar os serviços.
        if (error || !atualizados || atualizados.length === 0) {
          Alert.alert('Erro', mensagemErroBanco(error ?? { code: '42501' }, 'salvar este agendamento'));
          return;
        }
        const { error: errDelLinhas } = await supabase.from('agendamento_servicos').delete().eq('agendamento_id', editId);
        if (errDelLinhas) {
          Alert.alert('Erro', mensagemErroBanco(errDelLinhas, 'salvar os serviços do agendamento'));
          return;
        }
        agId = editId;
      } else {
        // Id gerado aqui e SEM RETURNING: com "agenda.gerenciar_outras" e sem "agenda.ver_equipe" a
        // pessoa cria na agenda de outra profissional, mas não lê a linha nova — o RETURNING recusava.
        const novoAg = { id: novoUuid() };
        const { error } = await supabase.from('agendamentos').insert({
          id:         novoAg.id,
          empresa_id: empresaId,
          status:     'agendado',
          ...cabecalho,
        });
        // Bloqueio (trigger 074) e demais regras do banco chegam em português por mensagemErroBanco.
        if (error) {
          Alert.alert('Erro', mensagemErroBanco(error, 'criar agendamento'));
          return;
        }
        agId = novoAg.id;
        pacoteVendidoRef.current = null;

        // Só cria a linha com o switch "Cobrar taxa de reserva neste atendimento" ligado.
        if (novoAg && taxaReservaAtiva && cobrarTaxaReserva) {
          const taxaReservaPayload = buildTaxaReservaInsert({
            empresaId, agendamentoId: novoAg.id,
            clienteId: cliente.id, valor: parseValorBR(taxaReserva),
            jaCobrada: taxaReservaCobrada, metodo: taxaReservaMetodo, cobrar: cobrarTaxaReserva,
          }, new Date().toISOString());
          if (taxaReservaPayload) {
            const { error: erroReserva } = await supabase.from('taxas_reserva').insert(taxaReservaPayload);
            if (erroReserva) {
              console.error('Erro ao registrar taxa de reserva:', erroReserva.message);
              setAvisoTaxaReserva('Agendamento criado, mas a taxa de reserva não pôde ser registrada.');
            }
          }
        }
      }
    } else {
      // Nova tentativa: o agendamento existe; apaga o que tiver sobrado e regrava os serviços.
      const { error: errDelLinhas } = await supabase.from('agendamento_servicos').delete().eq('agendamento_id', idCriado);
      if (errDelLinhas) {
        Alert.alert('Erro', mensagemErroBanco(errDelLinhas, 'salvar os serviços do agendamento'));
        return;
      }
      agId = idCriado;
    }

    const { error: errLinhas } = await supabase.from('agendamento_servicos').insert(
      montado.linhas.map((l, i) => ({
        agendamento_id:  agId,
        servico_id:      l.servico_id,
        valor:           l.valor,
        duracao_minutos: l.duracao_min,
        ordem:           i,
        empresa_id:      empresaId,
      }))
    );
    invalidarAgenda(agId);
    if (errLinhas) {
      if (!editId) setIdCriado(agId);
      Alert.alert('Erro', `O agendamento foi salvo, mas os serviços não: ${mensagemErroBanco(errLinhas, 'salvar os serviços do agendamento')}`);
      return;
    }

    setSucesso({
      clienteNome: cliente.nome,
      servicoNome: linhasPreenchidas.map((l) => l.nome).join(' + '),
      profNome: prof.nome,
      inicioIso: inicio, fimIso: fim,
    });
  }

  function invalidarAgenda(agId: string) {
    queryClient.invalidateQueries({ queryKey: ['agenda-dia'] });
    queryClient.invalidateQueries({ queryKey: ['dias-agendados'] });
    queryClient.invalidateQueries({ queryKey: ['agendar-janela'] });
    queryClient.invalidateQueries({ queryKey: ['agendamento', agId] });
    queryClient.invalidateQueries({ queryKey: ['agendamento-editar'] });
    queryClient.invalidateQueries({ queryKey: ['cliente-detalhe'] });
    invalidarFinanceiro(queryClient);
  }

  if (sucesso) {
    return (
      <View style={{ flex: 1, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: insets.top }}>
        <StatusBar barStyle="dark-content" />
        <SuccessCheck size={72} />
        <MotiView from={{ translateY: 12, opacity: 0 }} animate={{ translateY: 0, opacity: 1 }}
          transition={{ type: 'timing', duration: 350, delay: 150 }}
          style={{ alignItems: 'center', marginTop: 16 }}>
          <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 22, color: C.text, textAlign: 'center' }}>
            {editId ? 'Agendamento atualizado!' : 'Agendamento criado!'}
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text2, textAlign: 'center', marginTop: 6 }}>
            {sucesso.clienteNome}
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3, textAlign: 'center', marginTop: 2 }}>
            {sucesso.servicoNome} · {sucesso.profNome}
          </Text>
          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text4, textAlign: 'center', marginTop: 2 }}>
            {horaBRT(sucesso.inicioIso)}–{horaBRT(sucesso.fimIso)}
          </Text>
          {!!avisoTaxaReserva && (
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: '#B45309', textAlign: 'center', marginTop: 8 }}>
              {avisoTaxaReserva}
            </Text>
          )}
        </MotiView>
      </View>
    );
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
        <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: '#fff' }}>
          {editId ? 'Editar Agendamento' : 'Novo Agendamento'}
        </Text>
      </LinearGradient>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 20, paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
      >
        {editId && (carregandoEdit || !!motivoEdicaoTravada) && (
          <View style={{ marginHorizontal: 24, marginBottom: 16, padding: 12, borderRadius: 12,
            backgroundColor: motivoEdicaoTravada ? C.roseSoft : C.accentSoft }}>
            {motivoEdicaoTravada
              ? <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.rose }}>{motivoEdicaoTravada}</Text>
              : <ActivityIndicator color={C.primary} />}
          </View>
        )}
        {!!idCriado && (
          <View style={{ marginHorizontal: 24, marginBottom: 16, padding: 12, borderRadius: 12, backgroundColor: C.roseSoft }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.rose }}>
              O agendamento já foi criado, mas os serviços não foram gravados. Toque em "Salvar serviços" para tentar de novo.
            </Text>
          </View>
        )}

        {/* ── 1. Cliente ── */}
        <Secao numero={1} titulo="Cliente" completo={!!clienteSelecionado}>
          <TouchableOpacity
            onPress={() => { if (!formTravado) setModalCliente(true); }}
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
                  {clienteCriadoFlash ? (
                    <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 200 }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 }}>
                      <Check size={11} color={C.green} strokeWidth={3} />
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.green }}>
                        Cadastrada agora
                      </Text>
                    </MotiView>
                  ) : clienteSelecionado.telefone && (
                    <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3 }}>
                      {clienteSelecionado.telefone}
                    </Text>
                  )}
                </View>
                <TouchableOpacity disabled={formTravado} onPress={() => setClienteSelecionado(null)}>
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

        {/* ── 2. Pacote (opcional) ── */}
        {clienteSelecionado && (pacotesCliente.length > 0 || pacotesCatalogo.length > 0) && (
          <Secao numero={2} titulo="Pacote (opcional)">
            {pacotesCliente.length > 0 && (
              <View style={{ marginBottom: pacotesCatalogo.length > 0 ? 12 : 0 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Pacote do cliente — consome 1 sessão
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {pacotesCliente.map(p => {
                    const ativo = pacoteClienteId === p.id;
                    return (
                      <TouchableOpacity
                        key={p.id}
                        onPress={() => onPacoteClienteChange(p)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 6,
                          backgroundColor: ativo ? C.primarySoft : C.surface,
                          borderWidth: 1, borderColor: ativo ? C.primary : C.border,
                          borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12,
                        }}
                      >
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? C.primary : C.text2 }}>
                          {p.nome}
                        </Text>
                        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: ativo ? C.primary : C.text4 }}>
                          {p.restantes == null ? 'ilimitado' : `${p.restantes} rest.`}
                        </Text>
                        {ativo && <Check size={12} color={C.primary} strokeWidth={2.5} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Histórico de sessões do pacote selecionado — feitas + pendentes */}
                {(() => {
                  const p = pacotesCliente.find(x => x.id === pacoteClienteId);
                  if (!p) return null;
                  return (
                    <View style={{ marginTop: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 10 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text2 }}>
                          {p.usadas}{p.total != null ? ` de ${p.total}` : ''} {p.usadas === 1 ? 'sessão feita' : 'sessões feitas'}
                        </Text>
                        {p.restantes != null && (
                          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3 }}>
                            {p.restantes} pendente{p.restantes !== 1 ? 's' : ''}
                          </Text>
                        )}
                      </View>
                      {p.sessoes.length === 0 ? (
                        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text4 }}>
                          Nenhuma sessão feita ainda.
                        </Text>
                      ) : (
                        <View style={{ gap: 4 }}>
                          {p.sessoes.slice(0, 8).map(s => (
                            <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                              <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3 }}>
                                {s.servico ?? 'Sessão'}
                              </Text>
                              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: C.text4 }}>
                                {fmtSessaoData(s.data)} · {s.viaAg ? 'agendada' : 'avulsa'}
                              </Text>
                            </View>
                          ))}
                          {p.sessoes.length > 8 && (
                            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 9, color: C.text4, marginTop: 2 }}>
                              +{p.sessoes.length - 8} mais
                            </Text>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })()}
              </View>
            )}

            {!pacoteClienteId && pacotesCatalogo.length > 0 && podeVenderPacote && (
              <View>
                <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 10, color: C.text3, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Vender pacote agora
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {pacotesCatalogo.map(p => {
                    const ativo = pacoteVenderId === p.id;
                    return (
                      <TouchableOpacity
                        key={p.id}
                        onPress={() => onPacoteVenderChange(p)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 6,
                          backgroundColor: ativo ? C.greenSoft : C.surface,
                          borderWidth: 1, borderColor: ativo ? C.green : C.border,
                          borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12,
                        }}
                      >
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? C.green : C.text2 }}>
                          {p.nome}
                        </Text>
                        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10, color: ativo ? C.green : C.text4 }}>
                          {formatarMoeda(p.preco)}
                        </Text>
                        {ativo && <Check size={12} color={C.green} strokeWidth={2.5} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}
          </Secao>
        )}

        {/* ── 3. Serviços ── */}
        <Secao numero={3} titulo="Serviços" completo={linhasPreenchidas.length > 0 && valoresOk && duracoesOk}>
          <LinhasServicoEditor
            linhas={linhas}
            servicos={servicos}
            onChange={setLinhas}
            desabilitado={formTravado}
          />
          {linhasPreenchidas.length > 0 && (
            <View style={{ marginTop: 10, flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.text3 }}>
                Total ({linhasPreenchidas.length} {linhasPreenchidas.length === 1 ? 'serviço' : 'serviços'})
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: valoresOk ? C.text : C.rose }}>
                {valoresOk ? formatarMoeda(valorTotal) : '—'}
              </Text>
            </View>
          )}
        </Secao>

        {/* ── 4. Profissional ── */}
        <Secao numero={4} titulo="Profissional" completo={!!profSelecionado}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(profSelecionado && !profissionais.some((p) => p.id === profSelecionado.id)
              ? [...profissionais, { id: profSelecionado.id, nome: profSelecionado.nome }]
              : profissionais
            ).map((p) => {
              const ativo = profSelecionado?.id === p.id;
              const [c1, c2] = avatarColors(p.nome);
              return (
                <TouchableOpacity
                  key={p.id}
                  disabled={formTravado}
                  onPress={() => selecionarProf(p)}
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

        {/* ── 5. Data, horário e duração ── */}
        <Secao numero={5} titulo="Data e Horário" completo={!!inicioIso}>
          {/* Semana (domingo a sábado, em Brasília). Dias passados ficam liberados: salvar pede confirmação. */}
          <View style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 18, padding: 14, marginBottom: 10,
            shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <TouchableOpacity onPress={() => setSemanaRef((d) => semanaVizinha(d, -1))} style={{ padding: 4 }} disabled={formTravado}>
                <ChevronLeft size={16} color={C.text2} strokeWidth={2.5} />
              </TouchableOpacity>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}>
                {rotuloMesAno(semanaRef)}
              </Text>
              <TouchableOpacity onPress={() => setSemanaRef((d) => semanaVizinha(d, 1))} style={{ padding: 4 }} disabled={formTravado}>
                <ChevronLeft size={16} color={C.text2} strokeWidth={2.5} style={{ transform: [{ rotate: '180deg' }] }} />
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', gap: 4 }}>
              {semana.map((dia) => {
                const ativo = dia === dataChave;
                const passado = dia < hoje;
                return (
                  <TouchableOpacity
                    key={dia}
                    disabled={formTravado}
                    onPress={() => setDataChave(dia)}
                    style={{
                      flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 12, gap: 4,
                      backgroundColor: ativo ? C.primary : 'transparent',
                      opacity: passado && !ativo ? 0.55 : 1,
                    }}
                  >
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: ativo ? 'rgba(255,255,255,0.6)' : C.text3 }}>
                      {DIAS_SEMANA_ABREV[diaDaSemana(dia)]}
                    </Text>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: ativo ? '#fff' : (dia === hoje ? C.accent : C.text) }}>
                      {Number(dia.slice(8, 10))}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Horários do dia (15 em 15 min) + horário livre */}
          <SeletorHorario horarios={horarios} hora={hora} onChange={setHora} desabilitado={formTravado} />

          {/* Duração total: vazia = soma das linhas; preenchida substitui a soma. */}
          <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Clock size={14} color={C.text3} strokeWidth={2} />
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.text3 }}>
              Duração total (min)
            </Text>
            <TextInput
              editable={!formTravado}
              value={duracaoTxt}
              onChangeText={(v) => setDuracaoTxt(v.replace(/\D/g, ''))}
              placeholder={String(linhasPreenchidas.reduce((s, l) => s + (duracaoDigitada(l.duracao) ?? 0), 0) || '')}
              placeholderTextColor={C.text4}
              keyboardType="number-pad"
              maxLength={4}
              style={{
                width: 80, borderWidth: 1, borderColor: duracaoTotalOk ? C.border : C.rose, borderRadius: 10,
                paddingHorizontal: 10, paddingVertical: 7, backgroundColor: C.surface,
                fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text,
              }}
            />
          </View>

          {inicioIso && montado.duracaoMin > 0 && (
            <MotiView
              from={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ type: 'timing', duration: 250 }}
              style={{
                marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6,
                backgroundColor: C.accentSoft, borderRadius: 10, padding: 10,
              }}
            >
              <Clock size={12} color={C.accent} strokeWidth={2} />
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.accent }}>
                {horaBRT(inicioIso)}{' → '}{horaBRT(montado.fimIso)}{' · '}{montado.duracaoMin} min
                {instanteNoPassado(inicioIso, Date.now()) ? ' · horário já passou' : ''}
              </Text>
            </MotiView>
          )}
        </Secao>

        {/* ── 6. Taxa de reserva (só ao criar, como no web) ── */}
        {taxaReservaAtiva && !editId && (
          <Secao numero={6} titulo="Taxa de reserva">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Switch
                value={cobrarTaxaReserva}
                onValueChange={setCobrarTaxaReserva}
                disabled={formTravado}
                trackColor={{ false: C.border, true: C.primary }}
              />
              <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text2 }}>
                Cobrar taxa de reserva neste atendimento
              </Text>
            </View>
            {cobrarTaxaReserva && (
              <View style={{
                marginTop: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: taxaOk ? C.border : C.rose,
                borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
                paddingHorizontal: 14,
                shadowColor: C.primary, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
              }}>
                <DollarSign size={16} color={C.text4} strokeWidth={1.8} />
                <TextInput
                  editable={!formTravado}
                  value={taxaReserva}
                  onChangeText={v => { setTaxaReserva(v); setTaxaReservaEditada(true); }}
                  placeholder="Taxa de reserva (0,00)"
                  placeholderTextColor={C.text4}
                  keyboardType="decimal-pad"
                  style={{
                    flex: 1, paddingVertical: 14,
                    fontFamily: 'PlusJakartaSans_600SemiBold',
                    fontSize: 16, color: C.text,
                  }}
                />
              </View>
            )}
            {cobrarTaxaReserva && !taxaOk && (
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.rose, marginTop: 6 }}>
                Valor da taxa inválido. Use, por exemplo, 30,00.
              </Text>
            )}
            {cobrarTaxaReserva && parseValorBR(taxaReserva) > 0 && (
              <>
                <TouchableOpacity
                  onPress={() => {
                    setTaxaReservaCobrada(v => !v);
                    if (taxaReservaCobrada) setTaxaReservaMetodo(null);
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}
                >
                  <View style={{
                    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5,
                    borderColor: taxaReservaCobrada ? C.primary : C.border,
                    backgroundColor: taxaReservaCobrada ? C.primary : C.surface,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {taxaReservaCobrada && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', lineHeight: 14 }}>✓</Text>}
                  </View>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text2 }}>
                    Já foi cobrada?
                  </Text>
                </TouchableOpacity>
                {taxaReservaCobrada && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {METODOS_TAXA.map(m => {
                      const ativo = taxaReservaMetodo === m.key;
                      return (
                        <TouchableOpacity key={m.key}
                          onPress={() => setTaxaReservaMetodo(ativo ? null : m.key)}
                          style={{
                            paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
                            borderWidth: 1, borderColor: ativo ? C.primary : C.border,
                            backgroundColor: ativo ? C.primary : C.surface,
                          }}>
                          <Text style={{
                            fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11,
                            color: ativo ? '#fff' : C.text2,
                          }}>
                            {m.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </>
            )}
          </Secao>
        )}

        {/* ── 7. Observação ── */}
        <Secao numero={7} titulo="Observação (opcional)">
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
        {/* Resumo, ou o que falta para salvar */}
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 250 }}
          style={{ marginBottom: 10 }}
        >
          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: podeSalvar ? C.text3 : C.rose, textAlign: 'center' }}>
            {podeSalvar
              ? `${clienteSelecionado?.nome?.split(' ')[0]} · ${linhasPreenchidas.length} ${linhasPreenchidas.length === 1 ? 'serviço' : 'serviços'} · ${formatarMoeda(valorTotal)} · ${rotuloDiaCurto(dataChave)} ${hora ?? ''}`
              : (motivoNaoSalva ?? '')}
          </Text>
        </MotiView>

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
                  {idCriado ? 'Salvar serviços' : editId ? 'Salvar alterações' : 'Confirmar Agendamento'}
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
            {!criandoCliente ? (
              <>
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
              </>
            ) : (
              <>
                <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.text }}>
                  Nova cliente
                </Text>
                <TouchableOpacity onPress={() => { setCriandoCliente(false); setNovoClienteNome(''); setNovoClienteTelefone(''); }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.accent }}>
                    Cancelar
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {criandoCliente ? (
            <View style={{ padding: 20, gap: 12 }}>
              <View style={{
                backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                borderRadius: 14, paddingHorizontal: 14,
              }}>
                <TextInput
                  value={novoClienteNome}
                  onChangeText={setNovoClienteNome}
                  placeholder="Nome completo *"
                  placeholderTextColor={C.text4}
                  autoCapitalize="words"
                  autoFocus
                  style={{
                    paddingVertical: 14, fontFamily: 'PlusJakartaSans_400Regular',
                    fontSize: 14, color: C.text,
                  }}
                />
              </View>
              <View style={{
                backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                borderRadius: 14, paddingHorizontal: 14,
              }}>
                <TextInput
                  value={novoClienteTelefone}
                  onChangeText={(v) => setNovoClienteTelefone(maskPhone(v))}
                  maxLength={15}
                  placeholder="Telefone (opcional)"
                  placeholderTextColor={C.text4}
                  keyboardType="phone-pad"
                  style={{
                    paddingVertical: 14, fontFamily: 'PlusJakartaSans_400Regular',
                    fontSize: 14, color: C.text,
                  }}
                />
              </View>
              <TouchableOpacity
                onPress={salvarNovoCliente}
                disabled={!nomeClienteValido(novoClienteNome) || salvandoCliente}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={nomeClienteValido(novoClienteNome) ? ['#2C1654', '#4A2480'] : ['#C4BAD4', '#C4BAD4']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={{ borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}
                >
                  {salvandoCliente
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: '#fff' }}>
                        Cadastrar e selecionar
                      </Text>
                  }
                </LinearGradient>
              </TouchableOpacity>
            </View>
          ) : (
          <FlatList
            data={clientes}
            ListHeaderComponent={() => !podeCadastrarCliente ? null : (
              <TouchableOpacity
                onPress={() => setCriandoCliente(true)}
                style={{
                  backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accent,
                  borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10,
                  marginBottom: 10,
                }}
              >
                <View style={{
                  width: 40, height: 40, borderRadius: 12, backgroundColor: C.accent,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <UserPlus size={18} color="#fff" strokeWidth={2} />
                </View>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.primary }}>
                  Cadastrar nova cliente
                </Text>
              </TouchableOpacity>
            )}
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
          )}
        </View>
      </Modal>
    </View>
  );
}
