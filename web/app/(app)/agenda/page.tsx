'use client';

/**
 * @file agenda/page.tsx
 * Agenda interativa com visão semanal e mensal.
 *
 * ## Componentes internos
 * - `AgCard`        — card de agendamento com dropdown de status
 * - `NovoAgModal`   — modal de criação/edição de agendamento
 * - `ListaDia`      — lista de agendamentos (e bloqueios) do dia selecionado
 * - `TimelineView`  — grade por hora; em "Todas as profissionais", uma coluna por profissional
 *
 * ## Arquivos ao lado
 * - `visoes.ts`          — regras puras: janela do dia, posições, filtro "todas", semana/mês
 * - `MesView.tsx`        — calendário mensal (atendimentos e bloqueios por dia)
 * - `BloqueiosDoDia.tsx` — bloqueios do dia como itens nas visões Semana e Mês
 *
 * ## Otimistic UI
 * Mudanças de status são aplicadas na UI antes da confirmação do banco.
 * Se o banco retornar erro, o estado é revertido e um alert é exibido.
 *
 * ## Busca de dados
 * - `fetchDia()`: busca agendamentos do dia selecionado (dispara a cada mudança de data)
 * - `fetchMes()`: busca contagem por dia para o calendário mensal (só quando view = 'mes')
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  format, addDays, addMonths, subMonths,
  isSameDay, isToday, addMinutes, parseISO, isPast,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ChevronLeft, ChevronRight, Plus, Clock, User, X,
  CalendarPlus, AlertTriangle, Pencil, Star, Ban, Trash2, UserPlus, Check,
} from 'lucide-react';
import { ExportButton } from '@/components/ExportButton';
import { definicaoAgenda } from '@shared/exportacao/agenda';
import { createClient } from '@/lib/supabase/client';
import { useScrollLock } from '@/lib/useScrollLock';
import { Sk } from '@/components/Skeleton';
import { SearchSelect } from '@/components/SearchSelect';
import { maskPhone } from '@/lib/masks';
import { avancarComEnter } from '@/lib/formNav';
import {
  type CategoriaServico, type CategoriaCustom,
  resolverCategoriaServico, bgDaCor,
} from '@shared/categorias';
import { buildTaxaReservaInsert } from '@shared/taxa-reserva';
import {
  linhasIniciaisEdicao, montarAgendamento, instanteNoPassado, msgConflito, msgBloqueio,
  valorDigitadoValido, MSG_HORARIO_PASSADO, MSG_CONCLUIDO_COM_COMANDA, janelaDoDia,
} from '@shared/agenda';
import {
  TODAS, filtroInicialAgenda, type FiltroProfissional, bloqueiosDaProfissional, colunasComExtras, horasDaJanela, itensDaJanela,
} from '@shared/agenda-grade';
import { parseValorBR } from '@shared/comanda-fechamento';
import { carregarPreferenciaAgenda, salvarAvaliacao } from '@shared/agenda-consultas';
import { carregarConfigTaxas, colunaCobrarTaxaExiste, perguntaTaxaCancelamento, valorTaxaReservaSugerida } from '@shared/taxas-atendimento';
import { PerguntaTaxaCancelamentoModal } from '@/components/PerguntaTaxaCancelamentoModal';
import { podeExcluirAgendamento, motivoExclusaoBloqueada, podeMexerNoAgendamento } from '@shared/agendamentos';
import { mensagemErroBanco } from '@shared/erros';
import { novoUuid } from '@shared/uuid';
import {
  MOTIVOS_BLOQUEIO, motivoBloqueioLabel, podeSelecionarEscopoGeral,
  montarInsertBloqueio, bloqueioEmConflito, bloqueioNoInstante,
  type EscopoBloqueio,
} from '@shared/bloqueios';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { usePermissoes } from '@/components/PermissoesProvider';
import { formatarMoeda as fmtBRL } from '@shared/moeda';
import { chaveDiaBRT, chaveDiaExibido, horaBRT, limitesDias } from '@shared/periodos';
import {
  TL_HOUR_H, alturaDaJanela, bloqueiosDoDia, bloqueiosVisiveis, buscarPaginas,
  diasComBloqueio, filtroEfetivo, gradeDoMes, horaDoClique,
  posicaoNaTimeline, semanaDoDia, topoAgora,
} from './visoes';
import { MesView } from './MesView';
import { BloqueiosDoDia } from './BloqueiosDoDia';

const supabase = createClient();

// ── Tipos ─────────────────────────────────────────────────────

type AgServicoRef = { id: string; nome: string; categoria: CategoriaServico | null; categoria_id?: string | null };
type AgServico = { servico_id: string; servico: AgServicoRef | null; valor: number; duracao_minutos: number; ordem: number };
type Ag = {
  id: string; data_hora_inicio: string; data_hora_fim: string;
  status: string; valor: number; observacao?: string;
  pacote_cliente_id?: string | null;
  comanda_id?: string | null;
  cliente: { id: string; nome: string; telefone?: string } | null;
  profissional: { id: string; nome: string } | null;
  servico: (AgServicoRef & { duracao_minutos: number }) | null;
  agendamento_servicos: AgServico[];
};

/** Cor/fundo/label de uma chave de categoria resolvida (built-in ou id de personalizada). */
function infoCategoria(chave: string, customs: CategoriaCustom[]): { cor: string; bg: string; label: string } {
  const c = customs.find(x => x.id === chave);
  if (c) return { cor: c.cor, bg: bgDaCor(c.cor), label: c.nome };
  const r = resolverCategoriaServico(chave, null, []);
  return { cor: r.cor, bg: r.bg, label: r.label };
}

/** Chaves de categoria distintas dos serviços de um agendamento (agendamento_servicos, com fallback pro serviço legado único). Serviços sem categoria não entram. */
function categoriasDoAg(ag: Ag, customs: CategoriaCustom[]): string[] {
  const servs = (ag.agendamento_servicos ?? []).length > 0
    ? ag.agendamento_servicos.map(s => s.servico)
    : [ag.servico];
  const chaves = servs
    .filter((s): s is AgServicoRef => !!s && (s.categoria != null || s.categoria_id != null))
    .map(s => resolverCategoriaServico(s.categoria, s.categoria_id, customs).chave);
  return Array.from(new Set(chaves));
}
type PacoteSessaoFeita = { id: string; data: string; servico: string | null; viaAg: boolean };
type PacoteClienteOpt = {
  id: string; nome: string;
  restantes: number | null; total: number | null; usadas: number;
  servicos: { servico_id: string }[];
  sessoes: PacoteSessaoFeita[];
};
type PacoteCatalogoOpt = { id: string; nome: string; preco: number; validade_dias: number | null; servicos: { servico_id: string }[] };
type ClienteOpt = { id: string; nome: string; telefone?: string };
type Servico    = { id: string; nome: string; preco: number; duracao_minutos: number };
type Bloqueio   = {
  id: string;
  profissional_id: string | null;
  titulo: string;
  data_inicio: string;
  data_fim: string;
  escopo: 'profissional' | 'geral';
  motivo: string | null;
  situacao: 'aprovado' | 'pendente';
  criado_por: string | null;
};

type BloqueioPendente = {
  id: string;
  profissional_id: string | null;
  criado_por: string | null;
  autorNome: string;
  titulo: string;
  motivo: string | null;
  data_inicio: string;
  data_fim: string;
};

type MetodoPagTaxa = 'dinheiro' | 'pix' | 'credito' | 'debito' | 'cortesia';
/** Formas de pagamento da taxa de reserva quando marcada como já cobrada — mesmas 5 opções de `pagamentos.metodo` usadas no checkout da comanda. */
const METODOS_TAXA: { key: MetodoPagTaxa; label: string }[] = [
  { key: 'dinheiro', label: 'Dinheiro' },
  { key: 'pix',      label: 'Pix' },
  { key: 'credito',  label: 'Crédito' },
  { key: 'debito',   label: 'Débito' },
  { key: 'cortesia', label: 'Cortesia' },
];

const STATUS: Record<string, { label: string; bg: string; text: string; bdr: string }> = {
  agendado:   { label: 'Agendado',   bg: 'bg-amber-soft',   text: 'text-amber',   bdr: 'rgba(166,90,27,0.35)'   },
  confirmado: { label: 'Confirmado', bg: 'bg-primary-soft', text: 'text-primary', bdr: 'rgba(44,23,80,0.25)'    },
  concluido:  { label: 'Concluído',  bg: 'bg-green-soft',   text: 'text-green',   bdr: 'rgba(21,122,91,0.35)'   },
  cancelado:  { label: 'Cancelado',  bg: 'bg-red-soft',     text: 'text-red',     bdr: 'rgba(201,82,127,0.35)'  },
  faltou:     { label: 'Faltou',     bg: 'bg-red-soft',     text: 'text-red',     bdr: 'rgba(201,82,127,0.35)'  },
};
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function iniciais(nome?: string | null) {
  return (nome ?? '?').split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}
/** Data curta de uma sessão de pacote; nunca lança em data inválida. */
function fmtSessaoData(iso: string | null): string {
  if (!iso) return '—';
  const d = parseISO(iso);
  return isNaN(d.getTime()) ? '—' : format(d, 'dd/MM/yy');
}

/** Nomes de todos os serviços de um agendamento, unidos por " + " (fallback: serviço legado). */
function nomesServicosDoAg(ag: { agendamento_servicos?: { ordem: number; servico?: { nome?: string | null } | null }[]; servico?: { nome?: string | null } | null }): string {
  const multi = ag.agendamento_servicos ?? [];
  if (multi.length > 0) {
    return [...multi].sort((a, b) => a.ordem - b.ordem).map(s => s.servico?.nome).filter(Boolean).join(' + ') || '—';
  }
  return ag.servico?.nome ?? '—';
}

// ── Card de agendamento ───────────────────────────────────────

const STATUS_OPCOES = [
  { key: 'agendado',   label: 'Agendado',   cor: 'text-amber'   },
  { key: 'confirmado', label: 'Confirmado', cor: 'text-primary' },
  { key: 'concluido',  label: 'Concluído',  cor: 'text-green'   },
  { key: 'cancelado',  label: 'Cancelado',  cor: 'text-red'     },
  { key: 'faltou',     label: 'Faltou',     cor: 'text-red'     },
];

function AgCard({ ag, empresaId, onStatus, onEditar: onEditarProp, statusInline = false, somenteLeitura = false }: {
  ag: Ag;
  empresaId: string;
  onStatus: (id: string, s: string) => void;
  onEditar?: (ag: Ag) => void;
  /** No modal mobile de Detalhes: mostra o status como lista embutida em vez de dropdown flutuante (que era cortado). */
  statusInline?: boolean;
  /**
   * Atendimento de outra profissional sem `agenda.gerenciar_outras`: o banco recusaria editar
   * e mudar status (policy "agendamentos: equipe atualiza"), então o card só mostra.
   */
  somenteLeitura?: boolean;
}) {
  const onEditar = somenteLeitura ? undefined : onEditarProp;
  const [menuAberto, setMenuAberto] = useState(false);
  const inicio = format(parseISO(ag.data_hora_inicio), 'HH:mm');
  const fim    = format(parseISO(ag.data_hora_fim), 'HH:mm');
  const st     = STATUS[ag.status] ?? { label: ag.status, bg: 'bg-bg', text: 'text-text-3' };

  function selecionarStatus(s: string) {
    setMenuAberto(false);
    if (s === ag.status) return;
    onStatus(ag.id, s);
  }

  const clienteNome = ag.cliente?.nome ?? '';
  let hue = 0;
  for (let i = 0; i < clienteNome.length; i++) hue = (hue * 31 + clienteNome.charCodeAt(i)) % 360;
  const initsAg = clienteNome.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase() || '?';

  return (
    <>
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 20, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}
      className="hover:border-accent/40 transition-colors"
      onDoubleClick={() => onEditar?.(ag)}
      title={onEditar ? 'Clique duas vezes para editar' : undefined}>
      <div className="flex items-start gap-3">
        <div style={{ width: 36, height: 36, borderRadius: 12, background: `linear-gradient(140deg, oklch(0.55 0.16 ${hue}), oklch(0.42 0.17 ${hue}))`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 12, fontFamily: 'var(--font-sans)' }}>{initsAg}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <p className="font-semibold text-text text-sm truncate">{ag.cliente?.nome ?? '—'}</p>
            <div className="flex items-center gap-1 flex-shrink-0">
              {onEditar && (
                <button onClick={() => onEditar(ag)}
                  className="w-6 h-6 rounded-lg flex items-center justify-center text-text-4 hover:text-accent hover:bg-accent/10 transition">
                  <Pencil size={11} strokeWidth={2.5}/>
                </button>
              )}
              {/* Badge de status — dropdown no desktop, estático no modo inline ou somente leitura */}
              {statusInline || somenteLeitura ? (
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${st.bg} ${st.text}`}>
                  {st.label}
                </span>
              ) : (
                <div className="relative">
                  <button
                    onClick={() => setMenuAberto(v => !v)}
                    className={`text-xs font-semibold px-2 py-0.5 rounded-lg transition hover:opacity-80 ${st.bg} ${st.text}`}>
                    {st.label} ▾
                  </button>
                  {menuAberto && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuAberto(false)}/>
                      <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-border rounded-xl shadow-lg py-1 min-w-[130px]">
                        {STATUS_OPCOES.map(({ key, label, cor }) => (
                          <button key={key} onClick={() => selecionarStatus(key)}
                            className={`w-full text-left px-3 py-2 text-xs font-semibold hover:bg-bg transition flex items-center gap-2 ${
                              ag.status === key ? 'opacity-40 cursor-default' : cor
                            }`}>
                            {ag.status === key && <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0"/>}
                            {label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>{/* /flex gap-1 */}
          </div>{/* /justify-between */}
          <p className="text-text-3 text-xs mb-1.5 truncate">
            {nomesServicosDoAg(ag)}
          </p>
          {ag.observacao && (
            <p className="text-xs text-text-4 italic mb-1.5 truncate">{ag.observacao}</p>
          )}
          <div className="flex items-center gap-3 text-xs text-text-3">
            <span className="flex items-center gap-1"><Clock size={10} strokeWidth={2}/>{inicio}–{fim}</span>
            {ag.profissional && <span className="flex items-center gap-1"><User size={10} strokeWidth={2}/>{ag.profissional.nome.split(' ')[0]}</span>}
            <span className="ml-auto font-semibold text-text-2">{fmtBRL(ag.valor)}</span>
          </div>
          {statusInline && !somenteLeitura && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-[10px] font-semibold text-text-3 uppercase tracking-wide mb-1.5">Mudar status</p>
              <div className="flex flex-col gap-1.5">
                {STATUS_OPCOES.map(({ key, label, cor }) => (
                  <button key={key} type="button" onClick={() => selecionarStatus(key)}
                    disabled={ag.status === key}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold border transition flex items-center gap-2 ${
                      ag.status === key
                        ? 'border-accent bg-accent/10 text-text opacity-60 cursor-default'
                        : `border-border bg-surface hover:bg-bg ${cor}`
                    }`}>
                    {ag.status === key && <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0"/>}
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

// ── Modal de novo agendamento ─────────────────────────────────

/** `valor` fica como texto digitado: vazio = preço do serviço; "0" = cortesia (regra de `montarAgendamento`). */
type ServicoLinha = { uid: string; servico_id: string; duracao: number; valor: string };
/** Valor em reais no formato do campo ("150,00"). */
const valorCampo = (n: number) => n.toFixed(2).replace('.', ',');
type ConflitoDet  = { inicio: string; fim: string; cliente: string; servico: string };

function NovoAgModal({
  data, empresaId, onClose, onSalvo, agEditar, horaInicial, profIdInicial, meuUserId, onExcluido,
}: {
  data: Date; empresaId: string;
  onClose: () => void; onSalvo: () => void;
  agEditar?: Ag;
  horaInicial?: string;
  profIdInicial?: string;
  meuUserId: string;
  onExcluido: () => void;
}) {
  useScrollLock();
  const { pode } = usePermissoes();
  const podeOutras = pode('agenda.gerenciar_outras');
  const [clientes,      setClientes]      = useState<ClienteOpt[]>([]);
  const [profissionais, setProfissionais] = useState<{ id: string; nome: string }[]>([]);
  const [servicos,      setServicos]      = useState<Servico[]>([]);

  const [dataSel,   setDataSel]   = useState(() => agEditar ? parseISO(agEditar.data_hora_inicio) : data);
  const [clienteId, setClienteId] = useState(() => agEditar?.cliente?.id ?? '');
  const [profId,    setProfId]    = useState(() => agEditar?.profissional?.id ?? (podeOutras ? (profIdInicial ?? '') : meuUserId));
  const [hora,      setHora]      = useState(() => agEditar ? format(parseISO(agEditar.data_hora_inicio), 'HH:mm') : (horaInicial ?? '09:00'));
  const [obs,       setObs]       = useState(() => agEditar?.observacao ?? '');
  const [salvando,  setSalvando]  = useState(false);
  const [erro,      setErro]      = useState('');
  const [confirmarExcluir, setConfirmarExcluir] = useState(false);
  const [excluindo,        setExcluindo]        = useState(false);
  const [avisoTaxaExcluir, setAvisoTaxaExcluir] = useState('');

  const podeExcluir = !!agEditar && podeExcluirAgendamento(agEditar.status, pode('agenda.excluir'));
  const motivoBloqueioExcluir = agEditar ? motivoExclusaoBloqueada(agEditar.status) : null;

  async function abrirConfirmExcluir() {
    setAvisoTaxaExcluir('');
    if (!agEditar) return;
    // Avisa se há taxa paga que sairá do faturamento junto
    const [{ data: tr }, { data: tc }] = await Promise.all([
      supabase.from('taxas_reserva').select('valor, status, paga_em').eq('agendamento_id', agEditar.id),
      supabase.from('taxas_cancelamento').select('valor, status, paga_em').eq('agendamento_id', agEditar.id),
    ]);
    const pagas = [...(tr ?? []), ...(tc ?? [])].filter(
      (t: any) => t.paga_em != null || t.status === 'pago' || t.status === 'paga',
    );
    const totalPago = pagas.reduce((s: number, t: any) => s + Number(t.valor || 0), 0);
    if (totalPago > 0) {
      setAvisoTaxaExcluir(
        ` A taxa de ${fmtBRL(totalPago)} (paga) também será removida e sai do faturamento daquele período.`,
      );
    }
    setConfirmarExcluir(true);
  }

  async function excluirAgendamento() {
    if (!agEditar) return;
    setExcluindo(true);
    const { data: apagados, error } = await supabase
      .from('agendamentos')
      .delete()
      .eq('id', agEditar.id)
      .select('id');
    setExcluindo(false);
    setConfirmarExcluir(false);
    if (error) { setErro(`Erro ao excluir: ${error.message}`); return; }
    if (!apagados || apagados.length === 0) {
      setErro('Você não tem permissão para excluir agendamentos.');
      return;
    }
    onExcluido();
  }
  const [sucesso,   setSucesso]   = useState<{ clienteNome: string; profNome: string; servicosNomes: string[]; inicio: Date; fim: Date } | null>(null);
  const [avisoTaxaReserva, setAvisoTaxaReserva] = useState('');

  // Taxa de reserva (configurada pela empresa, pré-preenchida ao escolher o serviço).
  // `aplicarTaxaReserva` é o switch "Cobrar taxa de reserva neste atendimento": nasce ligado
  // (a chave geral da empresa é o padrão) e, desligado, nenhuma linha de `taxas_reserva` é criada.
  const [taxaReservaCfg, setTaxaReservaCfg] = useState<{ ativa: boolean; modo: 'percentual' | 'fixo'; valor: number }>({ ativa: false, modo: 'percentual', valor: 0 });
  const [aplicarTaxaReserva, setAplicarTaxaReserva] = useState(true);
  const [taxaReserva,        setTaxaReserva]        = useState('0');
  const [taxaEditadaManual, setTaxaEditadaManual] = useState(false);
  const [taxaReservaCobrada, setTaxaReservaCobrada] = useState(false);
  const [taxaReservaMetodo,  setTaxaReservaMetodo]  = useState<MetodoPagTaxa | null>(null);

  // Pacote do cliente a consumir neste agendamento (opcional)
  const [pacotesCliente,  setPacotesCliente]  = useState<PacoteClienteOpt[]>([]);
  const [pacoteClienteId, setPacoteClienteId] = useState(() => agEditar?.pacote_cliente_id ?? '');

  // Vender um pacote novo do catálogo direto neste agendamento (opcional)
  const [pacotesCatalogo, setPacotesCatalogo] = useState<PacoteCatalogoOpt[]>([]);
  const [pacoteVenderId,  setPacoteVenderId]  = useState('');

  // Cadastro rápido de cliente novo, sem sair do modal de agendamento
  const [criandoCliente,      setCriandoCliente]      = useState(false);
  const [novoClienteNome,     setNovoClienteNome]     = useState('');
  const [novoClienteTelefone, setNovoClienteTelefone] = useState('');
  const [salvandoCliente,     setSalvandoCliente]     = useState(false);
  const [erroCliente,         setErroCliente]         = useState('');
  const [clienteCriadoFlash,  setClienteCriadoFlash]  = useState('');

  const [linhas, setLinhas] = useState<ServicoLinha[]>(() => {
    if (agEditar) {
      const salvas = [...(agEditar.agendamento_servicos ?? [])]
        .sort((a, b) => a.ordem - b.ordem)
        .map(s => ({ servico_id: s.servico_id, profissional_id: agEditar.profissional?.id ?? '', valor: s.valor, duracao_min: s.duracao_minutos }));
      // Atendimento antigo (sem linhas em agendamento_servicos) começa com o serviço principal.
      const duracaoAg = agEditar.servico?.duracao_minutos
        ?? Math.round((new Date(agEditar.data_hora_fim).getTime() - new Date(agEditar.data_hora_inicio).getTime()) / 60000);
      const iniciais = linhasIniciaisEdicao(
        { servico_id: agEditar.servico?.id ?? null, profissional_id: agEditar.profissional?.id ?? '', valor: agEditar.valor, duracao_min: duracaoAg },
        salvas,
      );
      if (iniciais.length > 0) {
        return iniciais.map(l => ({ uid: crypto.randomUUID(), servico_id: l.servico_id, duracao: l.duracao_min, valor: valorCampo(l.valor) }));
      }
    }
    return [{ uid: crypto.randomUUID(), servico_id: '', duracao: 60, valor: '' }];
  });

  // Conflito de horário detectado
  const [conflitos,  setConflitos]  = useState<ConflitoDet[]>([]);
  // Bloqueios de agenda do dia selecionado — para impedir agendar em cima.
  const [bloqueiosDia, setBloqueiosDia] = useState<Bloqueio[]>([]);
  const [pendInicio, setPendInicio] = useState<Date | null>(null);
  const [pendFim,    setPendFim]    = useState<Date | null>(null);
  const [msgConflitoAtual, setMsgConflitoAtual] = useState('');
  // Horário passado: pergunta MSG_HORARIO_PASSADO antes de gravar.
  const [perguntaPassado, setPerguntaPassado] = useState<{ inicio: Date; fim: Date } | null>(null);
  // Criação que gravou o agendamento mas falhou nos serviços: a nova tentativa só regrava as linhas
  // guardadas desse id (nunca cria um segundo agendamento, uma segunda taxa nem vende o pacote 2x).
  const [idCriado, setIdCriado] = useState<{ id: string; linhas: ReturnType<typeof montarAgendamento>['linhas']; inicio: Date; fim: Date } | null>(null);
  const pacoteVendidoRef = useRef<string | null>(null);
  // Atendimento já fechado na comanda: valor e serviços só mudam pela comanda (igual ao app).
  const edicaoTravada = !!agEditar?.comanda_id;

  const totalDuracao = linhas.reduce((s, l) => s + (l.duracao || 0), 0);
  const precoDe = (id: string) => servicos.find(x => x.id === id)?.preco ?? 0;
  // Total pelas mesmas regras do app: vazio = preço do serviço, "0" = cortesia.
  const montado = montarAgendamento({
    linhas: linhas.filter(l => l.servico_id).map(l => ({
      servico_id: l.servico_id, profissional_id: profId, valor: l.valor, duracao_min: l.duracao || 0, preco: precoDe(l.servico_id),
    })),
    inicioIso: new Date().toISOString(),
  });
  const valorTotal = montado.valorTotal;
  const totalValor = valorTotal;
  const valoresOk = linhas.filter(l => l.servico_id).every(l => valorDigitadoValido(l.valor));

  // Taxa de reserva sugerida sobre o total; recalcula quando o total muda, até a pessoa digitar a taxa.
  useEffect(() => {
    if (!taxaReservaCfg.ativa || taxaEditadaManual) return;
    setTaxaReserva(String(valorTaxaReservaSugerida(taxaReservaCfg, valorTotal)).replace('.', ','));
  }, [taxaReservaCfg, taxaEditadaManual, valorTotal]);

  useEffect(() => {
    Promise.all([
      supabase.from('clientes').select('id, nome, telefone')
        .eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      supabase.from('empresa_membros').select('user_id, user:users(id, nome)')
        .eq('empresa_id', empresaId).in('role', ['owner', 'gestor', 'profissional']).eq('ativo', true),
      supabase.from('servicos').select('id, nome, preco, duracao_minutos')
        .eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      supabase.from('pacotes')
        .select('id, nome, preco, validade_dias, servicos:pacote_servicos(servico_id)')
        .eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
    ]).then(([c, p, s, pac]) => {
      setClientes((c.data ?? []) as ClienteOpt[]);
      setProfissionais((p.data ?? []).map((m: any) => ({ id: m.user.id, nome: m.user.nome })));
      setServicos((s.data ?? []) as Servico[]);
      setPacotesCatalogo(((pac.data ?? []) as any[]).map(p => ({
        id: p.id, nome: p.nome, preco: p.preco, validade_dias: p.validade_dias,
        servicos: (p.servicos ?? []).map((x: any) => ({ servico_id: x.servico_id })),
      })));
    });
  }, [empresaId]);

  // Recarrega ao trocar a data dentro do modal (o campo de data é editável).
  useEffect(() => {
    const d0 = new Date(dataSel); d0.setHours(0, 0, 0, 0);
    const d1 = new Date(dataSel); d1.setHours(23, 59, 59, 999);
    supabase
      .from('agenda_bloqueios')
      .select('id, escopo, profissional_id, situacao, motivo, titulo, data_inicio, data_fim')
      .eq('empresa_id', empresaId)
      .lt('data_inicio', d1.toISOString())
      .gt('data_fim', d0.toISOString())
      .then(({ data }: { data: any[] | null }) => {
        setBloqueiosDia((data ?? []) as Bloqueio[]);
      });
  }, [empresaId, dataSel]);

  // Configuração de taxa de reserva da empresa
  useEffect(() => {
    supabase.from('empresas')
      .select('taxa_reserva_ativa, taxa_reserva_modo, taxa_reserva_valor')
      .eq('id', empresaId).single()
      .then(({ data }: { data: any }) => {
        if (data) {
          setTaxaReservaCfg({
            ativa: data.taxa_reserva_ativa,
            modo: data.taxa_reserva_modo as 'percentual' | 'fixo',
            valor: Number(data.taxa_reserva_valor),
          });
        }
      });
  }, [empresaId]);

  // Pacotes ativos do cliente selecionado (para vincular ao agendamento)
  useEffect(() => {
    if (!clienteId) { setPacotesCliente([]); return; }
    supabase.from('pacote_clientes')
      .select('id, data_validade, pacote:pacotes(nome, controla_sessoes, servicos:pacote_servicos(servico_id, quantidade)), uso:pacote_uso(id, created_at, agendamento_id, servico:servicos(nome))')
      .eq('empresa_id', empresaId)
      .eq('cliente_id', clienteId)
      .eq('status', 'ativo')
      .then((res: { data: any[] | null }) => {
        const opts = ((res.data ?? []) as any[])
          .filter(pc => (pc.pacote?.controla_sessoes ?? true) && (!pc.data_validade || !isPast(parseISO(pc.data_validade))))
          .map(pc => {
            const servicosPac = (pc.pacote?.servicos ?? []) as { servico_id: string; quantidade: number | null }[];
            const ilimitado = servicosPac.some(s => s.quantidade == null);
            const total = ilimitado ? null : servicosPac.reduce((s, x) => s + (x.quantidade ?? 0), 0);
            const usoRows = (pc.uso ?? []) as any[];
            const usadas = usoRows.length;
            const restantes = total != null ? total - usadas : null;
            const sessoes: PacoteSessaoFeita[] = usoRows
              .map(u => ({ id: u.id, data: u.created_at as string, servico: u.servico?.nome ?? null, viaAg: !!u.agendamento_id }))
              .sort((a, b) => (b.data ?? '').localeCompare(a.data ?? ''));
            return { id: pc.id, nome: pc.pacote?.nome ?? 'Pacote', restantes, total, usadas, servicos: servicosPac.map(s => ({ servico_id: s.servico_id })), sessoes };
          })
          .filter(p => p.restantes === null || p.restantes > 0);
        setPacotesCliente(opts);
        setPacoteClienteId(prev => opts.some(o => o.id === prev) ? prev : '');
      });
  }, [empresaId, clienteId]);

  function onServicoChange(uid: string, id: string) {
    const s = servicos.find(x => x.id === id);
    setLinhas(prev => prev.map(l =>
      l.uid === uid
        ? { ...l, servico_id: id, duracao: s?.duracao_minutos ?? 60, valor: s ? valorCampo(s.preco) : '' }
        : l
    ));
  }

  /** Preenche as linhas de serviço com os serviços inclusos num pacote (sem duplicar já adicionados) */
  function preencherServicosDoPacote(servicosPac: { servico_id: string }[]) {
    setLinhas(prev => {
      const jaTem = new Set(prev.map(l => l.servico_id).filter(Boolean));
      const novas = servicosPac
        .filter(s => !jaTem.has(s.servico_id))
        .map(s => {
          const info = servicos.find(x => x.id === s.servico_id);
          return { uid: crypto.randomUUID(), servico_id: s.servico_id, duracao: info?.duracao_minutos ?? 60, valor: info ? valorCampo(info.preco) : '' };
        });
      if (novas.length === 0) return prev;
      const base = prev.filter(l => l.servico_id); // descarta a linha em branco inicial
      return [...base, ...novas];
    });
  }

  function onPacoteClienteChange(id: string) {
    setPacoteClienteId(id);
    if (id) {
      setPacoteVenderId('');
      const pac = pacotesCliente.find(p => p.id === id);
      if (pac) preencherServicosDoPacote(pac.servicos);
    }
  }

  function onPacoteVenderChange(id: string) {
    setPacoteVenderId(id);
    if (id) {
      setPacoteClienteId('');
      const pac = pacotesCatalogo.find(p => p.id === id);
      if (pac) preencherServicosDoPacote(pac.servicos);
    }
  }

  async function salvarNovoCliente() {
    if (!novoClienteNome.trim()) return;
    setErroCliente('');
    setSalvandoCliente(true);
    const { data, error } = await supabase.from('clientes').insert({
      empresa_id: empresaId,
      nome: novoClienteNome.trim(),
      telefone: novoClienteTelefone.trim() || null,
    }).select('id, nome, telefone').single();
    setSalvandoCliente(false);
    if (error || !data) { setErroCliente(mensagemErroBanco(error, 'cadastrar cliente')); return; }
    setClientes(prev => [...prev, data as ClienteOpt].sort((a, b) => a.nome.localeCompare(b.nome)));
    setClienteId(data.id);
    setCriandoCliente(false);
    setNovoClienteNome('');
    setNovoClienteTelefone('');
    setClienteCriadoFlash(data.nome);
    setTimeout(() => setClienteCriadoFlash(''), 2000);
  }

  function addLinha() {
    setLinhas(prev => [...prev, { uid: crypto.randomUUID(), servico_id: '', duracao: 60, valor: '' }]);
  }

  function removeLinha(uid: string) {
    setLinhas(prev => prev.length > 1 ? prev.filter(l => l.uid !== uid) : prev);
  }

  async function executarSalvar(inicio: Date, fim: Date) {
    setSalvando(true);
    const filled = linhas.filter(l => l.servico_id);
    let agId = '';
    let linhasGravar = montado.linhas;

    if (idCriado) {
      // Nova tentativa: o agendamento existe; apaga o que tiver sobrado e regrava só as linhas.
      const { error: errDelLinhas } = await supabase.from('agendamento_servicos').delete().eq('agendamento_id', idCriado.id);
      if (errDelLinhas) {
        setSalvando(false); setErro(mensagemErroBanco(errDelLinhas, 'salvar os serviços do agendamento')); return;
      }
      agId = idCriado.id;
      linhasGravar = idCriado.linhas;
    } else {

    // Se escolheu vender um pacote novo do catálogo, cria a venda antes de tudo (uma vez só,
    // mesmo que a gravação do agendamento falhe e a pessoa tente de novo).
    let pacoteClienteIdFinal = pacoteClienteId || null;
    if (pacoteVenderId && pacoteVendidoRef.current) {
      pacoteClienteIdFinal = pacoteVendidoRef.current;
    } else if (pacoteVenderId) {
      const pacote = pacotesCatalogo.find(p => p.id === pacoteVenderId);
      if (pacote) {
        const { data: novaVenda, error: errVenda } = await supabase.from('pacote_clientes').insert({
          empresa_id:    empresaId,
          pacote_id:     pacote.id,
          cliente_id:    clienteId,
          data_inicio:   format(new Date(), 'yyyy-MM-dd'),
          data_validade: pacote.validade_dias != null
            ? format(addDays(new Date(), pacote.validade_dias), 'yyyy-MM-dd')
            : null,
          valor_pago:    pacote.preco,
          status:        'ativo',
        }).select('id').single();
        if (errVenda || !novaVenda) { setSalvando(false); setErro(mensagemErroBanco(errVenda, 'vender o pacote')); return; }
        pacoteClienteIdFinal = novaVenda.id;
        pacoteVendidoRef.current = novaVenda.id;

        // Registra a venda do pacote como faturamento (uma vez, no ato). As
        // sessões consumidas depois não contam como receita.
        const { error: errVendaPac } = await supabase.from('vendas').insert({
          empresa_id:  empresaId,
          cliente_id:  clienteId,
          valor_total: pacote.preco,
          desconto:    0,
          observacao:  `Venda de pacote: ${pacote.nome}`,
        });
        // O pacote já foi vendido: só avisa (abortar deixaria o pacote sem agendamento).
        if (errVendaPac) alert(`O pacote foi vendido, mas a receita não foi registrada: ${mensagemErroBanco(errVendaPac, 'registrar a venda do pacote')}`);
      }
    }

    if (agEditar) {
      const { data: atualizados, error } = await supabase.from('agendamentos').update({
        cliente_id:        clienteId,
        profissional_id:   profId,
        servico_id:        filled[0]?.servico_id ?? null,
        data_hora_inicio:  inicio.toISOString(),
        data_hora_fim:     fim.toISOString(),
        valor:             montado.valorTotal,
        observacao:        obs.trim() || null,
        pacote_cliente_id: pacoteClienteIdFinal,
      }).eq('id', agEditar.id).select('id');
      // 0 linhas sem erro = RLS recusou (agenda de outra profissional sem a permissão). Para aqui,
      // antes de apagar/regravar os serviços — senão os serviços mudavam e o cabeçalho não.
      if (error || !atualizados || atualizados.length === 0) {
        setSalvando(false); setErro(mensagemErroBanco(error ?? { code: '42501' }, 'salvar este agendamento')); return;
      }
      const { error: errDelLinhas } = await supabase.from('agendamento_servicos').delete().eq('agendamento_id', agEditar.id);
      if (errDelLinhas) {
        setSalvando(false); setErro(mensagemErroBanco(errDelLinhas, 'salvar os serviços do agendamento')); return;
      }
      agId = agEditar.id;
    } else {
      // Id gerado aqui e SEM RETURNING: quem tem "agenda.gerenciar_outras" sem "agenda.ver_equipe"
      // cria na agenda de outra profissional, mas não lê a linha nova (policy de SELECT) — o
      // RETURNING derrubava o INSERT com 42501 mesmo com a permissão.
      const novoId = novoUuid();
      const { error } = await supabase.from('agendamentos').insert({
        id:                novoId,
        empresa_id:        empresaId,
        cliente_id:        clienteId,
        profissional_id:   profId,
        servico_id:        filled[0].servico_id,
        data_hora_inicio:  inicio.toISOString(),
        data_hora_fim:     fim.toISOString(),
        status:            'agendado',
        valor:             montado.valorTotal,
        observacao:        obs.trim() || null,
        pacote_cliente_id: pacoteClienteIdFinal,
      });
      if (error) { setSalvando(false); setErro(mensagemErroBanco(error, 'criar agendamento')); return; }
      agId = novoId;
      pacoteVendidoRef.current = null;

      // Só cria a linha com o switch "Cobrar taxa de reserva neste atendimento" ligado.
      if (aplicarTaxaReserva) {
        const taxaReservaValorNum = parseValorBR(taxaReserva);
        const taxaReservaPayload = buildTaxaReservaInsert({
          empresaId, agendamentoId: agId, clienteId, valor: taxaReservaValorNum,
          jaCobrada: taxaReservaCobrada, metodo: taxaReservaMetodo, cobrar: aplicarTaxaReserva,
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

    }

    const { error: errLinhas } = await supabase.from('agendamento_servicos').insert(
      linhasGravar.map((l, i) => ({
        agendamento_id:  agId,
        servico_id:      l.servico_id,
        valor:           l.valor,
        duracao_minutos: l.duracao_min,
        ordem:           i,
        empresa_id:      empresaId,
      }))
    );
    if (errLinhas) {
      if (!agEditar) setIdCriado({ id: agId, linhas: linhasGravar, inicio, fim });
      setSalvando(false);
      setErro(`O agendamento foi salvo, mas os serviços não: ${mensagemErroBanco(errLinhas, 'salvar os serviços do agendamento')}`);
      return;
    }
    setSalvando(false);
    setSucesso({
      clienteNome:   clientes.find(c => c.id === clienteId)?.nome ?? 'Cliente',
      profNome:      profissionais.find(p => p.id === profId)?.nome ?? 'Profissional',
      servicosNomes: filled.map(l => servicos.find(s => s.id === l.servico_id)?.nome ?? 'Serviço'),
      inicio, fim,
    });
  }

  useEffect(() => {
    if (!sucesso) return;
    const t = setTimeout(onSalvo, avisoTaxaReserva ? 2600 : 1300);
    return () => clearTimeout(t);
  }, [sucesso]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setConflitos([]);
    setPerguntaPassado(null);
    if (edicaoTravada) { setErro(MSG_CONCLUIDO_COM_COMANDA); return; }
    if (idCriado) { await executarSalvar(idCriado.inicio, idCriado.fim); return; }
    if (bloqueioConflitante) {
      setErro(msgBloqueio(bloqueioConflitante.motivo));
      return;
    }
    const filled = linhas.filter(l => l.servico_id);
    if (!clienteId || filled.length === 0 || !profId) {
      setErro('Preencha cliente, pelo menos um serviço e profissional.');
      return;
    }
    if (!valoresOk) { setErro('Corrija o valor do serviço (use 0 para cortesia).'); return; }
    if (aplicarTaxaReserva && taxaReservaCfg.ativa && !agEditar && !valorDigitadoValido(taxaReserva)) {
      setErro('Corrija o valor da taxa de reserva.'); return;
    }
    const [h, m] = hora.split(':').map(Number);
    const inicio = new Date(dataSel); inicio.setHours(h, m, 0, 0);
    const fim    = addMinutes(inicio, totalDuracao || 60);

    let confQuery = supabase
      .from('agendamentos')
      .select(`id,data_hora_inicio,data_hora_fim,
        cliente:clientes!agendamentos_cliente_id_fkey(nome),
        servico:servicos(nome)`)
      .eq('empresa_id', empresaId)
      .eq('profissional_id', profId)
      .not('status', 'in', '("cancelado","faltou")')
      .lt('data_hora_inicio', fim.toISOString())
      .gt('data_hora_fim', inicio.toISOString());
    if (agEditar) confQuery = confQuery.neq('id', agEditar.id);
    const { data: conf, error: errConf } = await confQuery;
    if (errConf) { setErro(mensagemErroBanco(errConf, 'conferir a agenda')); return; }

    if (conf && conf.length > 0) {
      setPendInicio(inicio);
      setPendFim(fim);
      setMsgConflitoAtual(msgConflito(profissionais.find(p => p.id === profId)?.nome ?? 'Profissional', format(parseISO(conf[0].data_hora_inicio), 'HH:mm')));
      setConflitos(conf.map((c: any) => ({
        inicio:  format(parseISO(c.data_hora_inicio), 'HH:mm'),
        fim:     format(parseISO(c.data_hora_fim),    'HH:mm'),
        cliente: c.cliente?.nome ?? '—',
        servico: c.servico?.nome  ?? '—',
      })));
      return;
    }
    await seguirAposConflito(inicio, fim);
  }

  /** Depois do conflito (ou sem conflito): horário passado pede confirmação; senão grava. */
  async function seguirAposConflito(inicio: Date, fim: Date) {
    setConflitos([]);
    const mudouInicio = !agEditar || inicio.getTime() !== parseISO(agEditar.data_hora_inicio).getTime();
    if (mudouInicio && instanteNoPassado(inicio.toISOString(), Date.now())) {
      setPerguntaPassado({ inicio, fim });
      return;
    }
    await executarSalvar(inicio, fim);
  }

  // Bloqueio que colide com o intervalo que o formulário representa agora.
  const bloqueioConflitante = (() => {
    if (!profId || !hora) return null;
    const [bh, bm] = hora.split(':').map(Number);
    if (Number.isNaN(bh) || Number.isNaN(bm)) return null;
    const ini = new Date(dataSel); ini.setHours(bh, bm, 0, 0);
    const fim = addMinutes(ini, totalDuracao || 60);
    // Só trava a edição quando o intervalo/profissional REALMENTE mudou —
    // o trigger 074 usa a mesma condição (is not distinct from). Sem isto,
    // um agendamento que já existia quando o bloqueio foi criado ficaria
    // impossível de editar (até para trocar a observação).
    const mudouIntervalo = !agEditar
      || ini.getTime() !== parseISO(agEditar.data_hora_inicio).getTime()
      || fim.getTime() !== parseISO(agEditar.data_hora_fim).getTime()
      || profId !== (agEditar.profissional?.id ?? '');
    if (!mudouIntervalo) return null;
    return bloqueioEmConflito(bloqueiosDia, profId, ini.toISOString(), fim.toISOString());
  })();

  const inputClass = "w-full min-w-0 max-w-full h-10 px-3 rounded-xl border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
  const clienteOpts = clientes.map(c => ({ value: c.id, label: c.nome, sub: c.telefone }));
  // Sem 'agenda.gerenciar_outras' o seletor fica travado nela mesma (ou na dona do agendamento já existente).
  const profOpts    = profissionais
    .filter(p => podeOutras || p.id === meuUserId || p.id === agEditar?.profissional?.id)
    .map(p => ({ value: p.id, label: p.nome }));
  const servicoOpts = servicos.map(s => ({ value: s.id, label: s.nome }));

  // Portaliza o modal para <body>: dentro de <main> (que tem overflow-x-hidden)
  // o iOS Safari recorta o position:fixed pela caixa do <main>, deixando faixa
  // de fundo embaixo e cortando o cabeçalho no topo.
  if (typeof document === 'undefined') return null;

  if (sucesso) {
    return createPortal(
      <div className="bm-modal fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"/>
        <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm flex flex-col items-center text-center gap-2.5 py-10 px-6">
          <div className="relative flex items-center justify-center" style={{ width: 64, height: 64 }}>
            <div className="bm-glow absolute inset-0 rounded-full blur-lg" style={{ background: 'var(--color-green-soft)' }}/>
            <div className="relative flex items-center justify-center rounded-full"
              style={{ width: 64, height: 64, background: 'var(--color-green-soft)', animation: 'bm-pop .5s cubic-bezier(.2,.9,.3,1) both' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" style={{ strokeDasharray: 30, strokeDashoffset: 30, animation: 'bm-draw .55s .3s ease forwards' }}/>
              </svg>
            </div>
          </div>
          <p className="font-serif text-lg text-text">{agEditar ? 'Agendamento atualizado!' : 'Agendamento criado!'}</p>
          <p className="text-sm text-text-2 truncate max-w-full">{sucesso.clienteNome}</p>
          <p className="text-xs text-text-4">{sucesso.servicosNomes.join(' + ')} · {sucesso.profNome}</p>
          <p className="text-xs text-text-4">
            {format(sucesso.inicio, 'HH:mm')}–{format(sucesso.fim, 'HH:mm')}
          </p>
          {avisoTaxaReserva && (
            <p className="text-xs text-amber mt-1">{avisoTaxaReserva}</p>
          )}
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="bm-modal fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[90dvh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-serif text-xl text-text">{agEditar ? 'Editar agendamento' : 'Novo agendamento'}</h2>
            <p className="text-text-3 text-xs mt-0.5 capitalize">
              {format(dataSel, "EEEE, dd 'de' MMMM", { locale: ptBR })}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
            <X size={16} />
          </button>
        </div>

        {/* Área rolável (só o conteúdo rola; cabeçalho fica fixo) */}
        <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">

        {/* Aviso de horário bloqueado — trava dura, sem opção de forçar */}
        {bloqueioConflitante && (
          <div className="mx-5 mt-5 rounded-2xl overflow-hidden border" style={{ borderColor: 'var(--color-rose)', background: 'var(--color-rose-soft)' }}>
            <div className="flex items-center gap-2 px-4 pt-4 pb-1">
              <AlertTriangle size={15} strokeWidth={2.5} style={{ color: 'var(--color-rose)' }}/>
              <p className="text-sm font-bold" style={{ color: 'var(--color-rose)' }}>Horário bloqueado</p>
            </div>
            <p className="text-xs text-text-2 px-4 pb-4">
              {motivoBloqueioLabel(bloqueioConflitante.motivo)} ·{' '}
              {format(parseISO(bloqueioConflitante.data_inicio), 'HH:mm')}–{format(parseISO(bloqueioConflitante.data_fim), 'HH:mm')}.
              {' '}Remova o bloqueio na agenda para poder agendar nesse horário.
            </p>
          </div>
        )}

        {/* Aviso de conflito de horário */}
        {conflitos.length > 0 && (
          <div className="mx-5 mt-5 rounded-2xl overflow-hidden border border-amber/30" style={{ background: 'var(--color-amber-soft)' }}>
            <div className="flex items-center gap-2 px-4 pt-4 pb-2">
              <AlertTriangle size={15} className="text-amber flex-shrink-0" strokeWidth={2.5}/>
              <p className="text-sm font-bold text-amber">Conflito de horário</p>
            </div>
            <p className="text-xs text-text-2 px-4 pb-2">{msgConflitoAtual}</p>
            <div className="px-4 pb-3 flex flex-col gap-1">
              {conflitos.map((c, i) => (
                <p key={i} className="text-xs text-text-2">• {c.inicio}–{c.fim} · {c.cliente} ({c.servico})</p>
              ))}
            </div>
            <div className="flex gap-2 px-4 pb-4">
              <button type="button" onClick={() => setConflitos([])}
                className="flex-1 h-9 rounded-xl border border-border text-xs font-semibold text-text-2 hover:bg-bg transition bg-surface">
                Cancelar
              </button>
              <button type="button" disabled={salvando}
                onClick={() => pendInicio && pendFim && seguirAposConflito(pendInicio, pendFim)}
                className="flex-1 h-9 rounded-xl text-white text-xs font-bold transition disabled:opacity-60"
                style={{ background: 'var(--color-amber)' }}>
                {salvando ? 'Salvando...' : agEditar ? 'Salvar assim mesmo' : 'Agendar mesmo assim'}
              </button>
            </div>
          </div>
        )}

        {/* Horário passado: confirma antes de gravar */}
        {perguntaPassado && (
          <div className="mx-5 mt-5 rounded-2xl overflow-hidden border border-amber/30" style={{ background: 'var(--color-amber-soft)' }}>
            <div className="flex items-center gap-2 px-4 pt-4 pb-2">
              <AlertTriangle size={15} className="text-amber flex-shrink-0" strokeWidth={2.5}/>
              <p className="text-sm font-bold text-amber">{MSG_HORARIO_PASSADO}</p>
            </div>
            <div className="flex gap-2 px-4 pb-4">
              <button type="button" onClick={() => setPerguntaPassado(null)}
                className="flex-1 h-9 rounded-xl border border-border text-xs font-semibold text-text-2 hover:bg-bg transition bg-surface">
                Voltar
              </button>
              <button type="button" disabled={salvando}
                onClick={() => { const p = perguntaPassado; setPerguntaPassado(null); executarSalvar(p.inicio, p.fim); }}
                className="flex-1 h-9 rounded-xl text-white text-xs font-bold transition disabled:opacity-60"
                style={{ background: 'var(--color-amber)' }}>
                {salvando ? 'Salvando...' : 'Registrar'}
              </button>
            </div>
          </div>
        )}

        {/* Comanda fechada / serviços pendentes de uma criação anterior */}
        {edicaoTravada && (
          <div role="alert" className="mx-5 mt-5 rounded-xl bg-red-soft text-red text-xs font-semibold px-4 py-3">
            {MSG_CONCLUIDO_COM_COMANDA}
          </div>
        )}
        {idCriado && (
          <div role="alert" className="mx-5 mt-5 rounded-xl bg-red-soft text-red text-xs font-semibold px-4 py-3">
            O agendamento já foi criado, mas os serviços não foram gravados. Clique em &quot;Salvar serviços&quot; para tentar de novo.
          </div>
        )}

        {/* Form */}
        <form onSubmit={salvar} onKeyDown={avancarComEnter} className="p-5 flex flex-col gap-4 min-w-0">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide">Cliente</label>
              {clienteCriadoFlash ? (
                <span className="bm-pop flex items-center gap-1 text-xs font-semibold text-green">
                  <Check size={12} strokeWidth={3}/>
                  {clienteCriadoFlash} cadastrada
                </span>
              ) : !criandoCliente && pode('clientes.cadastrar') && (
                <button type="button"
                  onClick={() => { setCriandoCliente(true); setErroCliente(''); }}
                  className="flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-dark transition">
                  <UserPlus size={13} strokeWidth={2.5}/>
                  Novo cliente
                </button>
              )}
            </div>

            {!criandoCliente ? (
              <SearchSelect options={clienteOpts} value={clienteId} onChange={setClienteId} placeholder="Buscar cliente..." required />
            ) : (
              <div className="rounded-xl border border-accent/30 bg-accent/5 p-3 flex flex-col gap-2.5">
                <input
                  autoFocus
                  value={novoClienteNome}
                  onChange={e => setNovoClienteNome(e.target.value)}
                  placeholder="Nome completo *"
                  className="w-full h-9 px-3 rounded-lg border border-border bg-surface text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"
                />
                <input
                  value={novoClienteTelefone}
                  onChange={e => setNovoClienteTelefone(maskPhone(e.target.value))}
                  placeholder="Telefone (opcional)"
                  type="tel"
                  maxLength={15}
                  className="w-full h-9 px-3 rounded-lg border border-border bg-surface text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"
                />
                {erroCliente && <p className="text-red text-xs">{erroCliente}</p>}
                <div className="flex gap-2">
                  <button type="button"
                    onClick={() => { setCriandoCliente(false); setNovoClienteNome(''); setNovoClienteTelefone(''); setErroCliente(''); }}
                    className="flex-1 h-8 rounded-lg border border-border text-text-2 text-xs font-semibold hover:bg-bg transition">
                    Cancelar
                  </button>
                  <button type="button"
                    disabled={salvandoCliente || !novoClienteNome.trim()}
                    onClick={salvarNovoCliente}
                    className="flex-1 h-8 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary-dark transition disabled:opacity-50">
                    {salvandoCliente ? 'Cadastrando...' : 'Cadastrar e selecionar'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {clienteId && pacotesCliente.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">
                Pacote do cliente
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <SearchSelect
                    options={pacotesCliente.map(p => ({ value: p.id, label: p.nome, sub: p.restantes == null ? 'ilimitado' : `${p.restantes} restante${p.restantes !== 1 ? 's' : ''}` }))}
                    value={pacoteClienteId}
                    onChange={onPacoteClienteChange}
                    placeholder="Pagar avulso (sem pacote)"
                  />
                </div>
                {pacoteClienteId && (
                  <button type="button" onClick={() => setPacoteClienteId('')}
                    title="Não usar pacote"
                    className="w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition">
                    <X size={13} strokeWidth={2.5}/>
                  </button>
                )}
              </div>

              {/* Histórico de sessões do pacote selecionado — feitas + pendentes */}
              {(() => {
                const p = pacotesCliente.find(x => x.id === pacoteClienteId);
                if (!p) return null;
                return (
                  <div className="mt-2 rounded-xl border border-border bg-bg px-3 py-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-text-2">
                        {p.usadas}{p.total != null ? ` de ${p.total}` : ''} {p.usadas === 1 ? 'sessão feita' : 'sessões feitas'}
                      </span>
                      {p.restantes != null && (
                        <span className="text-xs text-text-3">{p.restantes} pendente{p.restantes !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                    {p.sessoes.length === 0 ? (
                      <p className="text-xs text-text-4">Nenhuma sessão feita ainda.</p>
                    ) : (
                      <ul className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                        {p.sessoes.map(s => (
                          <li key={s.id} className="flex items-center justify-between text-xs text-text-3">
                            <span className="truncate pr-2">{s.servico ?? 'Sessão'}</span>
                            <span className="flex-shrink-0 text-text-4">
                              {fmtSessaoData(s.data)} · {s.viaAg ? 'agendada' : 'avulsa'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {clienteId && !pacoteClienteId && pacotesCatalogo.length > 0 && pode('pacotes.vender') && (
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">
                Pacote
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <SearchSelect
                    options={pacotesCatalogo.map(p => ({ value: p.id, label: p.nome, sub: fmtBRL(p.preco) }))}
                    value={pacoteVenderId}
                    onChange={onPacoteVenderChange}
                    placeholder="Nenhum pacote novo"
                  />
                </div>
                {pacoteVenderId && (
                  <button type="button" onClick={() => setPacoteVenderId('')}
                    title="Não vender pacote"
                    className="w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition">
                    <X size={13} strokeWidth={2.5}/>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Lista de serviços (multi) */}
          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Serviços</label>
            <div className="flex flex-col gap-2">
              {linhas.map((l) => (
                <div key={l.uid} className="flex flex-col gap-2 rounded-xl p-3" style={{ background: 'var(--color-bg)' }}>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <SearchSelect
                        options={servicoOpts}
                        value={l.servico_id}
                        onChange={id => onServicoChange(l.uid, id)}
                        placeholder="Buscar serviço..."
                      />
                    </div>
                    {linhas.length > 1 && (
                      <button type="button" onClick={() => removeLinha(l.uid)}
                        className="w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center text-text-4 hover:text-red hover:bg-red/10 transition">
                        <X size={13} strokeWidth={2.5}/>
                      </button>
                    )}
                  </div>
                  {l.servico_id && (
                    <div className="grid grid-cols-2 gap-2 min-w-0">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold text-text-3 uppercase tracking-wide mb-1">Duração (min)</p>
                        <input type="number" value={l.duracao} min={5} step={5}
                          onChange={e => setLinhas(prev => prev.map(x => x.uid === l.uid ? { ...x, duracao: Number(e.target.value) } : x))}
                          className={inputClass} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold text-text-3 uppercase tracking-wide mb-1">Valor (R$)</p>
                        <input type="text" inputMode="decimal" value={l.valor} placeholder={valorCampo(precoDe(l.servico_id))}
                          onChange={e => setLinhas(prev => prev.map(x => x.uid === l.uid ? { ...x, valor: e.target.value } : x))}
                          aria-invalid={!valorDigitadoValido(l.valor)}
                          className={`${inputClass} ${valorDigitadoValido(l.valor) ? '' : 'border-red'}`} />
                        {!valorDigitadoValido(l.valor) && (
                          <p className="text-[10px] text-red mt-0.5">Valor inválido (use 0 para cortesia)</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <button type="button" onClick={addLinha}
                className="flex items-center justify-center gap-1.5 h-9 rounded-xl border border-dashed border-border text-xs font-semibold text-text-3 hover:border-accent hover:text-accent transition">
                <Plus size={12} strokeWidth={2.5}/> Adicionar serviço
              </button>
            </div>
            {linhas.filter(l => l.servico_id).length > 1 && (
              <p className="text-xs text-text-3 mt-1.5">
                Total: {totalDuracao} min · {fmtBRL(totalValor)}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Profissional</label>
            <SearchSelect options={profOpts} value={profId} onChange={setProfId} placeholder="Selecionar profissional..." required />
          </div>

          {agEditar && (
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Data</label>
              <input type="date" value={format(dataSel, 'yyyy-MM-dd')}
                onChange={e => { if (e.target.value) setDataSel(new Date(e.target.value + 'T00:00:00')); }}
                className={inputClass} />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Horário de início</label>
            <input type="time" value={hora} onChange={e => setHora(e.target.value)} required className={inputClass} />
            {totalDuracao > 0 && (() => {
              const [h, m] = hora.split(':').map(Number);
              const fim = addMinutes(new Date(new Date(dataSel).setHours(h, m, 0, 0)), totalDuracao);
              return <p className="text-xs text-text-3 mt-1">Término previsto: {format(fim, 'HH:mm')}</p>;
            })()}
          </div>

          {taxaReservaCfg.ativa && !agEditar && (
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={aplicarTaxaReserva}
                  onChange={e => setAplicarTaxaReserva(e.target.checked)}
                  className="w-4 h-4 rounded border-border accent-primary"
                />
                <span className="text-xs font-semibold text-text-2 uppercase tracking-wide">Cobrar taxa de reserva neste atendimento</span>
              </label>
              {aplicarTaxaReserva && (
                <div className="mt-2">
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 text-sm font-bold">R$</span>
                    <input
                      value={taxaReserva}
                      onChange={e => { setTaxaReserva(e.target.value); setTaxaEditadaManual(true); }}
                      inputMode="decimal" placeholder="0,00"
                      className={`${inputClass} pl-9`}
                    />
                  </div>
                  {parseValorBR(taxaReserva) > 0 && (
                    <>
                      <label className="flex items-center gap-2 mt-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={taxaReservaCobrada}
                          onChange={e => { setTaxaReservaCobrada(e.target.checked); if (!e.target.checked) setTaxaReservaMetodo(null); }}
                          className="w-4 h-4 rounded border-border accent-primary"
                        />
                        <span className="text-xs text-text-2">Já foi cobrada?</span>
                      </label>
                      {taxaReservaCobrada && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {METODOS_TAXA.map(m => (
                            <button key={m.key} type="button"
                              onClick={() => setTaxaReservaMetodo(prev => prev === m.key ? null : m.key)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                                taxaReservaMetodo === m.key
                                  ? 'bg-primary text-white border-primary'
                                  : 'bg-bg text-text-2 border-border hover:border-primary/40'
                              }`}>
                              {m.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Observação <span className="text-text-4 normal-case font-normal">(opcional)</span></label>
            <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2} placeholder="Notas sobre o atendimento..."
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition resize-none" />
          </div>

          {erro && <p className="text-red text-sm text-center">{erro}</p>}

          <div className="flex items-center gap-3 mt-1">
            {agEditar && podeExcluir && (
              <button type="button" onClick={abrirConfirmExcluir}
                className="h-10 px-3 rounded-xl text-sm font-semibold text-red hover:bg-red-soft transition flex items-center gap-1.5">
                <Trash2 size={14} strokeWidth={2}/> Excluir
              </button>
            )}
            {agEditar && !podeExcluir && motivoBloqueioExcluir && pode('agenda.excluir') && (
              <span className="text-xs text-text-4" title={motivoBloqueioExcluir}>Não pode excluir</span>
            )}
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">Cancelar</button>
            <button type="submit" disabled={salvando || (!!bloqueioConflitante && !idCriado) || edicaoTravada || !valoresOk} className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-60">
              {salvando ? 'Salvando...' : idCriado ? 'Salvar serviços' : agEditar ? 'Salvar alterações' : 'Agendar'}
            </button>
          </div>
        </form>
        </div>
      </div>

      {confirmarExcluir && agEditar && (
        <ConfirmDialog
          open
          variant="danger"
          title="Excluir agendamento"
          message={`Excluir o agendamento de ${agEditar.cliente?.nome ?? 'cliente'}? Esta ação não pode ser desfeita.${avisoTaxaExcluir}`}
          confirmLabel="Excluir"
          loading={excluindo}
          onConfirm={excluirAgendamento}
          onCancel={() => setConfirmarExcluir(false)}
        />
      )}
    </div>,
    document.body,
  );
}

// ── Timeline do dia ───────────────────────────────────────────

// Janela (horas visíveis), posições e clique vêm de `./visoes` — em Brasília, esticando a
// janela 7h–21h para caber todo atendimento e bloqueio do dia (nenhum card cortado).

/** Verifica se dois agendamentos se sobrepõem no tempo */
function sobrepoem(a: Ag, b: Ag): boolean {
  return a.data_hora_inicio < b.data_hora_fim && a.data_hora_fim > b.data_hora_inicio;
}

/**
 * Atribui lanes (faixas verticais internas) para agendamentos de uma coluna.
 * Ex: dois agendamentos simultâneos ficam em lane 0 e lane 1.
 */
function computeLanes(colAgs: Ag[]): Map<string, { lane: number; totalLanes: number }> {
  const sorted = [...colAgs].sort((a, b) =>
    a.data_hora_inicio.localeCompare(b.data_hora_inicio)
  );
  const result  = new Map<string, { lane: number; totalLanes: number }>();
  const laneEnd: string[] = []; // fim do último ag em cada lane

  for (const ag of sorted) {
    let lane = laneEnd.findIndex(end => end <= ag.data_hora_inicio);
    if (lane === -1) lane = laneEnd.length;
    laneEnd[lane] = ag.data_hora_fim;
    result.set(ag.id, { lane, totalLanes: 1 });
  }

  // Segunda passagem: ajusta totalLanes para o grupo de sobreposição
  for (const ag of sorted) {
    const group = sorted.filter(o => sobrepoem(ag, o));
    const maxLane = group.reduce((m, o) => Math.max(m, result.get(o.id)!.lane), 0);
    const tl = maxLane + 1;
    for (const o of group) {
      const entry = result.get(o.id)!;
      if (tl > entry.totalLanes) entry.totalLanes = tl;
    }
  }

  return result;
}

// ── Modal de bloqueio ─────────────────────────────────────────

function NovoBloqueioModal({ data, empresaId, meuUserId, meuNome, membros, onClose, onSalvo }: {
  data: Date;
  empresaId: string;
  meuUserId: string;
  meuNome: string;
  membros: { id: string; nome: string }[];
  onClose: () => void;
  onSalvo: (b: Bloqueio) => void;
}) {
  useScrollLock();
  const { pode } = usePermissoes();
  const ehGestao = podeSelecionarEscopoGeral(pode('agenda.aprovar_bloqueios'));

  const [escopo,   setEscopo]   = useState<EscopoBloqueio>('profissional');
  const [profId,   setProfId]   = useState('');
  const [motivo,   setMotivo]   = useState<string>('folga');
  const [titulo,   setTitulo]   = useState('');
  const [horaIni,  setHoraIni]  = useState('08:00');
  const [horaFim,  setHoraFim]  = useState('09:00');
  const [dataBl,   setDataBl]   = useState(format(data, 'yyyy-MM-dd'));
  const [salvando, setSalvando] = useState(false);
  const [erro,     setErro]     = useState('');

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(''); setSalvando(true);

    const dataInicio = new Date(`${dataBl}T${horaIni}:00`);
    const dataFim    = new Date(`${dataBl}T${horaFim}:00`);
    if (dataFim <= dataInicio) {
      setErro('O horário de fim deve ser após o início.'); setSalvando(false); return;
    }
    if (ehGestao && escopo === 'profissional' && !profId) {
      setErro('Escolha o profissional.'); setSalvando(false); return;
    }

    const insert = montarInsertBloqueio({
      podeAprovarBloqueios: ehGestao,
      meuUserId,
      empresaId,
      escopo,
      profissionalId: profId || null,
      motivo: motivo as any,
      titulo,
      dataInicio: dataInicio.toISOString(),
      dataFim: dataFim.toISOString(),
    });

    const { data: row, error } = await supabase
      .from('agenda_bloqueios')
      .insert(insert)
      .select('id, profissional_id, titulo, data_inicio, data_fim, escopo, motivo, situacao, criado_por')
      .single();

    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo(row as Bloqueio);
  }

  const inputCls = "w-full min-w-0 max-w-full h-10 px-3 rounded-xl border border-border bg-bg text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";
  const labelCls = "block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1";

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <Ban size={16} style={{ color: 'var(--color-rose)' }} strokeWidth={2}/>
            <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: 'var(--color-ink)' }}>
              Bloquear horário
            </h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
            <X size={16}/>
          </button>
        </div>

        <form onSubmit={salvar} onKeyDown={avancarComEnter} className="p-5 flex flex-col gap-3 min-w-0">
          {ehGestao ? (
            <>
              <div>
                <label className={labelCls}>Tipo de bloqueio</label>
                <div className="flex rounded-xl border border-border overflow-hidden">
                  <button type="button" onClick={() => setEscopo('profissional')}
                    className={`flex-1 h-10 text-sm font-semibold transition ${escopo === 'profissional' ? 'bg-primary text-white' : 'text-text-2 hover:bg-bg'}`}>
                    Um profissional
                  </button>
                  <button type="button" onClick={() => setEscopo('geral')}
                    className={`flex-1 h-10 text-sm font-semibold transition ${escopo === 'geral' ? 'bg-primary text-white' : 'text-text-2 hover:bg-bg'}`}>
                    Toda a agenda
                  </button>
                </div>
              </div>
              {escopo === 'profissional' && (
                <div>
                  <label className={labelCls}>Profissional</label>
                  <select value={profId} onChange={e => setProfId(e.target.value)} className={inputCls}>
                    <option value="">Selecione...</option>
                    {membros.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl bg-bg border border-border px-3 py-2.5 text-sm text-text-2">
              Bloqueio para: <span className="font-semibold text-text">{meuNome}</span>
              <p className="text-xs text-text-4 mt-1">Vai para aprovação da dona ou gestora.</p>
            </div>
          )}

          <div>
            <label className={labelCls}>Motivo</label>
            <select value={motivo} onChange={e => setMotivo(e.target.value)} className={inputCls} required>
              {MOTIVOS_BLOQUEIO.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>

          <div>
            <label className={labelCls}>Detalhe <span className="normal-case font-normal text-text-4">(opcional)</span></label>
            <input value={titulo} onChange={e => setTitulo(e.target.value)}
              placeholder="Ex: Dentista, Viagem..." className={inputCls}/>
          </div>

          <div>
            <label className={labelCls}>Data</label>
            <input type="date" value={dataBl} onChange={e => setDataBl(e.target.value)} className={inputCls}/>
          </div>

          <div className="flex gap-3 min-w-0">
            <div className="w-28 min-w-0">
              <label className={labelCls}>Início</label>
              <input type="time" value={horaIni} onChange={e => setHoraIni(e.target.value)} className={inputCls}/>
            </div>
            <div className="w-28 min-w-0">
              <label className={labelCls}>Fim</label>
              <input type="time" value={horaFim} onChange={e => setHoraFim(e.target.value)} className={inputCls}/>
            </div>
          </div>

          {erro && <p className="text-sm" style={{ color: 'var(--color-rose)' }}>{erro}</p>}

          <div className="flex gap-3 mt-1">
            <button type="button" onClick={onClose}
              className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
              Cancelar
            </button>
            <button type="submit" disabled={salvando}
              className="flex-1 h-10 rounded-xl text-white text-sm font-bold transition disabled:opacity-60"
              style={{ background: 'var(--color-rose)' }}>
              {salvando ? 'Salvando...' : ehGestao ? 'Bloquear' : 'Pedir bloqueio'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * PendentesBloqueioBtn — pílula "Pendentes (N)" + modal de aprovação.
 *
 * Só aparece quando há pedidos de bloqueio aguardando (some com lista vazia).
 * Cada item mostra autor, janela de horário e motivo; "Aprovar" (verde) age
 * direto, "Recusar" abre um passo de confirmação inline antes de apagar.
 */
function PendentesBloqueioBtn({ pendentes, onAprovar, onRecusar }: {
  pendentes: BloqueioPendente[];
  onAprovar: (id: string) => void;
  onRecusar: (id: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [confirmarRecusa, setConfirmarRecusa] = useState<string | null>(null);
  if (pendentes.length === 0) return null;

  return (
    <>
      <button onClick={() => setAberto(true)}
        className="press flex items-center gap-2 px-3 h-10 rounded-2xl text-sm font-bold border transition"
        style={{ borderColor: 'var(--color-amber)', color: 'var(--color-amber)', background: 'var(--color-amber-soft)' }}
        title="Bloqueios aguardando aprovação">
        <AlertTriangle size={14} strokeWidth={2}/><span>Pendentes ({pendentes.length})</span>
      </button>

      {aberto && (
        <div className="bm-modal fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setAberto(false)}/>
          <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[85dvh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: 'var(--color-ink)' }}>
                Bloqueios pendentes
              </h2>
              <button onClick={() => setAberto(false)} className="w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3 transition">
                <X size={16}/>
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              {pendentes.map(b => (
                <div key={b.id} className="rounded-xl border border-border p-3">
                  <p className="font-semibold text-text text-sm">{b.autorNome}</p>
                  <p className="text-xs text-text-3 mt-0.5">
                    {format(parseISO(b.data_inicio), "dd/MM 'às' HH:mm")}–{format(parseISO(b.data_fim), 'HH:mm')}
                    {' · '}{motivoBloqueioLabel(b.motivo)}
                  </p>
                  {b.titulo && b.titulo !== motivoBloqueioLabel(b.motivo) && (
                    <p className="text-xs text-text-4 italic mt-0.5">{b.titulo}</p>
                  )}
                  {confirmarRecusa === b.id ? (
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => { onRecusar(b.id); setConfirmarRecusa(null); }}
                        className="flex-1 h-8 rounded-lg text-white text-xs font-bold" style={{ background: 'var(--color-rose)' }}>
                        Confirmar recusa
                      </button>
                      <button onClick={() => setConfirmarRecusa(null)}
                        className="flex-1 h-8 rounded-lg border border-border text-text-2 text-xs font-semibold">
                        Voltar
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => onAprovar(b.id)}
                        className="flex-1 h-8 rounded-lg text-white text-xs font-bold" style={{ background: 'var(--color-green)' }}>
                        Aprovar
                      </button>
                      <button onClick={() => setConfirmarRecusa(b.id)}
                        className="flex-1 h-8 rounded-lg border border-border text-text-2 text-xs font-semibold hover:bg-bg">
                        Recusar
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * TimelineView — Visão por hora dos agendamentos do dia.
 *
 * Uma coluna por profissional (`colunasDaTimeline`): só a escolhida, ou todas em
 * "Todas as profissionais", com o nome no topo e rolagem horizontal. Agendamentos são
 * blocos posicionados pelo horário e duração (Brasília) dentro da janela do dia.
 * Sobreposições são detectadas e exibidas lado a lado.
 * Clicar num bloco abre o AgCard no painel lateral.
 */
function TimelineView({
  ags, bloqueios, profissionaisEmpresa, filtro, loading, empresaId, categoriasCustom, onStatus, dataSel, onEditar, onNovo, onPedirRemoverBloqueio, onAvisoBloqueio, meuUserId, podeAlterar,
}: {
  ags: Ag[]; bloqueios: Bloqueio[]; profissionaisEmpresa: { id: string; nome: string }[];
  /** Profissional escolhida ou "todas" (já validado contra `agenda.ver_equipe`). */
  filtro: FiltroProfissional;
  loading: boolean; empresaId: string;
  categoriasCustom: CategoriaCustom[];
  onStatus: (id: string, s: string) => void;
  dataSel: Date;
  onEditar?: (ag: Ag) => void;
  onNovo: (params: { hora: string; profId: string }) => void;
  onPedirRemoverBloqueio: (b: Bloqueio) => void;
  onAvisoBloqueio: (msg: string) => void;
  meuUserId: string;
  /** Falso = atendimento de outra profissional sem `agenda.gerenciar_outras` (só leitura). */
  podeAlterar: (ag: Ag) => boolean;
}) {
  const { pode } = usePermissoes();
  const podeAprovarBloqueios = pode('agenda.aprovar_bloqueios');
  const [agSel,     setAgSel]     = useState<Ag | null>(null);
  // O painel Detalhes so vira modal no mobile/tablet (lg:hidden). No desktop ele e um
  // painel lateral e travar a pagina seria bug — foi exatamente o problema que
  // motivou a variante .bm-modal-mobile no globals.css.
  useScrollLock(!!agSel, { apenasMobile: true });
  const [hoverInfo, setHoverInfo] = useState<{ profId: string; y: number; horaStr: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chaveDia = chaveDiaExibido(dataSel);

  // Janela do dia: 7h–21h esticada para caber todo atendimento e bloqueio visível.
  const janela = useMemo(() => janelaDoDia(itensDaJanela(chaveDia, ags.map(a => ({ data_hora_inicio: a.data_hora_inicio, data_hora_fim: a.data_hora_fim })), bloqueios)), [ags, bloqueios, chaveDia]);
  const alturaTotal = alturaDaJanela(janela);
  const horas = horasDaJanela(janela);

  // Rola até o horário atual (ou o começo da janela) quando a grade aparece — ao montar ela
  // ainda é o esqueleto de carregamento, por isso depende de `loading`.
  useEffect(() => {
    if (loading || !scrollRef.current) return;
    const agoraIso = new Date().toISOString();
    const top = topoAgora(agoraIso, chaveDiaBRT(agoraIso), janela) ?? 0;
    scrollRef.current.scrollTop = Math.max(0, top - 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Sincroniza agSel quando o ag sofre atualização de status (optimistic)
  useEffect(() => {
    if (!agSel) return;
    const atualizado = ags.find(a => a.id === agSel.id);
    if (atualizado) setAgSel(atualizado);
  }, [ags]);

  // Colunas da timeline: a profissional escolhida, ou todas em "Todas" (sempre, mesmo sem
  // agendamento) + qualquer profissional que apareça só nos agendamentos do dia
  // e não esteja na lista (defensivo — ex.: profissional desativado depois).
  const colunas = useMemo(
    () => colunasComExtras(ags, profissionaisEmpresa, filtro, a => a.profissional),
    [ags, profissionaisEmpresa, filtro],
  );
  const profissionais = colunas.map(c => c.profissional);

  // Categorias de serviço presentes no dia (para a legenda de cores)
  const categoriasPresentes = useMemo(() => {
    const set = new Set<string>();
    for (const ag of ags) categoriasDoAg(ag, categoriasCustom).forEach(c => set.add(c));
    return Array.from(set);
  }, [ags, categoriasCustom]);

  // Linha de "agora"
  const agoraTop = topoAgora(new Date().toISOString(), chaveDia, janela);

  if (loading) {
    return (
      <div className="bm-page flex flex-col gap-3">
        {[1, 2, 3].map(i => <Sk key={i} className="h-28 rounded-2xl"/>)}
      </div>
    );
  }

  if (profissionais.length === 0) {
    return (
      <div className="flex items-center gap-3 py-4 px-1 text-text-3 text-sm">
        <span>Nenhum profissional cadastrado ainda.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 min-w-0">
      {/* Legenda de cores por tipo de serviço */}
      {categoriasPresentes.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
          {categoriasPresentes.map(c => {
            const info = infoCategoria(c, categoriasCustom);
            return (
              <div key={c} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: info.cor }}/>
                <span className="text-[10.5px] font-semibold text-text-3">{info.label}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-4 items-start min-w-0">

      {/* ── Grid de timeline ── */}
      <div className="flex-1 border border-border rounded-2xl overflow-hidden bg-surface min-w-0 w-full">

        {/* Área scrollável (nos dois sentidos). Cabeçalho e colunas ficam no mesmo container: em
            "Todas", a rolagem horizontal move os nomes junto com as colunas. */}
        <div ref={scrollRef} className="overflow-auto" style={{ maxHeight: '62dvh' }}>
          <div style={{ minWidth: 'max-content' }}>

        {/* Cabeçalho com nomes dos profissionais — sticky top-0 na rolagem vertical */}
        <div className="sticky top-0 z-40 flex border-b border-border bg-bg">
          <div className="w-10 md:w-12 flex-shrink-0 border-r border-border" />
          {profissionais.map(prof => {
            return (
              <div key={prof.id}
                className="flex-1 min-w-[140px] border-r border-border last:border-r-0 px-2 py-3 text-center"
                title={prof.nome}>
                <p className="text-xs font-bold text-text-2 whitespace-nowrap leading-none">{prof.nome}</p>
              </div>
            );
          })}
        </div>

          <div className="flex">

            {/* Coluna de horas */}
            <div
              className="w-10 md:w-12 flex-shrink-0 border-r border-border relative bg-bg/60"
              style={{ height: alturaTotal }}>
              {horas.map(h => (
                <div key={h}
                  style={{ top: (h - janela.ini) * TL_HOUR_H }}
                  className="absolute inset-x-0 flex justify-center">
                  <span className="text-[10px] text-text-4 font-medium mt-0.5">
                    {String(h).padStart(2, '0')}h
                  </span>
                </div>
              ))}
            </div>

            {/* Colunas por profissional */}
            {colunas.map(({ profissional: prof, itens: colAgs }) => {
              const laneMap = computeLanes(colAgs);

              return (
                <div key={prof.id}
                  className="flex-1 min-w-[140px] border-r border-border last:border-r-0 relative cursor-crosshair"
                  style={{ height: alturaTotal }}
                  onClick={e => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const horaStr = horaDoClique(e.clientY - rect.top, janela);
                    // Instante do clique em Brasília (mesmo fuso da grade).
                    const instante = new Date(`${chaveDia}T${horaStr}:00-03:00`);
                    const bl = bloqueioNoInstante(bloqueios, prof.id, instante.toISOString());
                    if (bl) {
                      onAvisoBloqueio(msgBloqueio(bl.motivo));
                      return;
                    }
                    onNovo({ hora: horaStr, profId: prof.id });
                  }}
                  onMouseMove={e => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const y = e.clientY - rect.top;
                    setHoverInfo({ profId: prof.id, y, horaStr: horaDoClique(y, janela) });
                  }}
                  onMouseLeave={() => setHoverInfo(null)}>

                  {/* Linhas de hora */}
                  {horas.map(h => (
                    <div key={h}
                      style={{ top: (h - janela.ini) * TL_HOUR_H }}
                      className="absolute inset-x-0 border-t border-border/40" />
                  ))}

                  {/* Linhas de meia hora */}
                  {horas.slice(0, -1).map(h => (
                    <div key={`${h}h30`}
                      style={{ top: (h - janela.ini) * TL_HOUR_H + TL_HOUR_H / 2 }}
                      className="absolute inset-x-0 border-t border-dashed border-border/25" />
                  ))}

                  {/* Linha de agora */}
                  {agoraTop !== null && (
                    <div style={{ top: agoraTop }}
                      className="absolute inset-x-0 z-20 pointer-events-none">
                      <div className="border-t-2 border-red">
                        <div className="w-2.5 h-2.5 rounded-full bg-red absolute -left-1.5 -top-[5px]" />
                      </div>
                    </div>
                  )}

                  {/* Hover guide */}
                  {hoverInfo?.profId === prof.id && (
                    <div className="absolute inset-x-0 pointer-events-none z-30" style={{ top: hoverInfo.y }}>
                      <div className="absolute inset-x-0 border-t border-dashed border-accent/60" />
                      <span className="absolute right-1.5 -top-4 text-[9px] font-bold text-accent bg-surface/95 px-1.5 py-0.5 rounded-md border border-accent/25 whitespace-nowrap shadow-sm">
                        {hoverInfo.horaStr}
                      </span>
                    </div>
                  )}

                  {/* Bloqueios de horário */}
                  {/* Quem chama já passa só os visíveis do dia (`bloqueiosVisiveis` + `bloqueiosDoDia`); aqui só os da coluna. */}
                  {bloqueiosDaProfissional(bloqueios, prof.id)
                    .map(bl => {
                      const { top: topBl, height: hBl } = posicaoNaTimeline(bl.data_inicio, bl.data_fim, chaveDia, janela, 20);
                      const pendente    = bl.situacao === 'pendente';
                      const podeRemover = podeAprovarBloqueios
                        || (pendente && bl.criado_por === meuUserId);
                      return (
                        <div key={bl.id}
                          onClick={e => e.stopPropagation()}
                          className="absolute overflow-hidden z-5 flex flex-col"
                          style={{
                            top: topBl, height: hBl, left: 2, right: 2,
                            borderRadius: 5,
                            background: pendente
                              ? 'repeating-linear-gradient(45deg, rgba(201,82,127,0.10) 0 6px, rgba(201,82,127,0.02) 6px 12px)'
                              : 'var(--color-rose-soft)',
                            border: '1px solid rgba(220,38,38,0.22)',
                          }}>
                          <div className="flex items-center justify-between px-1.5 py-0.5 gap-1">
                            <span className="text-[9px] font-semibold truncate" style={{ color: 'var(--color-rose)' }}>
                              {bl.titulo || 'Bloqueio'}
                            </span>
                            {podeRemover && (
                              <button
                                onClick={e => { e.stopPropagation(); onPedirRemoverBloqueio(bl); }}
                                className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-rose-soft transition"
                                title="Remover bloqueio">
                                <X size={9} strokeWidth={2.5} style={{ color: 'var(--color-rose)' }}/>
                              </button>
                            )}
                          </div>
                          {pendente && (
                            <span className="px-1.5 text-[9px] font-semibold leading-none truncate" style={{ color: 'var(--color-amber)' }}>
                              aguardando aprovação
                            </span>
                          )}
                        </div>
                      );
                    })}

                  {/* Blocos de agendamento — cor por tipo de serviço, status via borda/ícone */}
                  {colAgs.map(ag => {
                    const { lane, totalLanes } = laneMap.get(ag.id) ?? { lane: 0, totalLanes: 1 };
                    const pct      = 100 / totalLanes;
                    const { top, height: h } = posicaoNaTimeline(ag.data_hora_inicio, ag.data_hora_fim, chaveDia, janela, 26);
                    const cats     = categoriasDoAg(ag, categoriasCustom);
                    const infoCat  = infoCategoria(cats[0] ?? 'outros', categoriasCustom);
                    const corCat   = infoCat.cor;
                    const bgCat    = infoCat.bg;
                    const inativo  = ag.status === 'faltou' || ag.status === 'cancelado';
                    const selecionado = agSel?.id === ag.id;

                    return (
                      <button
                        key={ag.id}
                        onClick={e => { e.stopPropagation(); setAgSel(selecionado ? null : ag); }}
                        onDoubleClick={e => { e.stopPropagation(); if (podeAlterar(ag)) onEditar?.(ag); }}
                        style={{
                          top:         top + 2,
                          height:      h - 4,
                          left:        `calc(${lane * pct}% + 3px)`,
                          width:       `calc(${pct}% - 6px)`,
                          borderRadius: 5,
                          borderLeft:  `3px solid ${corCat}`,
                          borderTop:    '1px solid rgba(0,0,0,0.06)',
                          borderRight:  '1px solid rgba(0,0,0,0.06)',
                          borderBottom: '1px solid rgba(0,0,0,0.06)',
                          background: inativo
                            ? 'repeating-linear-gradient(-45deg, rgba(148,163,184,0.12), rgba(148,163,184,0.12) 5px, rgba(148,163,184,0.05) 5px, rgba(148,163,184,0.05) 10px)'
                            : bgCat,
                          opacity: inativo ? 0.7 : 1,
                        }}
                        className={`absolute overflow-hidden text-left transition-all
                          ${selecionado ? 'ring-2 ring-accent shadow-lg z-10' : 'hover:shadow-sm hover:brightness-95 z-0'}`}
                      >
                        <div className="px-1.5 py-1 h-full flex flex-col justify-start gap-0.5 min-w-0">
                          <div className="flex items-center gap-1 min-w-0">
                            <span className={`text-[10px] font-bold leading-none flex-shrink-0 whitespace-nowrap tabular-nums ${inativo ? 'text-text-4' : 'text-text-3'}`}>
                              {horaBRT(ag.data_hora_inicio)}–{horaBRT(ag.data_hora_fim)}
                            </span>
                            <p className={`text-[11px] font-bold leading-tight truncate flex-1 ${inativo ? 'text-text-3 line-through' : 'text-text'}`}>
                              {ag.cliente?.nome ?? '—'}
                            </p>
                            {ag.status === 'concluido' && (
                              <Check size={10} strokeWidth={3} className="flex-shrink-0" style={{ color: 'var(--color-green)' }}/>
                            )}
                            {cats.length > 1 && (
                              <div className="flex gap-0.5 flex-shrink-0">
                                {cats.slice(0, 3).map(c => (
                                  <span key={c} className="w-1.5 h-1.5 rounded-full" style={{ background: infoCategoria(c, categoriasCustom).cor }}/>
                                ))}
                              </div>
                            )}
                          </div>
                          {h >= 34 && (
                            <p className="text-[10px] text-text-3 leading-tight truncate">
                              {nomesServicosDoAg(ag)}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}

          </div>
          </div>
        </div>
      </div>

      {/* ── Painel lateral — detalhes do agendamento ── */}
      {agSel && (
        <>
          {/* Mobile: modal centralizado — mesmo padrão dos modais de despesa */}
          <div className="lg:hidden bm-modal-mobile fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setAgSel(null)} />
            <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm max-h-[88dvh] flex flex-col">
              <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
                <p className="text-xs font-semibold text-text-3 uppercase tracking-widest">Detalhes</p>
                <button onClick={() => setAgSel(null)}
                  className="w-7 h-7 rounded-lg hover:bg-bg flex items-center justify-center text-text-4 transition">
                  <X size={14} />
                </button>
              </div>
              <div className="p-4 overflow-y-auto flex-1">
                <AgCard ag={agSel} empresaId={empresaId} statusInline somenteLeitura={!podeAlterar(agSel)}
                  onStatus={(id, s) => { setAgSel(null); onStatus(id, s); }}
                  onEditar={onEditar ? ag => { setAgSel(null); onEditar(ag); } : undefined}/>
              </div>
            </div>
          </div>

          {/* Desktop: painel lateral */}
          <div className="hidden lg:block w-72 flex-shrink-0">
            <div className="sticky top-4">
              <div className="flex items-center justify-between mb-2 px-1">
                <p className="text-xs font-semibold text-text-3 uppercase tracking-widest">Detalhes</p>
                <button onClick={() => setAgSel(null)}
                  className="w-6 h-6 rounded-lg hover:bg-surface flex items-center justify-center text-text-4 transition">
                  <X size={12} />
                </button>
              </div>
              <AgCard ag={agSel} empresaId={empresaId} somenteLeitura={!podeAlterar(agSel)}
                onStatus={(id, s) => { setAgSel(null); onStatus(id, s); }}
                onEditar={onEditar ? ag => { setAgSel(null); onEditar(ag); } : undefined}/>
            </div>
          </div>
        </>
      )}

      </div>
    </div>
  );
}

// ── Lista do dia ─────────────────────────────────────────────

function ListaDia({ ags, bloqueios, loading, dataSel, empresaId, onNovo, onStatus, onEditar, podeAlterar, nomeProfissional, meuUserId, podeAprovar, onPedirRemoverBloqueio }: {
  ags: Ag[];
  /** Bloqueios visíveis do dia (mesmo filtro por profissional da Timeline). */
  bloqueios: Bloqueio[];
  loading: boolean; dataSel: Date; empresaId: string;
  onNovo: () => void; onStatus: (id: string, s: string) => void;
  onEditar?: (ag: Ag) => void;
  /** Falso = atendimento de outra profissional sem `agenda.gerenciar_outras` (só leitura). */
  podeAlterar: (ag: Ag) => boolean;
  nomeProfissional: (id: string) => string | undefined;
  meuUserId: string;
  podeAprovar: boolean;
  onPedirRemoverBloqueio: (b: Bloqueio) => void;
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-text-2 mb-3">
        {isToday(dataSel) ? 'Hoje' : format(dataSel, "EEEE, dd 'de' MMMM", { locale: ptBR })}
        {!loading && (
          <span className="ml-2 text-text-4 font-normal">
            {ags.length} {ags.length === 1 ? 'agendamento' : 'agendamentos'}
          </span>
        )}
      </p>
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1,2,3].map(i => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4 shadow-sm flex items-start gap-3">
              <Sk className="w-9 h-9 rounded-xl flex-shrink-0"/>
              <div className="flex-1 min-w-0 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Sk className="h-4 w-1/2 max-w-[140px]"/>
                  <Sk className="h-5 w-16 rounded-lg flex-shrink-0"/>
                </div>
                <Sk className="h-3 w-2/3 max-w-[180px]"/>
                <Sk className="h-3 w-1/3 max-w-[100px]"/>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
        <BloqueiosDoDia
          bloqueios={bloqueios}
          chaveDia={chaveDiaExibido(dataSel)}
          nomeProfissional={nomeProfissional}
          meuUserId={meuUserId}
          podeAprovar={podeAprovar}
          onPedirRemover={b => { const orig = bloqueios.find(x => x.id === b.id); if (orig) onPedirRemoverBloqueio(orig); }}
        />
        {ags.length > 0 ? (
        <div className="flex flex-col gap-3">
          {ags.map((ag, idx) => (
            <div key={ag.id} className="bm-stagger" style={{ '--bm-i': idx, '--bm-step': '60ms' } as React.CSSProperties}>
              <AgCard ag={ag} empresaId={empresaId} onStatus={onStatus} onEditar={onEditar} somenteLeitura={!podeAlterar(ag)}/>
            </div>
          ))}
          {/* Slot livre */}
          <button onClick={onNovo} className="press bm-stagger"
            style={{
              '--bm-i': ags.length, '--bm-step': '60ms',
              border: '2px dashed var(--color-border)',
              borderRadius: 20, padding: '14px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: 'transparent', width: '100%',
            } as React.CSSProperties}>
            <CalendarPlus size={16} style={{ color: 'var(--color-accent)' }} strokeWidth={2}/>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, color: 'var(--color-accent)' }}>
              Horário livre — agendar
            </span>
          </button>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 py-4 px-1 text-text-3 text-sm">
          <span>Nenhum agendamento para este dia.</span>
          <button onClick={onNovo} className="text-accent font-semibold hover:underline self-start whitespace-nowrap">+ Criar agendamento</button>
        </div>
        )}
        </>
      )}
    </div>
  );
}

// ── Tela principal ────────────────────────────────────────────

export default function AgendaPage() {


  const [view,      setView]      = useState<'semana' | 'mes' | 'timeline'>('timeline');
  const [dataSel,   setDataSel]   = useState(new Date());
  const [semana,    setSemana]    = useState(() => semanaDoDia(new Date()));
  const [ags,        setAgs]       = useState<Ag[]>([]);
  const [bloqueios,  setBloqueios] = useState<Bloqueio[]>([]);
  const [agsMes,     setAgsMes]    = useState<Map<string, number>>(new Map());
  /** Bloqueios da grade do mês (42 dias), para marcar os dias na visão Mês. */
  const [bloqueiosMes, setBloqueiosMes] = useState<Bloqueio[]>([]);
  const [loading,    setLoading]   = useState(true);
  const [empresaId,  setEmpresaId] = useState<string | null>(null);
  const [meuUserId, setMeuUserId] = useState<string>('');
  // Agenda exibida: id de uma profissional ou "todas" (TODAS). Começa na própria
  // pessoa ('' só enquanto a sessão e a preferência carregam). "Todas" só vale com
  // `agenda.ver_equipe` — sem ela, `filtroEfetivo` volta para a própria pessoa. O valor inicial
  // vem da preferência "Minha agenda abre em" (`filtroInicialAgenda`).
  const [filtroProfissional, setFiltroProfissional] = useState<FiltroProfissional>('');
  const [modal,       setModal]      = useState(false);
  const [modalBloq,   setModalBloq]  = useState(false);
  const [modalParams, setModalParams] = useState<{ hora?: string; profId?: string }>({});
  const [agEditar,   setAgEditar]  = useState<Ag | null>(null);
  const [toastErro,    setToastErro]   = useState('');
  const [erroDia,      setErroDia]     = useState('');
  /** Erro da carga do calendário do mês — aviso fixo no calendário (sem ele, dias sem marca pareceriam vazios). */
  const [erroMes, setErroMes] = useState('');
  const [avaliacaoAg,  setAvaliacaoAg] = useState<{ agId: string; clienteNome: string; clienteId: string } | null>(null);
  const [categoriasCustom, setCategoriasCustom] = useState<CategoriaCustom[]>([]);
  // Profissionais da empresa — base das colunas da timeline (independe de haver
  // agendamento no dia; sem isso a timeline e os bloqueios só apareciam em dias
  // com atendimento). Mesma fonte de dados que membrosAtivos, só que ordenada.
  const [profissionaisEmpresa, setProfissionaisEmpresa] = useState<{ id: string; nome: string }[]>([]);
  const [membrosAtivos,      setMembrosAtivos]      = useState<{ id: string; nome: string }[]>([]);
  const [bloqueiosPendentes, setBloqueiosPendentes] = useState<BloqueioPendente[]>([]);
  const [bloqueioParaRemover, setBloqueioParaRemover] = useState<Bloqueio | null>(null);

  const { pode } = usePermissoes();
  // Ver a agenda da equipe e aprovar bloqueios são permissões independentes.
  const ehGestao = pode('agenda.ver_equipe');
  const podeAprovarBloqueios = pode('agenda.aprovar_bloqueios');
  const podeOutras = pode('agenda.gerenciar_outras');
  /** Mesma regra da policy de UPDATE de agendamentos: própria agenda sempre; a de outra só com a chave. */
  const podeAlterarAg = (ag: Ag) => podeMexerNoAgendamento(ag.profissional?.id, meuUserId, podeOutras);
  /** Filtro válido para a carga e as visões ("todas" sem `ver_equipe` vira a própria pessoa). */
  const filtro = filtroEfetivo(filtroProfissional, ehGestao, meuUserId);

  // Cancelado não aparece na agenda — vive só no histórico da cliente.
  // `ags` cru continua sendo a fonte de verdade do revert otimista em
  // `mudarStatus`; toda renderização passa por `agsVisiveis`.
  const agsVisiveis = useMemo(
    () => ags.filter(a => a.status !== 'cancelado'),
    [ags],
  );

  function showErro(msg: string) {
    setToastErro(msg);
    setTimeout(() => setToastErro(''), 4000);
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membro } = await supabase.from('empresa_membros').select('empresa_id')
        .eq('user_id', user.id).eq('ativo', true).limit(1).single();
      setEmpresaId(membro?.empresa_id ?? null);
      setMeuUserId(user.id);
      // Valor inicial pela preferência "Minha agenda abre em" (Configurações → Meu perfil).
      // Só aplica depois de carregar: o filtro fica '' (nada é buscado) até aqui. As permissões já
      // vêm do provider; "Todas" exige `agenda.ver_equipe` mesmo com a preferência gravada.
      // Erro ao ler a preferência = abre na própria pessoa. A troca manual não grava nada.
      let preferencia: 'propria' | 'todas' | null = 'propria';
      if (membro?.empresa_id) {
        try { preferencia = await carregarPreferenciaAgenda(supabase, membro.empresa_id, user.id); } catch { /* própria */ }
      }
      setFiltroProfissional(filtroInicialAgenda(preferencia ?? 'propria', ehGestao, user.id));
      if (membro?.empresa_id) {
        const souGestao = ehGestao;
        const [{ data: cats }, { data: profs }] = await Promise.all([
          supabase.from('categorias_servico').select('*')
            .eq('empresa_id', membro.empresa_id).order('nome'),
          souGestao
            ? supabase.from('empresa_membros').select('user_id, user:users(id, nome)')
                .eq('empresa_id', membro.empresa_id)
                .in('role', ['owner', 'gestor', 'profissional']).eq('ativo', true)
            : supabase.from('empresa_membros').select('user_id, user:users(id, nome)')
                .eq('empresa_id', membro.empresa_id).eq('user_id', user.id).limit(1),
        ]);
        setCategoriasCustom((cats ?? []) as CategoriaCustom[]);
        const membrosMapeados = ((profs ?? []) as any[])
          .map((m) => ({ id: m.user?.id, nome: m.user?.nome }))
          .filter((m: { id?: string; nome?: string }) => m.id && m.nome);
        setMembrosAtivos(membrosMapeados);
        setProfissionaisEmpresa(
          [...membrosMapeados].sort((a, b) => a.nome.localeCompare(b.nome)),
        );
      }
    })();
  }, []);

  // Contadores de requisição: troca rápida de dia/filtro nunca mostra a resposta antiga.
  const reqDia = useRef(0);
  const reqMes = useRef(0);

  // Busca agendamentos + bloqueios do dia selecionado (Brasília). Em "Todas", de todas as
  // profissionais — paginado, porque o PostgREST corta em 1000 linhas sem avisar.
  const fetchDia = useCallback(async (data: Date, empId: string) => {
    if (!filtro) return;
    const req = ++reqDia.current;
    setLoading(true);
    const { startIso: iniDia, endIso: fimDia } = limitesDias(chaveDiaExibido(data), chaveDiaExibido(data));

    try {
      const [rows, blRows] = await Promise.all([
        buscarPaginas((de, ate) => {
          let q = supabase
            .from('agendamentos')
            .select(`id,data_hora_inicio,data_hora_fim,status,valor,observacao,pacote_cliente_id,comanda_id,
              cliente:clientes!agendamentos_cliente_id_fkey(id,nome,telefone),
              profissional:users!agendamentos_profissional_id_fkey(id,nome),
              servico:servicos(id,nome,duracao_minutos,categoria,categoria_id),
              agendamento_servicos(servico_id,valor,duracao_minutos,ordem,servico:servicos(id,nome,categoria,categoria_id))`)
            .eq('empresa_id', empId)
            .gte('data_hora_inicio', iniDia)
            .lte('data_hora_inicio', fimDia)
            .neq('status', 'cancelado');
          if (filtro !== TODAS) q = q.eq('profissional_id', filtro);
          return q.order('data_hora_inicio').order('id').range(de, ate);
        }),
        buscarPaginas((de, ate) => supabase
          .from('agenda_bloqueios')
          .select('id, profissional_id, titulo, data_inicio, data_fim, escopo, motivo, situacao, criado_por')
          .eq('empresa_id', empId)
          .lte('data_inicio', fimDia)
          .gte('data_fim',    iniDia)
          .order('data_inicio').order('id')
          .range(de, ate)),
      ]);
      if (req !== reqDia.current) return;
      setErroDia('');
      setAgs(rows as unknown as Ag[]);
      setBloqueios(blRows as Bloqueio[]);
    } catch (e) {
      if (req !== reqDia.current) return;
      // Mantém o que já estava na tela: lista vazia aqui pareceria "dia sem atendimentos".
      setErroDia(mensagemErroBanco(e as { message?: string; code?: string }, 'carregar a agenda do dia'));
    }
    setLoading(false);
  }, [filtro]);

  // Contagem por dia e bloqueios da grade da visão Mês (42 dias, domingo primeiro).
  const fetchMes = useCallback(async (mes: Date, empId: string) => {
    if (!filtro) return;
    const req = ++reqMes.current;
    const grade = gradeDoMes(mes);
    const { startIso, endIso } = limitesDias(chaveDiaExibido(grade[0]), chaveDiaExibido(grade[grade.length - 1]));
    try {
      const [rows, blRows] = await Promise.all([
        buscarPaginas((de, ate) => {
          let q = supabase
            .from('agendamentos')
            .select('id, data_hora_inicio')
            .eq('empresa_id', empId)
            .neq('status', 'cancelado')
            .gte('data_hora_inicio', startIso)
            .lte('data_hora_inicio', endIso);
          if (filtro !== TODAS) q = q.eq('profissional_id', filtro);
          return q.order('data_hora_inicio').order('id').range(de, ate);
        }),
        buscarPaginas((de, ate) => supabase
          .from('agenda_bloqueios')
          .select('id, profissional_id, titulo, data_inicio, data_fim, escopo, motivo, situacao, criado_por')
          .eq('empresa_id', empId)
          .lte('data_inicio', endIso)
          .gte('data_fim',    startIso)
          .order('data_inicio').order('id')
          .range(de, ate)),
      ]);
      if (req !== reqMes.current) return;
      const map = new Map<string, number>();
      (rows as { data_hora_inicio: string }[]).forEach(r => {
        const k = chaveDiaBRT(r.data_hora_inicio);
        map.set(k, (map.get(k) ?? 0) + 1);
      });
      setErroMes('');
      setAgsMes(map);
      setBloqueiosMes(blRows as Bloqueio[]);
    } catch (e) {
      if (req !== reqMes.current) return;
      setErroMes(mensagemErroBanco(e as { message?: string; code?: string }, 'carregar o calendário do mês'));
    }
  }, [filtro]);

  // Bloqueios visíveis (mesmo filtro em Timeline, Semana e Mês).
  const chaveDiaSel = chaveDiaExibido(dataSel);
  const bloqueiosDaLista = useMemo(
    () => bloqueiosDoDia(bloqueiosVisiveis(bloqueios, filtro, meuUserId, podeAprovarBloqueios), chaveDiaSel),
    [bloqueios, filtro, meuUserId, podeAprovarBloqueios, chaveDiaSel],
  );
  const diasBloqueadosMes = useMemo(
    () => diasComBloqueio(
      bloqueiosVisiveis(bloqueiosMes, filtro, meuUserId, podeAprovarBloqueios),
      gradeDoMes(dataSel).map(chaveDiaExibido),
    ),
    [bloqueiosMes, filtro, meuUserId, podeAprovarBloqueios, dataSel],
  );
  const nomeProfissional = useCallback(
    (id: string) => profissionaisEmpresa.find(p => p.id === id)?.nome
      ?? ags.find(a => a.profissional?.id === id)?.profissional?.nome,
    [profissionaisEmpresa, ags],
  );

  // Bloqueios pendentes de aprovação (só a gestão enxerga / faz polling)
  const recarregarPendentes = useCallback(async () => {
    if (!empresaId) return;
    const { data, error } = await supabase
      .from('agenda_bloqueios')
      .select('id, profissional_id, criado_por, titulo, motivo, data_inicio, data_fim, autor:users!agenda_bloqueios_criado_por_fkey(nome)')
      .eq('empresa_id', empresaId)
      .eq('situacao', 'pendente')
      .order('data_inicio');
    if (error) {
      // Não zera a lista atual — só avisa que a atualização falhou.
      showErro('Erro ao carregar bloqueios pendentes.');
      return;
    }
    setBloqueiosPendentes(
      ((data ?? []) as any[]).map((b) => ({
        id: b.id,
        profissional_id: b.profissional_id,
        criado_por: b.criado_por,
        autorNome: b.autor?.nome ?? 'Profissional',
        titulo: b.titulo,
        motivo: b.motivo,
        data_inicio: b.data_inicio,
        data_fim: b.data_fim,
      })),
    );
  }, [empresaId]);

  useEffect(() => {
    if (!empresaId || !podeAprovarBloqueios) return;
    recarregarPendentes();
    const tick = () => { if (document.visibilityState === 'visible') recarregarPendentes(); };
    const iv = setInterval(tick, 30_000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(iv); window.removeEventListener('focus', tick); };
  }, [empresaId, podeAprovarBloqueios, recarregarPendentes]);

  useEffect(() => {
    if (!empresaId) return;
    fetchDia(dataSel, empresaId);
    if (view === 'mes') fetchMes(dataSel, empresaId);
  }, [dataSel, empresaId, view, fetchDia, fetchMes]);

  /** Move a seleção um dia por vez; realoca a faixa da semana quando o dia sai da semana visível */
  function navDia(dir: number) {
    const novaData = addDays(dataSel, dir);
    setDataSel(novaData);
    if (!semana.some(s => isSameDay(s, novaData)))
      setSemana(semanaDoDia(novaData));
  }

  function navMes(dir: number) {
    setDataSel(d => dir > 0 ? addMonths(d, 1) : subMonths(d, 1));
  }

  function selecionarDia(d: Date) {
    setDataSel(d);
    if (!semana.some(s => isSameDay(s, d)))
      setSemana(semanaDoDia(d));
  }

  /** Atendimento aguardando a resposta de "Cobrar taxa de cancelamento de R$ X?". */
  const [perguntaTaxa, setPerguntaTaxa] = useState<{ id: string; status: string; valor: number; clienteNome: string } | null>(null);
  const [gravandoTaxa, setGravandoTaxa] = useState(false);

  /**
   * Ponto único de mudança de status da Agenda (dropdown, detalhe e timeline chegam aqui).
   * Para cancelado/faltou com a migration 091 aplicada, o UPDATE sempre leva `cobrar_taxa_cancelamento`:
   * a escolha da pessoa quando há pergunta, ou `true` quando não há. Sem a 091 não pergunta nem envia a coluna.
   */
  async function mudarStatus(id: string, status: string) {
    const ag = ags.find(a => a.id === id);
    if (ag && !podeAlterarAg(ag)) {
      showErro(mensagemErroBanco({ code: '42501' }, 'mudar o status de agendamento de outra profissional'));
      return;
    }
    if (status !== 'cancelado' && status !== 'faltou') { await aplicarStatus(id, status); return; }
    if (!(await colunaCobrarTaxaExiste(supabase))) { await aplicarStatus(id, status); return; }
    let pergunta = { perguntar: false, valor: 0 };
    if (empresaId && ag?.cliente) {
      try {
        const cfg = await carregarConfigTaxas(supabase, empresaId);
        pergunta = perguntaTaxaCancelamento(cfg.cancelamento, status, ag.cliente.id, ag.valor);
      } catch (e) {
        showErro(mensagemErroBanco({ message: (e as Error).message }, 'ler a configuração da taxa de cancelamento'));
        return;
      }
    }
    if (pergunta.perguntar) {
      setPerguntaTaxa({ id, status, valor: pergunta.valor, clienteNome: ag?.cliente?.nome ?? '' });
      return;
    }
    await aplicarStatus(id, status, true);
  }

  async function responderPerguntaTaxa(cobrar: boolean) {
    if (!perguntaTaxa) return;
    setGravandoTaxa(true);
    await aplicarStatus(perguntaTaxa.id, perguntaTaxa.status, cobrar);
    setGravandoTaxa(false);
    setPerguntaTaxa(null);
  }

  async function aplicarStatus(id: string, status: string, cobrarTaxaCancelamento?: boolean) {
    // Salva o status original ANTES de atualizar (necessário para revert)
    const ag = ags.find(a => a.id === id);
    const statusOriginal = ag?.status ?? '';
    // Otimista: atualiza local imediatamente
    setAgs(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    // .select('id') + guarda de 0 linhas: RLS recusando UPDATE devolve sucesso sem linha.
    const { data: rows, error } = await supabase
      .from('agendamentos')
      .update(cobrarTaxaCancelamento === undefined ? { status } : { status, cobrar_taxa_cancelamento: cobrarTaxaCancelamento })
      .eq('id', id)
      .select('id');
    if (error || !rows || rows.length === 0) {
      setAgs(prev => prev.map(a => a.id === id ? { ...a, status: statusOriginal } : a));
      showErro(mensagemErroBanco(error ?? { code: '42501' }, 'mudar o status deste agendamento'));
      return;
    }
    if (status === 'concluido' && ag?.cliente) {
      setAvaliacaoAg({
        agId: id,
        clienteNome: ag.cliente.nome,
        clienteId: ag.cliente.id,
      });
    }
  }

  /** Recarrega as marcas de bloqueio do calendário (só na visão Mês) depois de mexer num bloqueio. */
  function recarregarMes() {
    if (empresaId && view === 'mes') fetchMes(dataSel, empresaId);
  }

  /** Remove um bloqueio. `.select('id')` + guarda de zero linhas transforma um bloqueio de RLS em mensagem visível, restaurando a lista otimista. */
  async function deletarBloqueio(id: string) {
    const anterior = bloqueios;
    setBloqueios(prev => prev.filter(b => b.id !== id));
    const { data: rows, error } = await supabase
      .from('agenda_bloqueios').delete().eq('id', id).select('id');
    if (error || !rows || rows.length === 0) {
      setBloqueios(anterior);
      showErro(error?.message ?? 'Sem permissão para remover este bloqueio.');
      return;
    }
    setBloqueiosPendentes(prev => prev.filter(b => b.id !== id));
    recarregarMes();
  }

  /** Aprova um pedido de bloqueio pendente. `.select('id')` + guarda de zero linhas para não engolir bloqueio de RLS. */
  async function aprovarBloqueio(id: string) {
    const { data: rows, error } = await supabase
      .from('agenda_bloqueios')
      .update({ situacao: 'aprovado', revisado_por: meuUserId, revisado_em: new Date().toISOString() })
      .eq('id', id)
      .select('id');
    if (error || !rows || rows.length === 0) {
      showErro(error?.message ?? 'Sem permissão para aprovar.');
      return;
    }
    setBloqueiosPendentes(prev => prev.filter(b => b.id !== id));
    if (empresaId) fetchDia(dataSel, empresaId);
    recarregarMes();
  }

  /** Recusa um pedido de bloqueio pendente apagando a linha. Mesma guarda de zero linhas do aprovar. */
  async function recusarBloqueio(id: string) {
    const { data: rows, error } = await supabase
      .from('agenda_bloqueios')
      .delete()
      .eq('id', id)
      .select('id');
    if (error || !rows || rows.length === 0) {
      showErro(error?.message ?? 'Sem permissão para recusar.');
      return;
    }
    setBloqueiosPendentes(prev => prev.filter(b => b.id !== id));
    if (empresaId) fetchDia(dataSel, empresaId);
    recarregarMes();
  }

  return (
    <div className="bm-page">
      {/* Toast de erro */}
      {toastErro && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-red text-white px-5 py-3 rounded-2xl shadow-lg font-semibold text-sm pointer-events-none">
          {toastErro}
        </div>
      )}

      {erroDia && (
        <div role="alert" className="mb-4 rounded-xl bg-red-soft text-red text-sm font-semibold px-4 py-3">
          {erroDia} Os dados abaixo podem estar desatualizados.
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6 bm-mobile-page-header">
        <div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }} className="capitalize">
            {format(dataSel, 'MMMM yyyy', { locale: ptBR })}
          </p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em', lineHeight: 1.05 }}>Agenda</h1>
        </div>
        <div className="bm-mobile-actions bm-mobile-page-actions sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:pt-1">
          {/* Toggle view */}
          <div className="bm-mobile-action-wide" style={{ display: 'flex', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 14, overflow: 'hidden' }}>
            {([
              { key: 'semana',   label: 'Semana'   },
              { key: 'mes',      label: 'Mês'      },
              { key: 'timeline', label: 'Timeline' },
            ] as const).map(({ key, label }) => (
              <button key={key} onClick={() => setView(key)}
                style={view === key
                  ? { flex: 1, textAlign: 'center', background: 'var(--color-primary)', color: '#fff', fontWeight: 700, fontFamily: 'var(--font-sans)', fontSize: 12, padding: '16px 12px' }
                  : { flex: 1, textAlign: 'center', color: 'var(--color-ink3)', fontWeight: 600, fontFamily: 'var(--font-sans)', fontSize: 12, padding: '16px 12px' }}
                className="transition">{label}</button>
            ))}
          </div>
          {ehGestao && profissionaisEmpresa.length > 1 && (
            <div className="bm-mobile-action-wide" style={{ minWidth: 200 }}>
              <SearchSelect
                options={[...(ehGestao ? [{ value: TODAS, label: 'Todas as profissionais' }] : []), ...profissionaisEmpresa.map(p => ({ value: p.id, label: p.nome }))]}
                value={filtro}
                onChange={v => setFiltroProfissional(v as FiltroProfissional)}
                placeholder="Ver agenda de..."
              />
            </div>
          )}
          <ExportButton
            variant="mobileHeader"
            className="bm-mobile-header-export"
            definicao={definicaoAgenda(format(dataSel, 'yyyy-MM-dd'))}
            getLinhas={() => agsVisiveis.map(a => ({ inicio: a.data_hora_inicio, cliente: a.cliente?.nome ?? null, servico: a.servico?.nome ?? null, profissional: a.profissional?.nome ?? null, valor: a.valor, status: STATUS[a.status]?.label ?? a.status }))}
          />
          <button onClick={() => setModalBloq(true)}
            className="press flex items-center gap-2 px-3 h-10 rounded-2xl text-sm font-bold border border-border transition hover:bg-bg"
            style={{ fontFamily: 'var(--font-sans)', color: 'var(--color-rose)' }}
            title="Bloquear horário">
            <Ban size={14} strokeWidth={2}/><span>Bloquear</span>
          </button>
          {podeAprovarBloqueios && (
            <PendentesBloqueioBtn
              pendentes={bloqueiosPendentes}
              onAprovar={aprovarBloqueio}
              onRecusar={recusarBloqueio}
            />
          )}
          <button onClick={() => { setModalParams({}); setModal(true); }} className="press flex items-center gap-2 px-4 h-10 rounded-2xl text-white text-sm font-bold"
            style={{ background: 'var(--color-primary)', boxShadow: '0 6px 20px rgba(44,23,80,0.18)', fontFamily: 'var(--font-sans)' }}>
            <Plus size={15} strokeWidth={2.5}/>Novo
          </button>
        </div>
      </div>

      {/* Navegador de semana — visível em Semana e Timeline */}
      {(view === 'semana' || view === 'timeline') && (
        <div className="flex justify-center mb-6">
          <div className="bg-surface border border-border rounded-[20px] py-3 px-2 sm:px-4 max-w-full overflow-x-auto">
            <div className="flex items-center gap-1 sm:gap-1.5">
              <button onClick={() => navDia(-1)}
                className="w-8 h-8 rounded-[10px] flex items-center justify-center text-text-3 hover:bg-bg transition flex-shrink-0">
                <ChevronLeft size={16}/>
              </button>
              <div className="flex gap-0.5 sm:gap-1">
                {semana.map((d, i) => {
                  const sel = isSameDay(d, dataSel);
                  const hj  = isToday(d);
                  return (
                    <button key={d.toISOString()} onClick={() => selecionarDia(d)} className="bm-stagger press flex flex-col items-center rounded-[14px] py-2.5 w-9 sm:w-11 flex-shrink-0"
                      style={{
                        '--bm-i': i, '--bm-step': '35ms',
                        background: sel ? 'var(--color-primary)' : 'transparent',
                        transition: 'all 0.15s',
                      } as React.CSSProperties}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4, fontFamily: 'var(--font-sans)', color: sel ? 'rgba(255,255,255,0.7)' : 'var(--color-ink4)' }}>{DIAS[d.getDay()]}</span>
                      <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-sans)', color: sel ? '#fff' : hj ? 'var(--color-accent)' : 'var(--color-ink2)' }}>{format(d, 'd')}</span>
                    </button>
                  );
                })}
              </div>
              <button onClick={() => navDia(1)}
                className="w-8 h-8 rounded-[10px] flex items-center justify-center text-text-3 hover:bg-bg transition flex-shrink-0">
                <ChevronRight size={16}/>
              </button>
            </div>
          </div>
        </div>
      )}

      {view === 'semana' ? (
        <ListaDia ags={agsVisiveis} bloqueios={bloqueiosDaLista} loading={loading} dataSel={dataSel} empresaId={empresaId ?? ''} onNovo={() => setModal(true)} onStatus={mudarStatus} onEditar={ag => setAgEditar(ag)} podeAlterar={podeAlterarAg} nomeProfissional={nomeProfissional} meuUserId={meuUserId} podeAprovar={podeAprovarBloqueios} onPedirRemoverBloqueio={setBloqueioParaRemover}/>
      ) : view === 'timeline' ? (
        <TimelineView
          ags={agsVisiveis}
          bloqueios={bloqueiosDaLista}
          profissionaisEmpresa={profissionaisEmpresa}
          filtro={filtro}
          loading={loading}
          empresaId={empresaId ?? ''}
          categoriasCustom={categoriasCustom}
          onStatus={mudarStatus}
          dataSel={dataSel}
          onEditar={ag => setAgEditar(ag)}
          onNovo={({ hora, profId }) => {
            // Sem a permissão, o modal travaria a profissional nela mesma em silêncio — avisa em vez disso.
            if (profId && profId !== meuUserId && !podeOutras) {
              showErro('Você só pode agendar na sua própria agenda. Fale com a dona ou a gestora.');
              return;
            }
            setModalParams({ hora, profId }); setModal(true);
          }}
          onPedirRemoverBloqueio={setBloqueioParaRemover}
          onAvisoBloqueio={showErro}
          meuUserId={meuUserId}
          podeAlterar={podeAlterarAg}
        />
      ) : (
        <>
          {/* Mês: calendário centralizado + lista abaixo */}
          <div className="flex justify-center mb-6">
          <div className="bg-surface border border-border rounded-2xl p-4 sm:p-5 w-full max-w-md">
            <div className="flex items-center justify-center gap-3 mb-4">
              <button onClick={() => navMes(-1)} className="w-8 h-8 rounded-lg hover:bg-bg flex items-center justify-center text-text-3 transition">
                <ChevronLeft size={16}/>
              </button>
              <span className="text-sm font-semibold text-text-2 capitalize w-36 text-center">
                {format(dataSel, 'MMMM yyyy', { locale: ptBR })}
              </span>
              <button onClick={() => navMes(1)} className="w-8 h-8 rounded-lg hover:bg-bg flex items-center justify-center text-text-3 transition">
                <ChevronRight size={16}/>
              </button>
            </div>
            {erroMes && (
              <div role="alert" className="mb-3 rounded-xl bg-red-soft text-red text-xs font-semibold px-3 py-2">
                {erroMes} As marcas do calendário podem estar incompletas.
              </div>
            )}
            <MesView mes={dataSel} agsPorDia={agsMes} diasBloqueados={diasBloqueadosMes} diaSel={dataSel} onDiaClick={selecionarDia}/>
          </div>
          </div>
          <ListaDia ags={agsVisiveis} bloqueios={bloqueiosDaLista} loading={loading} dataSel={dataSel} empresaId={empresaId ?? ''} onNovo={() => setModal(true)} onStatus={mudarStatus} onEditar={ag => setAgEditar(ag)} podeAlterar={podeAlterarAg} nomeProfissional={nomeProfissional} meuUserId={meuUserId} podeAprovar={podeAprovarBloqueios} onPedirRemoverBloqueio={setBloqueioParaRemover}/>
        </>
      )}

      {/* Modal novo/editar agendamento */}
      {(modal || agEditar) && empresaId && (
        <NovoAgModal
          data={agEditar ? parseISO(agEditar.data_hora_inicio) : dataSel}
          empresaId={empresaId}
          horaInicial={modalParams.hora}
          profIdInicial={modalParams.profId}
          meuUserId={meuUserId}
          onClose={() => { setModal(false); setAgEditar(null); setModalParams({}); }}
          onSalvo={() => {
            setModal(false);
            setAgEditar(null);
            setModalParams({});
            fetchDia(dataSel, empresaId);
            if (view === 'mes') fetchMes(dataSel, empresaId);
          }}
          onExcluido={() => {
            setModal(false);
            setAgEditar(null);
            setModalParams({});
            fetchDia(dataSel, empresaId);
            if (view === 'mes') fetchMes(dataSel, empresaId);
          }}
          agEditar={agEditar ?? undefined}
        />
      )}

      {perguntaTaxa && (
        <PerguntaTaxaCancelamentoModal
          valor={perguntaTaxa.valor}
          clienteNome={perguntaTaxa.clienteNome}
          loading={gravandoTaxa}
          onCobrar={() => responderPerguntaTaxa(true)}
          onNaoCobrar={() => responderPerguntaTaxa(false)}
          onFechar={() => setPerguntaTaxa(null)}
        />
      )}

      {/* Confirmação ao remover bloqueio pela Timeline */}
      {bloqueioParaRemover && (() => {
        const b = bloqueioParaRemover;
        const alvo = b.escopo === 'geral'
          ? 'Toda a agenda'
          : (profissionaisEmpresa.find(p => p.id === b.profissional_id)?.nome ?? 'Profissional');
        const intervalo =
          `${format(parseISO(b.data_inicio), "dd/MM 'às' HH:mm")}–${format(parseISO(b.data_fim), 'HH:mm')}`;
        const pend = b.situacao === 'pendente' ? ' Este pedido ainda aguarda aprovação.' : '';
        return (
          <ConfirmDialog
            open
            variant="danger"
            title="Remover bloqueio?"
            message={`${alvo} · ${motivoBloqueioLabel(b.motivo)} · ${intervalo}.${pend}`}
            confirmLabel="Remover"
            onConfirm={() => { deletarBloqueio(b.id); setBloqueioParaRemover(null); }}
            onCancel={() => setBloqueioParaRemover(null)}
          />
        );
      })()}

      {/* Modal de bloqueio */}
      {modalBloq && empresaId && (
        <NovoBloqueioModal
          data={dataSel}
          empresaId={empresaId}
          meuUserId={meuUserId}
          meuNome={membrosAtivos.find(m => m.id === meuUserId)?.nome ?? 'Você'}
          membros={membrosAtivos}
          onClose={() => setModalBloq(false)}
          onSalvo={b => {
            setBloqueios(prev => [...prev, b]);
            setModalBloq(false);
            recarregarMes();
            if (b.situacao === 'pendente') showErro('Pedido de bloqueio enviado para aprovação.');
          }}
        />
      )}

      {/* Modal de avaliação pós-atendimento */}
      {avaliacaoAg && empresaId && (
        <AvaliacaoModal
          clienteNome={avaliacaoAg.clienteNome}
          onClose={() => setAvaliacaoAg(null)}
          onSalvar={async (nota, comentario) => {
            // O banco preenche a profissional a partir do atendimento; o erro volta para o modal.
            await salvarAvaliacao(supabase as unknown as Parameters<typeof salvarAvaliacao>[0], {
              empresaId, agendamentoId: avaliacaoAg.agId, clienteId: avaliacaoAg.clienteId, nota, comentario,
            });
            setAvaliacaoAg(null);
          }}
        />
      )}
    </div>
  );
}

// ── Modal de Avaliação ─────────────────────────────────────────

function AvaliacaoModal({ clienteNome, onClose, onSalvar }: {
  clienteNome: string;
  onClose: () => void;
  onSalvar: (nota: number, comentario: string) => Promise<void>;
}) {
  useScrollLock();
  const [nota,       setNota]       = useState(0);
  const [hover,      setHover]      = useState(0);
  const [comentario, setComentario] = useState('');
  const [salvando,   setSalvando]   = useState(false);

  const [erro, setErro] = useState('');

  async function salvar() {
    if (nota === 0) return;
    setSalvando(true); setErro('');
    try {
      await onSalvar(nota, comentario);
    } catch (e) {
      setErro((e as Error).message || 'Não foi possível salvar a avaliação.');
      setSalvando(false);
    }
  }

  const estrelaAtiva = hover || nota;

  return (
    <div className="bm-modal fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-5"
        style={{ animation: 'bm-screen .3s cubic-bezier(.2,.85,.3,1)' }}>

        <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-xl hover:bg-bg flex items-center justify-center text-text-3">
          <X size={15}/>
        </button>

        <div className="text-center">
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--color-ink3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>
            Atendimento concluído
          </p>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600, color: 'var(--color-ink)' }}>
            Como foi com {clienteNome.split(' ')[0]}?
          </h2>
        </div>

        <div className="flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map(i => (
            <button key={i} type="button"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setNota(i)}
              className="transition-transform hover:scale-110 active:scale-95">
              <Star
                size={36}
                strokeWidth={1.5}
                fill={i <= estrelaAtiva ? 'var(--color-amber)' : 'none'}
                style={{ color: i <= estrelaAtiva ? 'var(--color-amber)' : 'var(--color-border)' }}
              />
            </button>
          ))}
        </div>

        {nota > 0 && (
          <div>
            <textarea
              value={comentario}
              onChange={e => setComentario(e.target.value)}
              placeholder="Comentário opcional..."
              rows={2}
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-bg text-text text-sm placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition resize-none"
            />
          </div>
        )}

        {erro && <p className="text-xs font-semibold text-red text-center">{erro}</p>}

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-border text-text-2 text-sm font-semibold hover:bg-bg transition">
            Pular
          </button>
          <button onClick={salvar} disabled={nota === 0 || salvando}
            className="flex-1 h-10 rounded-xl text-white text-sm font-bold transition disabled:opacity-40"
            style={{ background: 'var(--color-amber)', boxShadow: '0 4px 14px rgba(166,90,27,0.25)' }}>
            {salvando ? 'Salvando...' : 'Salvar avaliação'}
          </button>
        </div>
      </div>
    </div>
  );
}
