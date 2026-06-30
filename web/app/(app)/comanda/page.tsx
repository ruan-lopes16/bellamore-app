'use client';

/**
 * @file comanda/page.tsx
 * Frente de caixa — Comanda de atendimento.
 *
 * ## Fluxo
 * 1. Página carrega agendamentos do dia (exceto cancelados e já concluídos)
 * 2. Painel esquerdo lista clientes agrupados por horário de atendimento
 * 3. Ao selecionar um cliente, o painel direito abre a comanda com:
 *    - Todos os agendamentos do cliente no dia como itens de serviço
 *    - Possibilidade de adicionar serviços ou produtos extras
 *    - Campo de desconto
 *    - Formas de pagamento (múltiplas — dividir o valor)
 *    - Botão "Fechar comanda"
 *
 * ## Ao fechar
 * 1. INSERT em `comandas` (status = 'fechada', clientes_id, valor_total, desconto)
 * 2. UPDATE em `agendamentos` → status = 'concluido', comanda_id = novo id
 *    (o trigger trg_gerar_comissao dispara automaticamente)
 * 3. INSERT em `comanda_itens` para itens extras (serviços/produtos manuais)
 * 4. INSERT em `pagamentos` para cada split de pagamento
 *
 * ## Cálculo de totais
 * subtotal = Σ (valor × quantidade) de todos os itens
 * total    = subtotal − desconto
 * restante = total − Σ splits registrados
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Clock, User, Plus, Trash2, X, Check, ChevronRight, ChevronLeft,
  Banknote, Zap, CreditCard, Gift, Receipt, Tag, Pencil,
  AlertCircle, Share2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Sk } from '@/components/Skeleton';
import { SearchSelect } from '@/components/SearchSelect';
import {
  format, startOfDay, endOfDay, parseISO,
  addDays, subDays, addMonths, subMonths, isToday, isSameDay, isSameMonth,
  startOfWeek, startOfMonth, endOfMonth, eachDayOfInterval,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { calcTaxa, fmtTaxa, valorLiquido, OPCOES_PARCELAS } from '@/lib/taxas-cartao';
import { toWhatsApp } from '@/lib/masks';

const supabase = createClient();

// ── Tipos ─────────────────────────────────────────────────────

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

type AgServicoDia = { servico: { id: string; nome: string } | null; valor: number; duracao_minutos: number; ordem: number };
type AgDia = {
  id: string;
  data_hora_inicio: string;
  data_hora_fim: string;
  status: string;
  valor: number;
  comanda_id: string | null;
  cliente:      { id: string; nome: string; telefone?: string } | null;
  profissional: { id: string; nome: string } | null;
  servico:      { id: string; nome: string; preco: number }    | null;
  agendamento_servicos: AgServicoDia[];
};

/** Item dentro da comanda (agendamento ou extra) */
type ComandaItem = {
  uid:            string;       // id temporário único
  tipo:           'agendamento' | 'servico' | 'produto';
  descricao:      string;
  profissional?:  string;
  valor:          number;       // valor unitário
  quantidade:     number;
  agendamento_id?: string;
  servico_id?:    string;
  produto_id?:    string;
  profissional_id?: string;
};

type Split = { metodo: string; valor: string; bandeira?: string; parcelas?: number };

type ClienteComanda = {
  id: string;
  nome: string;
  telefone?: string;
  agendamentos: AgDia[];       // todos os ags do dia para esse cliente
};

// ── Constantes ────────────────────────────────────────────────

const METODOS_PAG = [
  { key: 'dinheiro', label: 'Dinheiro', icon: Banknote,   cor: '#16A34A', bg: '#F0FDF4' },
  { key: 'pix',      label: 'PIX',      icon: Zap,        cor: '#4F46E5', bg: '#EEF2FF' },
  { key: 'credito',  label: 'Crédito',  icon: CreditCard, cor: '#D97706', bg: '#FEF3C7' },
  { key: 'debito',   label: 'Débito',   icon: CreditCard, cor: '#9D174D', bg: '#FDF2F8' },
  { key: 'cortesia', label: 'Cortesia', icon: Gift,        cor: '#6B7280', bg: '#F9FAFB' },
] as const;

const BANDEIRAS = [
  { key: 'visa',       label: 'Visa'      },
  { key: 'mastercard', label: 'Master'    },
  { key: 'elo',        label: 'Elo'       },
  { key: 'amex',       label: 'Amex'      },
  { key: 'hipercard',  label: 'Hipercard' },
] as const;

const STATUS_COR: Record<string, string> = {
  agendado:   'bg-amber-soft text-amber',
  confirmado: 'bg-primary-soft text-primary',
  concluido:  'bg-green-soft text-green',
  faltou:     'bg-red-soft text-red',
};

// ── Helpers ───────────────────────────────────────────────────

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);
}
function fmtHora(iso: string) { return format(parseISO(iso), 'HH:mm'); }
function iniciais(nome?: string | null) {
  return (nome ?? '?').split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}
function avatarHue(nome: string) {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 360;
  return h;
}
function avatarGradient(nome: string) {
  const h = avatarHue(nome);
  return `linear-gradient(140deg, oklch(0.55 0.16 ${h}), oklch(0.42 0.17 ${h}))`;
}
function uid() { return crypto.randomUUID(); }

type SucessoRecibo = {
  nome: string;
  valor: number;
  telefone?: string;
  itens: ComandaItem[];
  splits: Split[];
  desconto: number;
  data: Date;
};

const MET_LABELS: Record<string, string> = {
  dinheiro: 'Dinheiro', pix: 'PIX', credito: 'Crédito', debito: 'Débito', cortesia: 'Cortesia',
};
const BAND_LABELS: Record<string, string> = {
  visa: 'Visa', mastercard: 'Master', elo: 'Elo', amex: 'Amex', hipercard: 'Hipercard',
};

function gerarTextoRecibo(s: SucessoRecibo): string {
  const data = format(s.data, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  const linhas: string[] = [
    `🌸 *Recibo de Atendimento*`,
    ``,
    `👤 ${s.nome}`,
    `📅 ${data}`,
    ``,
    `*Serviços:*`,
    ...s.itens.map(i => `• ${i.descricao}${i.quantidade > 1 ? ` (${i.quantidade}x)` : ''} — ${fmtBRL(i.valor * i.quantidade)}`),
    ...(s.desconto > 0 ? [`• Desconto — −${fmtBRL(s.desconto)}`] : []),
    ``,
    `💰 *Total: ${fmtBRL(s.valor)}*`,
    ``,
    `*Pagamento:*`,
    ...s.splits.map(sp => {
      const valorN = parseFloat(sp.valor.replace(',', '.'));
      let label = MET_LABELS[sp.metodo] ?? sp.metodo;
      if (sp.bandeira) label += ` ${BAND_LABELS[sp.bandeira] ?? sp.bandeira}`;
      if (sp.metodo === 'credito' && (sp.parcelas ?? 1) > 1) label += ` ${sp.parcelas}x`;
      return `• ${label} — ${fmtBRL(valorN)}`;
    }),
  ];
  return linhas.join('\n');
}

// ── Componente principal ──────────────────────────────────────

export default function ComandaPage() {
  const [empresaId,         setEmpresaId]         = useState<string | null>(null);
  const [loading,           setLoading]           = useState(true);
  const [agDia,             setAgDia]             = useState<AgDia[]>([]);
  const [dataComanda,       setDataComanda]       = useState<Date>(new Date());
  const [view,              setView]              = useState<'semana' | 'mes'>('semana');
  const [semana,            setSemana]            = useState<Date[]>(() =>
    Array.from({ length: 7 }, (_, i) => addDays(subDays(new Date(), 3), i))
  );
  const [agsMes,            setAgsMes]            = useState<Map<string, number>>(new Map());
  const [comandaExistenteId, setComandaExistenteId] = useState<string | null>(null);

  // Catálogos para pesquisa
  const [servicos,  setServicos]    = useState<{ id: string; nome: string; preco: number }[]>([]);
  const [produtos,  setProdutos]    = useState<{ id: string; nome: string; preco_venda: number }[]>([]);
  const [membros,   setMembros]     = useState<{ id: string; nome: string }[]>([]);

  // Comanda em aberto
  const [clienteSel, setClienteSel] = useState<ClienteComanda | null>(null);
  const [itens,      setItens]      = useState<ComandaItem[]>([]);
  const [descontoPct, setDescontoPct] = useState('');
  const [splits,     setSplits]     = useState<Split[]>([]);
  const [fechando,   setFechando]   = useState(false);
  const [toast,      setToast]      = useState('');
  const [sucesso,    setSucesso]    = useState<SucessoRecibo | null>(null);
  const [erro,       setErro]       = useState('');

  // ── Carregar empresaId
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      if (data) setEmpresaId(data.empresa_id);
    })();
  }, []);

  // ── Carregar dados do dia selecionado
  useEffect(() => {
    if (!empresaId) return;
    setLoading(true);
    setClienteSel(null);
    Promise.all([
      // Agendamentos do dia (exceto cancelados)
      supabase.from('agendamentos')
        .select(`id, data_hora_inicio, data_hora_fim, status, valor, comanda_id,
          cliente:clientes!agendamentos_cliente_id_fkey(id, nome, telefone),
          profissional:users!agendamentos_profissional_id_fkey(id, nome),
          servico:servicos(id, nome, preco),
          agendamento_servicos(servico_id,valor,duracao_minutos,ordem,servico:servicos(id,nome))`)
        .eq('empresa_id', empresaId)
        .gte('data_hora_inicio', startOfDay(dataComanda).toISOString())
        .lte('data_hora_inicio', endOfDay(dataComanda).toISOString())
        .neq('status', 'cancelado')
        .order('data_hora_inicio'),

      // Catálogos
      supabase.from('servicos').select('id, nome, preco').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      supabase.from('produtos').select('id, nome, preco_venda').eq('empresa_id', empresaId).eq('ativo', true).eq('tipo', 'venda').order('nome'),
      supabase.from('empresa_membros')
        .select('user_id, users:users!empresa_membros_user_id_fkey(nome)')
        .eq('empresa_id', empresaId).eq('ativo', true),
    ]).then(([rAgs, rServs, rProds, rMembros]) => {
      setAgDia((rAgs.data ?? []) as unknown as AgDia[]);
      setServicos((rServs.data ?? []) as { id: string; nome: string; preco: number }[]);
      setProdutos((rProds.data ?? []) as { id: string; nome: string; preco_venda: number }[]);
      setMembros((rMembros.data ?? []).map((m: any) => ({
        id: m.user_id, nome: m.users?.nome ?? 'Profissional',
      })));
      setLoading(false);
    });
  }, [empresaId, dataComanda]);

  // Contagem por dia para a visão mensal
  const fetchMes = useCallback(async (mes: Date, empId: string) => {
    const { data: rows } = await supabase
      .from('agendamentos')
      .select('data_hora_inicio')
      .eq('empresa_id', empId)
      .neq('status', 'cancelado')
      .gte('data_hora_inicio', startOfMonth(mes).toISOString())
      .lte('data_hora_inicio', endOfMonth(mes).toISOString());
    const map = new Map<string, number>();
    ((rows ?? []) as { data_hora_inicio: string }[]).forEach(r => {
      const k = format(parseISO(r.data_hora_inicio), 'yyyy-MM-dd');
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    setAgsMes(map);
  }, []);

  useEffect(() => {
    if (!empresaId || view !== 'mes') return;
    fetchMes(dataComanda, empresaId);
  }, [view, dataComanda, empresaId, fetchMes]);

  // ── Navegação
  function navSemana(dir: number) {
    setSemana(s => s.map(d => addDays(d, dir * 7)));
    setDataComanda(d => addDays(d, dir * 7));
  }
  function navMes(dir: number) {
    setDataComanda(d => dir > 0 ? addMonths(d, 1) : subMonths(d, 1));
  }
  function selecionarDia(d: Date) {
    setDataComanda(d);
    setView('semana');
    if (!semana.some(s => isSameDay(s, d)))
      setSemana(Array.from({ length: 7 }, (_, i) => addDays(subDays(d, 3), i)));
  }

  // ── Clientes do dia (agrupados)
  const clientesDia = useMemo<ClienteComanda[]>(() => {
    const map: Record<string, ClienteComanda> = {};
    for (const ag of agDia) {
      const cid = ag.cliente?.id ?? '__sem__';
      if (!map[cid]) {
        map[cid] = {
          id: cid,
          nome: ag.cliente?.nome ?? 'Cliente',
          telefone: ag.cliente?.telefone,
          agendamentos: [],
        };
      }
      map[cid].agendamentos.push(ag);
    }
    return Object.values(map).sort((a, b) => {
      const ha = a.agendamentos[0]?.data_hora_inicio ?? '';
      const hb = b.agendamentos[0]?.data_hora_inicio ?? '';
      return ha.localeCompare(hb);
    });
  }, [agDia]);

  // ── Abrir comanda para um cliente (nova)
  function abrirComanda(cliente: ClienteComanda) {
    setClienteSel(cliente);
    setComandaExistenteId(null);
    setErro('');
    setDescontoPct('');
    setSplits([]);
    // Pré-preenche itens — cada serviço do agendamento vira um item separado
    setItens(
      cliente.agendamentos
        .filter(ag => ag.status !== 'concluido')
        .flatMap(ag => {
          const servicos = [...(ag.agendamento_servicos ?? [])].sort((a, b) => a.ordem - b.ordem);
          if (servicos.length > 0) {
            return servicos.map(s => ({
              uid:             uid(),
              tipo:            'agendamento' as const,
              descricao:       s.servico?.nome ?? 'Serviço',
              profissional:    ag.profissional?.nome,
              valor:           s.valor,
              quantidade:      1,
              agendamento_id:  ag.id,
              servico_id:      s.servico?.id,
              profissional_id: ag.profissional?.id,
            }));
          }
          return [{
            uid:             uid(),
            tipo:            'agendamento' as const,
            descricao:       ag.servico?.nome ?? 'Serviço',
            profissional:    ag.profissional?.nome,
            valor:           ag.valor,
            quantidade:      1,
            agendamento_id:  ag.id,
            servico_id:      ag.servico?.id,
            profissional_id: ag.profissional?.id,
          }];
        })
    );
  }

  // ── Abrir comanda já fechada para edição
  async function abrirComandaFechada(cliente: ClienteComanda) {
    const comandaId = cliente.agendamentos.find(a => a.comanda_id)?.comanda_id ?? null;
    if (!comandaId) { abrirComanda(cliente); return; }

    setClienteSel(cliente);
    setComandaExistenteId(comandaId);
    setErro(''); setDescontoPct(''); setSplits([]);

    const agItems: ComandaItem[] = cliente.agendamentos.flatMap(ag => {
      const servicos = [...(ag.agendamento_servicos ?? [])].sort((a, b) => a.ordem - b.ordem);
      if (servicos.length > 0) {
        return servicos.map(s => ({
          uid: uid(), tipo: 'agendamento' as const,
          descricao: s.servico?.nome ?? 'Serviço',
          profissional: ag.profissional?.nome,
          valor: s.valor, quantidade: 1,
          agendamento_id: ag.id,
          servico_id: s.servico?.id,
          profissional_id: ag.profissional?.id,
        }));
      }
      return [{
        uid: uid(), tipo: 'agendamento' as const,
        descricao: ag.servico?.nome ?? 'Serviço',
        profissional: ag.profissional?.nome,
        valor: ag.valor, quantidade: 1,
        agendamento_id: ag.id,
        servico_id: ag.servico?.id,
        profissional_id: ag.profissional?.id,
      }];
    });

    const [{ data: cmd }, { data: extraItems }, { data: pags }] = await Promise.all([
      supabase.from('comandas').select('desconto').eq('id', comandaId).single(),
      supabase.from('comanda_itens').select('tipo,descricao,servico_id,produto_id,profissional_id,quantidade,valor_unit').eq('comanda_id', comandaId),
      supabase.from('pagamentos').select('metodo,valor,bandeira,parcelas').eq('comanda_id', comandaId),
    ]);

    setDescontoPct('');

    const extras: ComandaItem[] = (extraItems ?? []).map((item: any) => ({
      uid: uid(), tipo: item.tipo as 'servico' | 'produto',
      descricao: item.descricao ?? '—',
      valor: item.valor_unit, quantidade: item.quantidade,
      servico_id: item.servico_id ?? undefined,
      produto_id: item.produto_id ?? undefined,
      profissional_id: item.profissional_id ?? undefined,
    }));

    setItens([...agItems, ...extras]);
    setSplits((pags ?? []).map((p: any) => ({
      metodo:   p.metodo,
      valor:    Number(p.valor).toFixed(2).replace('.', ','),
      bandeira: p.bandeira ?? undefined,
      parcelas: p.parcelas ?? 1,
    })));
  }

  // ── Editar comanda já fechada (UPDATE ao invés de INSERT)
  async function editarComanda(comandaId: string) {
    setFechando(true); setErro('');

    const { error: errCmd } = await supabase.from('comandas')
      .update({ valor_total: subtotal, desconto: descontoN })
      .eq('id', comandaId);
    if (errCmd) { setErro(errCmd.message); setFechando(false); return; }

    // Substitui itens extras
    await supabase.from('comanda_itens').delete().eq('comanda_id', comandaId);
    const extras = itens.filter(i => i.tipo !== 'agendamento');
    if (extras.length > 0) {
      await supabase.from('comanda_itens').insert(
        extras.map(i => ({
          comanda_id: comandaId, empresa_id: empresaId,
          tipo: i.tipo, descricao: i.descricao,
          servico_id: i.servico_id ?? null,
          produto_id: i.produto_id ?? null,
          profissional_id: i.profissional_id ?? null,
          quantidade: i.quantidade, valor_unit: i.valor,
        }))
      );
    }

    // Substitui pagamentos
    await supabase.from('pagamentos').delete().eq('comanda_id', comandaId);
    const splitsValidos = splits.filter(s => parseFloat(s.valor.replace(',', '.')) > 0);
    if (splitsValidos.length > 0) {
      const { error: errPag } = await supabase.from('pagamentos').insert(
        splitsValidos.map(s => {
          const v    = parseFloat(s.valor.replace(',', '.'));
          const parc = s.metodo === 'credito' ? (s.parcelas ?? 1) : 1;
          const taxa = calcTaxa(s.metodo, parc);
          return {
            empresa_id:    empresaId,
            comanda_id:    comandaId,
            valor:         v,
            metodo:        s.metodo,
            bandeira:      (s.metodo === 'credito' || s.metodo === 'debito') ? (s.bandeira ?? null) : null,
            parcelas:      parc,
            taxa_perc:     taxa > 0 ? taxa : null,
            valor_liquido: taxa > 0 ? valorLiquido(v, taxa) : null,
            status:        'pago',
          };
        })
      );
      if (errPag) { setErro(errPag.message); setFechando(false); return; }
    }

    setFechando(false);
    const nomeCliente = clienteSel?.nome ?? '—';
    const telefoneCliente = clienteSel?.telefone;
    const reciboItens = [...itens];
    const reciboSplits = [...splits];
    const reciboDesconto = descontoN;
    setClienteSel(null);
    setComandaExistenteId(null);
    setSucesso({ nome: nomeCliente, valor: subtotal - descontoN, telefone: telefoneCliente, itens: reciboItens, splits: reciboSplits, desconto: reciboDesconto, data: new Date() });
  }

  // ── Itens: adicionar/remover
  function adicionarServico(servicoId: string) {
    const s = servicos.find(x => x.id === servicoId);
    if (!s) return;
    setItens(prev => [...prev, {
      uid: uid(), tipo: 'servico', descricao: s.nome, valor: s.preco, quantidade: 1, servico_id: s.id,
    }]);
  }
  function adicionarProduto(prodId: string) {
    const p = produtos.find(x => x.id === prodId);
    if (!p) return;
    setItens(prev => [...prev, {
      uid: uid(), tipo: 'produto', descricao: p.nome, valor: p.preco_venda, quantidade: 1, produto_id: p.id,
    }]);
  }
  function removerItem(u: string) {
    setItens(prev => prev.filter(i => i.uid !== u));
  }
  function atualizarValor(u: string, v: string) {
    const n = parseFloat(v.replace(',', '.'));
    setItens(prev => prev.map(i => i.uid === u ? { ...i, valor: isNaN(n) ? i.valor : n } : i));
  }
  function atualizarQtd(u: string, v: string) {
    const n = parseFloat(v.replace(',', '.'));
    setItens(prev => prev.map(i => i.uid === u ? { ...i, quantidade: isNaN(n) || n <= 0 ? 1 : n } : i));
  }
  function atualizarProfissional(u: string, profId: string) {
    const m = membros.find(x => x.id === profId);
    setItens(prev => prev.map(i =>
      i.uid === u ? { ...i, profissional_id: profId, profissional: m?.nome } : i
    ));
  }

  // ── Totais
  const subtotal  = itens.reduce((s, i) => s + i.valor * i.quantidade, 0);
  const descontoPctN = parseFloat(descontoPct.replace(',', '.')) || 0;
  const descontoN    = subtotal * (descontoPctN / 100);
  const total        = Math.max(subtotal - descontoN, 0);
  const recebido  = splits.reduce((s, x) => s + (parseFloat(x.valor.replace(',', '.')) || 0), 0);
  const restante  = total - recebido;

  // ── Splits de pagamento
  function adicionarSplit(metodo: string) {
    const valorPre = Math.max(restante, 0);
    setSplits(prev => [...prev, {
      metodo,
      valor: valorPre > 0 ? valorPre.toFixed(2).replace('.', ',') : '',
    }]);
  }
  function atualizarSplit(idx: number, valor: string) {
    setSplits(prev => prev.map((s, i) => i === idx ? { ...s, valor } : s));
  }
  function removerSplit(idx: number) {
    setSplits(prev => prev.filter((_, i) => i !== idx));
  }
  function atualizarSplitBandeira(idx: number, bandeira: string) {
    setSplits(prev => prev.map((s, i) => i === idx ? { ...s, bandeira } : s));
  }
  function atualizarSplitParcelas(idx: number, parcelas: number) {
    setSplits(prev => prev.map((s, i) => i === idx ? { ...s, parcelas } : s));
  }

  // ── Fechar / salvar comanda
  async function fecharComanda() {
    if (!clienteSel || !empresaId || fechando) return;
    if (comandaExistenteId) { await editarComanda(comandaExistenteId); return; }
    setFechando(true); setErro('');

    // 1. Criar comanda no banco
    const { data: comanda, error: errComanda } = await supabase
      .from('comandas').insert({
        empresa_id:  empresaId,
        clientes_id: clienteSel.id === '__sem__' ? null : clienteSel.id,
        valor_total: subtotal,
        desconto:    descontoN,
        status:      'fechada',
        fechada_at:  new Date().toISOString(),
      }).select('id').single();

    if (errComanda || !comanda) {
      setErro(errComanda?.message ?? 'Erro ao criar comanda');
      setFechando(false); return;
    }

    const comandaId = comanda.id;

    // 2. Marcar agendamentos como concluídos (trigger gera comissão automaticamente)
    const agIds = itens.filter(i => i.agendamento_id).map(i => i.agendamento_id!);
    if (agIds.length > 0) {
      const { error: errAg } = await supabase
        .from('agendamentos')
        .update({ status: 'concluido', comanda_id: comandaId })
        .in('id', agIds);
      if (errAg) { setErro(errAg.message); setFechando(false); return; }
    }

    // 3. Inserir itens extras (serviços e produtos manuais)
    const extras = itens.filter(i => i.tipo !== 'agendamento');
    if (extras.length > 0) {
      const { error: errItens } = await supabase.from('comanda_itens').insert(
        extras.map(i => ({
          comanda_id:      comandaId,
          empresa_id:      empresaId,
          tipo:            i.tipo,
          descricao:       i.descricao,
          servico_id:      i.servico_id ?? null,
          produto_id:      i.produto_id ?? null,
          profissional_id: i.profissional_id ?? null,
          quantidade:      i.quantidade,
          valor_unit:      i.valor,
        }))
      );
      if (errItens) { setErro(errItens.message); setFechando(false); return; }
    }

    // 3b. Descontar estoque dos produtos extras
    const extrasProdutos = extras.filter(i => i.tipo === 'produto' && i.produto_id);
    if (extrasProdutos.length > 0) {
      const { error: errEst } = await supabase.from('estoque_movimentos').insert(
        extrasProdutos.map(i => ({
          produto_id: i.produto_id!,
          empresa_id: empresaId,
          tipo:       'saida',
          quantidade: i.quantidade,
          motivo:     `Produto via comanda — ${i.descricao}`,
        }))
      );
      if (errEst) { setErro(errEst.message); setFechando(false); return; }
    }

    // 3c. Registrar venda avulsa dos produtos (para histórico do cliente e módulo de vendas)
    if (extrasProdutos.length > 0) {
      const totalProdutos = extrasProdutos.reduce((s, i) => s + i.valor * i.quantidade, 0);
      const { data: venda } = await supabase.from('vendas').insert({
        empresa_id:  empresaId,
        cliente_id:  clienteSel.id === '__sem__' ? null : clienteSel.id,
        valor_total: totalProdutos,
        desconto:    0,
        observacao:  `Via comanda`,
      }).select('id').single();

      if (venda) {
        await supabase.from('venda_itens').insert(
          extrasProdutos.map(i => ({
            empresa_id:     empresaId,
            venda_id:       venda.id,
            produto_id:     i.produto_id!,
            quantidade:     i.quantidade,
            preco_unitario: i.valor,
          }))
        );
      }
    }

    // 4. Inserir pagamentos
    const splitsValidos = splits.filter(s => parseFloat(s.valor.replace(',', '.')) > 0);
    if (splitsValidos.length > 0) {
      const { error: errPag } = await supabase.from('pagamentos').insert(
        splitsValidos.map(s => {
          const v    = parseFloat(s.valor.replace(',', '.'));
          const parc = s.metodo === 'credito' ? (s.parcelas ?? 1) : 1;
          const taxa = calcTaxa(s.metodo, parc);
          return {
            empresa_id:    empresaId,
            comanda_id:    comandaId,
            valor:         v,
            metodo:        s.metodo,
            bandeira:      (s.metodo === 'credito' || s.metodo === 'debito') ? (s.bandeira ?? null) : null,
            parcelas:      parc,
            taxa_perc:     taxa > 0 ? taxa : null,
            valor_liquido: taxa > 0 ? valorLiquido(v, taxa) : null,
            status:        'pago',
          };
        })
      );
      if (errPag) { setErro(errPag.message); setFechando(false); return; }
    }

    setFechando(false);

    // Atualiza lista local — marca ags como concluídos
    setAgDia(prev => prev.map(ag =>
      agIds.includes(ag.id) ? { ...ag, status: 'concluido' } : ag
    ));

    // Mostra tela de sucesso com checkmark animado (design Bellamore)
    const nomeCliente = clienteSel.nome;
    const telefoneCliente = clienteSel.telefone;
    const reciboItens = [...itens];
    const reciboSplits = [...splits];
    const reciboDesconto = descontoN;
    setClienteSel(null);
    setSucesso({ nome: nomeCliente, valor: subtotal - descontoN, telefone: telefoneCliente, itens: reciboItens, splits: reciboSplits, desconto: reciboDesconto, data: new Date() });
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="bm-page flex gap-0 -mt-6 -mb-24 -mx-4 md:-mt-8 md:-mb-10 md:-mx-8 overflow-hidden" style={{ height: '100dvh' }}>

      {/* ════ PAINEL ESQUERDO — clientes do dia ════ */}
      <div className={`${clienteSel ? 'hidden md:flex' : 'flex'} md:w-[26rem] w-full flex-shrink-0 border-r border-border flex-col bg-bg`}>
        {/* Header — título + toggle + week strip */}
        <div className="px-3 pt-3 pb-2 border-b border-border flex-shrink-0">
          {/* Linha 1: título + toggle Semana/Mês */}
          <div className="flex items-center justify-between mb-2">
            <div>
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em' }} className="capitalize">
                {format(dataComanda, 'MMMM yyyy', { locale: ptBR })}
              </p>
              <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>Comanda</h1>
            </div>
            <div style={{ display: 'flex', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
              {(['semana', 'mes'] as const).map(v => (
                <button key={v} onClick={() => setView(v)}
                  style={view === v
                    ? { background: 'var(--color-primary)', color: '#fff', fontWeight: 700, fontFamily: 'var(--font-sans)', fontSize: 11, padding: '6px 10px' }
                    : { color: 'var(--color-ink3)', fontWeight: 600, fontFamily: 'var(--font-sans)', fontSize: 11, padding: '6px 10px' }}>
                  {v === 'semana' ? 'Semana' : 'Mês'}
                </button>
              ))}
            </div>
          </div>

          {/* Week strip — só visível no modo Semana */}
          {view === 'semana' && <div className="overflow-x-auto">
            <div className="flex items-center gap-0.5">
              <button onClick={() => navSemana(-1)}
                className="w-7 h-7 rounded-[10px] flex items-center justify-center text-text-3 hover:bg-surface flex-shrink-0 transition">
                <ChevronLeft size={14}/>
              </button>
              <div className="flex gap-0.5 flex-1 justify-between">
                {semana.map((d, i) => {
                  const sel = isSameDay(d, dataComanda);
                  const hj  = isToday(d);
                  return (
                    <button key={d.toISOString()} onClick={() => selecionarDia(d)}
                      className="flex flex-col items-center rounded-[12px] py-1.5 flex-1 transition"
                      style={{ background: sel ? 'var(--color-primary)' : 'transparent' }}>
                      <span style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', fontFamily: 'var(--font-sans)', color: sel ? 'rgba(255,255,255,0.7)' : 'var(--color-ink4)', marginBottom: 2 }}>{DIAS[d.getDay()]}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-sans)', color: sel ? '#fff' : hj ? 'var(--color-accent)' : 'var(--color-ink2)' }}>{format(d, 'd')}</span>
                    </button>
                  );
                })}
              </div>
              <button onClick={() => navSemana(1)}
                className="w-7 h-7 rounded-[10px] flex items-center justify-center text-text-3 hover:bg-surface flex-shrink-0 transition">
                <ChevronRight size={14}/>
              </button>
            </div>
          </div>}
        </div>

        {/* Conteúdo: lista de clientes ou calendário mensal */}
        <div className="flex-1 overflow-y-auto">
          {view === 'mes' ? (
            /* ── Visão mensal ── */
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => navMes(-1)} className="w-7 h-7 rounded-lg flex items-center justify-center text-text-3 hover:bg-surface transition"><ChevronLeft size={14}/></button>
                <p className="text-xs font-bold text-text-2 capitalize">{format(dataComanda, 'MMMM yyyy', { locale: ptBR })}</p>
                <button onClick={() => navMes(1)} className="w-7 h-7 rounded-lg flex items-center justify-center text-text-3 hover:bg-surface transition"><ChevronRight size={14}/></button>
              </div>
              <div className="grid grid-cols-7 gap-0.5 mb-1">
                {DIAS.map(d => <div key={d} className="text-center text-[9px] font-semibold text-text-4 py-1">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {eachDayOfInterval({
                  start: startOfWeek(startOfMonth(dataComanda), { weekStartsOn: 0 }),
                  end: (() => { const e = new Date(startOfWeek(startOfMonth(dataComanda), { weekStartsOn: 0 })); e.setDate(e.getDate() + 41); return e; })(),
                }).map(d => {
                  const key    = format(d, 'yyyy-MM-dd');
                  const count  = agsMes.get(key) ?? 0;
                  const sel    = isSameDay(d, dataComanda);
                  const hj     = isToday(d);
                  const dMes   = isSameMonth(d, dataComanda);
                  return (
                    <div key={key} className="relative">
                      <button onClick={() => selecionarDia(d)}
                        className={`w-full aspect-square flex items-center justify-center rounded-lg text-xs font-bold transition
                          ${sel ? 'bg-primary text-white' : hj ? 'bg-primary-soft text-primary' : dMes ? 'hover:bg-surface text-text-2' : 'text-text-4 hover:bg-surface'}`}>
                        {format(d, 'd')}
                      </button>
                      {count > 0 && !sel && (
                        <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent pointer-events-none"/>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : loading ? (
            <div className="p-3 flex flex-col gap-2">
              {[1, 2, 3, 4].map(i => <Sk key={i} className="h-16 rounded-xl" />)}
            </div>
          ) : clientesDia.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 py-8">
              <Receipt size={28} className="text-text-4 mb-2" />
              <p className="text-sm text-text-3">
                {isToday(dataComanda) ? 'Nenhum atendimento hoje' : 'Nenhum atendimento neste dia'}
              </p>
            </div>
          ) : (
            <div className="p-2 flex flex-col gap-1">
              {clientesDia.map(cliente => {
                const ativo  = clienteSel?.id === cliente.id;
                const jaFeita = cliente.agendamentos.every(a => a.status === 'concluido');
                const primeiroAg = cliente.agendamentos[0];
                return (
                  <button
                    key={cliente.id}
                    onClick={() => jaFeita ? abrirComandaFechada(cliente) : abrirComanda(cliente)}
                    className={`w-full text-left rounded-xl p-3 transition-colors border ${
                      ativo
                        ? 'bg-primary-soft border-primary/30'
                        : jaFeita
                        ? 'bg-bg border-border opacity-60 hover:opacity-100 hover:border-accent/40'
                        : 'bg-surface border-border hover:border-accent/40'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                        style={{ background: avatarGradient(cliente.nome) }}>
                        {iniciais(cliente.nome)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-text truncate">{cliente.nome}</p>
                        <p className="text-xs text-text-3 truncate">
                          {fmtHora(primeiroAg.data_hora_inicio)} · {
                            (primeiroAg.agendamento_servicos ?? []).length > 0
                              ? [...(primeiroAg.agendamento_servicos ?? [])].sort((a, b) => a.ordem - b.ordem).map(s => s.servico?.nome).filter(Boolean).join(' + ')
                              : primeiroAg.servico?.nome ?? '—'
                          }
                        </p>
                      </div>
                      {jaFeita ? (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Check size={12} className="text-green" strokeWidth={2.5}/>
                          <Pencil size={11} className="text-text-4" strokeWidth={2}/>
                        </div>
                      ) : (
                        <ChevronRight size={14} className="text-text-4 flex-shrink-0"/>
                      )}
                    </div>
                    {/* Badges de agendamentos */}
                    {cliente.agendamentos.length > 1 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {cliente.agendamentos.map(ag => (
                          <span key={ag.id}
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${STATUS_COR[ag.status] ?? 'bg-bg text-text-3'}`}>
                            {fmtHora(ag.data_hora_inicio)}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ════ PAINEL DIREITO — comanda ════ */}
      <div className={`${!clienteSel ? 'hidden md:flex' : 'flex'} flex-1 flex-col overflow-hidden bg-surface relative`}>
        {/* Toast de feedback */}
        {toast && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-green text-white text-sm font-semibold px-5 py-2.5 rounded-full shadow-lg flex items-center gap-2 pointer-events-none">
            <Check size={15} strokeWidth={3}/>{toast}
          </div>
        )}

        {/* Tela de sucesso — checkmark desenhado (design Bellamore) */}
        {sucesso && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-surface"
            style={{ animation: 'bm-screen .35s cubic-bezier(.2,.85,.3,1)' }}>
            <div className="flex items-center justify-center rounded-full"
              style={{ width: 84, height: 84, background: 'var(--color-green-soft)', boxShadow: '0 6px 20px rgba(44,23,80,0.09)', animation: 'bm-pop .5s cubic-bezier(.2,.9,.3,1) both' }}>
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--color-green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" style={{ strokeDasharray: 30, strokeDashoffset: 30, animation: 'bm-draw .55s .3s ease forwards' }}/>
              </svg>
            </div>
            <h2 className="text-3xl text-text text-center" style={{ fontFamily: 'var(--font-serif)' }}>Comanda fechada!</h2>
            <p className="text-text-2 text-sm text-center">
              {sucesso.nome} · {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(sucesso.valor)}
            </p>
            <div className="flex flex-col items-center gap-2 mt-2 w-full max-w-xs">
              {sucesso.telefone && (
                <button
                  onClick={() => {
                    const texto = gerarTextoRecibo(sucesso);
                    const tel = sucesso.telefone!.replace(/\D/g, '');
                    window.open(`https://wa.me/55${tel}?text=${encodeURIComponent(texto)}`, '_blank');
                  }}
                  className="press w-full px-8 py-3.5 rounded-2xl text-white text-sm font-bold flex items-center justify-center gap-2"
                  style={{ background: 'var(--color-green)', boxShadow: '0 6px 20px rgba(21,122,91,0.3)' }}>
                  <Share2 size={16}/>
                  Compartilhar recibo
                </button>
              )}
              <button onClick={() => setSucesso(null)}
                className="press w-full px-8 py-3.5 rounded-2xl text-sm font-bold border border-border text-text-2">
                Voltar
              </button>
            </div>
          </div>
        )}

        {!clienteSel ? (
          /* Estado vazio */
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-bg flex items-center justify-center mb-4">
              <Receipt size={28} className="text-text-4"/>
            </div>
            <h2 className="text-2xl text-text mb-2" style={{ fontFamily: 'var(--font-serif)' }}>Nenhuma comanda aberta</h2>
            <p className="text-sm text-text-3 max-w-xs">
              Selecione um cliente na lista ao lado para abrir a comanda do atendimento.
            </p>
          </div>
        ) : (
          /* Comanda aberta */
          <>
            {/* Header da comanda */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white"
                  style={{ background: avatarGradient(clienteSel.nome) }}>
                  {iniciais(clienteSel.nome)}
                </div>
                <div>
                  <h2 className="font-semibold text-text">{clienteSel.nome}</h2>
                  <p className="text-xs text-text-3">
                    {clienteSel.agendamentos.length} serviço{clienteSel.agendamentos.length !== 1 ? 's' : ''} agendado{clienteSel.agendamentos.length !== 1 ? 's' : ''}
                    {clienteSel.telefone && ` · ${clienteSel.telefone}`}
                  </p>
                </div>
              </div>
              <button onClick={() => setClienteSel(null)}
                className="flex items-center gap-1.5 px-3 h-8 rounded-xl hover:bg-bg text-text-3 transition text-xs font-semibold">
                <X size={14}/>
                <span className="hidden sm:inline">Fechar</span>
              </button>
            </div>

            {/* Corpo da comanda — scrollável */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-2xl mx-auto px-6 py-5 flex flex-col gap-6">

                {/* ── Seção: Serviços ── */}
                <section>
                  <p className="text-xs font-bold text-text-3 uppercase tracking-widest mb-3">
                    Serviços
                  </p>
                  <div className="flex flex-col gap-2">
                    {itens.map(item => (
                      <div key={item.uid}
                        className={`rounded-xl px-4 py-3 border ${
                          item.tipo === 'agendamento'
                            ? 'bg-primary-soft border-primary/20'
                            : item.tipo === 'produto'
                            ? 'bg-amber-soft border-amber/20'
                            : 'bg-bg border-border'
                        }`}
                      >
                        {/* Linha principal */}
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-text truncate">{item.descricao}</p>
                            {item.profissional && (
                              <p className="text-xs text-text-3 flex items-center gap-1 mt-0.5">
                                <User size={10} strokeWidth={2}/>{item.profissional}
                              </p>
                            )}
                          </div>
                          {/* Quantidade (só itens extras) */}
                          {item.tipo !== 'agendamento' && (
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <span className="text-xs text-text-3">Qtd</span>
                              <input
                                defaultValue={item.quantidade}
                                onBlur={e => atualizarQtd(item.uid, e.target.value)}
                                inputMode="decimal"
                                className="w-14 h-8 px-2 text-sm text-center font-semibold rounded-lg border border-border bg-surface focus:outline-none focus:border-accent transition"
                              />
                            </div>
                          )}
                          {/* Valor editável */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <span className="text-xs text-text-3">R$</span>
                            <input
                              defaultValue={item.valor.toFixed(2).replace('.', ',')}
                              onBlur={e => atualizarValor(item.uid, e.target.value)}
                              inputMode="decimal"
                              className="w-20 h-8 px-2 text-sm text-right font-semibold rounded-lg border border-border bg-surface focus:outline-none focus:border-accent transition"
                            />
                          </div>
                          {item.tipo !== 'agendamento' && (
                            <button onClick={() => removerItem(item.uid)}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition flex-shrink-0">
                              <Trash2 size={13}/>
                            </button>
                          )}
                        </div>
                        {/* Seletor de profissional para serviços extras */}
                        {item.tipo === 'servico' && (
                          <div className="mt-2">
                            <select
                              value={item.profissional_id ?? ''}
                              onChange={e => atualizarProfissional(item.uid, e.target.value)}
                              className="w-full h-8 px-2 text-xs rounded-lg border border-border bg-surface focus:outline-none focus:border-accent transition text-text-2"
                            >
                              <option value="">Profissional (opcional)</option>
                              {membros.map(m => (
                                <option key={m.id} value={m.id}>{m.nome}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Adicionar serviço extra */}
                    <SearchSelect
                      options={servicos.map(s => ({ value: s.id, label: s.nome, sub: fmtBRL(s.preco) }))}
                      value=""
                      onChange={adicionarServico}
                      placeholder="+ Adicionar serviço extra..."
                    />
                    {/* Adicionar produto */}
                    <SearchSelect
                      options={produtos.map(p => ({ value: p.id, label: p.nome, sub: fmtBRL(p.preco_venda) }))}
                      value=""
                      onChange={adicionarProduto}
                      placeholder="+ Adicionar produto / bebida..."
                    />
                  </div>
                </section>

                {/* ── Seção: Desconto ── */}
                <section>
                  <p className="text-xs font-bold text-text-3 uppercase tracking-widest mb-3">
                    Desconto
                  </p>
                  <div className="flex items-center gap-3 bg-bg rounded-xl px-4 py-3 border border-border">
                    <Tag size={16} className="text-text-3 flex-shrink-0"/>
                    <span className="text-sm text-text-2 flex-1">Desconto</span>
                    <div className="relative">
                      <input
                        value={descontoPct}
                        onChange={e => setDescontoPct(e.target.value)}
                        inputMode="decimal"
                        placeholder="0"
                        className="w-20 h-8 px-2 pr-7 text-sm text-right rounded-lg border border-border bg-surface focus:outline-none focus:border-accent transition font-semibold"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-text-3 font-bold">%</span>
                    </div>
                  </div>
                </section>

                {/* ── Seção: Resumo de valores ── */}
                <section className="bg-bg rounded-xl border border-border overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <span className="text-sm text-text-2">Subtotal</span>
                    <span className="text-sm font-semibold text-text">{fmtBRL(subtotal)}</span>
                  </div>
                  {descontoN > 0 && (
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                      <span className="text-sm text-text-2">(−) Desconto <span className="text-xs text-text-4">{descontoPctN}%</span></span>
                      <span className="text-sm font-semibold text-red">− {fmtBRL(descontoN)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between px-4 py-4">
                    <span className="text-base font-bold text-text">Total</span>
                    <span className="text-2xl font-bold text-text" style={{ letterSpacing: '-0.02em' }}>{fmtBRL(total)}</span>
                  </div>
                </section>

                {/* ── Seção: Pagamento ── */}
                <section>
                  <p className="text-xs font-bold text-text-3 uppercase tracking-widest mb-3">
                    Forma de pagamento
                  </p>

                  {/* Chips de método */}
                  <div className="flex flex-wrap gap-2 mb-3">
                    {METODOS_PAG.map(({ key, label, icon: Icon, cor, bg }) => (
                      <button key={key} onClick={() => adicionarSplit(key)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-sm font-semibold transition hover:border-accent"
                        style={{ background: bg, color: cor }}>
                        <Icon size={14} strokeWidth={2}/>{label}
                      </button>
                    ))}
                  </div>

                  {/* Splits */}
                  {splits.length > 0 && (
                    <div className="flex flex-col gap-2 mb-3">
                      {splits.map((s, i) => {
                        const m = METODOS_PAG.find(x => x.key === s.metodo) ?? METODOS_PAG[0];
                        const IconM = m.icon;
                        const isCard = s.metodo === 'credito' || s.metodo === 'debito';
                        return (
                          <div key={i} className="flex flex-col gap-2 rounded-xl px-4 py-3 border border-border"
                            style={{ background: m.bg }}>
                            <div className="flex items-center gap-3">
                              <IconM size={16} strokeWidth={2} style={{ color: m.cor }} className="flex-shrink-0"/>
                              <span className="text-sm font-semibold flex-1" style={{ color: m.cor }}>{m.label}</span>
                              <span className="text-xs text-text-3">R$</span>
                              <input
                                value={s.valor}
                                onChange={e => atualizarSplit(i, e.target.value)}
                                inputMode="decimal"
                                placeholder="0,00"
                                className="w-28 h-9 px-3 text-sm text-right rounded-xl border border-border bg-surface focus:outline-none focus:border-accent transition font-semibold"
                              />
                              <button onClick={() => removerSplit(i)}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition flex-shrink-0">
                                <X size={13}/>
                              </button>
                            </div>
                            {isCard && (
                              <div className="flex gap-1.5 flex-wrap">
                                {BANDEIRAS.map(b => (
                                  <button key={b.key} type="button" onClick={() => atualizarSplitBandeira(i, b.key)}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${
                                      s.bandeira === b.key
                                        ? 'bg-white/60 border-current'
                                        : 'border-border/50 opacity-60 hover:opacity-100 hover:border-current'
                                    }`}
                                    style={{ color: m.cor }}>
                                    {b.label}
                                  </button>
                                ))}
                              </div>
                            )}
                            {s.metodo === 'credito' && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-text-3 flex-shrink-0">Parcelas:</span>
                                <select
                                  value={s.parcelas ?? 1}
                                  onChange={e => atualizarSplitParcelas(i, Number(e.target.value))}
                                  className="h-7 px-2 rounded-lg border border-border/50 bg-surface text-xs font-semibold focus:outline-none focus:border-accent transition"
                                  style={{ color: m.cor }}>
                                  {OPCOES_PARCELAS.map(n => (
                                    <option key={n} value={n}>{n}x{n === 1 ? ' (à vista)' : ''}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                            {isCard && (() => {
                              const valorN = parseFloat(s.valor.replace(',', '.')) || 0;
                              const taxa   = calcTaxa(s.metodo, s.parcelas ?? 1);
                              const liq    = valorLiquido(valorN, taxa);
                              if (!valorN) return null;
                              return (
                                <div className="flex items-center justify-between text-xs opacity-70" style={{ color: m.cor }}>
                                  <span>Taxa {fmtTaxa(taxa)}</span>
                                  <span>Líquido {fmtBRL(liq)}</span>
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Resumo de pagamento */}
                  {splits.length > 0 && (
                    <div className={`rounded-xl p-4 border ${
                      Math.abs(restante) < 0.01
                        ? 'bg-green-soft border-green/20'
                        : restante > 0
                        ? 'bg-amber-soft border-amber/20'
                        : 'bg-primary-soft border-primary/20'
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-2">Recebido</span>
                        <span className="text-sm font-bold text-text">{fmtBRL(recebido)}</span>
                      </div>
                      {restante > 0.01 && (
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-sm font-semibold text-amber">Falta</span>
                          <span className="text-sm font-bold text-amber">{fmtBRL(restante)}</span>
                        </div>
                      )}
                      {restante < -0.01 && (
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-sm font-semibold text-primary">Troco</span>
                          <span className="text-sm font-bold text-primary">{fmtBRL(-restante)}</span>
                        </div>
                      )}
                      {Math.abs(restante) < 0.01 && (
                        <div className="flex items-center justify-center gap-1.5 mt-2">
                          <Check size={14} className="text-green" strokeWidth={3}/>
                          <span className="text-green text-sm font-bold">Valor quitado</span>
                        </div>
                      )}
                    </div>
                  )}

                </section>

                {/* Erro */}
                {erro && (
                  <div className="flex items-center gap-2 bg-red-soft rounded-xl px-4 py-3 border border-red/20">
                    <AlertCircle size={16} className="text-red flex-shrink-0"/>
                    <p className="text-sm text-red">{erro}</p>
                  </div>
                )}

                {/* Espaço para o footer fixo */}
                <div className="h-4"/>
              </div>
            </div>

            {/* Footer fixo — botão de fechar comanda */}
            <div className="flex-shrink-0 px-6 py-4 border-t border-border bg-surface">
              <div className="max-w-2xl mx-auto">
                <button
                  onClick={fecharComanda}
                  disabled={fechando || itens.length === 0 || splits.length === 0 || !empresaId || (splits.length > 0 && restante > 0.01)}
                  className="w-full h-12 rounded-xl bg-green text-white font-bold text-base hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {fechando ? (
                    'Fechando...'
                  ) : (
                    <>
                      {comandaExistenteId ? <Pencil size={16} strokeWidth={2.5}/> : <Check size={18} strokeWidth={2.5}/>}
                      {comandaExistenteId ? `Salvar edição — ${fmtBRL(total)}` : `Fechar comanda — ${fmtBRL(total)}`}
                    </>
                  )}
                </button>
                {splits.length === 0 && itens.length > 0 && (
                  <p className="text-xs text-text-4 text-center mt-2">
                    Selecione ao menos uma forma de pagamento para fechar
                  </p>
                )}
                {splits.length > 0 && restante > 0.01 && (
                  <p className="text-xs text-amber text-center mt-2 font-semibold">
                    Ainda faltam {fmtBRL(restante)} para cobrir o total
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
