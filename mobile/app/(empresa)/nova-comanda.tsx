import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, StatusBar, KeyboardAvoidingView,
  Platform, Linking,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ChevronLeft, ChevronRight, Check, X, Trash2, User,
  Banknote, Zap, CreditCard, Gift, Tag, Receipt, AlertCircle, Send,
} from 'lucide-react-native';
import {
  format, startOfDay, endOfDay, parseISO, addDays, startOfWeek, startOfMonth, endOfMonth,
  addMonths, subMonths, isSameDay, isSameMonth, isToday, eachDayOfInterval,
} from 'date-fns';
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
import { usePermissoes } from '@/lib/permissions';
import { podeMexerNoAgendamento } from '@shared/agendamentos';
import { mensagemErroBanco } from '@shared/erros';
import { supabase } from '@/lib/supabase';
import { invalidarFinanceiro } from '@/lib/invalidarFinanceiro';
import { useQueryClient } from '@tanstack/react-query';
import SuccessCheck from '@/components/SuccessCheck';
import { aplicarDescontoReserva, somarTaxasReservaPagas } from '@shared/taxa-reserva';
import { calcularPacotesAtivosCliente, type PacoteClienteOpt } from '@shared/pacotes';
import {
  marcarAgendamentosFechados, agruparValoresPorAgendamento, cartoesComandaDoDia, type ComandaSoExtras,
} from '@shared/comanda';
import {
  calcularDesconto, resumoComanda, montarPagamentos, parseValorBR, taxaDoSplit, diffItensComanda,
  BANDEIRAS_CARTAO, ROTULOS_BANDEIRA, type ItemComandaOriginal, type ModoDesconto,
} from '@shared/comanda-fechamento';
import {
  fmtTaxa, valorLiquido, OPCOES_PARCELAS, TAXAS_PADRAO, taxasDaEmpresa, type TaxasCartao,
} from '@shared/taxas-cartao';
import { formatarMoeda } from '@shared/moeda';
import {
  carregarBacklogComandas, carregarComandasSoExtrasDoDia, carregarComissoesPagasDosItens,
} from '@shared/comanda-consultas';
import { limitesDias, chaveDiaExibido } from '@shared/periodos';
import { gerarTextoRecibo, linkWhatsAppRecibo } from '@shared/comanda-recibo';

const C = {
  bg: '#F4F1EE', surface: '#FFFFFF', border: '#E8E2DC',
  primary: '#2C1654', primarySoft: '#EEE8F8',
  green: '#0D7E5F', greenSoft: '#EAFAF5',
  amber: '#B45309', amberSoft: '#FEF3E2',
  rose: '#D4608A', roseSoft: '#FDF0F5',
  red: '#EF4444', redSoft: '#FEF2F2',
  text: '#1A1228', text2: '#4A3F5C', text3: '#8878A6', text4: '#B8AECC',
};

const STATUS_COR: Record<string, { bg: string; text: string }> = {
  agendado:   { bg: C.amberSoft, text: C.amber },
  confirmado: { bg: C.primarySoft, text: C.primary },
  concluido:  { bg: C.greenSoft, text: C.green },
  faltou:     { bg: C.redSoft, text: C.red },
};

const METODOS = [
  { key: 'dinheiro', label: 'Dinheiro', bg: '#F0FDF4', cor: '#16A34A' },
  { key: 'pix',      label: 'PIX',      bg: '#EEF2FF', cor: '#4F46E5' },
  { key: 'credito',  label: 'Crédito',  bg: '#FEF3C7', cor: '#D97706' },
  { key: 'debito',   label: 'Débito',   bg: '#FDF2F8', cor: '#9D174D' },
  { key: 'cortesia', label: 'Cortesia', bg: '#F9FAFB', cor: '#6B7280' },
] as const;

type AgDia = {
  id: string;
  data_hora_inicio: string;
  status: string;
  valor: number;
  comanda_id: string | null;
  pacote_cliente_id: string | null;
  cliente:      { id: string; nome: string; telefone?: string } | null;
  profissional: { id: string; nome: string } | null;
  servico:      { id: string; nome: string; preco: number }    | null;
  /** Linhas do atendimento multi-serviço (vazio no legado de serviço único). */
  agendamento_servicos: AgServicoDia[] | null;
};

type AgServicoDia = {
  id: string;
  valor: number;
  ordem: number;
  servico: { id: string; nome: string } | null;
};

type ComandaItem = {
  uid: string;
  tipo: 'agendamento' | 'servico' | 'produto' | 'pacote';
  descricao: string;
  profissional?: string;
  valor: number;
  quantidade: number;
  agendamento_id?: string;
  /** id da linha em `agendamento_servicos` (atendimento multi-serviço) — o valor cobrado volta pra ela. */
  ag_servico_id?: string;
  servico_id?: string;
  produto_id?: string;
  pacote_id?: string;
  profissional_id?: string;
  /** Linha já gravada em `comanda_itens` (edição de comanda fechada). */
  item_id?: string;
  /** Comissão deste extra já paga: profissional e remoção travadas (o banco recusaria — 085). */
  comissao_paga?: boolean;
};

/**
 * Split de pagamento na tela (valor como texto). Reaberto na edição de comanda fechada, carrega
 * como foi gravado (`taxaGravada`, `metodoGravado`, `parcelasGravadas`, `criadoEm`): a taxa da
 * época vale enquanto método e parcelas não mudarem (taxaDoSplit / montarPagamentos), igual ao web.
 */
type Split = {
  metodo: string; valor: string; bandeira?: string; parcelas?: number;
  taxaGravada?: number | null; metodoGravado?: string; parcelasGravadas?: number; criadoEm?: string | null;
};

type ClienteComanda = {
  id: string;
  /** Identidade do cartão (cliente + comanda, ou cliente + 'aberta') — cartoesComandaDoDia. */
  chave: string;
  /** Comanda fechada deste cartão; null = atendimentos ainda abertos. */
  comandaId: string | null;
  nome: string;
  telefone?: string;
  agendamentos: AgDia[];
};

function fmtHora(iso: string) { return format(parseISO(iso), 'HH:mm'); }
function iniciais(nome: string) {
  return nome.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}
function avatarHue(nome: string) {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 360;
  return h;
}
let uidCount = 0;
function uid() { return `tmp_${++uidCount}`; }

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

type Etapa = 'lista' | 'comanda' | 'sucesso';

/** Comanda só com extras que falhou depois de criada (mesmo texto no web). */
const AVISO_COMANDA_PARCIAL = 'A comanda foi criada mas não terminou de gravar — confira em Comanda/Financeiro antes de lançar de novo';

export default function NovaComandaScreen() {
  const insets = useSafeAreaInsets();
  const empresaAtiva = useAuthStore(s => s.empresaAtiva);
  const meuUserId = useAuthStore(s => s.user?.id ?? '');
  const { pode } = usePermissoes();
  const podeOutras = pode('agenda.gerenciar_outras');
  const podeFechar   = pode('comanda.fechar');
  const podeDesconto = pode('comanda.desconto');
  const podeVenderPacote = pode('pacotes.vender');
  const podeEditarFechada = pode('comanda.editar_fechada');
  const empresaId = empresaAtiva?.id ?? null;
  const qc = useQueryClient();

  const [loading, setLoading] = useState(true);
  // Dia da comanda (como no web): semana de 7 dias a partir do domingo, ou visão do mês.
  const [dataComanda, setDataComanda] = useState<Date>(() => new Date());
  const [view, setView] = useState<'semana' | 'mes'>('semana');
  const [semana, setSemana] = useState<Date[]>(() =>
    Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(new Date(), { weekStartsOn: 0 }), i)));
  const [agsMes, setAgsMes] = useState<Map<string, number>>(new Map());
  const [backlog, setBacklog] = useState<{ id: string; data: Date }[]>([]);
  const reqDiaRef = useRef(0);
  const [erroDia, setErroDia] = useState<string | null>(null);
  const [agDia, setAgDia] = useState<AgDia[]>([]);
  // Comandas fechadas no dia sem nenhum atendimento (só extras) — viram cartões próprios, como no web
  const [soExtrasDia, setSoExtrasDia] = useState<ComandaSoExtras[]>([]);
  const [erroSoExtras, setErroSoExtras] = useState<string | null>(null);
  // Edição de comanda já fechada: id da comanda (null = fechamento novo)
  const [comandaExistenteId, setComandaExistenteId] = useState<string | null>(null);
  // Extras como estavam no banco ao reabrir a comanda fechada (base do diff na edição)
  const [itensOriginais, setItensOriginais] = useState<ItemComandaOriginal[]>([]);
  // Contador das aberturas de comanda: resposta de uma abertura antiga é ignorada
  const aberturaRef = useRef(0);
  // Carga da comanda fechada falhou: bloqueia o Salvar (itens/pagamentos não foram lidos)
  const [cargaFalhou, setCargaFalhou] = useState(false);
  // Comanda fechada sendo lida do banco (itens/pagamentos ainda não chegaram)
  const [carregandoComanda, setCarregandoComanda] = useState(false);
  const [taxasReservaPagas, setTaxasReservaPagas] = useState<{ agendamento_id: string; valor: number }[]>([]);
  // Falha ao ler as taxas de reserva pagas do dia: bloqueia fechar/salvar comanda com atendimento
  const [erroTaxasReserva, setErroTaxasReserva] = useState<string | null>(null);
  const [recarregandoTaxas, setRecarregandoTaxas] = useState(false);
  const [servicos, setServicos] = useState<{ id: string; nome: string; preco: number }[]>([]);
  const [produtos, setProdutos] = useState<{ id: string; nome: string; preco_venda: number }[]>([]);
  const [membros, setMembros] = useState<{ id: string; nome: string }[]>([]);
  const [pacotesCat, setPacotesCat] = useState<{ id: string; nome: string; preco: number; validade_dias: number | null }[]>([]);
  const [pacotesClienteAtivos, setPacotesClienteAtivos] = useState<PacoteClienteOpt[]>([]);
  // string = vinculado (sessão existente ou venda nova); null = explicitamente
  // desvinculado nesta sessão (precisa gravar `pacote_cliente_id: null` no
  // fechamento, pra sobrescrever um vínculo que já existia no banco vindo da
  // Agenda); ausente da chave = nunca mexido, fechamento não toca na coluna.
  const [pacoteLinks, setPacoteLinks] = useState<Record<string, string | null>>({});

  const [etapa, setEtapa] = useState<Etapa>('lista');
  const [clienteSel, setClienteSel] = useState<ClienteComanda | null>(null);
  const [itens, setItens] = useState<ComandaItem[]>([]);
  // Desconto digitado em % (padrão) ou R$; grava-se sempre o valor em reais (calcularDesconto).
  const [descontoEntrada, setDescontoEntrada] = useState('');
  const [descontoModo, setDescontoModo] = useState<ModoDesconto>('percentual');
  const [splits, setSplits] = useState<Split[]>([]);
  // Taxas da maquininha da empresa (migration 084); sem as colunas, vale o padrão.
  const [taxas, setTaxas] = useState<TaxasCartao>(TAXAS_PADRAO);
  const [fechando, setFechando] = useState(false);
  const [sucessoData, setSucessoData] = useState<{
    nome: string; valor: number; telefone?: string;
    splits: Split[]; itensCount: number;
    itens: { descricao: string; quantidade: number; valor: number }[];
    dataIso: string;
    desconto: number;          // desconto manual, sem a taxa de reserva
    descontoReserva: number;   // taxa de reserva já paga, descontada separadamente do total
  } | null>(null);
  const [showExtras, setShowExtras] = useState(false);
  // Próximo cliente da fila (comanda aberta + horário já passou) — avança sem precisar voltar
  const [proximoCliente, setProximoCliente] = useState<ClienteComanda | null>(null);
  // Comandas só com extras criadas que falharam numa etapa seguinte (cliente → comanda_id):
  // bloqueiam um novo fechamento da mesma cliente nesta tela (ver falharAposCriar).
  const [comandasParciais, setComandasParciais] = useState<Record<string, string>>({});

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  /** Carrega (ou recarrega, após uma falha no fechamento) os atendimentos do dia e os catálogos. */
  const carregarDia = useCallback(async () => {
    if (!empresaId) return;
    // Só a resposta da chamada mais recente pode alterar o estado (troca rápida de dia).
    const req = ++reqDiaRef.current;
    await Promise.all([
      supabase.from('agendamentos')
        .select(`id, data_hora_inicio, status, valor, comanda_id, pacote_cliente_id,
          cliente:clientes!agendamentos_cliente_id_fkey(id, nome, telefone),
          profissional:users!agendamentos_profissional_id_fkey(id, nome),
          servico:servicos(id, nome, preco),
          agendamento_servicos(id, valor, ordem, servico:servicos(id, nome))`)
        .eq('empresa_id', empresaId)
        .gte('data_hora_inicio', startOfDay(dataComanda).toISOString())
        .lte('data_hora_inicio', endOfDay(dataComanda).toISOString())
        .not('status', 'in', '("cancelado","faltou")')
        .order('data_hora_inicio'),
      supabase.from('servicos').select('id, nome, preco').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      supabase.from('produtos').select('id, nome, preco_venda').eq('empresa_id', empresaId).eq('ativo', true).eq('tipo', 'venda').order('nome'),
      supabase.from('pacotes').select('id, nome, preco, validade_dias').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      // select('*'): as colunas de taxa (migration 084) podem ainda não existir
      supabase.from('empresas').select('*').eq('id', empresaId).single(),
      supabase.from('empresa_membros')
        .select('user_id, users:users!empresa_membros_user_id_fkey(nome)')
        .eq('empresa_id', empresaId).eq('ativo', true),
    ]).then(async ([rAgs, rServs, rProds, rPacotes, rEmpresa, rMembros]) => {
      if (req !== reqDiaRef.current) return;
      if (rAgs.error) {
        setErroDia(mensagemErroBanco(rAgs.error, 'carregar os atendimentos do dia'));
        setAgDia([]);
        setSoExtrasDia([]);
        setLoading(false);
        return;
      }
      setErroDia(null);
      setTaxas(taxasDaEmpresa(rEmpresa.data as Record<string, unknown> | null));
      const agsDoDia = (rAgs.data ?? []) as unknown as AgDia[];

      // Taxas de reserva já pagas — buscadas só depois de sabermos os
      // agendamentos do dia, e escopadas a esses ids via `.in(...)`. NUNCA
      // buscar sem esse filtro: o PostgREST limita a 1000 linhas por
      // requisição por padrão e, sem ORDER BY, a truncagem mantém um
      // recorte arbitrário (na prática, as linhas mais antigas) e descarta
      // o resto — é exatamente aí que a taxa paga HOJE cairia sem este
      // filtro, zerando o desconto em silêncio.
      const agIds = agsDoDia.map(ag => ag.id);
      const dia = chaveDiaExibido(dataComanda);
      const [rTaxasReserva, rSoExtras] = await Promise.all([
        agIds.length > 0
          ? supabase.from('taxas_reserva').select('agendamento_id, valor')
              .eq('empresa_id', empresaId).eq('status', 'pago').in('agendamento_id', agIds)
          : Promise.resolve({ data: [] as { agendamento_id: string; valor: number }[], error: null }),
        // Comandas fechadas no dia só com extras (sem atendimento): cartões próprios, como no web.
        carregarComandasSoExtrasDoDia(supabase, empresaId, limitesDias(dia, dia))
          .then(lista => ({ lista, erro: null as string | null }))
          .catch((e: unknown) => ({
            lista: [] as ComandaSoExtras[],
            erro: mensagemErroBanco({ message: e instanceof Error ? e.message : '' }, 'carregar as comandas do dia'),
          })),
      ]);

      if (req !== reqDiaRef.current) return;

      // Sem as taxas pagas o desconto da reserva viraria R$ 0 em silêncio (cliente cobrado a
      // mais): guarda o erro, que BLOQUEIA fechar/salvar comanda com atendimento (bloqueioTaxaReserva).
      if (rTaxasReserva.error) {
        console.error('Erro ao buscar taxas de reserva pagas:', rTaxasReserva.error.message);
        setErroTaxasReserva(mensagemErroBanco(rTaxasReserva.error, 'carregar as taxas de reserva pagas'));
      } else {
        setErroTaxasReserva(null);
      }
      setRecarregandoTaxas(false);

      setAgDia(agsDoDia);
      setSoExtrasDia(rSoExtras.lista);
      setErroSoExtras(rSoExtras.erro);
      setServicos((rServs.data ?? []) as any[]);
      setProdutos((rProds.data ?? []) as any[]);
      setMembros(((rMembros.data ?? []) as any[]).map(m => ({ id: m.user_id as string, nome: (m.users?.nome as string | undefined) ?? 'Profissional' })));
      setPacotesCat((rPacotes.data ?? []) as { id: string; nome: string; preco: number; validade_dias: number | null }[]);
      setTaxasReservaPagas((rTaxasReserva.data ?? []) as { agendamento_id: string; valor: number }[]);
      setLoading(false);
    });
  }, [empresaId, dataComanda]);

  useEffect(() => { carregarDia(); }, [carregarDia]);

  // Trocar de dia fecha a comanda aberta e volta para a lista.
  // A lista antiga some na hora: nunca aparece sob o rótulo do novo dia.
  useEffect(() => {
    // Abertura de comanda fechada ainda em voo não pode reabrir a tela depois da troca de dia.
    aberturaRef.current++;
    setClienteSel(null);
    setComandaExistenteId(null);
    setCarregandoComanda(false);
    setEtapa('lista');
    setLoading(true);
    setAgDia([]);
    setSoExtrasDia([]);
    setErroSoExtras(null);
    setTaxasReservaPagas([]);
    setErroTaxasReserva(null);
    setRecarregandoTaxas(false);
    setErroDia(null);
  }, [dataComanda]);

  /**
   * Relê só as taxas de reserva pagas dos atendimentos do dia ("Tentar de novo" do bloqueio),
   * sem sair da comanda — mesmo comportamento do web. Resposta de outro dia é ignorada.
   */
  async function recarregarTaxasReserva() {
    if (!empresaId) return;
    const req = reqDiaRef.current;
    const agIds = agDia.map(ag => ag.id);
    setRecarregandoTaxas(true);
    const r = agIds.length > 0
      ? await supabase.from('taxas_reserva').select('agendamento_id, valor')
          .eq('empresa_id', empresaId).eq('status', 'pago').in('agendamento_id', agIds)
      : { data: [] as { agendamento_id: string; valor: number }[], error: null };
    if (req !== reqDiaRef.current) return;
    setRecarregandoTaxas(false);
    if (r.error) {
      setErroTaxasReserva(mensagemErroBanco(r.error, 'carregar as taxas de reserva pagas'));
      return;
    }
    setTaxasReservaPagas((r.data ?? []) as { agendamento_id: string; valor: number }[]);
    setErroTaxasReserva(null);
  }

  /** Comandas não fechadas (atendimentos passados sem comanda), de qualquer dia. Erro -> lista vazia. */
  const carregarBacklog = useCallback(async () => {
    if (!empresaId) return;
    try {
      const rows = await carregarBacklogComandas(supabase, empresaId, new Date().toISOString());
      setBacklog(rows.map(r => ({ id: r.id, data: parseISO(r.data_hora_inicio) })));
    } catch {
      setBacklog([]);
    }
  }, [empresaId]);

  useEffect(() => { carregarBacklog(); }, [carregarBacklog]);

  // Contagem de atendimentos por dia para a visão mensal
  useEffect(() => {
    if (!empresaId || view !== 'mes') return;
    let ativo = true;
    supabase.from('agendamentos')
      .select('data_hora_inicio')
      .eq('empresa_id', empresaId)
      .not('status', 'in', '("cancelado","faltou")')
      .gte('data_hora_inicio', startOfMonth(dataComanda).toISOString())
      .lte('data_hora_inicio', endOfMonth(dataComanda).toISOString())
      .then(({ data: rows }: { data: { data_hora_inicio: string }[] | null }) => {
        if (!ativo) return;
        const map = new Map<string, number>();
        (rows ?? []).forEach(r => {
          const k = format(parseISO(r.data_hora_inicio), 'yyyy-MM-dd');
          map.set(k, (map.get(k) ?? 0) + 1);
        });
        setAgsMes(map);
      });
    return () => { ativo = false; };
  }, [view, dataComanda, empresaId]);

  /** Move a seleção um dia por vez; realoca a faixa da semana quando o dia sai da semana visível */
  function navDia(dir: number) {
    const novaData = addDays(dataComanda, dir);
    setDataComanda(novaData);
    if (!semana.some(s => isSameDay(s, novaData)))
      setSemana(Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(novaData, { weekStartsOn: 0 }), i)));
  }
  function navMes(dir: number) {
    setDataComanda(d => dir > 0 ? addMonths(d, 1) : subMonths(d, 1));
  }
  function selecionarDia(d: Date) {
    setDataComanda(d);
    setView('semana');
    if (!semana.some(s => isSameDay(s, d)))
      setSemana(Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(d, { weekStartsOn: 0 }), i)));
  }

  // Um cartão por comanda fechada (a mesma cliente pode ter duas no dia) + os atendimentos
  // ainda abertos da cliente + comandas só com extras — mesma regra do web (shared/comanda).
  const clientesDia = useMemo<ClienteComanda[]>(() =>
    cartoesComandaDoDia(agDia, soExtrasDia).map(c => ({
      id: c.clienteId, chave: c.chave, nome: c.nome, telefone: c.telefone,
      agendamentos: c.agendamentos, comandaId: c.comandaId,
    })), [agDia, soExtrasDia]);

  useEffect(() => {
    if (!clienteSel || clienteSel.id === '__sem__' || !empresaId) { setPacotesClienteAtivos([]); return; }
    supabase.from('pacote_clientes')
      .select('id, data_validade, pacote:pacotes(nome, controla_sessoes, servicos:pacote_servicos(servico_id, quantidade)), uso:pacote_uso(id, created_at, agendamento_id, servico:servicos(nome))')
      .eq('empresa_id', empresaId)
      .eq('cliente_id', clienteSel.id)
      .eq('status', 'ativo')
      .then(({ data }: { data: any[] | null }) => {
        setPacotesClienteAtivos(calcularPacotesAtivosCliente((data ?? []) as any[], format(new Date(), 'yyyy-MM-dd')));
      });
  }, [clienteSel?.id, empresaId]);

  /** Soma o valor de todos os agendamentos já concluídos (comandas fechadas) hoje */
  const totalDia = useMemo(
    () => agDia.filter(ag => ag.status === 'concluido').reduce((s, ag) => s + ag.valor, 0),
    [agDia],
  );

  /** Próximo cliente da fila: comanda ainda aberta e horário do atendimento já passou */
  function proximoClienteAberto(excluirChave: string): ClienteComanda | null {
    const agora = new Date();
    return clientesDia.find(c =>
      c.comandaId === null &&
      c.chave !== excluirChave &&
      !temAtendimentoDeOutra(c) &&
      c.agendamentos.some(a => a.status !== 'concluido' || !a.comanda_id) &&
      c.agendamentos.some(a => parseISO(a.data_hora_inicio) <= agora)
    ) ?? null;
  }

  // Avança automaticamente para a próxima comanda em aberto após fechar a atual
  useEffect(() => {
    if (etapa !== 'sucesso' || !proximoCliente) return;
    const t = setTimeout(() => {
      abrirComanda(proximoCliente);
      setSucessoData(null);
      setProximoCliente(null);
    }, 1800);
    return () => clearTimeout(t);
  }, [etapa, proximoCliente]);

  /**
   * Atendimento de outra profissional sem 'agenda.gerenciar_outras': o banco recusaria o UPDATE
   * do agendamento no fechamento (e a comanda já teria sido inserida — ficaria órfã). Trava antes.
   */
  function temAtendimentoDeOutra(c: ClienteComanda): boolean {
    return c.agendamentos.some(a => !podeMexerNoAgendamento(a.profissional?.id, meuUserId, podeOutras));
  }

  function abrirComanda(cliente: ClienteComanda) {
    setClienteSel(cliente);
    setComandaExistenteId(null);
    aberturaRef.current++;
    setCargaFalhou(false);
    setCarregandoComanda(false);
    setItensOriginais([]);
    setShowExtras(false);
    setDescontoEntrada('');
    setDescontoModo('percentual');
    setSplits([]);

    const linksIniciais: Record<string, string> = {};
    for (const ag of cliente.agendamentos) {
      if (ag.pacote_cliente_id) linksIniciais[ag.id] = ag.pacote_cliente_id;
    }
    setPacoteLinks(linksIniciais);

    // Um atendimento "concluído" sem comanda_id (ex.: marcado direto pelo
    // atalho de status, sem nunca passar por uma comanda) precisa continuar
    // aparecendo aqui pra poder ser cobrado — senão a comanda nasce vazia em
    // R$0. Só sai da lista quando já está vinculado a uma comanda de verdade.
    // Atendimento multi-serviço vira uma linha por serviço (com ag_servico_id),
    // igual ao web — o valor cobrado de cada linha volta pra agendamento_servicos.
    setItens(
      cliente.agendamentos
        .filter(ag => ag.status !== 'concluido' || !ag.comanda_id)
        .flatMap<ComandaItem>(ag => {
          const coberto = !!ag.pacote_cliente_id;
          const linhas = [...(ag.agendamento_servicos ?? [])].sort((a, b) => a.ordem - b.ordem);
          if (linhas.length > 0) {
            return linhas.map(s => ({
              uid: uid(), tipo: 'agendamento' as const, descricao: s.servico?.nome ?? 'Serviço',
              profissional: ag.profissional?.nome, valor: coberto ? 0 : Number(s.valor), quantidade: 1,
              agendamento_id: ag.id, ag_servico_id: s.id, servico_id: s.servico?.id, profissional_id: ag.profissional?.id,
            }));
          }
          return [{
            uid: uid(), tipo: 'agendamento' as const, descricao: ag.servico?.nome ?? 'Serviço',
            profissional: ag.profissional?.nome, valor: coberto ? 0 : Number(ag.valor), quantidade: 1,
            agendamento_id: ag.id, servico_id: ag.servico?.id, profissional_id: ag.profissional?.id,
          }];
        }),
    );
    setEtapa('comanda');
  }

  /** Volta para a lista do dia; uma abertura de comanda fechada ainda em voo é descartada. */
  function voltarParaLista() {
    aberturaRef.current++;
    setCarregandoComanda(false);
    setEtapa('lista');
  }

  /**
   * Reabre uma comanda já fechada para edição — mesma sequência do web (`abrirComandaFechada`):
   * só os atendimentos DESTA comanda, desconto manual reaberto em R$, extras com `item_id` (base
   * do diff) e `comissao_paga`, pagamentos com a taxa/data de quando foram gravados. Toda resposta
   * de uma abertura que já não é a mais recente é ignorada (aberturaRef).
   */
  async function abrirComandaFechada(cliente: ClienteComanda) {
    const abertura = ++aberturaRef.current;
    const comandaId = cliente.comandaId;
    if (!comandaId || !empresaId) { abrirComanda(cliente); return; }

    setClienteSel(cliente);
    setComandaExistenteId(comandaId);
    // Zera tudo ANTES de ler: nada da comanda anterior pode vazar para esta.
    setItens([]); setItensOriginais([]); setCargaFalhou(false); setCarregandoComanda(true);
    setDescontoEntrada(''); setDescontoModo('valor'); setSplits([]); setShowExtras(false);

    // Só os atendimentos DESTA comanda: a mesma cliente pode ter mais de uma
    // comanda no dia, e misturá-las regravaria valores/pagamentos da outra.
    // Comanda só com extras não tem atendimento nenhum (lista vazia).
    const agsDaComanda = cliente.agendamentos.filter(ag => ag.comanda_id === comandaId);
    // Vínculo de pacote semeado do banco só para exibição (vincular/desvincular fica fora da edição).
    const linksExistentes: Record<string, string> = {};
    for (const ag of agsDaComanda) {
      if (ag.pacote_cliente_id) linksExistentes[ag.id] = ag.pacote_cliente_id;
    }
    setPacoteLinks(linksExistentes);

    const agItems: ComandaItem[] = agsDaComanda.flatMap<ComandaItem>(ag => {
      const linhas = [...(ag.agendamento_servicos ?? [])].sort((a, b) => a.ordem - b.ordem);
      if (linhas.length > 0) {
        return linhas.map(s => ({
          uid: uid(), tipo: 'agendamento' as const, descricao: s.servico?.nome ?? 'Serviço',
          profissional: ag.profissional?.nome, valor: Number(s.valor), quantidade: 1,
          agendamento_id: ag.id, ag_servico_id: s.id, servico_id: s.servico?.id, profissional_id: ag.profissional?.id,
        }));
      }
      return [{
        uid: uid(), tipo: 'agendamento' as const, descricao: ag.servico?.nome ?? 'Serviço',
        profissional: ag.profissional?.nome, valor: Number(ag.valor), quantidade: 1,
        agendamento_id: ag.id, servico_id: ag.servico?.id, profissional_id: ag.profissional?.id,
      }];
    });
    setEtapa('comanda');

    const [rCmd, rItens, rPags] = await Promise.all([
      supabase.from('comandas').select('desconto, desconto_reserva').eq('id', comandaId).eq('empresa_id', empresaId).single(),
      supabase.from('comanda_itens')
        .select('id,tipo,descricao,servico_id,produto_id,pacote_id,profissional_id,quantidade,valor_unit')
        .eq('comanda_id', comandaId).order('created_at'),
      // taxa_perc e created_at: o pagamento reaberto mantém a taxa e a data de quando foi lançado
      supabase.from('pagamentos').select('metodo,valor,bandeira,parcelas,taxa_perc,created_at')
        .eq('comanda_id', comandaId).order('created_at'),
    ]);
    if (abertura !== aberturaRef.current) return;
    // Sem os dados gravados não dá para editar com segurança (salvar zeraria desconto/itens/
    // pagamentos): avisa, trava o Salvar e volta para a lista.
    const errCarga = rCmd.error ?? rItens.error ?? rPags.error;
    if (errCarga) {
      setItens([]); setItensOriginais([]); setCargaFalhou(true); setCarregandoComanda(false);
      Alert.alert('Erro', mensagemErroBanco(errCarga, 'abrir a comanda'));
      setEtapa('lista');
      return;
    }
    const cmd = rCmd.data as { desconto: number | null; desconto_reserva: number | null } | null;

    // `comandas.desconto` guarda manual + taxa de reserva; reabre só a parte manual, em R$.
    const descontoManual = Math.max(Number(cmd?.desconto ?? 0) - Number(cmd?.desconto_reserva ?? 0), 0);

    const extras: ComandaItem[] = ((rItens.data ?? []) as any[]).map(item => ({
      uid: uid(), tipo: item.tipo as 'servico' | 'produto' | 'pacote',
      item_id: item.id as string,
      descricao: item.descricao ?? '—',
      valor: Number(item.valor_unit), quantidade: Number(item.quantidade),
      servico_id: item.servico_id ?? undefined,
      produto_id: item.produto_id ?? undefined,
      pacote_id: item.pacote_id ?? undefined,
      profissional_id: item.profissional_id ?? undefined,
      profissional: item.profissional_id ? membros.find(m => m.id === item.profissional_id)?.nome : undefined,
    }));

    // Extras com comissão já paga ficam travados (profissional e remoção) — o banco recusaria (085).
    // Falha na leitura (fora "sem a 085") = carga falha, igual ao web: sem saber o que está pago,
    // salvar destravaria itens pagos e o trigger recusaria no meio do salvamento.
    let pagas: Set<string>;
    try {
      pagas = await carregarComissoesPagasDosItens(supabase, extras.map(e => e.item_id!));
    } catch (e) {
      if (abertura !== aberturaRef.current) return;
      setItens([]); setItensOriginais([]); setSplits([]); setDescontoEntrada('');
      setCargaFalhou(true); setCarregandoComanda(false);
      Alert.alert('Erro', mensagemErroBanco(e as { code?: string; message?: string }, 'abrir a comanda'));
      setEtapa('lista');
      return;
    }
    if (abertura !== aberturaRef.current) return;
    for (const e of extras) e.comissao_paga = pagas.has(e.item_id!);

    setItensOriginais(extras.map(e => ({
      item_id: e.item_id!, valor: e.valor, quantidade: e.quantidade, profissional_id: e.profissional_id ?? null,
    })));
    setDescontoEntrada(descontoManual > 0 ? descontoManual.toFixed(2).replace('.', ',') : '');
    setItens([...agItems, ...extras]);
    setSplits(((rPags.data ?? []) as any[]).map(p => ({
      metodo:   p.metodo,
      valor:    Number(p.valor).toFixed(2).replace('.', ','),
      bandeira: p.bandeira ?? undefined,
      parcelas: p.parcelas ?? 1,
      taxaGravada:      p.taxa_perc == null ? null : Number(p.taxa_perc),
      metodoGravado:    p.metodo,
      parcelasGravadas: p.parcelas ?? 1,
      criadoEm:         p.created_at ?? null,
    })));
    setCarregandoComanda(false);
  }

  function adicionarServico(s: { id: string; nome: string; preco: number }) {
    setItens(prev => [...prev, { uid: uid(), tipo: 'servico', descricao: s.nome, valor: s.preco, quantidade: 1, servico_id: s.id }]);
    setShowExtras(false);
  }
  function adicionarProduto(p: { id: string; nome: string; preco_venda: number }) {
    setItens(prev => [...prev, { uid: uid(), tipo: 'produto', descricao: p.nome, valor: p.preco_venda, quantidade: 1, produto_id: p.id }]);
    setShowExtras(false);
  }
  function adicionarPacote(p: { id: string; nome: string; preco: number }) {
    setItens(prev => [...prev, { uid: uid(), tipo: 'pacote', descricao: p.nome, valor: p.preco, quantidade: 1, pacote_id: p.id }]);
    setShowExtras(false);
  }
  /**
   * Só no fechamento novo: na edição de comanda fechada o atendimento não sai (continuaria
   * concluído com esta comanda_id, contando na receita) — igual ao web.
   */
  const emEdicao = comandaExistenteId !== null;
  const podeTirarAtendimento = !emEdicao;

  function removerItem(u: string) { setItens(prev => prev.filter(i => i.uid !== u)); }

  /** Tira o atendimento da comanda (todas as linhas dele) e limpa o vínculo de pacote; o agendamento continua aberto. */
  function tirarAtendimento(agendamentoId: string) {
    Alert.alert('Tirar da comanda', 'O agendamento continua aberto.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Tirar', style: 'destructive', onPress: () => {
        setItens(prev => prev.filter(i => i.agendamento_id !== agendamentoId));
        setPacoteLinks(prev => {
          const { [agendamentoId]: _removido, ...resto } = prev;
          return resto;
        });
      } },
    ]);
  }

  // Mesma leitura de valor dos pagamentos (parseValorBR): '1.234,56' não vira 1,234.
  // Texto sem nenhum dígito mantém o valor anterior; '0' zera de propósito.
  function atualizarValor(u: string, texto: string) {
    if (!/\d/.test(texto)) return;
    const v = parseValorBR(texto);
    setItens(prev => prev.map(i => i.uid === u ? { ...i, valor: v } : i));
  }
  function atualizarQtd(u: string, delta: number) {
    setItens(prev => prev.map(i => i.uid === u ? { ...i, quantidade: Math.max(1, i.quantidade + delta) } : i));
  }
  function atualizarProfissional(u: string, profId: string) {
    const m = membros.find(x => x.id === profId);
    setItens(prev => prev.map(i => i.uid === u ? { ...i, profissional_id: profId || undefined, profissional: m?.nome } : i));
  }

  function vincularPacote(agendamentoId: string, pacoteClienteId: string) {
    setPacoteLinks(prev => ({ ...prev, [agendamentoId]: pacoteClienteId }));
    setItens(prev => prev.map(i => i.agendamento_id === agendamentoId ? { ...i, valor: 0 } : i));
  }

  function desvincularPacote(agendamentoId: string) {
    // NÃO apagar a chave — precisa ficar como `null` explícito, distinto de
    // "nunca mexido" (chave ausente). Um agendamento pode chegar na comanda
    // já com `pacote_cliente_id` gravado no banco (vínculo feito na Agenda);
    // se a chave só fosse apagada, o fechamento cairia no update em lote
    // (que não toca em `pacote_cliente_id`) e o vínculo antigo sobreviveria
    // no banco — cobrando o valor cheio na comanda E consumindo a sessão do
    // pacote de qualquer forma via trigger. `null` força o update individual
    // que sobrescreve a coluna.
    setPacoteLinks(prev => ({ ...prev, [agendamentoId]: null }));
    const ag = agDia.find(a => a.id === agendamentoId);
    if (!ag) return;
    // Restaura o valor de tabela: por linha no multi-serviço, total no legado.
    setItens(prev => prev.map(i => {
      if (i.agendamento_id !== agendamentoId) return i;
      if (i.ag_servico_id) {
        const s = (ag.agendamento_servicos ?? []).find(x => x.id === i.ag_servico_id);
        return s ? { ...i, valor: Number(s.valor) } : i;
      }
      return { ...i, valor: Number(ag.valor) };
    }));
  }

  // ── Totais pela regra única (shared/comanda-fechamento.ts), igual ao web
  const subtotal  = itens.reduce((s, i) => s + i.valor * i.quantidade, 0);
  const descontoEntradaN = parseValorBR(descontoEntrada);
  const { valor: descontoN, erro: erroDesconto } = calcularDesconto(subtotal, descontoEntradaN, descontoModo);
  const agendamentoIdsNaComanda = itens.filter(i => i.agendamento_id).map(i => i.agendamento_id!);
  const descontoReservaN = somarTaxasReservaPagas(agendamentoIdsNaComanda, taxasReservaPagas);
  const { descontoReservaAplicado } = aplicarDescontoReserva(subtotal, descontoN, descontoReservaN);
  // Splits já convertidos em número (aceita '10,50', '10.50', '1.234,56', 'R$ 10,00')
  const splitsNumericos = splits.map(s => ({ ...s, valor: parseValorBR(s.valor) }));
  const resumo = resumoComanda({
    subtotal, desconto: descontoN, erroDesconto, descontoReserva: descontoReservaAplicado, splits: splitsNumericos,
  });
  const { total, recebido, falta, troco } = resumo;
  const comandaParcialAberta = !!clienteSel && !!comandasParciais[clienteSel.id];
  // Botão principal: "Fechar comanda" (comanda.fechar) ou "Salvar alterações" (comanda.editar_fechada),
  // mesma regra do web (resumo.podeFechar, itens > 0, carga da comanda fechada ok).
  const podeAcaoPrincipal = emEdicao ? podeEditarFechada : podeFechar;
  // Taxas de reserva não lidas + comanda com atendimento: o desconto da reserva sairia R$ 0
  // (cobrança a mais). Bloqueia fechar/salvar até recarregar — mesma regra do web.
  const bloqueioTaxaReserva = erroTaxasReserva && agendamentoIdsNaComanda.length > 0
    ? `Não foi possível ler as taxas de reserva pagas — sem elas o desconto da reserva sairia R$ 0. Tente de novo antes de fechar. (${erroTaxasReserva})`
    : null;
  const botaoDesabilitado = fechando || itens.length === 0 || !podeAcaoPrincipal || !resumo.podeFechar
    || !!bloqueioTaxaReserva
    || (emEdicao ? (cargaFalhou || carregandoComanda) : comandaParcialAberta);

  function adicionarSplit(metodo: string) {
    setSplits(prev => [...prev, { metodo, valor: falta > 0 ? falta.toFixed(2).replace('.', ',') : '' }]);
  }
  function removerSplit(idx: number) { setSplits(prev => prev.filter((_, i) => i !== idx)); }
  function atualizarSplitBandeira(idx: number, bandeira: string) {
    setSplits(prev => prev.map((s, i) => i === idx ? { ...s, bandeira } : s));
  }
  function atualizarSplitParcelas(idx: number, parcelas: number) {
    setSplits(prev => prev.map((s, i) => i === idx ? { ...s, parcelas } : s));
  }

  /**
   * Falha no fechamento: avisa com a etapa, libera o botão e recarrega o dia (o que já foi
   * gravado aparece como está no banco). Nunca mostra a tela de sucesso.
   */
  function falharFechamento(
    etapa: string,
    erro: { code?: string | null; message?: string | null } | string | null,
    acao = 'fechar a comanda',
  ) {
    const msg = typeof erro === 'string' ? erro : mensagemErroBanco(erro, acao);
    Alert.alert('Erro', `${msg} (etapa: ${etapa})`);
    setFechando(false);
    carregarDia();
  }

  /**
   * Grava o valor cobrado de volta nos atendimentos — mesma lógica do
   * `persistirValoresAgendamento` do web: primeiro `agendamentos.valor` (total
   * do grupo) junto com `extraUpdate` ({ status: 'concluido', comanda_id }) e o
   * vínculo de pacote, tudo no MESMO UPDATE do status; depois cada
   * `agendamento_servicos.valor` (multi-serviço). `.select('id')` + contagem: UPDATE barrado
   * por RLS devolve sucesso com 0 linhas. Retorna a falha (com etapa) ou null.
   */
  async function persistirValoresAgendamento(
    extraUpdate: Record<string, unknown>,
    pacoteLinksPorAgendamento: Record<string, string | null>,
  ): Promise<{ etapa: string; erro: { code?: string | null; message?: string | null } | string } | null> {
    const grupos = agruparValoresPorAgendamento(itens, pacoteLinksPorAgendamento);
    // Edição de comanda fechada chama sem `comanda_id` (só regrava o valor) — textos próprios, como no web.
    const ehFechamento = 'comanda_id' in extraUpdate;
    const etapaAg = ehFechamento ? 'concluir atendimento' : 'valor do atendimento';
    const erroAg = ehFechamento
      ? 'Não foi possível vincular o atendimento à comanda. Verifique sua permissão.'
      : 'Não foi possível salvar o valor do atendimento. Verifique sua permissão.';
    const erroLinhas = ehFechamento
      ? 'O atendimento foi fechado, mas os valores dos serviços não foram salvos — abra a comanda no computador e confira os valores.'
      : 'O valor do atendimento foi salvo, mas os valores dos serviços não — abra a comanda de novo e confira os valores.';
    // Ordem por atendimento: PRIMEIRO `agendamentos` (valor, status, comanda_id, vínculo),
    // DEPOIS `agendamento_servicos`. Ao contrário, uma falha no atendimento deixava as linhas
    // zeradas pelo pacote sem o vínculo gravado (item reabria R$ 0 sem pacote = receita perdida).
    // Os triggers (065/075/078) não leem `agendamento_servicos`.
    for (const g of grupos) {
      // `undefined` = agendamento fora do mapa de vínculos, não mexe na coluna.
      // `null` (desvínculo explícito) ou string (vínculo) SÃO gravados — por
      // isso o teste é presença (!== undefined), não truthiness.
      const vinculo = g.pacoteClienteId !== undefined ? { pacote_cliente_id: g.pacoteClienteId } : {};
      const { data, error } = await supabase.from('agendamentos')
        .update({ valor: g.novoValorTotal, ...extraUpdate, ...vinculo })
        .eq('id', g.agendamentoId).eq('empresa_id', empresaId!).select('id');
      if (error) return { etapa: etapaAg, erro: error };
      if (!data || data.length === 0) return { etapa: etapaAg, erro: erroAg };
      for (const linha of g.linhasServico) {
        const { data: dLinha, error: eLinha } = await supabase.from('agendamento_servicos')
          .update({ valor: linha.valor }).eq('id', linha.agServicoId).eq('empresa_id', empresaId!)
          .select('id');
        if (eLinha || !dLinha || dLinha.length === 0) {
          return { etapa: 'valor dos serviços', erro: erroLinhas };
        }
      }
    }
    return null;
  }

  /**
   * Salva a edição de uma comanda já fechada — mesma ordem do `editarComanda` do web:
   * 1) extras por diferença (diffItensComanda: UPDATE/DELETE por id, INSERT dos novos — nunca
   *    apaga tudo, a comissão do serviço extra mora no item, 085). PRIMEIRO porque é a etapa
   *    que o trigger da 085 pode recusar ('Comissão deste serviço já foi paga'): a recusa
   *    aborta antes de mexer no total/desconto da comanda e nos valores dos atendimentos;
   * 2) UPDATE de `comandas` (total, desconto, desconto_reserva), conferindo linhas afetadas;
   * 3) valor dos atendimentos (persistirValoresAgendamento sem status/comanda_id — o trigger
   *    075 acerta a comissão);
   * 4) apaga os pagamentos, confere que não sobrou nenhum e reinsere (montarPagamentos mantém
   *    a taxa e a data dos reabertos não alterados) — sempre por último.
   * Qualquer falha avisa com a etapa e trava o Salvar (cargaFalhou): parte pode já ter sido
   * gravada e a base do diff ficou velha — é preciso reabrir a comanda para não duplicar itens.
   */
  async function editarComanda(comandaId: string) {
    if (cargaFalhou || carregandoComanda) {
      Alert.alert('Comanda não carregada', 'Não foi possível ler a comanda — volte e abra-a de novo antes de salvar.');
      return;
    }
    if (!clienteSel || !empresaId || fechando || !podeEditarFechada) return;
    if (bloqueioTaxaReserva) { Alert.alert('Não é possível salvar', bloqueioTaxaReserva); return; }
    setFechando(true);
    const falhar = (etapaFalha: string, erro: Parameters<typeof falharFechamento>[1]) => {
      setCargaFalhou(true);
      const msg = typeof erro === 'string' ? erro : mensagemErroBanco(erro, 'salvar a comanda');
      falharFechamento(etapaFalha, `${msg} Volte e abra a comanda de novo para conferir.`, 'salvar a comanda');
    };

    // 1. Itens extras por diferença
    const { inserir, atualizar, apagar } = diffItensComanda(itensOriginais, itens
      .filter(i => i.tipo !== 'agendamento')
      .map(i => ({ item_id: i.item_id, tipo: i.tipo as 'servico' | 'produto' | 'pacote', descricao: i.descricao,
        servico_id: i.servico_id, produto_id: i.produto_id, pacote_id: i.pacote_id,
        profissional_id: i.profissional_id ?? null, quantidade: i.quantidade, valor: i.valor })));

    for (const id of apagar) {
      const { data, error } = await supabase.from('comanda_itens').delete()
        .eq('id', id).eq('empresa_id', empresaId).select('id');
      if (error) { falhar('remover item', mensagemErroBanco(error, 'remover o item da comanda')); return; }
      if (!data || data.length === 0) { falhar('remover item', 'Não foi possível remover o item da comanda. Verifique sua permissão.'); return; }
    }
    for (const u of atualizar) {
      const { data, error } = await supabase.from('comanda_itens')
        .update({ valor_unit: u.valor_unit, quantidade: u.quantidade, profissional_id: u.profissional_id })
        .eq('id', u.item_id).eq('empresa_id', empresaId).select('id');
      if (error) { falhar('salvar item', mensagemErroBanco(error, 'salvar o item da comanda')); return; }
      if (!data || data.length === 0) { falhar('salvar item', 'Não foi possível salvar o item da comanda. Verifique sua permissão.'); return; }
    }
    if (inserir.length > 0) {
      const { error } = await supabase.from('comanda_itens').insert(inserir.map(i => ({
        comanda_id: comandaId, empresa_id: empresaId, tipo: i.tipo, descricao: i.descricao,
        servico_id: i.servico_id ?? null, produto_id: i.produto_id ?? null, pacote_id: i.pacote_id ?? null,
        profissional_id: i.profissional_id ?? null, quantidade: i.quantidade, valor_unit: i.valor,
      })));
      if (error) { falhar('incluir item', mensagemErroBanco(error, 'salvar os itens da comanda')); return; }
    }

    // 2. Comanda (.select: RLS barrando devolve 0 linhas sem erro)
    const { data: cmdAtualizada, error: errCmd } = await supabase.from('comandas')
      .update({ valor_total: subtotal, desconto: descontoN + descontoReservaAplicado, desconto_reserva: descontoReservaAplicado })
      .eq('id', comandaId).eq('empresa_id', empresaId).select('id');
    if (errCmd) { falhar('salvar comanda', errCmd); return; }
    if (!cmdAtualizada || cmdAtualizada.length === 0) {
      falhar('salvar comanda', 'Não foi possível salvar a comanda. Verifique sua permissão.'); return;
    }

    // 3. Valor editado dos procedimentos no próprio atendimento (sem status/comanda_id/vínculo)
    const falhaValor = await persistirValoresAgendamento({}, {});
    if (falhaValor) { falhar(falhaValor.etapa, falhaValor.erro); return; }

    // 4. Pagamentos: apaga, confere que apagou (sem a policy da 075 o DELETE falha em silêncio
    //    e os pagamentos duplicariam), reinsere pela regra única.
    const { error: errPagDel } = await supabase.from('pagamentos').delete()
      .eq('comanda_id', comandaId).select('id');
    if (errPagDel) { falhar('substituir pagamentos', mensagemErroBanco(errPagDel, 'substituir os pagamentos')); return; }
    const { count: restantes, error: errConf } = await supabase.from('pagamentos')
      .select('id', { count: 'exact', head: true }).eq('comanda_id', comandaId);
    if (errConf) { falhar('substituir pagamentos', mensagemErroBanco(errConf, 'conferir os pagamentos')); return; }
    if ((restantes ?? 0) > 0) {
      falhar('substituir pagamentos', 'Não foi possível substituir os pagamentos (permissão). Aplique a migration 075 no banco.');
      return;
    }
    const linhasPag = montarPagamentos(splitsNumericos, { empresaId, comandaId, taxas, total: resumo.total });
    if (linhasPag.length > 0) {
      const rPag = await supabase.from('pagamentos').insert(linhasPag);
      if (rPag.error) {
        falhar('pagamentos', `${mensagemErroBanco(rPag.error, 'lançar o pagamento')} A comanda ficou sem pagamento — lance o pagamento de novo.`);
        return;
      }
    }

    setFechando(false);
    // Receita, comissão, taxas de cartão e alerta de comandas abertas mudaram: atualiza tudo.
    invalidarFinanceiro(qc);
    qc.invalidateQueries({ queryKey: ['agenda-dia'] });
    carregarBacklog();
    carregarDia();
    setComandaExistenteId(null);
    setProximoCliente(null);
    setSucessoData({
      nome: clienteSel.nome, valor: total, telefone: clienteSel.telefone,
      splits: (() => {
        const lancados = splits.filter(s => parseValorBR(s.valor) > 0);
        return lancados.length === 0 && resumo.cortesiaAutomatica ? [{ metodo: 'cortesia', valor: '0,00' }] : lancados;
      })(),
      itensCount: itens.length,
      itens: itens.map(i => ({ descricao: i.descricao, quantidade: i.quantidade, valor: i.valor })),
      dataIso: new Date().toISOString(),
      desconto: descontoN, descontoReserva: descontoReservaAplicado,
    });
    setEtapa('sucesso');
  }

  async function fecharComanda() {
    if (!clienteSel || !empresaId || fechando) return;
    // Mesma regra do botão: total coberto (troco permitido; R$0 = cortesia) e desconto ≤ subtotal.
    if (!resumo.podeFechar) {
      Alert.alert('Não é possível fechar', resumo.motivo ?? 'Não foi possível fechar a comanda.');
      return;
    }
    if (bloqueioTaxaReserva) { Alert.alert('Não é possível fechar', bloqueioTaxaReserva); return; }
    // Comanda já fechada reaberta: UPDATE (editarComanda), não um novo INSERT.
    if (comandaExistenteId) { await editarComanda(comandaExistenteId); return; }
    if (!podeFechar) return;
    // Comanda desta cliente criada e não terminada nesta tela: nada de um segundo INSERT.
    if (comandasParciais[clienteSel.id]) { Alert.alert('Comanda não terminou de gravar', AVISO_COMANDA_PARCIAL); return; }
    // Sem `pacotes.vender` o banco recusaria o INSERT em pacote_clientes depois
    // de a comanda já ter sido criada — barra antes de gravar qualquer coisa.
    if (!podeVenderPacote && itens.some(i => i.tipo === 'pacote')) {
      Alert.alert('Sem permissão', 'Você não tem permissão para vender pacotes. Remova o pacote da comanda para fechar.');
      return;
    }
    setFechando(true);

    // Barra fechamento duplicado: se algum atendimento desta comanda já ganhou
    // comanda (outro aparelho, lista desatualizada), criar outra geraria
    // pagamento em dobro. Confere no banco, não na lista local.
    const agIdsNaComanda = itens.filter(i => i.agendamento_id).map(i => i.agendamento_id!);
    if (agIdsNaComanda.length > 0) {
      const { data: jaFechados, error: errCheck } = await supabase.from('agendamentos')
        .select('id').in('id', agIdsNaComanda).not('comanda_id', 'is', null);
      if (errCheck) { falharFechamento('conferir comanda existente', errCheck); return; }
      if (jaFechados && jaFechados.length > 0) {
        Alert.alert('Comanda já fechada', 'Este atendimento já teve a comanda fechada. Volte e abra a tela de novo para ver a comanda existente.');
        setFechando(false); return;
      }
    }

    // 1. Comanda
    const { data: comanda, error: errComanda } = await supabase
      .from('comandas').insert({
        empresa_id: empresaId,
        clientes_id: clienteSel.id === '__sem__' ? null : clienteSel.id,
        valor_total: subtotal, desconto: descontoN + descontoReservaAplicado,
        desconto_reserva: descontoReservaAplicado,
        status: 'fechada', fechada_at: new Date().toISOString(),
      }).select('id').single();

    if (errComanda || !comanda) { falharFechamento('criar comanda', errComanda); return; }

    const comandaId = comanda.id;
    // Ids dos atendimentos que ainda estão na comanda agora.
    const agIds = [...new Set(itens.filter(i => i.agendamento_id).map(i => i.agendamento_id!))];
    const pacoteLinksFinal: Record<string, string | null> = { ...pacoteLinks };

    // Falha depois de a comanda já existir. Comanda só com extras não tem atendimento que a
    // "trave" (a checagem de duplicado acima só olha atendimentos): guarda o id e bloqueia
    // um novo fechamento nesta tela, senão venda/estoque/receita seriam lançados de novo.
    const clienteId = clienteSel.id;
    const falharAposCriar = (etapaFalha: string, erro: Parameters<typeof falharFechamento>[1]) => {
      if (agIds.length === 0) setComandasParciais(prev => ({ ...prev, [clienteId]: comandaId }));
      falharFechamento(etapaFalha, erro);
    };

    // 2. Atendimentos: valor cobrado + concluído + comanda_id + vínculo de
    // pacote (se houver) no MESMO update do status — o trigger
    // fn_registrar_uso_pacote só dispara na transição pra 'concluido' e só
    // nesse momento lê NEW.pacote_cliente_id; gravar o vínculo num update
    // separado, depois do status já ter virado 'concluido', faria o trigger
    // rodar sem enxergar o vínculo (ele não dispara de novo). O mesmo vale pro
    // trg_gerar_comissao, que já nasce com o valor cobrado.
    //
    // A distinção é `undefined` (chave nunca mexida — não toca na coluna) vs
    // "presente" (string = vínculo novo/existente, ou `null` = desvínculo
    // explícito — os dois SOBRESCREVEM o que já está no banco). Checar
    // truthiness reintroduziria o bug: um `null` explícito também é falsy e um
    // `pacote_cliente_id` antigo gravado pela Agenda sobreviveria no banco —
    // cobrando o valor cheio na comanda E consumindo a sessão do pacote mesmo
    // assim via trigger. agruparValoresPorAgendamento já faz esse teste de presença.
    const gruposValor = agruparValoresPorAgendamento(itens, pacoteLinksFinal);
    if (agIds.length > 0) {
      const falha = await persistirValoresAgendamento({ status: 'concluido', comanda_id: comandaId }, pacoteLinksFinal);
      if (falha) { falharAposCriar(falha.etapa, falha.erro); return; }
    }

    // 3. Itens extras (serviços, produtos e pacotes avulsos)
    const extras = itens.filter(i => i.tipo !== 'agendamento');
    if (extras.length > 0) {
      const rItens = await supabase.from('comanda_itens').insert(
        extras.map(i => ({
          comanda_id: comandaId, empresa_id: empresaId, tipo: i.tipo,
          descricao: i.descricao, servico_id: i.servico_id ?? null,
          produto_id: i.produto_id ?? null, pacote_id: i.pacote_id ?? null, profissional_id: i.profissional_id ?? null,
          quantidade: i.quantidade, valor_unit: i.valor,
        })),
      );
      if (rItens.error) { falharAposCriar('itens da comanda', rItens.error); return; }
    }

    // 4. Produtos: baixa de estoque (só avisa) + venda com itens (conferida)
    const extrasProdutos = extras.filter(i => i.tipo === 'produto' && i.produto_id);
    if (extrasProdutos.length > 0) {
      const { error: errEst } = await supabase.from('estoque_movimentos').insert(
        extrasProdutos.map(i => ({
          produto_id: i.produto_id!, empresa_id: empresaId,
          tipo: 'saida', quantidade: i.quantidade,
          motivo: `Produto via comanda — ${i.descricao}`,
          // Liga a baixa ao atendimento: é o ramo de RLS que deixa a profissional baixar estoque.
          agendamento_id: agIds[0] ?? null,
        })),
      );
      if (errEst) Alert.alert('Estoque', mensagemErroBanco(errEst, 'baixar o estoque dos produtos'));
      const totalProdutos = extrasProdutos.reduce((s, i) => s + i.valor * i.quantidade, 0);
      const { data: venda, error: errVendaProd } = await supabase.from('vendas').insert({
        empresa_id: empresaId,
        cliente_id: clienteSel.id === '__sem__' ? null : clienteSel.id,
        valor_total: totalProdutos, desconto: 0, observacao: 'Via comanda',
      }).select('id').single();
      if (errVendaProd || !venda) { falharAposCriar('venda dos produtos', errVendaProd); return; }
      const rVendaItens = await supabase.from('venda_itens').insert(
        extrasProdutos.map(i => ({
          empresa_id: empresaId, venda_id: venda.id,
          produto_id: i.produto_id!, quantidade: i.quantidade,
          preco_unitario: i.valor,
        })),
      );
      if (rVendaItens.error) { falharAposCriar('itens da venda dos produtos', rVendaItens.error); return; }
    }

    // 5. Vender pacotes adicionados na comanda (gera pacote_clientes para o cliente)
    const extrasPacotes = extras.filter(i => i.tipo === 'pacote' && i.pacote_id);
    if (extrasPacotes.length > 0 && clienteSel.id !== '__sem__') {
      const hoje = new Date();
      const dataInicio = format(hoje, 'yyyy-MM-dd');
      const novasVendas = extrasPacotes.flatMap(i => {
        const pacoteInfo = pacotesCat.find(p => p.id === i.pacote_id);
        if (!pacoteInfo) return [];
        const dataValidade = pacoteInfo.validade_dias != null
          ? format(addDays(hoje, pacoteInfo.validade_dias), 'yyyy-MM-dd')
          : null;
        return Array.from({ length: Math.max(1, Math.round(i.quantidade)) }, () => ({
          empresa_id:    empresaId,
          pacote_id:     i.pacote_id!,
          cliente_id:    clienteSel.id,
          data_inicio:   dataInicio,
          data_validade: dataValidade,
          valor_pago:    i.valor,
          status:        'ativo',
        }));
      });
      if (novasVendas.length > 0) {
        const { error: errPac } = await supabase.from('pacote_clientes').insert(novasVendas);
        if (errPac) { falharAposCriar('venda de pacote', errPac); return; }
        // Registra a venda do pacote como faturamento (uma vez, no ato).
        // As sessões consumidas depois NÃO contam como receita.
        const totalPacotes = novasVendas.reduce((s, v) => s + Number(v.valor_pago ?? 0), 0);
        if (totalPacotes > 0) {
          const { error: errVenda } = await supabase.from('vendas').insert({
            empresa_id:  empresaId,
            cliente_id:  clienteSel.id,
            valor_total: totalPacotes,
            desconto:    0,
            observacao:  `Pacote(s) via comanda`,
          });
          if (errVenda) { falharAposCriar('venda de pacote', errVenda); return; }
        }
      }
    }

    // 6. Pagamentos pela regra única (montarPagamentos): cartão com
    // bandeira/parcelas/taxa/líquido; se nenhum split foi lançado e o total
    // fechou em R$ 0 (sessão de pacote cobrindo tudo, ou desconto de 100%),
    // grava um "Cortesia" de R$ 0 — fica claro no relatório de formas de
    // pagamento que esse fechamento não gerou cobrança nova, sem somar na receita.
    const linhasPag = montarPagamentos(splitsNumericos, { empresaId, comandaId, taxas, total: resumo.total });
    if (linhasPag.length > 0) {
      const rPag = await supabase.from('pagamentos').insert(linhasPag);
      if (rPag.error) {
        falharAposCriar('pagamentos', `${mensagemErroBanco(rPag.error, 'lançar o pagamento')} A comanda foi fechada sem o pagamento — abra a comanda no computador para lançar o pagamento.`);
        return;
      }
    }

    setFechando(false);
    // Receita, comissão e alerta de comandas abertas mudaram: atualiza todas as telas.
    invalidarFinanceiro(qc);
    qc.invalidateQueries({ queryKey: ['agenda-dia'] });
    carregarBacklog();
    // Valor cobrado, vínculo de pacote, status E comanda_id — senão o atendimento
    // continua listado como aberto (e o "Total do dia" usa o valor antigo).
    setAgDia(prev => marcarAgendamentosFechados(prev.map(ag => {
      const g = gruposValor.find(x => x.agendamentoId === ag.id);
      if (!g) return ag;
      return {
        ...ag,
        valor: g.novoValorTotal,
        pacote_cliente_id: g.pacoteClienteId !== undefined ? g.pacoteClienteId : ag.pacote_cliente_id,
      };
    }), agIds, comandaId));
    setProximoCliente(proximoClienteAberto(clienteSel.chave));
    setSucessoData({
      nome: clienteSel.nome, valor: total, telefone: clienteSel.telefone,
      // Cortesia automática (total R$ 0 sem pagamento — a linha que montarPagamentos grava)
      // aparece como "Cortesia R$ 0,00" em vez de uma lista vazia.
      splits: (() => {
        const lancados = splits.filter(s => parseValorBR(s.valor) > 0);
        return lancados.length === 0 && resumo.cortesiaAutomatica ? [{ metodo: 'cortesia', valor: '0,00' }] : lancados;
      })(),
      itensCount: itens.length,
      itens: itens.map(i => ({ descricao: i.descricao, quantidade: i.quantidade, valor: i.valor })),
      dataIso: new Date().toISOString(),
      desconto: descontoN, descontoReserva: descontoReservaAplicado,
    });
    setEtapa('sucesso');
  }

  if (!fontsLoaded) return null;

  // ── Tela de sucesso ──
  if (etapa === 'sucesso' && sucessoData) {
    return (
      <View style={{ flex: 1, backgroundColor: C.surface, paddingTop: insets.top }}>
        <StatusBar barStyle="dark-content" />
        <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 24 }}>
          <View style={{ marginBottom: 16 }}>
            <SuccessCheck size={84} />
          </View>
          <MotiView from={{ translateY: 16, opacity: 0 }} animate={{ translateY: 0, opacity: 1 }}
            transition={{ type: 'timing', duration: 400, delay: 200 }}
            style={{ alignItems: 'center' }}>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 26, color: C.text, textAlign: 'center' }}>
              Comanda fechada!
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.green, textAlign: 'center', marginTop: 4 }}>
              {formatarMoeda(sucessoData.valor)}
            </Text>
          </MotiView>

          {/* Cards conectados: Cliente → Pagamento */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 350, delay: 320 }}
            style={{ width: '100%', maxWidth: 320, marginTop: 20 }}>
            <View style={{
              backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderBottomWidth: 0,
              borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 12,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                <User size={11} color={C.text3} strokeWidth={2.5} />
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10.5, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  Cliente
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <LinearGradient
                  colors={[`hsl(${avatarHue(sucessoData.nome)},60%,50%)`, `hsl(${avatarHue(sucessoData.nome)},50%,35%)`]}
                  style={{ width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11 }}>{iniciais(sucessoData.nome)}</Text>
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }} numberOfLines={1}>
                    {sucessoData.nome}
                  </Text>
                  {sucessoData.telefone && (
                    <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }}>{sucessoData.telefone}</Text>
                  )}
                </View>
              </View>
            </View>
            <View style={{
              backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderTopWidth: 0,
              borderBottomLeftRadius: 16, borderBottomRightRadius: 16, padding: 12,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                <ChevronRight size={11} color={C.text3} strokeWidth={2.5} />
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10.5, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  Pagamento
                </Text>
              </View>
              <View style={{ gap: 6 }}>
                {sucessoData.splits.map((s, i) => {
                  const m = METODOS.find(x => x.key === s.metodo) ?? METODOS[0];
                  return (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: m.bg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, gap: 8 }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: m.cor, flex: 1 }}>
                        {m.label}
                        {s.bandeira ? ` ${ROTULOS_BANDEIRA[s.bandeira] ?? s.bandeira}` : ''}
                        {s.metodo === 'credito' && (s.parcelas ?? 1) > 1 ? ` ${s.parcelas}x` : ''}
                      </Text>
                      <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: m.cor }}>
                        {formatarMoeda(parseValorBR(s.valor))}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </MotiView>

          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 300, delay: 450 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3, textAlign: 'center', marginTop: 10 }}>
              {sucessoData.itensCount} {sucessoData.itensCount === 1 ? 'item' : 'itens'}
              {sucessoData.descontoReserva > 0 && ` · Taxa de reserva paga ${formatarMoeda(sucessoData.descontoReserva)}`}
              {sucessoData.desconto > 0 && ` · Desconto ${formatarMoeda(sucessoData.desconto)}`}
            </Text>
            {proximoCliente && (
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3, textAlign: 'center', marginTop: 10 }}>
                Indo para a comanda de {proximoCliente.nome}...
              </Text>
            )}
          </MotiView>

          {sucessoData.telefone && (
            <TouchableOpacity
              onPress={() => {
                const texto = gerarTextoRecibo({
                  nome: sucessoData.nome, valor: sucessoData.valor, dataIso: sucessoData.dataIso,
                  itens: sucessoData.itens,
                  splits: sucessoData.splits.map(sp => ({ metodo: sp.metodo, valor: parseValorBR(sp.valor), bandeira: sp.bandeira, parcelas: sp.parcelas })),
                  desconto: sucessoData.desconto, descontoReserva: sucessoData.descontoReserva,
                });
                Linking.openURL(linkWhatsAppRecibo(sucessoData.telefone!, texto))
                  .catch(() => Alert.alert('WhatsApp', 'Não foi possível abrir o WhatsApp.'));
              }}
              activeOpacity={0.8}
              style={{ marginTop: 24, backgroundColor: '#16A34A', borderRadius: 16, paddingHorizontal: 32, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Send size={16} color="#fff" />
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: '#fff' }}>Enviar recibo por WhatsApp</Text>
            </TouchableOpacity>
          )}

          {proximoCliente ? (
            <TouchableOpacity
              onPress={() => { abrirComanda(proximoCliente); setSucessoData(null); setProximoCliente(null); }}
              activeOpacity={0.8}
              style={{ marginTop: 24, backgroundColor: C.green, borderRadius: 16, paddingHorizontal: 32, paddingVertical: 14 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: '#fff' }}>
                Ir agora para {proximoCliente.nome}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => { setEtapa('lista'); setClienteSel(null); setSucessoData(null); }}
              activeOpacity={0.8}
              style={{ marginTop: 24, backgroundColor: C.green, borderRadius: 16, paddingHorizontal: 32, paddingVertical: 14 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: '#fff' }}>Voltar</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    );
  }

  // ── Lista de clientes ──
  if (etapa === 'lista') {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
        <StatusBar barStyle="dark-content" />
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
            <ChevronLeft size={20} color={C.text3} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2 }}>Comanda</Text>
            <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 20, color: C.text }}>
              {isToday(dataComanda) ? 'Hoje' : format(dataComanda, "EEEE, d 'de' MMM", { locale: ptBR })}
            </Text>
          </View>
          {totalDia > 0 && (
            <View style={{ backgroundColor: C.greenSoft, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7, alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Total do dia
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.green }}>
                {formatarMoeda(totalDia)}
              </Text>
            </View>
          )}
        </View>

        {/* Escolha do dia: semana / mês, "Hoje" e aviso de comandas abertas */}
        <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, borderBottomWidth: 1, borderColor: C.border, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <TouchableOpacity onPress={() => (view === 'mes' ? navMes(-1) : navDia(-1))}
              style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
              <ChevronLeft size={16} color={C.text3} />
            </TouchableOpacity>
            <Text style={{ flex: 1, textAlign: 'center', fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.text2, textTransform: 'capitalize' }}>
              {view === 'mes'
                ? format(dataComanda, 'MMMM yyyy', { locale: ptBR })
                : format(dataComanda, "EEE, d 'de' MMM", { locale: ptBR })}
            </Text>
            <TouchableOpacity onPress={() => (view === 'mes' ? navMes(1) : navDia(1))}
              style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
              <ChevronRight size={16} color={C.text3} />
            </TouchableOpacity>
            {!isToday(dataComanda) && (
              <TouchableOpacity onPress={() => selecionarDia(new Date())}
                style={{ borderRadius: 10, backgroundColor: C.primarySoft, paddingHorizontal: 10, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.primary }}>Hoje</Text>
              </TouchableOpacity>
            )}
            <View style={{ flexDirection: 'row', backgroundColor: C.surface, borderRadius: 10, padding: 2 }}>
              {(['semana', 'mes'] as const).map(v => (
                <TouchableOpacity key={v} onPress={() => setView(v)}
                  style={{ borderRadius: 8, paddingHorizontal: 9, height: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: view === v ? C.primary : 'transparent' }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: view === v ? '#fff' : C.text3 }}>
                    {v === 'semana' ? 'Semana' : 'Mês'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {view === 'semana' && (
            <View style={{ flexDirection: 'row', gap: 2 }}>
              {semana.map(d => {
                const sel = isSameDay(d, dataComanda);
                return (
                  <TouchableOpacity key={d.toISOString()} onPress={() => selecionarDia(d)}
                    style={{ flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 12, backgroundColor: sel ? C.primary : 'transparent' }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9, textTransform: 'uppercase', marginBottom: 2, color: sel ? 'rgba(255,255,255,0.7)' : C.text4 }}>
                      {DIAS[d.getDay()]}
                    </Text>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: sel ? '#fff' : isToday(d) ? C.rose : C.text2 }}>
                      {format(d, 'd')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {backlog.length > 0 && (
            <TouchableOpacity onPress={() => selecionarDia(backlog[0].data)} activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.roseSoft, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(212,96,138,0.25)', paddingHorizontal: 12, paddingVertical: 8 }}>
              <AlertCircle size={14} color={C.rose} strokeWidth={2.5} />
              <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11.5, color: C.rose }}>
                {backlog.length === 1 ? '1 comanda não fechada' : `${backlog.length} comandas não fechadas`}
                {' · mais antiga '}{format(backlog[0].data, 'dd/MM')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {view === 'mes' ? (
          <ScrollView contentContainerStyle={{ padding: 12 }}>
            <View style={{ flexDirection: 'row', marginBottom: 4 }}>
              {DIAS.map(d => (
                <Text key={d} style={{ flex: 1, textAlign: 'center', fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text4, paddingVertical: 4 }}>{d}</Text>
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {eachDayOfInterval({
                start: startOfWeek(startOfMonth(dataComanda), { weekStartsOn: 0 }),
                end: addDays(startOfWeek(startOfMonth(dataComanda), { weekStartsOn: 0 }), 41),
              }).map(d => {
                const key = format(d, 'yyyy-MM-dd');
                const count = agsMes.get(key) ?? 0;
                const sel = isSameDay(d, dataComanda);
                const dMes = isSameMonth(d, dataComanda);
                return (
                  <View key={key} style={{ width: `${100 / 7}%`, padding: 1 }}>
                    <TouchableOpacity onPress={() => selecionarDia(d)}
                      style={{ aspectRatio: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                        backgroundColor: sel ? C.primary : isToday(d) ? C.primarySoft : 'transparent' }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13,
                        color: sel ? '#fff' : isToday(d) ? C.primary : dMes ? C.text2 : C.text4 }}>
                        {format(d, 'd')}
                      </Text>
                      {count > 0 && (
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 9, color: sel ? 'rgba(255,255,255,0.8)' : C.rose }}>
                          {count}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        ) : loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={C.primary} />
          </View>
        ) : erroDia ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 }}>
            <AlertCircle size={28} color={C.rose} />
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text2, textAlign: 'center' }}>{erroDia}</Text>
            <TouchableOpacity onPress={() => { setLoading(true); carregarDia(); }}
              style={{ borderRadius: 10, backgroundColor: C.primarySoft, paddingHorizontal: 14, height: 34, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.primary }}>Tentar de novo</Text>
            </TouchableOpacity>
          </View>
        ) : clientesDia.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            <Receipt size={28} color={C.text4} />
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text3, marginTop: 8 }}>
              {isToday(dataComanda) ? 'Nenhum atendimento hoje' : 'Nenhum atendimento neste dia'}
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
            {erroSoExtras && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.redSoft, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
                <AlertCircle size={14} color={C.red} />
                <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.red }}>{erroSoExtras}</Text>
              </View>
            )}
            {clientesDia.map((cliente, idx) => {
              // Um cartão por comanda fechada (cartoesComandaDoDia). Concluído sem
              // comanda_id (status mudado direto, sem nunca fechar) continua no
              // cartão aberto — senão não existiria outro jeito de cobrá-lo.
              const jaFeita = cliente.comandaId !== null;
              const deOutra = temAtendimentoDeOutra(cliente);
              // Comanda fechada só reabre para quem pode editá-la (igual ao web).
              const travado = deOutra || (jaFeita && !podeEditarFechada);
              // Comanda só com extras não tem atendimento nenhum.
              const ag1 = cliente.agendamentos[0];
              const hue = avatarHue(cliente.nome);
              return (
                <MotiView key={cliente.chave}
                  from={{ opacity: 0, translateY: 12 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: 'timing', duration: 300, delay: idx * 60 }}>
                  <TouchableOpacity
                    onPress={() => { if (travado) return; if (jaFeita) abrirComandaFechada(cliente); else abrirComanda(cliente); }}
                    disabled={travado}
                    activeOpacity={0.7}
                    style={{
                      backgroundColor: jaFeita ? C.bg : C.surface, borderRadius: 16, padding: 14,
                      borderWidth: 1, borderColor: C.border,
                      opacity: travado ? 0.5 : jaFeita ? 0.8 : 1,
                    }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <LinearGradient colors={[`hsl(${hue},60%,50%)`, `hsl(${hue},50%,35%)`]}
                        style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: '#fff', fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12 }}>{iniciais(cliente.nome)}</Text>
                      </LinearGradient>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }} numberOfLines={1}>
                          {cliente.nome}
                        </Text>
                        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }} numberOfLines={1}>
                          {!ag1 ? 'Só produtos/serviços extras' : `${fmtHora(ag1.data_hora_inicio)} · ${
                            (ag1.agendamento_servicos ?? []).length > 0
                              ? [...(ag1.agendamento_servicos ?? [])].sort((a, b) => a.ordem - b.ordem).map(s => s.servico?.nome).filter(Boolean).join(' + ')
                              : ag1.servico?.nome ?? '—'
                          }`}
                        </Text>
                        {deOutra && (
                          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text4 }} numberOfLines={1}>
                            Atendimento de outra profissional
                          </Text>
                        )}
                      </View>
                      {jaFeita ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Check size={16} color={C.green} strokeWidth={2.5} />
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text4 }}>
                            {travado ? 'Comanda fechada' : 'Editar'}
                          </Text>
                        </View>
                      ) : (
                        <ChevronRight size={16} color={C.text4} />
                      )}
                    </View>
                    {cliente.agendamentos.length > 1 && (
                      <View style={{ flexDirection: 'row', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                        {cliente.agendamentos.map(ag => {
                          const sc = STATUS_COR[ag.status] ?? { bg: C.bg, text: C.text3 };
                          return (
                            <View key={ag.id} style={{ backgroundColor: sc.bg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: sc.text }}>{fmtHora(ag.data_hora_inicio)}</Text>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </TouchableOpacity>
                </MotiView>
              );
            })}
          </ScrollView>
        )}
      </View>
    );
  }

  // ── Comanda aberta ──
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1, backgroundColor: C.surface, paddingTop: insets.top }}>
        <StatusBar barStyle="dark-content" />

        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: C.border }}>
          <TouchableOpacity onPress={voltarParaLista}
            style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
            <ChevronLeft size={20} color={C.text3} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 15, color: C.text }} numberOfLines={1}>
              {clienteSel?.nome}
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>
              {itens.length} ite{itens.length !== 1 ? 'ns' : 'm'}{emEdicao ? ' · editando comanda fechada' : ''}
            </Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 20 }}>

          {/* ── Itens ── */}
          <View>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10 }}>
              Serviços
            </Text>
            {carregandoComanda && (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <ActivityIndicator color={C.primary} />
              </View>
            )}
            {itens.map((item, idxItem) => {
              // Travas iguais às do web. Edição de comanda fechada: produto/pacote já baixaram
              // estoque ou foram vendidos no fechamento — valor, quantidade e remoção só leitura;
              // quantidade travada em todos; atendimento não sai da comanda.
              const itemSoLeitura = emEdicao && (item.tipo === 'produto' || item.tipo === 'pacote');
              // Atendimento coberto por sessão de pacote: valor travado em R$ 0 (novo e edição).
              const cobertoPorPacote = item.tipo === 'agendamento' && !!item.agendamento_id && !!pacoteLinks[item.agendamento_id];
              const valorSoLeitura = itemSoLeitura || cobertoPorPacote;
              const travadoComissao = emEdicao && !!item.comissao_paga;
              const podeRemover = (!emEdicao || item.tipo === 'servico') && !travadoComissao;
              const mostrarLixeira = podeRemover && (item.tipo !== 'agendamento' || (podeTirarAtendimento && !!item.agendamento_id));
              return (
              <View key={item.uid} style={{
                backgroundColor: item.tipo === 'agendamento' ? C.primarySoft : item.tipo === 'produto' ? C.amberSoft : C.bg,
                borderRadius: 14, padding: 14, marginBottom: 8,
                borderWidth: 1, borderColor: C.border,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }} numberOfLines={1}>
                      {item.descricao}
                    </Text>
                    {item.profissional && (
                      <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3, marginTop: 2 }}>
                        {item.profissional}
                      </Text>
                    )}
                  </View>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>
                    {formatarMoeda(item.valor * item.quantidade)}
                  </Text>
                  {mostrarLixeira && (
                    <TouchableOpacity
                      onPress={() => item.tipo === 'agendamento' ? tirarAtendimento(item.agendamento_id!) : removerItem(item.uid)}
                      style={{ width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                      <Trash2 size={14} color={C.red} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Valor e quantidade editáveis; valor travado quando o atendimento é coberto por pacote */}
                <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.text3 }}>R$</Text>
                    <TextInput
                      key={`${item.uid}-${item.valor}`}
                      defaultValue={item.valor.toFixed(2).replace('.', ',')}
                      keyboardType="decimal-pad"
                      editable={!valorSoLeitura}
                      onEndEditing={e => { if (!valorSoLeitura) atualizarValor(item.uid, e.nativeEvent.text); }}
                      style={{ opacity: valorSoLeitura ? 0.6 : 1, minWidth: 80, borderWidth: 1, borderColor: C.border, borderRadius: 8, backgroundColor: C.surface, paddingHorizontal: 8, paddingVertical: 4, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text }}
                    />
                  </View>
                  {item.tipo !== 'agendamento' && emEdicao && (
                    <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.text3 }}>Qtd {item.quantidade}</Text>
                  )}
                  {item.tipo !== 'agendamento' && !emEdicao && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <TouchableOpacity onPress={() => atualizarQtd(item.uid, -1)}
                        style={{ width: 26, height: 26, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text }}>−</Text>
                      </TouchableOpacity>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text, minWidth: 16, textAlign: 'center' }}>{item.quantidade}</Text>
                      <TouchableOpacity onPress={() => atualizarQtd(item.uid, 1)}
                        style={{ width: 26, height: 26, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text }}>+</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {item.quantidade > 1 && (
                    <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.text3 }}>
                      {item.quantidade}x = {formatarMoeda(item.valor * item.quantidade)}
                    </Text>
                  )}
                </View>

                {/* Profissional do serviço extra (gera a comissão) */}
                {item.tipo === 'servico' && (
                  <>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} contentContainerStyle={{ gap: 6 }}>
                      {[{ id: '', nome: 'Sem profissional' }, ...membros].map(m => {
                        const ativo = (item.profissional_id ?? '') === m.id;
                        return (
                          <TouchableOpacity key={m.id || 'nenhum'}
                            onPress={() => { if (!travadoComissao) atualizarProfissional(item.uid, m.id); }}
                            disabled={travadoComissao}
                            accessibilityState={{ selected: ativo, disabled: travadoComissao }}
                            style={{ opacity: travadoComissao && !ativo ? 0.4 : 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: ativo ? C.primary : C.border, backgroundColor: ativo ? C.primarySoft : C.surface }}>
                            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: ativo ? C.primary : C.text3 }}>{m.nome}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                    {travadoComissao && (
                      <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, color: C.text3, marginTop: 6 }}>
                        Comissão já paga — profissional e remoção travadas
                      </Text>
                    )}
                  </>
                )}

                {/* Vínculo com sessão de pacote — atendimento multi-serviço vira
                    várias linhas; o seletor aparece só na primeira linha de cada
                    atendimento (o vínculo é por atendimento, não por linha). */}
                {item.tipo === 'agendamento' && item.agendamento_id
                  && itens.findIndex(x => x.agendamento_id === item.agendamento_id) === idxItem && (() => {
                  const agendamentoId = item.agendamento_id!;
                  const pacoteVinculado = pacotesClienteAtivos.find(p => p.id === pacoteLinks[agendamentoId]);
                  if (pacoteVinculado) {
                    // Em edição o badge é só informativo: editarComanda nunca grava
                    // pacote_cliente_id (desvincular restauraria o valor e a receita
                    // sumiria de Dashboard/Financeiro/Relatórios) — igual ao web.
                    return (
                      <TouchableOpacity onPress={() => { if (!emEdicao) desvincularPacote(agendamentoId); }}
                        disabled={emEdicao}
                        style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.greenSoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.green, flex: 1 }} numberOfLines={1}>
                          Sessão de pacote — {pacoteVinculado.nome}
                        </Text>
                        {!emEdicao && (
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text4 }}>Desvincular</Text>
                        )}
                      </TouchableOpacity>
                    );
                  }
                  // Vincular pacote fica fora da edição de comanda fechada (zeraria o item sem
                  // nunca gravar o vínculo — receita perdida), igual ao web.
                  if (emEdicao) return null;
                  const servicoId = item.servico_id;
                  const elegiveis = servicoId ? pacotesClienteAtivos.filter(p => p.servicos.some(s => s.servico_id === servicoId)) : [];
                  if (elegiveis.length === 0) return null;
                  return (
                    <View style={{ marginTop: 8, gap: 4 }}>
                      {elegiveis.map((p: any) => (
                        <TouchableOpacity key={p.id}
                          onPress={() => vincularPacote(agendamentoId, p.id)}
                          style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }}>
                          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.text }} numberOfLines={1}>
                            Vincular: {p.nome}
                          </Text>
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3 }}>
                            {p.restantes == null ? 'ilimitado' : `${p.restantes} rest.`}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  );
                })()}
              </View>
              );
            })}

            {/* Adicionar extras */}
            <TouchableOpacity onPress={() => setShowExtras(!showExtras)}
              // Enquanto a comanda fechada carrega, um extra incluído seria sobrescrito pela leitura.
              disabled={carregandoComanda}
              activeOpacity={0.7}
              style={{ opacity: carregandoComanda ? 0.5 : 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text3 }}>+ Adicionar extra</Text>
            </TouchableOpacity>

            {showExtras && (
              <View style={{ marginTop: 8, backgroundColor: C.bg, borderRadius: 14, padding: 12, gap: 4 }}>
                {servicos.length > 0 && (
                  <>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Serviços</Text>
                    {servicos.map(s => (
                      <TouchableOpacity key={s.id} onPress={() => adicionarServico(s)}
                        style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10, backgroundColor: C.surface, marginBottom: 4 }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text }}>{s.nome}</Text>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text3 }}>{formatarMoeda(s.preco)}</Text>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
                {/* Produto e pacote não entram na edição: editarComanda não baixa estoque nem vende pacote (igual ao web) */}
                {!emEdicao && produtos.length > 0 && (
                  <>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8, marginBottom: 4 }}>Produtos</Text>
                    {produtos.map(p => (
                      <TouchableOpacity key={p.id} onPress={() => adicionarProduto(p)}
                        style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10, backgroundColor: C.surface, marginBottom: 4 }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text }}>{p.nome}</Text>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text3 }}>{formatarMoeda(p.preco_venda)}</Text>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
                {!emEdicao && podeVenderPacote && pacotesCat.length > 0 && clienteSel && clienteSel.id !== '__sem__' && (
                  <>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8, marginBottom: 4 }}>Pacotes</Text>
                    {pacotesCat.map(p => (
                      <TouchableOpacity key={p.id} onPress={() => adicionarPacote(p)}
                        style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10, backgroundColor: C.surface, marginBottom: 4 }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text }}>{p.nome}</Text>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text3 }}>{formatarMoeda(p.preco)}</Text>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </View>
            )}
          </View>

          {/* ── Desconto ── */}
          {podeDesconto && (
          <View>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10 }}>Desconto</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderRadius: 14, paddingHorizontal: 14, height: 48, borderWidth: 1, borderColor: erroDesconto ? C.red : C.border }}>
              <Tag size={16} color={C.text3} />
              <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2, marginLeft: 10 }}>Desconto</Text>
              {/* Seletor % / R$ — trocar o modo limpa o valor para não reinterpretar o número */}
              <View style={{ flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: C.border, overflow: 'hidden', marginRight: 8 }}>
                {([['percentual', '%'], ['valor', 'R$']] as const).map(([modo, rotulo]) => {
                  const ativo = descontoModo === modo;
                  return (
                    <TouchableOpacity key={modo}
                      onPress={() => { if (!ativo) { setDescontoModo(modo); setDescontoEntrada(''); } }}
                      accessibilityRole="button" accessibilityState={{ selected: ativo }}
                      style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: ativo ? C.primary : C.surface }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: ativo ? '#fff' : C.text3 }}>{rotulo}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TextInput
                value={descontoEntrada} onChangeText={setDescontoEntrada}
                keyboardType="decimal-pad" placeholder={descontoModo === 'percentual' ? '0' : '0,00'}
                placeholderTextColor={C.text4}
                style={{ width: 64, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text, textAlign: 'right' }}
              />
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.text3, marginLeft: 4 }}>
                {descontoModo === 'percentual' ? '%' : 'R$'}
              </Text>
            </View>
            {erroDesconto && (
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.red, marginTop: 6 }}>{erroDesconto}</Text>
            )}
          </View>
          )}

          {/* ── Resumo ── */}
          <View style={{ backgroundColor: C.bg, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2 }}>Subtotal</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>{formatarMoeda(subtotal)}</Text>
            </View>
            {descontoReservaAplicado > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2 }}>Taxa de reserva paga</Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.red }}>− {formatarMoeda(descontoReservaAplicado)}</Text>
              </View>
            )}
            {descontoN > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2 }}>
                  (−) Desconto{descontoModo === 'percentual' ? ` ${String(descontoEntradaN).replace('.', ',')}%` : ''}
                </Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.red }}>− {formatarMoeda(descontoN)}</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.text }}>Total</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 24, color: C.text }}>{formatarMoeda(total)}</Text>
            </View>
          </View>

          {/* ── Pagamento ── */}
          <View>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10 }}>Pagamento</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
              {METODOS.filter(m => podeDesconto || m.key !== 'cortesia').map(m => (
                <TouchableOpacity key={m.key} onPress={() => adicionarSplit(m.key)}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, backgroundColor: m.bg, borderWidth: 1, borderColor: C.border }}>
                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: m.cor }}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {splits.length > 0 && (
              <View style={{ marginTop: 10, gap: 8 }}>
                {splits.map((s, i) => {
                  const m = METODOS.find(x => x.key === s.metodo) ?? METODOS[0];
                  const isCard = s.metodo === 'credito' || s.metodo === 'debito';
                  const valorN = parseValorBR(s.valor);
                  // Pagamento reaberto e não alterado mostra a taxa gravada (a mesma que será salva)
                  const taxa = taxaDoSplit(s, taxas);
                  return (
                    <View key={i} style={{ backgroundColor: m.bg, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: C.border, gap: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', height: 32, gap: 8 }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: m.cor, flex: 1 }}>{m.label}</Text>
                        <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>R$</Text>
                        <TextInput
                          value={s.valor}
                          onChangeText={v => setSplits(prev => prev.map((x, j) => j === i ? { ...x, valor: v } : x))}
                          keyboardType="decimal-pad" placeholder="0,00"
                          placeholderTextColor={C.text4}
                          style={{ width: 80, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text, textAlign: 'right' }}
                        />
                        <TouchableOpacity onPress={() => removerSplit(i)}
                          style={{ width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                          <X size={14} color={C.text4} />
                        </TouchableOpacity>
                      </View>
                      {isCard && (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                          {BANDEIRAS_CARTAO.map(b => {
                            const ativa = s.bandeira === b.key;
                            return (
                              <TouchableOpacity key={b.key} onPress={() => atualizarSplitBandeira(i, b.key)}
                                accessibilityRole="button" accessibilityState={{ selected: ativa }}
                                style={{
                                  paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
                                  borderColor: ativa ? m.cor : C.border, backgroundColor: ativa ? 'rgba(255,255,255,0.6)' : 'transparent',
                                  opacity: ativa ? 1 : 0.6,
                                }}>
                                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: m.cor }}>{b.label}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}
                      {s.metodo === 'credito' && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>Parcelas:</Text>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                            {OPCOES_PARCELAS.map(n => {
                              const ativa = (s.parcelas ?? 1) === n;
                              return (
                                <TouchableOpacity key={n} onPress={() => atualizarSplitParcelas(i, n)}
                                  accessibilityRole="button" accessibilityState={{ selected: ativa }}
                                  style={{
                                    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, borderWidth: 1,
                                    borderColor: ativa ? m.cor : C.border, backgroundColor: ativa ? C.surface : 'transparent',
                                  }}>
                                  <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: m.cor }}>
                                    {n}x{n === 1 ? ' (à vista)' : ''}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </ScrollView>
                        </View>
                      )}
                      {isCard && valorN > 0 && (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', opacity: 0.75 }}>
                          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: m.cor }}>Taxa {fmtTaxa(taxa)}</Text>
                          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: m.cor }}>Líquido {formatarMoeda(valorLiquido(valorN, taxa))}</Text>
                        </View>
                      )}
                    </View>
                  );
                })}

                {/* Status pagamento — falta/troco vêm de resumoComanda (regra única) */}
                <View style={{
                  borderRadius: 14, padding: 14, borderWidth: 1,
                  backgroundColor: falta <= 0.01 && troco <= 0.01 ? C.greenSoft : falta > 0.01 ? C.amberSoft : C.primarySoft,
                  borderColor: falta <= 0.01 && troco <= 0.01 ? '#0D7E5F33' : falta > 0.01 ? '#B4530933' : '#2C165433',
                }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2 }}>Recebido</Text>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text }}>{formatarMoeda(recebido)}</Text>
                  </View>
                  {falta > 0.01 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.amber }}>Falta</Text>
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.amber }}>{formatarMoeda(falta)}</Text>
                    </View>
                  )}
                  {troco > 0.01 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.primary }}>Troco</Text>
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.primary }}>{formatarMoeda(troco)}</Text>
                    </View>
                  )}
                  {falta <= 0.01 && troco <= 0.01 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 6 }}>
                      <Check size={14} color={C.green} strokeWidth={3} />
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.green }}>Valor quitado</Text>
                    </View>
                  )}
                </View>
              </View>
            )}
          </View>
        </ScrollView>

        {/* Footer — Fechar comanda */}
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: insets.bottom + 12, paddingTop: 12, backgroundColor: C.surface, borderTopWidth: 1, borderColor: C.border }}>
          {!emEdicao && !podeFechar && (
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.red, textAlign: 'center', marginBottom: 8 }}>
              Você não tem permissão para fechar comanda.
            </Text>
          )}
          {emEdicao && !podeEditarFechada && (
            <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.red, textAlign: 'center', marginBottom: 8 }}>
              Você não tem permissão para editar comanda fechada.
            </Text>
          )}
          {emEdicao && cargaFalhou && (
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.red, textAlign: 'center', marginBottom: 8 }}>
              Volte e abra a comanda de novo antes de salvar.
            </Text>
          )}
          {bloqueioTaxaReserva && (
            <View style={{ alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.red, textAlign: 'center' }}>
                {bloqueioTaxaReserva}
              </Text>
              <TouchableOpacity onPress={recarregarTaxasReserva} disabled={recarregandoTaxas} activeOpacity={0.7}
                style={{ marginTop: 4, opacity: recarregandoTaxas ? 0.5 : 1 }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.primary, textDecorationLine: 'underline' }}>
                  {recarregandoTaxas ? 'Carregando...' : 'Tentar de novo'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          {!emEdicao && comandaParcialAberta && (
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.red, textAlign: 'center', marginBottom: 8 }}>
              {AVISO_COMANDA_PARCIAL}
            </Text>
          )}
          {podeAcaoPrincipal && itens.length > 0 && resumo.motivo && (
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: erroDesconto ? C.red : C.amber, textAlign: 'center', marginBottom: 8 }}>
              {resumo.motivo}
            </Text>
          )}
          {podeAcaoPrincipal && itens.length > 0 && resumo.podeFechar && resumo.cortesiaAutomatica && splits.length === 0 && (
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text4, textAlign: 'center', marginBottom: 8 }}>
              Total R$ 0 — será registrado como Cortesia
            </Text>
          )}
          <TouchableOpacity
            onPress={fecharComanda}
            disabled={botaoDesabilitado}
            activeOpacity={0.8}
            style={{
              height: 52, borderRadius: 16, backgroundColor: C.green,
              alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
              opacity: botaoDesabilitado ? 0.5 : 1,
            }}>
            {fechando ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Check size={18} color="#fff" strokeWidth={2.5} />
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff' }}>
                  {emEdicao ? 'Salvar alterações' : 'Fechar comanda'} — {formatarMoeda(total)}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
