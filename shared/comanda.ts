/**
 * Helpers puros da Comanda (frente de caixa).
 *
 * Hoje cobre a persistencia do valor editado dos procedimentos: quando o
 * usuario troca, na comanda, o valor de um servico que veio de um
 * agendamento, esse valor precisa voltar para o proprio agendamento
 * (`agendamentos.valor` e, no caso multi-servico, cada
 * `agendamento_servicos.valor`) — senao some ao reabrir a comanda e a
 * comissao continua calculada sobre o preco antigo. Ver migration 075.
 */
import { instanteMs } from './periodos';

/** Item da comanda, na forma minima necessaria para calcular a persistencia. */
export type ItemComandaValor = {
  tipo: string;
  agendamento_id?: string | null;
  /** id da linha em `agendamento_servicos` (so em agendamento multi-servico). */
  ag_servico_id?: string | null;
  valor: number;
  quantidade: number;
};

/** O que gravar de volta em um agendamento apos editar valores na comanda. */
export type PersistenciaValorAgendamento = {
  agendamentoId: string;
  /** Novo `agendamentos.valor` = soma das linhas daquele agendamento na comanda. */
  novoValorTotal: number;
  /** Linhas de `agendamento_servicos` cujo `valor` deve ser regravado. */
  linhasServico: { agServicoId: string; valor: number }[];
  /**
   * pacote_clientes.id a gravar em agendamentos.pacote_cliente_id, quando a
   * comanda vinculou (ou desvinculou) uma sessao de pacote a este
   * agendamento. `undefined` (chave ausente) = nao mexer no vinculo
   * existente. `null` = desvincular explicitamente (limpa o valor no banco).
   * String = novo vinculo.
   */
  pacoteClienteId?: string | null;
};

/**
 * Agrupa os itens de agendamento de uma comanda por `agendamento_id` e
 * calcula, para cada um, o novo valor total (soma das linhas presentes) e a
 * lista de linhas de `agendamento_servicos` a atualizar.
 *
 * - Itens extras (servico / produto / pacote avulsos) sao ignorados: eles
 *   vivem em `comanda_itens`, nao no agendamento.
 * - Agendamento legado de servico unico (sem `agendamento_servicos`) entra
 *   no resultado com `linhasServico` vazio — so o total do agendamento e
 *   regravado.
 * - Uma linha removida da comanda simplesmente nao entra na soma; o
 *   `agendamento_servicos` orfao mantem o valor antigo, mas o total do
 *   agendamento (e a comissao) refletem o que foi cobrado.
 */
export function agruparValoresPorAgendamento(
  itens: ItemComandaValor[],
  pacoteLinksPorAgendamento: Record<string, string | null> = {},
): PersistenciaValorAgendamento[] {
  const porAgendamento = new Map<string, PersistenciaValorAgendamento>();

  for (const item of itens) {
    if (item.tipo !== 'agendamento') continue;
    if (!item.agendamento_id) continue;

    const quantidade = item.quantidade > 0 ? item.quantidade : 1;

    let grupo = porAgendamento.get(item.agendamento_id);
    if (!grupo) {
      grupo = {
        agendamentoId: item.agendamento_id,
        novoValorTotal: 0,
        linhasServico: [],
      };
      porAgendamento.set(item.agendamento_id, grupo);
    }

    grupo.novoValorTotal += item.valor * quantidade;
    if (item.ag_servico_id) {
      grupo.linhasServico.push({ agServicoId: item.ag_servico_id, valor: item.valor });
    }
  }

  for (const grupo of porAgendamento.values()) {
    grupo.novoValorTotal = Math.round(grupo.novoValorTotal * 100) / 100;
    // Checa PRESENCA da chave, nao truthiness — um valor `null` explicito
    // (desvincular) precisa ser distinguivel de "agendamento nao mencionado
    // no mapa" (undefined, nao mexer no vinculo existente no banco).
    if (grupo.agendamentoId in pacoteLinksPorAgendamento) {
      grupo.pacoteClienteId = pacoteLinksPorAgendamento[grupo.agendamentoId];
    }
  }

  return [...porAgendamento.values()];
}

/**
 * Reflete, na lista local de atendimentos do dia, o fechamento de uma
 * comanda: grava `status = 'concluido'` **e** `comanda_id` nos atendimentos
 * que entraram nela.
 *
 * Os dois campos são obrigatórios porque a tela considera a comanda aberta
 * enquanto `status !== 'concluido' || !comanda_id`. Atualizar só o status
 * deixava o atendimento recém-fechado ainda listado como aberto, e fechá-lo de
 * novo criava uma segunda comanda com pagamento em dobro (bug de 2026-09-28).
 * Devolve uma lista nova; itens fora de `agIds` são mantidos por referência.
 */
export function marcarAgendamentosFechados<T extends { id: string; status: string; comanda_id: string | null }>(
  ags: T[],
  agIds: string[],
  comandaId: string,
): T[] {
  const ids = new Set(agIds);
  return ags.map(ag => (ids.has(ag.id) ? { ...ag, status: 'concluido', comanda_id: comandaId } : ag));
}

// ── Linhas de multi-serviço (`agendamento_servicos`) — regra única do web e do app (M7) ──────────
//
// - No fechamento, uma linha tirada da comanda (o web tira por linha) ficava com o valor antigo no
//   banco. Ao reabrir, ela voltava e a edição a somava em `agendamentos.valor` (receita e comissão
//   de um serviço que não foi cobrado). `completarLinhasTiradas` manda essa linha com R$ 0 para a
//   função: o banco fica coerente (soma das linhas = valor do atendimento).
// - Comandas antigas já gravadas com essa incoerência: `linhasConferemComValor` detecta (soma das
//   linhas ≠ valor do atendimento) e a tela reabre o atendimento como UMA linha com o valor gravado,
//   descrita por `descricaoLinhasAgrupadas` (mesmo texto nas duas telas).

type ValorBanco = number | string | null | undefined;

/** Atendimento do dia como as telas o carregam (só o que importa para as linhas). */
export type AtendimentoComLinhas = {
  id: string;
  valor: ValorBanco;
  agendamento_servicos?: { id: string; valor: ValorBanco; ordem?: number; servico?: { id: string; nome: string } | null }[] | null;
};

/** Linha de atendimento acrescentada por `completarLinhasTiradas` (forma de ItemComandaTela). */
export type LinhaTiradaComanda = {
  tipo: 'agendamento'; descricao: string; valor: number; quantidade: number;
  agendamento_id: string; ag_servico_id: string; servico_id?: string;
};

const numBanco = (v: ValorBanco) => Number(v ?? 0) || 0;
const emCentavos = (v: number) => Math.round(v * 100);

/**
 * Itens da comanda + as linhas de multi-serviço tiradas de um atendimento que CONTINUA na comanda,
 * com valor R$ 0. Atendimento tirado inteiro não volta (fica aberto). Atendimento que está na tela
 * sem linhas (valor único) não ganha linhas.
 */
export function completarLinhasTiradas<T extends { tipo: string; agendamento_id?: string | null; ag_servico_id?: string | null }>(
  itens: T[],
  atendimentos: AtendimentoComLinhas[],
): (T | LinhaTiradaComanda)[] {
  const presentes = new Map<string, Set<string>>();
  for (const i of itens) {
    if (i.tipo !== 'agendamento' || !i.agendamento_id || !i.ag_servico_id) continue;
    const s = presentes.get(i.agendamento_id) ?? new Set<string>();
    s.add(i.ag_servico_id);
    presentes.set(i.agendamento_id, s);
  }
  const tiradas: LinhaTiradaComanda[] = [];
  for (const ag of atendimentos) {
    const naTela = presentes.get(ag.id);
    if (!naTela) continue;
    for (const l of ag.agendamento_servicos ?? []) {
      if (naTela.has(l.id)) continue;
      tiradas.push({
        tipo: 'agendamento', descricao: l.servico?.nome ?? 'Serviço', valor: 0, quantidade: 1,
        agendamento_id: ag.id, ag_servico_id: l.id, servico_id: l.servico?.id,
      });
    }
  }
  return tiradas.length === 0 ? itens : [...itens, ...tiradas];
}

/** Soma das linhas de multi-serviço = valor gravado do atendimento (em centavos). Sem linhas = false. */
export function linhasConferemComValor(ag: Pick<AtendimentoComLinhas, 'valor' | 'agendamento_servicos'>): boolean {
  const linhas = ag.agendamento_servicos ?? [];
  if (linhas.length === 0) return false;
  const soma = linhas.reduce((s, l) => s + emCentavos(numBanco(l.valor)), 0);
  return soma === emCentavos(numBanco(ag.valor));
}

/**
 * Descrição do atendimento reaberto como UMA linha (linhas que não conferem com o valor): os
 * serviços na ordem, unidos por " + " ("Corte + Escova"). Sem linhas, o serviço do atendimento.
 */
export function descricaoLinhasAgrupadas(
  linhas: { ordem?: number; servico?: { nome: string } | null }[] | null | undefined,
  servicoLegado?: { nome: string } | null,
): string {
  const ordenadas = [...(linhas ?? [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  if (ordenadas.length === 0) return servicoLegado?.nome ?? 'Serviço';
  return ordenadas.map(l => l.servico?.nome ?? 'Serviço').join(' + ');
}

export type AgendamentoCartao = {
  id: string; data_hora_inicio: string; status: string; comanda_id: string | null;
  cliente: { id: string; nome: string; telefone?: string } | null;
};
export type ComandaSoExtras = {
  id: string; fechada_at: string;
  cliente: { id: string; nome: string; telefone?: string | null } | null;
};
/** Um cartão da lista do dia: os atendimentos abertos da cliente, ou UMA comanda fechada. */
export type CartaoComanda<T> = {
  chave: string; clienteId: string; nome: string; telefone?: string;
  agendamentos: T[]; comandaId: string | null; fechada: boolean; ordem: string;
};

/**
 * Cartões da lista de comandas do dia (web e app). Cada comanda fechada é um cartão — a mesma
 * cliente pode ter duas no dia, e abrir "a primeira comanda_id" editava a comanda errada.
 * Atendimento concluído SEM comanda_id (atalho do app / backlog) continua aberto. Comandas só
 * com extras (nenhum atendimento vinculado) também viram cartão, para poderem ser reabertas.
 */
export function cartoesComandaDoDia<T extends AgendamentoCartao>(ags: T[], soExtras: ComandaSoExtras[]): CartaoComanda<T>[] {
  const mapa = new Map<string, CartaoComanda<T>>();
  for (const ag of ags) {
    const clienteId = ag.cliente?.id ?? '__sem__';
    const fechada = ag.status === 'concluido' && !!ag.comanda_id;
    const chave = `${clienteId}|${fechada ? ag.comanda_id : 'aberta'}`;
    let c = mapa.get(chave);
    if (!c) {
      c = { chave, clienteId, nome: ag.cliente?.nome ?? 'Cliente', telefone: ag.cliente?.telefone,
        agendamentos: [], comandaId: fechada ? ag.comanda_id : null, fechada, ordem: ag.data_hora_inicio };
      mapa.set(chave, c);
    }
    c.agendamentos.push(ag);
    if (instanteMs(ag.data_hora_inicio) < instanteMs(c.ordem)) c.ordem = ag.data_hora_inicio;
  }
  for (const k of soExtras) {
    const clienteId = k.cliente?.id ?? '__sem__';
    mapa.set(`${clienteId}|${k.id}`, {
      chave: `${clienteId}|${k.id}`, clienteId, nome: k.cliente?.nome ?? 'Cliente',
      telefone: k.cliente?.telefone ?? undefined, agendamentos: [], comandaId: k.id, fechada: true, ordem: k.fechada_at,
    });
  }
  return [...mapa.values()].sort((a, b) => instanteMs(a.ordem) - instanteMs(b.ordem) || a.chave.localeCompare(b.chave));
}
