/**
 * @file push-dispositivos.ts
 * Registro e remoção do aparelho que recebe push (tabela `push_dispositivos`, migration 097), usado
 * pelo app (token Expo) e, no futuro, pelo web. Cada aparelho fica ligado à pessoa E à empresa ativa:
 * os crons só mandam o lembrete/resumo de uma empresa para os aparelhos dela.
 *
 * - Ativar notificações / trocar de empresa → `registrarDispositivoPush` (função
 *   `registrar_push_dispositivo`, que também passa o aparelho de outra conta para quem ativou).
 * - Sair da conta → `removerDispositivoPush`.
 *
 * Sem a 097 as duas devolvem `'sem_migration'` (nunca lançam por isso): o app então segue pelo
 * caminho antigo (`users.push_token`). Qualquer outro erro LANÇA, com mensagem em português.
 */
import { mensagemErroBanco } from './erros';

/** O mínimo do client supabase-js usado aqui (web: @supabase/ssr; mobile: @supabase/supabase-js). */
export interface ClienteDbPush {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabela: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any;
}

/** Origem do token: `expo` (app nativo) ou `web` (reservado; o web push segue em web_push_subscriptions). */
export type PlataformaPush = 'expo' | 'web';

type ErroDb = { code?: string | null; message?: string | null } | null | undefined;

/** A 097 não foi rodada: função ou tabela não existe no PostgREST. Nunca 42883 (tipo errado). */
export function semMigration097(e: ErroDb): boolean {
  if (!e) return false;
  return e.code === 'PGRST202' || e.code === 'PGRST205' || e.code === '42P01'
    || /could not find the (function|table)/i.test(e.message ?? '');
}

/**
 * Registra (ou move para a empresa ativa) o aparelho de quem está logado.
 * @returns `'registrado'`, ou `'sem_migration'` quando a 097 ainda não existe.
 * @throws Error com mensagem pronta para a tela (sem vínculo, sessão expirada, token vazio...).
 */
export async function registrarDispositivoPush(
  db: ClienteDbPush,
  dados: { empresaId: string; plataforma: PlataformaPush; token: string },
): Promise<'registrado' | 'sem_migration'> {
  const token = dados.token.trim();
  if (!token) throw new Error('Token de notificação vazio.');
  if (!dados.empresaId) throw new Error('Escolha a empresa antes de ativar as notificações.');
  const { error } = await db.rpc('registrar_push_dispositivo', {
    p_empresa: dados.empresaId, p_plataforma: dados.plataforma, p_token: token,
  });
  if (error) {
    if (semMigration097(error)) return 'sem_migration';
    throw new Error(mensagemErroBanco(error, 'ativar as notificações'));
  }
  return 'registrado';
}

/**
 * Remove o aparelho (pelo token) da pessoa logada — a RLS só deixa apagar os próprios.
 * @returns quantas linhas foram apagadas (0 = já não estava registrado), ou `'sem_migration'`.
 */
export async function removerDispositivoPush(db: ClienteDbPush, token: string): Promise<number | 'sem_migration'> {
  const t = token.trim();
  if (!t) return 0;
  const { data, error } = await db.from('push_dispositivos').delete().eq('token', t).select('id');
  if (error) {
    if (semMigration097(error)) return 'sem_migration';
    throw new Error(mensagemErroBanco(error, 'desativar as notificações deste aparelho'));
  }
  return (data ?? []).length;
}
