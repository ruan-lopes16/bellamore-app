import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, StatusBar, KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ChevronLeft, ChevronRight, Check, X, Trash2, User,
  Banknote, Zap, CreditCard, Gift, Tag, Receipt,
} from 'lucide-react-native';
import { format, startOfDay, endOfDay, parseISO, addDays } from 'date-fns';
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
import { supabase } from '@/lib/supabase';
import SuccessCheck from '@/components/SuccessCheck';
import { aplicarDescontoReserva, somarTaxasReservaPagas } from '@shared/taxa-reserva';
import { calcularPacotesAtivosCliente, type PacoteClienteOpt } from '@shared/pacotes';

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
};

type ComandaItem = {
  uid: string;
  tipo: 'agendamento' | 'servico' | 'produto';
  descricao: string;
  profissional?: string;
  valor: number;
  quantidade: number;
  agendamento_id?: string;
  servico_id?: string;
  produto_id?: string;
  profissional_id?: string;
};

type Split = { metodo: string; valor: string };

type ClienteComanda = {
  id: string;
  nome: string;
  telefone?: string;
  agendamentos: AgDia[];
};

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);
}
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

type Etapa = 'lista' | 'comanda' | 'sucesso';

export default function NovaComandaScreen() {
  const insets = useSafeAreaInsets();
  const empresaAtiva = useAuthStore(s => s.empresaAtiva);
  const empresaId = empresaAtiva?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [agDia, setAgDia] = useState<AgDia[]>([]);
  const [taxasReservaPagas, setTaxasReservaPagas] = useState<{ agendamento_id: string; valor: number }[]>([]);
  const [servicos, setServicos] = useState<{ id: string; nome: string; preco: number }[]>([]);
  const [produtos, setProdutos] = useState<{ id: string; nome: string; preco_venda: number }[]>([]);
  const [pacotesCat, setPacotesCat] = useState<{ id: string; nome: string; preco: number; validade_dias: number | null }[]>([]);
  const [pacotesClienteAtivos, setPacotesClienteAtivos] = useState<PacoteClienteOpt[]>([]);
  // string = vinculado (sessão existente ou venda nova); null = explicitamente
  // desvinculado nesta sessão (precisa gravar `pacote_cliente_id: null` no
  // fechamento, pra sobrescrever um vínculo que já existia no banco vindo da
  // Agenda); ausente da chave = nunca mexido, fechamento não toca na coluna.
  const [pacoteLinks, setPacoteLinks] = useState<Record<string, string | null>>({});
  const [pacoteVenderPorAgendamento, setPacoteVenderPorAgendamento] = useState<Record<string, string>>({});

  const [etapa, setEtapa] = useState<Etapa>('lista');
  const [clienteSel, setClienteSel] = useState<ClienteComanda | null>(null);
  const [itens, setItens] = useState<ComandaItem[]>([]);
  const [desconto, setDesconto] = useState('');
  const [splits, setSplits] = useState<Split[]>([]);
  const [fechando, setFechando] = useState(false);
  const [sucessoData, setSucessoData] = useState<{
    nome: string; valor: number; telefone?: string;
    splits: Split[]; itensCount: number;
    desconto: number;          // desconto manual, sem a taxa de reserva
    descontoReserva: number;   // taxa de reserva já paga, descontada separadamente do total
  } | null>(null);
  const [showExtras, setShowExtras] = useState(false);
  // Próximo cliente da fila (comanda aberta + horário já passou) — avança sem precisar voltar
  const [proximoCliente, setProximoCliente] = useState<ClienteComanda | null>(null);

  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  useEffect(() => {
    if (!empresaId) return;
    const hoje = new Date();
    Promise.all([
      supabase.from('agendamentos')
        .select(`id, data_hora_inicio, status, valor, comanda_id, pacote_cliente_id,
          cliente:clientes!agendamentos_cliente_id_fkey(id, nome, telefone),
          profissional:users!agendamentos_profissional_id_fkey(id, nome),
          servico:servicos(id, nome, preco)`)
        .eq('empresa_id', empresaId)
        .gte('data_hora_inicio', startOfDay(hoje).toISOString())
        .lte('data_hora_inicio', endOfDay(hoje).toISOString())
        .neq('status', 'cancelado')
        .order('data_hora_inicio'),
      supabase.from('servicos').select('id, nome, preco').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      supabase.from('produtos').select('id, nome, preco_venda').eq('empresa_id', empresaId).eq('ativo', true).eq('tipo', 'venda').order('nome'),
      supabase.from('pacotes').select('id, nome, preco, validade_dias').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
    ]).then(async ([rAgs, rServs, rProds, rPacotes]) => {
      const agsDoDia = (rAgs.data ?? []) as unknown as AgDia[];

      // Taxas de reserva já pagas — buscadas só depois de sabermos os
      // agendamentos do dia, e escopadas a esses ids via `.in(...)`. NUNCA
      // buscar sem esse filtro: o PostgREST limita a 1000 linhas por
      // requisição por padrão e, sem ORDER BY, a truncagem mantém um
      // recorte arbitrário (na prática, as linhas mais antigas) e descarta
      // o resto — é exatamente aí que a taxa paga HOJE cairia sem este
      // filtro, zerando o desconto em silêncio.
      const agIds = agsDoDia.map(ag => ag.id);
      const rTaxasReserva = agIds.length > 0
        ? await supabase.from('taxas_reserva').select('agendamento_id, valor')
            .eq('empresa_id', empresaId).eq('status', 'pago').in('agendamento_id', agIds)
        : { data: [] as { agendamento_id: string; valor: number }[], error: null };

      if (rTaxasReserva.error) {
        console.error('Erro ao buscar taxas de reserva pagas:', rTaxasReserva.error.message);
      }

      setAgDia(agsDoDia);
      setServicos((rServs.data ?? []) as any[]);
      setProdutos((rProds.data ?? []) as any[]);
      setPacotesCat((rPacotes.data ?? []) as { id: string; nome: string; preco: number; validade_dias: number | null }[]);
      setTaxasReservaPagas((rTaxasReserva.data ?? []) as { agendamento_id: string; valor: number }[]);
      setLoading(false);
    });
  }, [empresaId]);

  const clientesDia = useMemo<ClienteComanda[]>(() => {
    const map: Record<string, ClienteComanda> = {};
    for (const ag of agDia) {
      const cid = ag.cliente?.id ?? '__sem__';
      if (!map[cid]) map[cid] = { id: cid, nome: ag.cliente?.nome ?? 'Cliente', telefone: ag.cliente?.telefone, agendamentos: [] };
      map[cid].agendamentos.push(ag);
    }
    return Object.values(map).sort((a, b) => (a.agendamentos[0]?.data_hora_inicio ?? '').localeCompare(b.agendamentos[0]?.data_hora_inicio ?? ''));
  }, [agDia]);

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
  function proximoClienteAberto(excluirId: string): ClienteComanda | null {
    const agora = new Date();
    return clientesDia.find(c =>
      c.id !== excluirId &&
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

  function abrirComanda(cliente: ClienteComanda) {
    setClienteSel(cliente);
    setDesconto('');
    setSplits([]);
    setPacoteVenderPorAgendamento({});

    const linksIniciais: Record<string, string> = {};
    for (const ag of cliente.agendamentos) {
      if (ag.pacote_cliente_id) linksIniciais[ag.id] = ag.pacote_cliente_id;
    }
    setPacoteLinks(linksIniciais);

    // Um atendimento "concluído" sem comanda_id (ex.: marcado direto pelo
    // atalho de status, sem nunca passar por uma comanda) precisa continuar
    // aparecendo aqui pra poder ser cobrado — senão a comanda nasce vazia em
    // R$0. Só sai da lista quando já está vinculado a uma comanda de verdade.
    setItens(
      cliente.agendamentos
        .filter(ag => ag.status !== 'concluido' || !ag.comanda_id)
        .map(ag => ({
          uid: uid(), tipo: 'agendamento', descricao: ag.servico?.nome ?? 'Serviço',
          profissional: ag.profissional?.nome, valor: ag.pacote_cliente_id ? 0 : ag.valor, quantidade: 1,
          agendamento_id: ag.id, servico_id: ag.servico?.id, profissional_id: ag.profissional?.id,
        })),
    );
    setEtapa('comanda');
  }

  function adicionarServico(s: { id: string; nome: string; preco: number }) {
    setItens(prev => [...prev, { uid: uid(), tipo: 'servico', descricao: s.nome, valor: s.preco, quantidade: 1, servico_id: s.id }]);
    setShowExtras(false);
  }
  function adicionarProduto(p: { id: string; nome: string; preco_venda: number }) {
    setItens(prev => [...prev, { uid: uid(), tipo: 'produto', descricao: p.nome, valor: p.preco_venda, quantidade: 1, produto_id: p.id }]);
    setShowExtras(false);
  }
  function removerItem(u: string) { setItens(prev => prev.filter(i => i.uid !== u)); }

  function vincularPacote(agendamentoId: string, pacoteClienteId: string) {
    setPacoteLinks(prev => ({ ...prev, [agendamentoId]: pacoteClienteId }));
    setPacoteVenderPorAgendamento(prev => {
      if (!(agendamentoId in prev)) return prev;
      const { [agendamentoId]: _omit, ...resto } = prev;
      return resto;
    });
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
    setPacoteVenderPorAgendamento(prev => {
      if (!(agendamentoId in prev)) return prev;
      const { [agendamentoId]: _omit, ...resto } = prev;
      return resto;
    });
    const ag = agDia.find(a => a.id === agendamentoId);
    if (!ag) return;
    setItens(prev => prev.map(i => i.agendamento_id === agendamentoId ? { ...i, valor: ag.valor } : i));
  }

  function venderEVincularPacote(agendamentoId: string, pacoteCatalogoId: string) {
    setPacoteVenderPorAgendamento(prev => ({ ...prev, [agendamentoId]: pacoteCatalogoId }));
    // Mesmo raciocínio de `desvincularPacote`: `null` explícito, não apagar a
    // chave — se este atendimento já chegou com um vínculo real no banco
    // (Agenda) que por algum motivo não apareceu como "vinculado" na UI, o
    // valor final gravado no fechamento é sempre sobrescrito pelo id da venda
    // nova (laço de venda em `fecharComanda`); mas se essa venda for pulada
    // (ex.: item removido da comanda antes de fechar), `null` garante que o
    // update individual ainda rode e limpe a coluna, em vez de cair no update
    // em lote e deixar o vínculo antigo sobreviver no banco.
    setPacoteLinks(prev => ({ ...prev, [agendamentoId]: null }));
    setItens(prev => prev.map(i => i.agendamento_id === agendamentoId ? { ...i, valor: 0 } : i));
  }

  const subtotal  = itens.reduce((s, i) => s + i.valor * i.quantidade, 0);
  const descontoN = parseFloat(desconto.replace(',', '.')) || 0;
  const agendamentoIdsNaComanda = itens.filter(i => i.agendamento_id).map(i => i.agendamento_id!);
  const descontoReservaN = somarTaxasReservaPagas(agendamentoIdsNaComanda, taxasReservaPagas);
  const { total, descontoReservaAplicado } = aplicarDescontoReserva(subtotal, descontoN, descontoReservaN);
  const recebido  = splits.reduce((s, x) => s + (parseFloat(x.valor.replace(',', '.')) || 0), 0);
  const restante  = total - recebido;

  function adicionarSplit(metodo: string) {
    const v = Math.max(restante, 0);
    setSplits(prev => [...prev, { metodo, valor: v > 0 ? v.toFixed(2).replace('.', ',') : '' }]);
  }
  function removerSplit(idx: number) { setSplits(prev => prev.filter((_, i) => i !== idx)); }

  async function fecharComanda() {
    if (!clienteSel || !empresaId || fechando) return;
    setFechando(true);

    const { data: comanda, error: errComanda } = await supabase
      .from('comandas').insert({
        empresa_id: empresaId,
        clientes_id: clienteSel.id === '__sem__' ? null : clienteSel.id,
        valor_total: subtotal, desconto: descontoN + descontoReservaAplicado,
        desconto_reserva: descontoReservaAplicado,
        status: 'fechada', fechada_at: new Date().toISOString(),
      }).select('id').single();

    if (errComanda || !comanda) {
      Alert.alert('Erro', errComanda?.message ?? 'Erro ao criar comanda');
      setFechando(false); return;
    }

    const comandaId = comanda.id;
    // Ids dos atendimentos que ainda estão na comanda agora — calculado ANTES
    // do laço de venda de pacote abaixo porque um atendimento marcado pra
    // "vender pacote novo" pode ter sido removido da comanda depois (botão
    // Remover); sem esse filtro o laço venderia um pacote fantasma pra um
    // item que não existe mais aqui.
    const agIds = itens.filter(i => i.agendamento_id).map(i => i.agendamento_id!);

    if (agIds.length > 0) {
      // Resolve pacotes NOVOS escolhidos no vínculo da comanda (cliente sem
      // pacote elegível) — mesmo padrão do web: vende o pacote, registra a
      // receita da venda, e usa o id resultante como o vínculo final da
      // sessão.
      const pacoteLinksFinal: Record<string, string | null> = { ...pacoteLinks };
      for (const [agendamentoId, pacoteCatalogoId] of Object.entries(pacoteVenderPorAgendamento)) {
        // Item removido da comanda depois de marcado pra vender pacote —
        // nada a vender, nada a vincular. Silencioso (não é erro do usuário).
        if (!agIds.includes(agendamentoId)) continue;
        // Walk-in sem cadastro não pode receber pacote (pacote_clientes/vendas
        // exigem cliente_id) — o item já foi zerado na comanda (venderEVincularPacote),
        // então deixar passar em silêncio daria o serviço de graça. Aborta com erro.
        if (clienteSel.id === '__sem__') {
          Alert.alert('Erro', 'Venda de pacote exige cliente cadastrado.');
          setFechando(false);
          return;
        }
        const pacote = pacotesCat.find(p => p.id === pacoteCatalogoId);
        if (!pacote) {
          Alert.alert('Erro', 'Pacote selecionado não encontrado.');
          setFechando(false);
          return;
        }
        const { data: novaVenda, error: errVenda } = await supabase.from('pacote_clientes').insert({
          empresa_id:    empresaId,
          pacote_id:     pacote.id,
          cliente_id:    clienteSel.id,
          data_inicio:   format(new Date(), 'yyyy-MM-dd'),
          data_validade: pacote.validade_dias != null
            ? format(addDays(new Date(), pacote.validade_dias), 'yyyy-MM-dd')
            : null,
          valor_pago:    pacote.preco,
          status:        'ativo',
        }).select('id').single();
        if (errVenda || !novaVenda) { Alert.alert('Erro', errVenda?.message ?? 'Erro ao vender pacote'); setFechando(false); return; }
        pacoteLinksFinal[agendamentoId] = novaVenda.id;
        const { error: errVenda2 } = await supabase.from('vendas').insert({
          empresa_id:  empresaId,
          cliente_id:  clienteSel.id,
          valor_total: pacote.preco,
          desconto:    0,
          observacao:  `Venda de pacote: ${pacote.nome}`,
        });
        if (errVenda2) { Alert.alert('Erro', errVenda2.message); setFechando(false); return; }
        // Move o vínculo de "a vender" pra "já vinculado" no estado — se um
        // passo mais adiante falhar e o usuário tocar em "Fechar comanda" de
        // novo, este laço não deve vender um SEGUNDO pacote pro mesmo
        // atendimento. (O mapa local `pacoteLinksFinal` acima já cobre esta
        // mesma chamada; isto aqui é só pra uma eventual nova tentativa.)
        setPacoteVenderPorAgendamento(prev => {
          const { [agendamentoId]: _omit, ...rest } = prev;
          return rest;
        });
        setPacoteLinks(prev => ({ ...prev, [agendamentoId]: novaVenda.id }));
      }

      // Marcar agendamentos como concluídos + gravar o vínculo de pacote (se
      // houver) no MESMO update do status — o trigger fn_registrar_uso_pacote
      // só dispara na transição pra 'concluido' e só nesse momento lê
      // NEW.pacote_cliente_id; gravar o vínculo num update separado, depois
      // do status já ter virado 'concluido', faria o trigger rodar sem
      // enxergar o vínculo (ele não dispara de novo).
      //
      // A distinção aqui é `undefined` (chave nunca mexida — update em lote,
      // não toca na coluna) vs "presente" (string = vínculo novo/existente,
      // ou `null` = desvínculo explícito — os dois precisam do update
      // individual, porque os dois têm que SOBRESCREVER o que já está no
      // banco). Checar truthiness em vez de `!== undefined` reintroduziria o
      // bug: um `null` explícito também é falsy, cairia no lote errado, e um
      // `pacote_cliente_id` antigo gravado pela Agenda sobreviveria no banco
      // — cobrando o valor cheio na comanda E consumindo a sessão do pacote
      // mesmo assim via trigger.
      const agIdsSemPacote = agIds.filter(id => pacoteLinksFinal[id] === undefined);
      const agIdsComPacote = agIds.filter(id => pacoteLinksFinal[id] !== undefined);

      if (agIdsSemPacote.length > 0) {
        const { error } = await supabase.from('agendamentos')
          .update({ status: 'concluido', comanda_id: comandaId }).in('id', agIdsSemPacote).eq('empresa_id', empresaId);
        if (error) { Alert.alert('Erro', error.message); setFechando(false); return; }
      }
      for (const agendamentoId of agIdsComPacote) {
        const { error } = await supabase.from('agendamentos')
          .update({ status: 'concluido', comanda_id: comandaId, pacote_cliente_id: pacoteLinksFinal[agendamentoId] })
          .eq('id', agendamentoId).eq('empresa_id', empresaId);
        if (error) { Alert.alert('Erro', error.message); setFechando(false); return; }
      }
    }

    const extras = itens.filter(i => i.tipo !== 'agendamento');
    if (extras.length > 0) {
      await supabase.from('comanda_itens').insert(
        extras.map(i => ({
          comanda_id: comandaId, empresa_id: empresaId, tipo: i.tipo,
          descricao: i.descricao, servico_id: i.servico_id ?? null,
          produto_id: i.produto_id ?? null, profissional_id: i.profissional_id ?? null,
          quantidade: i.quantidade, valor_unit: i.valor,
        })),
      );
    }

    const extrasProdutos = extras.filter(i => i.tipo === 'produto' && i.produto_id);
    if (extrasProdutos.length > 0) {
      await supabase.from('estoque_movimentos').insert(
        extrasProdutos.map(i => ({
          produto_id: i.produto_id!, empresa_id: empresaId,
          tipo: 'saida', quantidade: i.quantidade,
          motivo: `Produto via comanda — ${i.descricao}`,
        })),
      );
      const totalProdutos = extrasProdutos.reduce((s, i) => s + i.valor * i.quantidade, 0);
      const { data: venda } = await supabase.from('vendas').insert({
        empresa_id: empresaId,
        cliente_id: clienteSel.id === '__sem__' ? null : clienteSel.id,
        valor_total: totalProdutos, desconto: 0, observacao: 'Via comanda',
      }).select('id').single();
      if (venda) {
        await supabase.from('venda_itens').insert(
          extrasProdutos.map(i => ({
            empresa_id: empresaId, venda_id: venda.id,
            produto_id: i.produto_id!, quantidade: i.quantidade,
            preco_unitario: i.valor,
          })),
        );
      }
    }

    // Se nenhum split foi lançado e o total já fechou em R$ 0 (sessão de
    // pacote cobrindo tudo, ou desconto manual de 100%), grava um "Cortesia"
    // de R$ 0 em vez de deixar sem nenhum registro: fica claro no relatório
    // de formas de pagamento que esse fechamento não gerou cobrança nova,
    // sem somar nada na receita.
    const splitsValidos = splits.filter(s => parseFloat(s.valor.replace(',', '.')) > 0);
    const splitsParaGravar = splitsValidos.length === 0 && total <= 0.01
      ? [{ metodo: 'cortesia', valor: '0' }]
      : splitsValidos;
    if (splitsParaGravar.length > 0) {
      await supabase.from('pagamentos').insert(
        splitsParaGravar.map(s => ({
          empresa_id: empresaId, comanda_id: comandaId,
          valor: parseFloat(s.valor.replace(',', '.')),
          metodo: s.metodo, status: 'pago',
        })),
      );
    }

    setFechando(false);
    setAgDia(prev => prev.map(ag => agIds.includes(ag.id) ? { ...ag, status: 'concluido' } : ag));
    setProximoCliente(proximoClienteAberto(clienteSel.id));
    setSucessoData({
      nome: clienteSel.nome, valor: total, telefone: clienteSel.telefone,
      splits: splitsValidos, itensCount: itens.length,
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
              {fmtBRL(sucessoData.valor)}
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
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: m.cor, flex: 1 }}>{m.label}</Text>
                      <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: m.cor }}>
                        {fmtBRL(parseFloat(s.valor.replace(',', '.')) || 0)}
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
              {sucessoData.descontoReserva > 0 && ` · Taxa de reserva paga ${fmtBRL(sucessoData.descontoReserva)}`}
              {sucessoData.desconto > 0 && ` · Desconto ${fmtBRL(sucessoData.desconto)}`}
            </Text>
            {proximoCliente && (
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3, textAlign: 'center', marginTop: 10 }}>
                Indo para a comanda de {proximoCliente.nome}...
              </Text>
            )}
          </MotiView>

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
              {format(new Date(), "EEEE, d 'de' MMM", { locale: ptBR })}
            </Text>
          </View>
          {totalDia > 0 && (
            <View style={{ backgroundColor: C.greenSoft, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7, alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Total do dia
              </Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.green }}>
                {fmtBRL(totalDia)}
              </Text>
            </View>
          )}
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={C.primary} />
          </View>
        ) : clientesDia.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            <Receipt size={28} color={C.text4} />
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text3, marginTop: 8 }}>
              Nenhum atendimento hoje
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
            {clientesDia.map((cliente, idx) => {
              // "Já cobrado" de verdade = concluído E com comanda vinculada.
              // Concluído sem comanda_id (ex.: status mudado direto, sem
              // nunca fechar) ainda tem algo a cobrar — não pode travar a
              // linha, senão não existe outro jeito de fechar essa comanda.
              const jaCobrado = cliente.agendamentos.every(a => a.status === 'concluido' && a.comanda_id);
              const ag1 = cliente.agendamentos[0];
              const hue = avatarHue(cliente.nome);
              return (
                <MotiView key={cliente.id}
                  from={{ opacity: 0, translateY: 12 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: 'timing', duration: 300, delay: idx * 60 }}>
                  <TouchableOpacity
                    onPress={() => !jaCobrado && abrirComanda(cliente)}
                    disabled={jaCobrado}
                    activeOpacity={0.7}
                    style={{
                      backgroundColor: C.surface, borderRadius: 16, padding: 14,
                      borderWidth: 1, borderColor: C.border,
                      opacity: jaCobrado ? 0.5 : 1,
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
                          {fmtHora(ag1.data_hora_inicio)} · {ag1.servico?.nome ?? '—'}
                        </Text>
                      </View>
                      {jaCobrado ? (
                        <Check size={16} color={C.green} strokeWidth={2.5} />
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
          <TouchableOpacity onPress={() => setEtapa('lista')}
            style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
            <ChevronLeft size={20} color={C.text3} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 15, color: C.text }} numberOfLines={1}>
              {clienteSel?.nome}
            </Text>
            <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3 }}>
              {itens.length} ite{itens.length !== 1 ? 'ns' : 'm'}
            </Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 20 }}>

          {/* ── Itens ── */}
          <View>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10 }}>
              Serviços
            </Text>
            {itens.map(item => (
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
                    {fmtBRL(item.valor * item.quantidade)}
                  </Text>
                  {item.tipo !== 'agendamento' && (
                    <TouchableOpacity onPress={() => removerItem(item.uid)}
                      style={{ width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                      <Trash2 size={14} color={C.red} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Vínculo com sessão de pacote — mobile não tem multi-serviço por
                    atendimento (um agendamento = um item), então não há risco de
                    renderizar o seletor mais de uma vez por atendimento aqui. */}
                {item.tipo === 'agendamento' && item.agendamento_id && (() => {
                  const agendamentoId = item.agendamento_id!;
                  const pacoteVinculado = pacotesClienteAtivos.find(p => p.id === pacoteLinks[agendamentoId]);
                  const pacoteParaVender = pacotesCat.find(p => p.id === pacoteVenderPorAgendamento[agendamentoId]);
                  if (pacoteVinculado || pacoteParaVender) {
                    return (
                      <TouchableOpacity onPress={() => desvincularPacote(agendamentoId)}
                        style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.greenSoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: C.green, flex: 1 }} numberOfLines={1}>
                          {pacoteVinculado ? `Sessão de pacote — ${pacoteVinculado.nome}` : `Novo pacote — ${pacoteParaVender!.nome}`}
                        </Text>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text4 }}>Desvincular</Text>
                      </TouchableOpacity>
                    );
                  }
                  const servicoId = item.servico_id;
                  const elegiveis = servicoId ? pacotesClienteAtivos.filter(p => p.servicos.some(s => s.servico_id === servicoId)) : [];
                  // "Vender pacote novo" exige cliente cadastrado (a venda grava
                  // cliente_id em pacote_clientes/vendas) — não oferecer pra walk-in
                  // (clienteSel.id === '__sem__'), senão a comanda zera o preço do
                  // atendimento e fecha de graça sem nada ter sido vendido de fato.
                  const podeVenderNovo = !!clienteSel && clienteSel.id !== '__sem__';
                  if (elegiveis.length === 0 && (pacotesCat.length === 0 || !podeVenderNovo)) return null;
                  const opcoes = elegiveis.length > 0 ? elegiveis : (podeVenderNovo ? pacotesCat : []);
                  if (opcoes.length === 0) return null;
                  return (
                    <View style={{ marginTop: 8, gap: 4 }}>
                      {opcoes.map((p: any) => (
                        <TouchableOpacity key={p.id}
                          onPress={() => elegiveis.length > 0 ? vincularPacote(agendamentoId, p.id) : venderEVincularPacote(agendamentoId, p.id)}
                          style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }}>
                          <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, color: C.text }} numberOfLines={1}>
                            {elegiveis.length > 0 ? `Vincular: ${p.nome}` : `Vender pacote: ${p.nome}`}
                          </Text>
                          <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11, color: C.text3 }}>
                            {elegiveis.length > 0 ? (p.restantes == null ? 'ilimitado' : `${p.restantes} rest.`) : fmtBRL(p.preco)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  );
                })()}
              </View>
            ))}

            {/* Adicionar extras */}
            <TouchableOpacity onPress={() => setShowExtras(!showExtras)}
              activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed' }}>
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
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text3 }}>{fmtBRL(s.preco)}</Text>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
                {produtos.length > 0 && (
                  <>
                    <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8, marginBottom: 4 }}>Produtos</Text>
                    {produtos.map(p => (
                      <TouchableOpacity key={p.id} onPress={() => adicionarProduto(p)}
                        style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10, backgroundColor: C.surface, marginBottom: 4 }}>
                        <Text style={{ fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, color: C.text }}>{p.nome}</Text>
                        <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: C.text3 }}>{fmtBRL(p.preco_venda)}</Text>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </View>
            )}
          </View>

          {/* ── Desconto ── */}
          <View>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10 }}>Desconto</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderRadius: 14, paddingHorizontal: 14, height: 48, borderWidth: 1, borderColor: C.border }}>
              <Tag size={16} color={C.text3} />
              <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2, marginLeft: 10 }}>Desconto</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.text3, marginRight: 4 }}>R$</Text>
              <TextInput
                value={desconto} onChangeText={setDesconto}
                keyboardType="decimal-pad" placeholder="0,00"
                placeholderTextColor={C.text4}
                style={{ width: 80, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text, textAlign: 'right' }}
              />
            </View>
          </View>

          {/* ── Resumo ── */}
          <View style={{ backgroundColor: C.bg, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2 }}>Subtotal</Text>
              <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.text }}>{fmtBRL(subtotal)}</Text>
            </View>
            {descontoReservaAplicado > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2 }}>Taxa de reserva paga</Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.red }}>− {fmtBRL(descontoReservaAplicado)}</Text>
              </View>
            )}
            {descontoN > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}>
                <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2 }}>(−) Desconto</Text>
                <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.red }}>− {fmtBRL(descontoN)}</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14 }}>
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.text }}>Total</Text>
              <Text style={{ fontFamily: 'Fraunces_600SemiBold', fontSize: 24, color: C.text }}>{fmtBRL(total)}</Text>
            </View>
          </View>

          {/* ── Pagamento ── */}
          <View>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10 }}>Pagamento</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
              {METODOS.map(m => (
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
                  return (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: m.bg, borderRadius: 14, paddingHorizontal: 14, height: 48, borderWidth: 1, borderColor: C.border, gap: 8 }}>
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
                  );
                })}

                {/* Status pagamento */}
                <View style={{
                  borderRadius: 14, padding: 14, borderWidth: 1,
                  backgroundColor: Math.abs(restante) < 0.01 ? C.greenSoft : restante > 0 ? C.amberSoft : C.primarySoft,
                  borderColor: Math.abs(restante) < 0.01 ? '#0D7E5F33' : restante > 0 ? '#B4530933' : '#2C165433',
                }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: C.text2 }}>Recebido</Text>
                    <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.text }}>{fmtBRL(recebido)}</Text>
                  </View>
                  {restante > 0.01 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.amber }}>Falta</Text>
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.amber }}>{fmtBRL(restante)}</Text>
                    </View>
                  )}
                  {restante < -0.01 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                      <Text style={{ fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, color: C.primary }}>Troco</Text>
                      <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.primary }}>{fmtBRL(-restante)}</Text>
                    </View>
                  )}
                  {Math.abs(restante) < 0.01 && (
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
          <TouchableOpacity
            onPress={fecharComanda}
            disabled={fechando || itens.length === 0}
            activeOpacity={0.8}
            style={{
              height: 52, borderRadius: 16, backgroundColor: C.green,
              alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
              opacity: (fechando || itens.length === 0) ? 0.5 : 1,
            }}>
            {fechando ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Check size={18} color="#fff" strokeWidth={2.5} />
                <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: '#fff' }}>
                  Fechar comanda — {fmtBRL(total)}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
