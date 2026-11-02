/**
 * @file inscricao-web.ts
 * Grava a inscrição de web push da pessoa presa à empresa ativa. Upsert por (user_id, endpoint):
 * ao trocar de empresa, a mesma inscrição passa a apontar para a nova. Conferido com
 * `.select('id')` — erro ou 0 linhas (RLS) lançam, nunca "ok" falso.
 */

export interface ClienteDbInscricao {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabela: string): any;
}

type CorpoInscricao = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } | null };

export async function gravarInscricaoWebPush(
  db: ClienteDbInscricao, userId: string, empresaId: string, corpo: CorpoInscricao,
): Promise<void> {
  const endpoint = corpo?.endpoint;
  const p256dh = corpo?.keys?.p256dh;
  const auth = corpo?.keys?.auth;
  if (typeof endpoint !== 'string' || !endpoint || typeof p256dh !== 'string' || !p256dh || typeof auth !== 'string' || !auth) {
    throw new Error('Inscrição de notificação inválida.');
  }
  const { data, error } = await db.from('web_push_subscriptions').upsert({
    user_id: userId, empresa_id: empresaId, endpoint, p256dh, auth,
  }, { onConflict: 'user_id, endpoint' }).select('id');
  if (error) throw new Error('Não foi possível salvar a inscrição de notificação.');
  if (!data || (data as unknown[]).length === 0) throw new Error('Sem permissão para salvar a inscrição de notificação.');
}
