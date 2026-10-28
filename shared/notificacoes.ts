/**
 * @file notificacoes.ts
 * Regras puras da tela de Notificações e do sino, iguais em web e app.
 *
 * A tela tem duas seções:
 * - **Alertas**: calculados na hora a partir dos dados da empresa (`alertasCalculados`);
 * - **Avisos**: linhas gravadas em `notificacoes` (tipos em `TIPOS_NOTIFICACAO`).
 *
 * As consultas ficam em `./notificacoes-consultas` (`carregarDadosAlertas`, que devolve um `DadosAlertas` que encaixa em `EntradaAlertas`).
 * Datas sempre em Brasília (`./periodos`): o web antigo calculava "hoje" em UTC.
 */
import { aniversariantesProximos, DIAS_DESPESAS_VENCENDO, type ClienteAniversario } from './dashboard';
import { AGENDAMENTO_LABEL, type AgendamentoStatus } from './dominio';
import { formatarQuantidadeBR } from './estoque';
import { formatarMoeda } from './moeda';
import { chaveDiaBRT, diasEntre, hojeBRT, horaBRT, instanteMs, limitesDias, somarDias } from './periodos';
import { pode, type Acesso, type PermissoesUsuario } from './permissoes';

// ── Avisos gravados (tabela notificacoes) ─────────────────────────

/** Tipos gravados hoje pelos crons e triggers. `comissao`, `pagamento` e `cliente_sumido` nunca são gravados. */
export type TipoNotificacao =
  | 'agendamento' | 'resumo' | 'estoque_baixo'
  | 'bloqueio_pendente' | 'bloqueio_aprovado' | 'bloqueio_recusado';

/** Cor do ícone, pelo nome do token de cor das duas plataformas (`--color-*` no web, paleta `C` no app). */
export type CorAviso = 'primary' | 'amber' | 'green' | 'red' | 'rose';

/** Visual de um tipo: `icone` é o nome do ícone lucide (igual em lucide-react e lucide-react-native). */
export type VisualAviso = { rotulo: string; icone: string; cor: CorAviso };

export const TIPOS_NOTIFICACAO: Readonly<Record<TipoNotificacao, VisualAviso>> = {
  agendamento:       { rotulo: 'Agendamento',        icone: 'CalendarDays',  cor: 'primary' },
  resumo:            { rotulo: 'Resumo do dia',      icone: 'ClipboardList', cor: 'primary' },
  estoque_baixo:     { rotulo: 'Estoque baixo',      icone: 'Package',       cor: 'amber' },
  bloqueio_pendente: { rotulo: 'Bloqueio pendente',  icone: 'Ban',           cor: 'amber' },
  bloqueio_aprovado: { rotulo: 'Bloqueio aprovado',  icone: 'Check',         cor: 'green' },
  bloqueio_recusado: { rotulo: 'Bloqueio recusado',  icone: 'X',             cor: 'red' },
};

/** O tipo conhecido, ou `null` (tipos antigos/desconhecidos caem no visual genérico). */
export function tipoNotificacao(tipo: string | null | undefined): TipoNotificacao | null {
  return tipo && Object.prototype.hasOwnProperty.call(TIPOS_NOTIFICACAO, tipo) ? (tipo as TipoNotificacao) : null;
}

export type Plataforma = 'web' | 'app';
/** Área do app: a da empresa (dona/gestora) ou a da profissional. O web tem uma área só. */
export type AreaApp = 'empresa' | 'profissional';

/** Telas para onde um alerta ou aviso leva. */
export type DestinoAlerta =
  | { tela: 'agenda' | 'estoque' | 'financeiro' | 'comissoes' | 'comanda' | 'dashboard' | 'notificacoes' }
  | { tela: 'cliente'; id: string };

const WEB: Record<Exclude<DestinoAlerta['tela'], 'cliente'>, string> = {
  agenda: '/agenda', estoque: '/estoque', financeiro: '/financeiro', comissoes: '/comissoes',
  comanda: '/comanda', dashboard: '/dashboard', notificacoes: '/notificacoes',
};
const APP_EMPRESA: Record<Exclude<DestinoAlerta['tela'], 'cliente'>, string> = {
  agenda: '/(empresa)/agenda', estoque: '/(empresa)/estoque', financeiro: '/(empresa)/financeiro',
  comissoes: '/(empresa)/comissoes', comanda: '/(empresa)/nova-comanda', dashboard: '/(empresa)/dashboard',
  notificacoes: '/(empresa)/notificacoes',
};
/** A área da profissional só tem agenda, comissões, início e notificações. */
const APP_PROFISSIONAL: Partial<Record<DestinoAlerta['tela'], string>> = {
  agenda: '/(profissional)/agenda', comissoes: '/(profissional)/comissoes', dashboard: '/(profissional)/inicio',
  notificacoes: '/(profissional)/notificacoes',
};

/** Rota de uma tela de destino em cada plataforma (e área do app). */
export function rotaDoDestino(destino: DestinoAlerta, plataforma: Plataforma, area: AreaApp = 'empresa'): string {
  if (plataforma === 'web') return destino.tela === 'cliente' ? `/clientes/${destino.id}` : WEB[destino.tela];
  if (area === 'profissional') return APP_PROFISSIONAL[destino.tela] ?? APP_PROFISSIONAL.notificacoes!;
  return destino.tela === 'cliente' ? `/(empresa)/cliente/${destino.id}` : APP_EMPRESA[destino.tela];
}

const DESTINO_DO_TIPO: Record<TipoNotificacao, DestinoAlerta> = {
  agendamento: { tela: 'agenda' },
  resumo: { tela: 'dashboard' },
  estoque_baixo: { tela: 'estoque' },
  bloqueio_pendente: { tela: 'agenda' },
  bloqueio_aprovado: { tela: 'agenda' },
  bloqueio_recusado: { tela: 'agenda' },
};

/** Rota que abre ao tocar num aviso (ou na notificação push). Tipo desconhecido → tela de Notificações. */
export function rotaDoAviso(tipo: string | null | undefined, plataforma: Plataforma, area: AreaApp = 'empresa'): string {
  const t = tipoNotificacao(tipo);
  return rotaDoDestino(t ? DESTINO_DO_TIPO[t] : { tela: 'notificacoes' }, plataforma, area);
}

// ── Alertas calculados ────────────────────────────────────────────

export type GrupoAlerta = 'agendamentos' | 'estoque' | 'despesas' | 'comissoes' | 'comandas' | 'aniversarios';

export type Alerta = {
  id: string;
  grupo: GrupoAlerta;
  titulo: string;
  descricao: string;
  destino: DestinoAlerta;
  urgente: boolean;
};

export const VISUAL_ALERTA: Readonly<Record<GrupoAlerta, { icone: string; cor: CorAviso }>> = {
  agendamentos: { icone: 'CalendarDays', cor: 'primary' },
  estoque:      { icone: 'Package',      cor: 'amber' },
  despesas:     { icone: 'DollarSign',   cor: 'red' },
  comissoes:    { icone: 'Wallet',       cor: 'green' },
  comandas:     { icone: 'Receipt',      cor: 'rose' },
  aniversarios: { icone: 'Gift',         cor: 'rose' },
};

type Nome = { nome: string | null } | null;

/** Linhas como `carregarDadosAlertas` (./notificacoes-consultas) devolve: embeds `cliente`/`servico`/`profissional`. */
export type EntradaAgendamentoAlerta = {
  id: string; data_hora_inicio: string;
  /** Opcional: a consulta já traz só os que não terminaram; quando vem, a regra confere de novo. */
  data_hora_fim?: string | null;
  status: string; profissional_id: string | null;
  cliente?: Nome; servico?: Nome;
};
export type EntradaEstoqueBaixo = { id: string; nome: string; estoque_atual: number | string; estoque_minimo: number | string };
export type EntradaDespesaAlerta = { id: string; descricao: string; valor: number | string; data_vencimento: string };
export type EntradaComissaoAlerta = { id: string; valor_comissao: number | string; profissional_id: string | null; profissional?: Nome };
/** `profissional_id` é obrigatório: sem `agenda.gerenciar_outras` a regra só mostra as próprias. */
export type EntradaComandaAberta = { id: string; data_hora_inicio: string; profissional_id: string | null };

/**
 * Entrada de `alertasCalculados` — o `DadosAlertas` de `./notificacoes-consultas` encaixa aqui.
 * Lista `null`/ausente = não consultada (sem a permissão ou não carregada): não gera alerta.
 * A regra refaz os filtros de data e de permissão, para o alerta nunca depender só da consulta.
 */
export type EntradaAlertas = {
  /** Atendimentos de hoje (Brasília). */
  agendamentosHoje?: EntradaAgendamentoAlerta[] | null;
  /** `v_produtos_estoque_baixo`. */
  estoqueBaixo?: EntradaEstoqueBaixo[] | null;
  /** Despesas pendentes (a janela de hoje a hoje+7 é refeita aqui). */
  despesasVencendo?: EntradaDespesaAlerta[] | null;
  /** Comissões pendentes, de qualquer mês. */
  comissoesPendentes?: EntradaComissaoAlerta[] | null;
  /** Clientes ativas com data de nascimento. */
  aniversariantes?: ClienteAniversario[] | null;
  /** Atendimentos já ocorridos sem comanda (`aplicarFiltroComandasNaoFechadas`). */
  comandasNaoFechadas?: EntradaComandaAberta[] | null;
};

const STATUS_FORA_DO_ALERTA = new Set(['concluido', 'cancelado', 'faltou']);
const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const num = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

/**
 * Os alertas que a pessoa vê, na ordem da tela: agendamentos de hoje, estoque baixo, despesas
 * vencendo, comissões pendentes, comandas não fechadas e aniversariantes.
 *
 * Permissões (`null` = ainda não carregadas ou com erro → nada que dependa de permissão):
 * - agendamentos: `agenda.ver_equipe` → todos; senão só os da própria pessoa;
 * - estoque baixo: `estoque.acessar`;
 * - despesas: `financeiro.ver`;
 * - comissões: `comissoes.ver_todas` → todas, por profissional; senão só as próprias;
 * - comandas não fechadas: `comanda.fechar` (sem `agenda.gerenciar_outras`, só as próprias — é o
 *   que ela consegue fechar);
 * - aniversariantes: todos (clientes são vistas por toda a equipe).
 */
export function alertasCalculados(
  dados: EntradaAlertas,
  permissoes: PermissoesUsuario | null,
  opcoes: { userId: string; agora?: Date },
): Alerta[] {
  const agora = opcoes.agora ?? new Date();
  const agoraMs = agora.getTime();
  const hoje = hojeBRT(agora);
  const p = (a: Acesso) => pode(permissoes, a);
  const verEquipe = p('agenda.ver_equipe');
  const proprio = (profissionalId: string | null | undefined) => !!profissionalId && profissionalId === opcoes.userId;
  const out: Alerta[] = [];

  // Agendamentos de hoje (Brasília) que ainda não terminaram e não foram concluídos/cancelados.
  if (permissoes && dados.agendamentosHoje) {
    const fimDoDiaMs = Date.parse(limitesDias(hoje, hoje).endIso);
    dados.agendamentosHoje
      .filter(a => !STATUS_FORA_DO_ALERTA.has(a.status))
      .filter(a => (!a.data_hora_fim || instanteMs(a.data_hora_fim) >= agoraMs) && instanteMs(a.data_hora_inicio) <= fimDoDiaMs)
      .filter(a => verEquipe || proprio(a.profissional_id))
      .sort((a, b) => instanteMs(a.data_hora_inicio) - instanteMs(b.data_hora_inicio) || (a.id < b.id ? -1 : 1))
      .forEach(a => out.push({
        id: `ag-${a.id}`,
        grupo: 'agendamentos',
        titulo: `${horaBRT(a.data_hora_inicio)} — ${a.cliente?.nome || 'Cliente'}`,
        descricao: `${a.servico?.nome || 'Serviço'} · ${AGENDAMENTO_LABEL[a.status as AgendamentoStatus] ?? a.status}`,
        destino: { tela: 'agenda' },
        urgente: false,
      }));
  }

  if (p('estoque.acessar') && dados.estoqueBaixo) {
    for (const prod of dados.estoqueBaixo) {
      const atual = num(prod.estoque_atual);
      out.push({
        id: `est-${prod.id}`,
        grupo: 'estoque',
        titulo: `Estoque baixo: ${prod.nome}`,
        descricao: `${formatarQuantidadeBR(atual)} em estoque (mínimo: ${formatarQuantidadeBR(num(prod.estoque_minimo))})`,
        destino: { tela: 'estoque' },
        urgente: atual <= 0,
      });
    }
  }

  if (p('financeiro.ver') && dados.despesasVencendo) {
    const ate = somarDias(hoje, DIAS_DESPESAS_VENCENDO);
    dados.despesasVencendo
      .filter(d => d.data_vencimento >= hoje && d.data_vencimento <= ate)
      .sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento) || (a.id < b.id ? -1 : 1))
      .forEach(d => {
        const dias = diasEntre(hoje, d.data_vencimento.slice(0, 10));
        out.push({
          id: `desp-${d.id}`,
          grupo: 'despesas',
          titulo: `${d.descricao} — ${formatarMoeda(num(d.valor))}`,
          descricao: dias === 0 ? 'Vence hoje!' : `Vence em ${dias} ${plural(dias, 'dia', 'dias')} (${ddmm(d.data_vencimento)})`,
          destino: { tela: 'financeiro' },
          urgente: dias <= 1,
        });
      });
  }

  if (permissoes && dados.comissoesPendentes) {
    const todas = p('comissoes.ver_todas');
    const porProf = new Map<string, { nome: string; total: number }>();
    for (const c of dados.comissoesPendentes) {
      if (!todas && !proprio(c.profissional_id)) continue;
      const nome = c.profissional?.nome || 'Profissional';
      const chave = c.profissional_id ?? `sem-${nome}`;
      const atual = porProf.get(chave) ?? { nome, total: 0 };
      atual.total += num(c.valor_comissao);
      porProf.set(chave, atual);
    }
    [...porProf.entries()]
      .sort(([, a], [, b]) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .forEach(([chave, { nome, total }]) => out.push({
        id: `com-${chave}`,
        grupo: 'comissoes',
        titulo: `Comissão pendente: ${nome}`,
        descricao: `${formatarMoeda(Math.round(total * 100) / 100)} a pagar`,
        destino: { tela: 'comissoes' },
        urgente: false,
      }));
  }

  if (p('comanda.fechar') && dados.comandasNaoFechadas) {
    const outras = p('agenda.gerenciar_outras');
    const lista = dados.comandasNaoFechadas
      .filter(c => outras || proprio(c.profissional_id))
      .sort((a, b) => instanteMs(a.data_hora_inicio) - instanteMs(b.data_hora_inicio));
    if (lista.length > 0) {
      const n = lista.length;
      out.push({
        id: 'comandas',
        grupo: 'comandas',
        titulo: `${n} ${plural(n, 'comanda não fechada', 'comandas não fechadas')}`,
        descricao: `A mais antiga é de ${ddmm(chaveDiaBRT(lista[0].data_hora_inicio))}`,
        destino: { tela: 'comanda' },
        urgente: false,
      });
    }
  }

  if (dados.aniversariantes) {
    // Próximos 7 dias (hoje em destaque), todos: sem o teto de 8 do Dashboard, igual ao web antigo.
    for (const a of aniversariantesProximos(dados.aniversariantes, hoje, { limite: Infinity })) {
      out.push({
        id: `aniv-${a.id}`,
        grupo: 'aniversarios',
        titulo: `🎂 Aniversário: ${a.nome}`,
        descricao: a.diasAte === 0 ? 'Aniversário HOJE! 🎉'
          : a.diasAte === 1 ? 'Amanhã!'
          : `Em ${a.diasAte} dias · ${ddmm(a.dataAniversario)}`,
        destino: { tela: 'cliente', id: a.id },
        urgente: a.diasAte === 0,
      });
    }
  }

  return out;
}

/**
 * Número do sino: avisos não lidos + alertas que pedem ação — cada produto com estoque baixo e cada
 * despesa vencendo contam 1; comissões pendentes e comandas não fechadas contam 1 cada (como o badge
 * antigo da Sidebar). Agendamentos e aniversários são informativos e não contam.
 * Qualquer parte `null` (carga com erro) → `null`: a tela mantém o número anterior, nunca um falso.
 */
export function contagemSino(alertas: readonly Alerta[] | null, naoLidas: number | null): number | null {
  if (alertas === null || naoLidas === null) return null;
  const n = (g: GrupoAlerta) => alertas.filter(a => a.grupo === g).length;
  return n('estoque') + n('despesas') + (n('comissoes') > 0 ? 1 : 0) + (n('comandas') > 0 ? 1 : 0) + naoLidas;
}
