/** Acesso ao banco de Pacotes compartilhado por web e app. */
import { buscarTodasOuLancar, type ClienteDb } from './kpis-financeiros-consultas';
import { mensagemErroBanco } from './erros';
import { totalSessoes, type PacoteClienteRaw } from './pacotes';

/**
 * Confere uma escrita em `pacote_uso` feita com `.select('id')` (insert, update ou delete). Desde a
 * 093 só escreve quem tem "pacotes.vender" ou o atendimento é dela/"agenda.gerenciar_outras": a RLS
 * recusa UPDATE/DELETE devolvendo sucesso com 0 linhas, e o INSERT com erro 42501. Devolve `null` se
 * gravou, ou a mensagem em português para a tela. `acao` no infinitivo ("excluir a sessão").
 */
export function erroEscritaPacoteUso(
  r: { data: unknown[] | null; error: { code?: string | null; message?: string | null } | null },
  acao: string,
): string | null {
  if (r.error) return mensagemErroBanco(r.error, acao);
  if (!r.data || r.data.length === 0) return mensagemErroBanco({ code: '42501' }, acao);
  return null;
}

/** Aviso quando o vínculo foi trocado, a sessão falhou e nem o desfazer deu certo. */
export const MENSAGEM_VINCULO_SEM_SESSAO = 'O vínculo foi trocado, mas a sessão não foi lançada; confira o atendimento.';

/**
 * Desfaz o vínculo de um atendimento a um pacote depois que o lançamento da sessão falhou, voltando ao
 * `pacote_cliente_id` que ele tinha ANTES (um atendimento de combo continua no combo; gravar `null` o
 * faria contar como faturamento). Confere erro e linhas afetadas: devolve `null` se desfez, ou a mensagem
 * a mostrar se não conseguiu.
 */
export async function desfazerVinculoPacote(
  db: ClienteDb,
  empresaId: string,
  agendamentoId: string,
  pacoteAnterior: string | null,
): Promise<string | null> {
  try {
    const { data, error } = await db.from('agendamentos')
      .update({ pacote_cliente_id: pacoteAnterior })
      .eq('id', agendamentoId).eq('empresa_id', empresaId)
      .select('id');
    if (error || !data || data.length === 0) return MENSAGEM_VINCULO_SEM_SESSAO;
    return null;
  } catch {
    return MENSAGEM_VINCULO_SEM_SESSAO;
  }
}

// ── Cargas paginadas (Paridade Serviços e Pacotes, 096) ───────────────────────────────────────
// Todas paginam além das 1000 linhas do PostgREST (`buscarTodasOuLancar`, desempate por id) e LANÇAM
// o erro do banco: a tela mostra "—" e um aviso, nunca uma lista vazia por falha.

/**
 * Coluna da 096 ainda inexistente (o PostgREST recusa o SELECT inteiro: "column ... cobranca does not
 * exist"). As cargas refazem a busca sem ela e tratam tudo como `cobranca = 'paga'`, `venda_id` nulo.
 */
function erroSemColuna096(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : '';
  return /cobranca|venda_id/.test(msg);
}

/** Serviço dentro de um pacote do catálogo. `quantidade` null = sessões ilimitadas. */
export type ServicoDoPacote = { servico_id: string; nome: string; quantidade: number | null };

/** Pacote do catálogo. `validade_dias` null = sem validade; `controla_sessoes` false = combo. */
export type PacoteCatalogo = {
  id: string; nome: string; preco: number; validade_dias: number | null; ativo: boolean;
  controla_sessoes: boolean; servicos: ServicoDoPacote[];
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapearServicos(lista: any[] | null | undefined): ServicoDoPacote[] {
  return (lista ?? []).map(s => ({ servico_id: s.servico_id, nome: s.servico?.nome ?? 'Serviço', quantidade: s.quantidade ?? null }));
}

/** Catálogo de pacotes da empresa (ativos e desativados), por nome. */
export async function carregarCatalogoPacotes(db: ClienteDb, empresaId: string): Promise<PacoteCatalogo[]> {
  const linhas = await buscarTodasOuLancar<any>((de, ate) => db.from('pacotes')
    .select('id, nome, preco, validade_dias, ativo, controla_sessoes, servicos:pacote_servicos(servico_id, quantidade, servico:servicos(nome))')
    .eq('empresa_id', empresaId).order('nome').order('id').range(de, ate));
  return linhas.map(p => ({
    id: p.id, nome: p.nome ?? 'Pacote', preco: Number(p.preco ?? 0), validade_dias: p.validade_dias ?? null,
    ativo: p.ativo ?? true, controla_sessoes: p.controla_sessoes ?? true, servicos: mapearServicos(p.servicos),
  }));
}

/** Sessão usada de um pacote vendido (linha de `pacote_uso`). */
export type UsoPacoteVendido = { id: string; servico_id: string | null; agendamento_id: string | null; created_at: string };

/** Pacote vendido para uma cliente, com os usos e a cobrança (096). */
export type PacoteVendido = {
  id: string;
  pacote: { id: string; nome: string; preco: number; validade_dias: number | null; controla_sessoes: boolean; servicos: ServicoDoPacote[] };
  cliente: { id: string; nome: string };
  data_inicio: string | null;
  data_validade: string | null;
  valor_pago: number | null;
  status: string;
  observacao: string | null;
  /** 'pendente' = "A cobrar" (vendido com "Cobrar na comanda"). Sem a 096: sempre 'paga'. */
  cobranca: 'paga' | 'pendente';
  venda_id: string | null;
  usos: UsoPacoteVendido[];
};

const SELECT_VENDIDOS = `id, data_inicio, data_validade, valor_pago, status, observacao,
  pacote:pacotes(id, nome, preco, validade_dias, controla_sessoes, servicos:pacote_servicos(servico_id, quantidade, servico:servicos(nome))),
  cliente:clientes(id, nome),
  usos:pacote_uso(id, servico_id, agendamento_id, created_at)`;

function mapearVendido(v: any): PacoteVendido {
  return {
    id: v.id,
    pacote: {
      id: v.pacote?.id ?? '', nome: v.pacote?.nome ?? '—', preco: Number(v.pacote?.preco ?? 0),
      validade_dias: v.pacote?.validade_dias ?? null, controla_sessoes: v.pacote?.controla_sessoes ?? true,
      servicos: mapearServicos(v.pacote?.servicos),
    },
    cliente: { id: v.cliente?.id ?? '', nome: v.cliente?.nome ?? '—' },
    data_inicio: v.data_inicio ?? null,
    data_validade: v.data_validade ?? null,
    valor_pago: v.valor_pago == null ? null : Number(v.valor_pago),
    status: v.status ?? 'ativo',
    observacao: v.observacao ?? null,
    cobranca: v.cobranca === 'pendente' ? 'pendente' : 'paga',
    venda_id: v.venda_id ?? null,
    usos: (v.usos ?? []).map((u: any) => ({
      id: u.id, servico_id: u.servico_id ?? null, agendamento_id: u.agendamento_id ?? null, created_at: u.created_at,
    })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Pacotes vendidos da empresa (mais recentes primeiro), com usos e cobrança. Sem a 096: cobranca 'paga'. */
export async function carregarPacotesVendidos(db: ClienteDb, empresaId: string): Promise<PacoteVendido[]> {
  const buscar = (colunas096: boolean) => buscarTodasOuLancar<unknown>((de, ate) => db.from('pacote_clientes')
    .select(colunas096 ? `${SELECT_VENDIDOS}, cobranca, venda_id` : SELECT_VENDIDOS)
    .eq('empresa_id', empresaId).order('created_at', { ascending: false }).order('id').range(de, ate));
  let linhas: unknown[];
  try {
    linhas = await buscar(true);
  } catch (e) {
    if (!erroSemColuna096(e)) throw e;
    linhas = await buscar(false);
  }
  return linhas.map(mapearVendido);
}

/** Pacote "a cobrar" de uma cliente (para os itens de `itensACobrar` na Comanda). */
export type PacotePendente = { id: string; pacote_id: string; nome: string; valor_pago: number };

/**
 * Pacotes "a cobrar" (cobranca = 'pendente', fora os cancelados) da cliente, mais antigos primeiro.
 * Sem a 096 não existe pendente: devolve lista vazia (só nesse caso; qualquer outro erro é lançado).
 */
export async function carregarPendentesCliente(db: ClienteDb, empresaId: string, clienteId: string): Promise<PacotePendente[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const linhas = await buscarTodasOuLancar<any>((de, ate) => db.from('pacote_clientes')
      .select('id, pacote_id, valor_pago, cobranca, pacote:pacotes(nome)')
      .eq('empresa_id', empresaId).eq('cliente_id', clienteId).eq('cobranca', 'pendente')
      .neq('status', 'cancelado')
      .order('created_at').order('id').range(de, ate));
    return linhas.map(p => ({ id: p.id, pacote_id: p.pacote_id, nome: p.pacote?.nome ?? 'Pacote', valor_pago: Number(p.valor_pago ?? 0) }));
  } catch (e) {
    if (erroSemColuna096(e)) return [];
    throw e;
  }
}

/**
 * Pacotes ATIVOS da cliente no formato de `calcularPacotesAtivosCliente` (candidatos a vincular a um
 * atendimento na Agenda e na Comanda). Inclui os "a cobrar": a cliente pode usar antes de pagar.
 */
export async function carregarCandidatosVinculo(db: ClienteDb, empresaId: string, clienteId: string): Promise<PacoteClienteRaw[]> {
  return buscarTodasOuLancar<PacoteClienteRaw>((de, ate) => db.from('pacote_clientes')
    .select(`id, data_validade,
      pacote:pacotes(nome, controla_sessoes, servicos:pacote_servicos(servico_id, quantidade)),
      uso:pacote_uso(id, created_at, agendamento_id, servico:servicos(nome))`)
    .eq('empresa_id', empresaId).eq('cliente_id', clienteId).eq('status', 'ativo')
    .order('data_validade', { ascending: true, nullsFirst: false }).order('id').range(de, ate));
}

/** Linha do relatório de utilização por pacote do catálogo. */
export type RelatorioPorPacote = {
  pacote_id: string; nome: string; combo: boolean;
  vendas: number; aCobrar: number; totalSessoes: number; sessoesUsadas: number; receita: number;
};

/** Relatório de utilização (aba Relatório de Pacotes, web e app). */
export type RelatorioUtilizacao = {
  totalSessoes: number; sessoesUsadas: number; aproveitamento: number; receitaTotal: number;
  vendas: number; aCobrar: number; porPacote: RelatorioPorPacote[];
};

/**
 * Relatório de utilização a partir dos vendidos. Sessões: combo e pacote com sessão ilimitada não
 * somam ao total (`totalSessoes` de shared/pacotes); usadas = linhas de `pacote_uso`.
 * Receita = soma de `valor_pago` SÓ dos pacotes com cobranca 'paga' (o "a cobrar" ainda não entrou no
 * faturamento) — o mesmo que o Financeiro soma pelas vendas. Pacote antigo, anterior ao `valor_pago`
 * (coluna nula), conta o preço do catálogo, como a tela fazia antes: `coalesce(valor_pago, preço)`.
 * Um `valor_pago` 0 gravado (cortesia) continua 0.
 */
export function calcularRelatorioUtilizacao(vendidos: PacoteVendido[]): RelatorioUtilizacao {
  const porPacote = new Map<string, RelatorioPorPacote>();
  let totalSess = 0, usadas = 0, receita = 0, aCobrar = 0;
  for (const v of vendidos) {
    const total = v.pacote.controla_sessoes ? (totalSessoes(v.pacote.servicos) ?? 0) : 0;
    const paga = v.cobranca === 'paga';
    const valor = paga ? Math.round((v.valor_pago ?? v.pacote.preco ?? 0) * 100) : 0;
    totalSess += total;
    usadas += v.usos.length;
    receita += valor;
    if (!paga) aCobrar++;
    const chave = v.pacote.id || v.pacote.nome;
    const linha = porPacote.get(chave) ?? {
      pacote_id: v.pacote.id, nome: v.pacote.nome, combo: !v.pacote.controla_sessoes,
      vendas: 0, aCobrar: 0, totalSessoes: 0, sessoesUsadas: 0, receita: 0,
    };
    linha.vendas++;
    if (!paga) linha.aCobrar++;
    linha.totalSessoes += total;
    linha.sessoesUsadas += v.usos.length;
    linha.receita += valor;
    porPacote.set(chave, linha);
  }
  return {
    totalSessoes: totalSess, sessoesUsadas: usadas,
    aproveitamento: totalSess > 0 ? Math.round((usadas / totalSess) * 100) : 0,
    receitaTotal: receita / 100, vendas: vendidos.length, aCobrar,
    porPacote: [...porPacote.values()]
      .map(l => ({ ...l, receita: l.receita / 100 }))
      .sort((a, b) => b.receita - a.receita || a.nome.localeCompare(b.nome)),
  };
}

/** Carrega os vendidos e calcula o relatório de utilização. */
export async function carregarRelatorioUtilizacao(db: ClienteDb, empresaId: string): Promise<RelatorioUtilizacao> {
  return calcularRelatorioUtilizacao(await carregarPacotesVendidos(db, empresaId));
}
