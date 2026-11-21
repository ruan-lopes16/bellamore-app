/**
 * Convites da Equipe e histórico (web e app), sobre a migration 092. Toda consulta lança erro em
 * vez de devolver lista vazia — exceto quando a 092 ainda não foi rodada (função `PGRST202` ou
 * tabela inexistente): aí não existe convite nem histórico, e a tela segue sem a seção.
 * Contrato: docs/superpowers/notes/2026-10-16-contrato-convites.md.
 */
import { mensagemErroBanco } from './erros';
import type { LinhaHistoricoEquipe, TipoContrato } from './equipe';

/** O mínimo do client supabase-js usado aqui (web: @supabase/ssr; mobile: @supabase/supabase-js). */
export interface ClienteDbConvites {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabela: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any;
}

type ErroDb = { code?: string | null; message?: string | null } | null | undefined;

/** Convite recebido pela conta logada (banner "Você foi convidada..."). */
export type ConviteRecebido = {
  id: string;
  empresa_id: string;
  empresa_nome: string;
  role: 'gestor' | 'profissional';
  percentual_comissao: number;
  tipo_contrato: TipoContrato | null;
  criado_em: string;
  convidado_por_nome: string | null;
};

/** Convite pendente da empresa (seção "Convites pendentes" da Equipe). */
export type ConvitePendente = {
  id: string;
  user_id: string;
  email: string;
  nome: string | null;
  role: 'gestor' | 'profissional';
  percentual_comissao: number;
  tipo_contrato: TipoContrato | null;
  convidado_por: string | null;
  criado_em: string;
};

/** Texto da tela (web e app) quando a API responde `convite_pendente`: a conta já existe e precisa aceitar. */
export const MENSAGEM_CONVITE_PENDENTE = 'Convite enviado. Ela precisa aceitar no app ou no site.';

/**
 * Aviso depois do aceite para quem já está em outra empresa, quando não deu para trocar a empresa
 * ativa para a nova (o caminho normal grava a empresa nova como ativa e abre o painel dela).
 */
export function mensagemConviteAceitoOutraEmpresa(empresaNome: string): string {
  return `Convite aceito. Você agora faz parte da equipe de ${empresaNome}. Não foi possível abrir essa empresa agora: `
    + 'escolha-a no seletor de empresa do menu.';
}

/** Quem pode cancelar um convite pendente (além de `equipe.gerenciar`): convite de gestora só a dona. */
export function podeCancelarConvite(role: 'gestor' | 'profissional', isOwner: boolean): boolean {
  return role !== 'gestor' || isOwner;
}

/** Itens por página do histórico da Equipe. */
export const TAMANHO_PAGINA_HISTORICO_EQUIPE = 30;

/** A 092 não foi rodada: função ou tabela não existe no PostgREST. */
export function semMigration092(e: ErroDb): boolean {
  if (!e) return false;
  // Nunca 42883 (função com tipo errado também dá esse código): só "não existe" do PostgREST.
  return e.code === 'PGRST202' || e.code === 'PGRST205' || e.code === '42P01'
    || /could not find the (function|table)/i.test(e.message ?? '');
}

const contratoOuNull = (v: unknown): TipoContrato | null => (v === 'pj' || v === 'clt' ? v : null);
const papel = (v: unknown): 'gestor' | 'profissional' => (v === 'gestor' ? 'gestor' : 'profissional');

/** Convites pendentes da conta logada, com o nome da empresa. Sem a 092: lista vazia. */
export async function carregarMeusConvites(db: ClienteDbConvites): Promise<ConviteRecebido[]> {
  const { data, error } = await db.rpc('meus_convites');
  if (error) {
    if (semMigration092(error)) return [];
    throw new Error(mensagemErroBanco(error, 'carregar seus convites'));
  }
  return ((data ?? []) as Record<string, unknown>[]).map(c => ({
    id: String(c.id),
    empresa_id: String(c.empresa_id),
    empresa_nome: String(c.empresa_nome ?? ''),
    role: papel(c.role),
    percentual_comissao: Number(c.percentual_comissao ?? 0),
    tipo_contrato: contratoOuNull(c.tipo_contrato),
    criado_em: String(c.criado_em ?? ''),
    convidado_por_nome: typeof c.convidado_por_nome === 'string' ? c.convidado_por_nome : null,
  }));
}

/**
 * Aceita o convite (só a conta convidada, só pendente) e devolve a empresa em que a pessoa entrou —
 * a tela troca a empresa ativa para ela.
 */
export async function aceitarConvite(db: ClienteDbConvites, conviteId: string): Promise<string> {
  const { data, error } = await db.rpc('aceitar_convite', { p_convite: conviteId });
  if (error) throw new Error(mensagemErroBanco(error, 'aceitar o convite'));
  if (typeof data !== 'string' || !data) throw new Error('Não foi possível aceitar o convite.');
  return data;
}

/** Recusa o convite (só a conta convidada, só pendente). */
export async function recusarConvite(db: ClienteDbConvites, conviteId: string): Promise<void> {
  const { error } = await db.rpc('recusar_convite', { p_convite: conviteId });
  if (error) throw new Error(mensagemErroBanco(error, 'recusar o convite'));
}

/** Convites pendentes da empresa (RLS: quem tem `equipe.gerenciar`), mais recentes primeiro. Sem a 092: vazio. */
export async function carregarConvitesPendentes(db: ClienteDbConvites, empresaId: string): Promise<ConvitePendente[]> {
  const { data, error } = await db.from('convites_equipe')
    .select('id, user_id, email, nome, role, percentual_comissao, tipo_contrato, convidado_por, criado_em')
    .eq('empresa_id', empresaId).eq('status', 'pendente')
    .order('criado_em', { ascending: false }).order('id')
    .range(0, 499);
  if (error) {
    if (semMigration092(error)) return [];
    throw new Error(mensagemErroBanco(error, 'carregar os convites pendentes'));
  }
  return ((data ?? []) as Record<string, unknown>[]).map(c => ({
    id: String(c.id),
    user_id: String(c.user_id),
    email: String(c.email ?? ''),
    nome: typeof c.nome === 'string' ? c.nome : null,
    role: papel(c.role),
    percentual_comissao: Number(c.percentual_comissao ?? 0),
    tipo_contrato: contratoOuNull(c.tipo_contrato),
    convidado_por: typeof c.convidado_por === 'string' ? c.convidado_por : null,
    criado_em: String(c.criado_em ?? ''),
  }));
}

/** Cancela um convite pendente (`equipe.gerenciar`; convite de gestora só a dona). */
export async function cancelarConvite(db: ClienteDbConvites, empresaId: string, conviteId: string): Promise<void> {
  const { error } = await db.rpc('cancelar_convite', { p_empresa: empresaId, p_convite: conviteId });
  if (error) throw new Error(mensagemErroBanco(error, 'cancelar o convite'));
}

/** Posição no histórico: a última linha já mostrada e quantas linhas já foram mostradas. */
export type CursorHistoricoEquipe = { criado_em: string; id: string; vistos: number };

/** Cursor da lista já mostrada (ordem `criado_em desc, id desc`); lista vazia = `null` (começa do início). */
export function cursorHistoricoEquipe(linhas: { criado_em: string; id: string }[]): CursorHistoricoEquipe | null {
  const ultima = linhas[linhas.length - 1];
  return ultima ? { criado_em: ultima.criado_em, id: ultima.id, vistos: linhas.length } : null;
}

/**
 * Mantém só o que vem DEPOIS do cursor na ordem `criado_em desc, id desc`. Evento novo empurra as
 * linhas já vistas para baixo; ler só por posição as repetiria, então elas são descartadas aqui.
 */
export function linhasAposCursorHistorico<T extends { criado_em: string; id: string }>(
  linhas: T[], cursor: { criado_em: string; id: string } | null,
): T[] {
  if (!cursor) return linhas;
  const t0 = Date.parse(cursor.criado_em);
  return linhas.filter((l) => {
    const t = Date.parse(l.criado_em);
    if (Number.isNaN(t) || Number.isNaN(t0)) return l.criado_em < cursor.criado_em || (l.criado_em === cursor.criado_em && l.id < cursor.id);
    return t < t0 || (t === t0 && l.id < cursor.id);
  });
}

/**
 * Uma página do histórico da Equipe, pela função `listar_historico_equipe` (e-mails mascarados para
 * quem não é a dona). Sem `cursor` lê a primeira página; com `cursor` (`cursorHistoricoEquipe` da lista
 * já mostrada) continua dali sem pular nem repetir itens quando chega evento novo.
 * `disponivel: false` = a 092 não foi rodada.
 */
export async function carregarHistoricoEquipe(db: ClienteDbConvites, empresaId: string, cursor: CursorHistoricoEquipe | null = null):
  Promise<{ linhas: LinhaHistoricoEquipe[]; temMais: boolean; disponivel: boolean }> {
  const n = TAMANHO_PAGINA_HISTORICO_EQUIPE;
  const offset = cursor && Number.isInteger(cursor.vistos) && cursor.vistos > 0 ? cursor.vistos : 0;
  const { data, error } = await db.rpc('listar_historico_equipe', { p_empresa: empresaId, p_limite: n + 1, p_offset: offset });
  if (error) {
    if (semMigration092(error)) return { linhas: [], temMais: false, disponivel: false };
    throw new Error(mensagemErroBanco(error, 'carregar o histórico da equipe'));
  }
  const todas = ((data ?? []) as Record<string, unknown>[]).map(h => ({
    id: String(h.id),
    empresa_id: typeof h.empresa_id === 'string' ? h.empresa_id : undefined,
    alvo_user_id: typeof h.alvo_user_id === 'string' ? h.alvo_user_id : null,
    acao: String(h.acao ?? ''),
    detalhe: h.detalhe && typeof h.detalhe === 'object' ? h.detalhe as Record<string, unknown> : null,
    feito_por: typeof h.feito_por === 'string' ? h.feito_por : null,
    criado_em: String(h.criado_em ?? ''),
    alvo_nome: typeof h.alvo_nome === 'string' ? h.alvo_nome : null,
    feito_por_nome: typeof h.feito_por_nome === 'string' ? h.feito_por_nome : null,
  }));
  const novas = linhasAposCursorHistorico(todas, cursor);
  return { linhas: novas.slice(0, n), temMais: todas.length > n, disponivel: true };
}
