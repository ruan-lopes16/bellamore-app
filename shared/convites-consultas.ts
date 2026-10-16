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

/**
 * Uma página do histórico da Equipe (0 = mais recente), pela função `listar_historico_equipe`
 * (e-mails mascarados para quem não é a dona). `disponivel: false` = a 092 não foi rodada.
 */
export async function carregarHistoricoEquipe(db: ClienteDbConvites, empresaId: string, pagina: number):
  Promise<{ linhas: LinhaHistoricoEquipe[]; temMais: boolean; disponivel: boolean }> {
  const n = TAMANHO_PAGINA_HISTORICO_EQUIPE;
  const p = Number.isInteger(pagina) && pagina > 0 ? pagina : 0;
  const { data, error } = await db.rpc('listar_historico_equipe', { p_empresa: empresaId, p_limite: n + 1, p_offset: p * n });
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
  return { linhas: todas.slice(0, n), temMais: todas.length > n, disponivel: true };
}
