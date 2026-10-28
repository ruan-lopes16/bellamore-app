/**
 * @file notificacoes-consultas.ts
 * Consultas ÚNICAS da tela de Notificações e do sino (web e app), que passam o próprio client.
 *
 * - "Avisos" = linhas salvas em `notificacoes` (triggers 028/069 e crons). Sempre filtradas por
 *   empresa E pessoa: com duas empresas, os avisos de uma não aparecem na outra.
 * - "Alertas" = dados lidos na hora (agenda de hoje, estoque baixo, despesas vencendo, comissões
 *   pendentes, aniversariantes e comandas não fechadas). Aqui só se busca o que a pessoa tem
 *   permissão de ver; a montagem dos alertas é de `alertasCalculados` (shared/notificacoes.ts).
 *
 * Toda leitura LANÇA erro (a tela mostra "—" e o aviso), nunca devolve lista vazia por falha.
 * Marcar como lida usa `.select('id')` e devolve só o que o banco confirmou (RLS pode aceitar 0).
 */
import { mensagemErroBanco } from './erros';
import { buscarTodasOuLancar, type ClienteDb } from './kpis-financeiros-consultas';
import { aplicarFiltroComandasNaoFechadas, carregarAniversariantes, carregarDespesasVencendo, type DespesaVencendoRow } from './dashboard-consultas';
import type { ClienteAniversario, ComandaNaoFechadaRow } from './dashboard';
import { hojeBRT, limitesDias } from './periodos';
import type { PodeFn } from './permissoes';

/** Aviso salvo em `notificacoes`. */
export type AvisoRow = {
  id: string;
  tipo: string;
  titulo: string;
  mensagem: string | null;
  lida: boolean;
  created_at: string;
};

/** Avisos por página da tela (web e app). */
export const TAMANHO_PAGINA_AVISOS = 50;

const COLUNAS_AVISO = 'id, tipo, titulo, mensagem, lida, created_at';

/**
 * Avisos da pessoa na empresa, mais recentes primeiro, `TAMANHO_PAGINA_AVISOS` por página.
 * @param opcoes.soNaoLidas filtro "Não lidas"
 * @param opcoes.pagina     0 = primeira página
 * @returns `temMais` diz se existe a próxima página.
 */
export async function carregarAvisos(
  db: ClienteDb, empresaId: string, userId: string,
  opcoes: { soNaoLidas?: boolean; pagina?: number } = {},
): Promise<{ avisos: AvisoRow[]; temMais: boolean }> {
  const pagina = Math.max(0, Math.floor(opcoes.pagina ?? 0));
  const de = pagina * TAMANHO_PAGINA_AVISOS;
  let q = db.from('notificacoes').select(COLUNAS_AVISO).eq('empresa_id', empresaId).eq('user_id', userId);
  if (opcoes.soNaoLidas) q = q.eq('lida', false);
  // Uma linha a mais que a página: só para saber se há próxima.
  const { data, error } = await q.order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(de, de + TAMANHO_PAGINA_AVISOS);
  if (error) throw new Error(mensagemErroBanco(error, 'carregar os avisos'));
  const linhas = ((data ?? []) as AvisoRow[]).map(a => ({ ...a, lida: a.lida === true }));
  return { avisos: linhas.slice(0, TAMANHO_PAGINA_AVISOS), temMais: linhas.length > TAMANHO_PAGINA_AVISOS };
}

/** Quantos avisos não lidos a pessoa tem na empresa (sino). Lança em erro. */
export async function contarAvisosNaoLidos(db: ClienteDb, empresaId: string, userId: string): Promise<number> {
  const { count, error } = await db.from('notificacoes').select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId).eq('user_id', userId).eq('lida', false);
  if (error) throw new Error(mensagemErroBanco(error, 'contar os avisos'));
  return count ?? 0;
}

const LOTE_MARCAR = 100;

/**
 * Marca os avisos como lidos. Devolve os ids que o banco confirmou; os demais (de outra pessoa ou
 * já apagados pela limpeza da madrugada) ficam em `naoConfirmados` — a tela só muda os confirmados.
 * Lança se o banco devolver erro.
 */
export async function marcarLidas(db: ClienteDb, ids: readonly string[]): Promise<{ confirmados: string[]; naoConfirmados: string[] }> {
  const unicos = [...new Set(ids.filter(Boolean))];
  const confirmados: string[] = [];
  for (let i = 0; i < unicos.length; i += LOTE_MARCAR) {
    const lote = unicos.slice(i, i + LOTE_MARCAR);
    const { data, error } = await db.from('notificacoes').update({ lida: true }).in('id', lote).select('id');
    if (error) throw new Error(mensagemErroBanco(error, 'marcar o aviso como lido'));
    confirmados.push(...((data ?? []) as { id: string }[]).map(r => r.id));
  }
  const ok = new Set(confirmados);
  return { confirmados: unicos.filter(id => ok.has(id)), naoConfirmados: unicos.filter(id => !ok.has(id)) };
}

/** "Marcar todas como lidas": todos os não lidos da pessoa na empresa (não só os da página). Devolve quantos. */
export async function marcarTodasLidas(db: ClienteDb, empresaId: string, userId: string): Promise<number> {
  const { data, error } = await db.from('notificacoes').update({ lida: true })
    .eq('empresa_id', empresaId).eq('user_id', userId).eq('lida', false).select('id');
  if (error) throw new Error(mensagemErroBanco(error, 'marcar os avisos como lidos'));
  return (data ?? []).length;
}

// ── Alertas ──────────────────────────────────────────────────

export type AgendamentoAlertaRow = {
  id: string;
  data_hora_inicio: string;
  status: string;
  profissional_id: string | null;
  cliente: { nome: string | null } | null;
  servico: { nome: string | null } | null;
};

export type ProdutoEstoqueBaixoRow = { id: string; nome: string; estoque_atual: number; estoque_minimo: number; unidade: string | null };

export type ComissaoPendenteAlertaRow = {
  id: string;
  valor_comissao: number;
  profissional_id: string | null;
  profissional: { nome: string | null } | null;
};

/**
 * Dados brutos dos alertas. `null` = não consultado porque a pessoa não tem a permissão (a tela
 * não mostra esse alerta); `[]` = consultado e vazio.
 */
export type DadosAlertas = {
  /** Hoje (Brasília), ainda não terminados nem concluídos/cancelados/faltas. Só os dela sem `agenda.ver_equipe`. */
  agendamentosHoje: AgendamentoAlertaRow[];
  /** Com `estoque.acessar`. Regra "baixo" = atual <= mínimo (view 038). */
  estoqueBaixo: ProdutoEstoqueBaixoRow[] | null;
  /** Com `financeiro.ver`: pendentes de hoje a hoje+7 (Brasília). */
  despesasVencendo: DespesaVencendoRow[] | null;
  /** Todas com `comissoes.ver_todas`; sem ela, só as próprias. */
  comissoesPendentes: ComissaoPendenteAlertaRow[];
  /** Clientes ativas com aniversário cadastrado (o filtro do dia é de `alertasCalculados`). */
  aniversariantes: ClienteAniversario[];
  /** Com `comanda.fechar`: só as dela sem `agenda.gerenciar_outras` (é o que ela consegue fechar). */
  comandasNaoFechadas: ComandaNaoFechadaRow[] | null;
  /** Agenda e comissões restritas à própria pessoa (para o texto do alerta). */
  soPropriaAgenda: boolean;
  soPropriasComissoes: boolean;
  /** Dia de referência (Brasília, 'yyyy-MM-dd'). */
  hoje: string;
};

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * Busca, em paralelo e paginado, o que os alertas precisam — só o que `acesso.pode` libera.
 * @param acesso `userId` de quem está logado e o `pode` dela (`usePermissoes().pode`).
 * @param agora  relógio (testes); os limites do dia são sempre em Brasília.
 * @throws Error se qualquer consulta falhar (a tela mostra "—" com aviso, nunca alertas pela metade).
 */
export async function carregarDadosAlertas(
  db: ClienteDb, empresaId: string, acesso: { userId: string; pode: PodeFn }, agora: Date = new Date(),
): Promise<DadosAlertas> {
  const { userId, pode } = acesso;
  const hoje = hojeBRT(agora);
  const agoraIso = agora.toISOString();
  const fimHoje = limitesDias(hoje, hoje).endIso;
  const soPropriaAgenda = !pode('agenda.ver_equipe');
  const soPropriasComissoes = !pode('comissoes.ver_todas');
  const soPropriasComandas = !pode('agenda.gerenciar_outras');

  const agendamentos = buscarTodasOuLancar<AgendamentoAlertaRow>((de, ate) => {
    let q = db.from('agendamentos')
      .select('id, data_hora_inicio, status, profissional_id, cliente:clientes!agendamentos_cliente_id_fkey(nome), servico:servicos(nome)')
      .eq('empresa_id', empresaId)
      .gte('data_hora_fim', agoraIso).lte('data_hora_inicio', fimHoje)
      .not('status', 'in', '("concluido","cancelado","faltou")');
    if (soPropriaAgenda) q = q.eq('profissional_id', userId);
    return q.order('data_hora_inicio').order('id').range(de, ate);
  });

  const estoque = pode('estoque.acessar')
    ? buscarTodasOuLancar<Record<string, unknown>>((de, ate) => db.from('v_produtos_estoque_baixo')
        .select('id, nome, estoque_atual, estoque_minimo, unidade')
        .eq('empresa_id', empresaId).eq('ativo', true)
        .order('nome').order('id').range(de, ate))
        .then(ls => ls.map(p => ({
          id: String(p.id), nome: String(p.nome ?? ''), unidade: (p.unidade as string | null) ?? null,
          estoque_atual: num(p.estoque_atual), estoque_minimo: num(p.estoque_minimo),
        })))
    : Promise.resolve(null);

  const despesas = pode('financeiro.ver') ? carregarDespesasVencendo(db, empresaId, hoje) : Promise.resolve(null);

  const comissoes = buscarTodasOuLancar<ComissaoPendenteAlertaRow>((de, ate) => {
    let q = db.from('comissoes')
      .select('id, valor_comissao, profissional_id, profissional:users!comissoes_profissional_id_fkey(nome)')
      .eq('empresa_id', empresaId).eq('status', 'pendente');
    if (soPropriasComissoes) q = q.eq('profissional_id', userId);
    return q.order('created_at').order('id').range(de, ate);
  }).then(ls => ls.map(c => ({ ...c, valor_comissao: num(c.valor_comissao) })));

  const comandas = pode('comanda.fechar')
    ? buscarTodasOuLancar<ComandaNaoFechadaRow>((de, ate) => {
        let q = aplicarFiltroComandasNaoFechadas(db.from('agendamentos').select('id, data_hora_inicio'), empresaId, agoraIso);
        if (soPropriasComandas) q = q.eq('profissional_id', userId);
        return q.order('data_hora_inicio', { ascending: true }).order('id').range(de, ate);
      })
    : Promise.resolve(null);

  const [agendamentosHoje, estoqueBaixo, despesasVencendo, comissoesPendentes, aniversariantes, comandasNaoFechadas] =
    await Promise.all([agendamentos, estoque, despesas, comissoes, carregarAniversariantes(db, empresaId), comandas]);

  return {
    agendamentosHoje, estoqueBaixo, despesasVencendo, comissoesPendentes, aniversariantes, comandasNaoFechadas,
    soPropriaAgenda, soPropriasComissoes, hoje,
  };
}
