/**
 * @file web/lib/push/expo.ts
 * Push para o app nativo pela Expo Push API, usado pelos crons de lembrete e de resumo diário
 * (spec 2026-10-28, seção "Push"). Sem dependência nova: só `fetch`.
 *
 * - Envio em lotes de até 100 mensagens (limite da Expo por requisição).
 * - `EXPO_ACCESS_TOKEN` (opcional) vai no header `Authorization` só quando existe.
 * - Aparelho com recibo `DeviceNotRegistered` é apagado de `push_dispositivos`.
 * - Só os aparelhos da MESMA empresa do aviso (`push_dispositivos.empresa_id`).
 * - Sem a 097 (tabela inexistente): fallback SÓ LEITURA em `users.push_token`, que não tem
 *   empresa — por isso só entra quem tem vínculo ativo apenas nesta empresa.
 *
 * Nunca lança e nunca registra token (do aparelho ou de acesso) em log.
 */
import { semMigration097 } from '@shared/push-dispositivos';

export const URL_EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';
export const LOTE_EXPO = 100;

/** O mínimo do client supabase-js (service role) usado pelos crons. */
export interface ClienteDbCron {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabela: string): any;
}

export type MensagemExpo = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  channelId?: string;
};

export type OpcoesExpo = { fetchFn?: typeof fetch; accessToken?: string };

/** Aparelhos expo por usuário. `legado` = vieram de `users.push_token` (nunca escrever neles). */
export type DispositivosExpo = { porUsuario: Map<string, string[]>; legado: boolean };

const TOKEN_EXPO = /^Expo(nent)?PushToken\[.+\]$/;
const ehTokenExpo = (t: unknown): t is string => typeof t === 'string' && TOKEN_EXPO.test(t.trim());

function msgErro(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Envia as mensagens à Expo em lotes de até 100. Um lote que falha (rede, HTTP de erro, resposta
 * estranha) conta como falha e não impede os outros.
 * @returns enviados (ticket ok), falhas e os tokens com `DeviceNotRegistered`.
 */
export async function enviarExpo(
  mensagens: MensagemExpo[], opcoes: OpcoesExpo = {},
): Promise<{ enviados: number; falhas: number; invalidos: string[] }> {
  const fetchFn = opcoes.fetchFn ?? fetch;
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (opcoes.accessToken) headers.Authorization = `Bearer ${opcoes.accessToken}`;

  let enviados = 0;
  let falhas = 0;
  const invalidos: string[] = [];

  for (let i = 0; i < mensagens.length; i += LOTE_EXPO) {
    const lote = mensagens.slice(i, i + LOTE_EXPO);
    try {
      const res = await fetchFn(URL_EXPO_PUSH, { method: 'POST', headers, body: JSON.stringify(lote) });
      if (!res.ok) {
        falhas += lote.length;
        console.error(`[push] Expo respondeu HTTP ${res.status} para um lote de ${lote.length}.`);
        continue;
      }
      const json = (await res.json()) as { data?: unknown };
      const tickets = Array.isArray(json?.data) ? (json.data as { status?: string; details?: { error?: string } }[]) : null;
      if (!tickets) {
        falhas += lote.length;
        console.error('[push] Resposta da Expo sem a lista de recibos.');
        continue;
      }
      lote.forEach((m, j) => {
        const t = tickets[j];
        if (t?.status === 'ok') { enviados++; return; }
        falhas++;
        if (t?.details?.error === 'DeviceNotRegistered') invalidos.push(m.to);
      });
    } catch (e) {
      falhas += lote.length;
      console.error('[push] Falha ao enviar para a Expo:', msgErro(e));
    }
  }
  return { enviados, falhas, invalidos };
}

/**
 * Aparelhos expo dos `userIds` NA empresa `empresaId`.
 * @param opcoes.legado sem a 097, usar `users.push_token` (só leitura). O cron de lembrete passa
 *   `false`: o app sem a 097 ainda agenda o lembrete local, e o push chegaria dobrado.
 */
export async function carregarDispositivosExpo(
  db: ClienteDbCron, empresaId: string, userIds: string[], opcoes: { legado: boolean },
): Promise<DispositivosExpo> {
  const porUsuario = new Map<string, string[]>();
  const quero = new Set(userIds);
  if (!quero.size) return { porUsuario, legado: false };
  const add = (uid: string, token: string) => {
    const arr = porUsuario.get(uid) ?? [];
    if (!arr.includes(token)) arr.push(token);
    porUsuario.set(uid, arr);
  };

  try {
    const { data, error } = await db.from('push_dispositivos')
      .select('user_id, token')
      .eq('empresa_id', empresaId)
      .eq('plataforma', 'expo');
    if (!error) {
      for (const d of (data ?? []) as { user_id: string; token: string }[]) {
        if (quero.has(d.user_id) && ehTokenExpo(d.token)) add(d.user_id, d.token.trim());
      }
      return { porUsuario, legado: false };
    }
    if (!semMigration097(error)) {
      console.error('[push] Erro ao ler push_dispositivos:', error.message);
      return { porUsuario, legado: false };
    }
    if (!opcoes.legado) return { porUsuario, legado: false };

    // Sem a 097: users.push_token não tem empresa. Só quem tem vínculo ativo SÓ nesta empresa,
    // para nunca mandar o aviso de uma empresa para quem está usando o app em outra.
    const ids = [...quero];
    const [rU, rV] = await Promise.all([
      db.from('users').select('id, push_token').in('id', ids),
      db.from('empresa_membros').select('user_id, empresa_id').in('user_id', ids).eq('ativo', true),
    ]);
    if (rU.error || rV.error) {
      console.error('[push] Erro ao ler o token antigo (users.push_token):', (rU.error ?? rV.error).message);
      return { porUsuario, legado: true };
    }
    const empresasDe = new Map<string, Set<string>>();
    for (const v of (rV.data ?? []) as { user_id: string; empresa_id: string }[]) {
      const s = empresasDe.get(v.user_id) ?? new Set<string>();
      s.add(v.empresa_id);
      empresasDe.set(v.user_id, s);
    }
    for (const u of (rU.data ?? []) as { id: string; push_token: string | null }[]) {
      const emp = empresasDe.get(u.id);
      if (!emp || emp.size !== 1 || !emp.has(empresaId)) continue;
      if (ehTokenExpo(u.push_token)) add(u.id, u.push_token.trim());
    }
    return { porUsuario, legado: true };
  } catch (e) {
    console.error('[push] Falha ao carregar aparelhos:', msgErro(e));
    return { porUsuario, legado: false };
  }
}

/**
 * Manda um push para os aparelhos de cada usuário em `envios` e apaga (só na 097) os aparelhos
 * `DeviceNotRegistered`, tirando-os também do mapa para os próximos envios do mesmo cron.
 * @returns quantas mensagens a Expo aceitou. Nunca lança.
 */
export async function enviarPushExpo(
  db: ClienteDbCron,
  disp: DispositivosExpo,
  envios: { userId: string; titulo: string; corpo: string; dados?: Record<string, unknown> }[],
  opcoes: OpcoesExpo = {},
): Promise<number> {
  try {
    const vistos = new Set<string>();
    const mensagens: MensagemExpo[] = [];
    for (const e of envios) {
      for (const to of disp.porUsuario.get(e.userId) ?? []) {
        if (vistos.has(to)) continue;
        vistos.add(to);
        mensagens.push({ to, title: e.titulo, body: e.corpo, data: e.dados, sound: 'default', channelId: 'default' });
      }
    }
    if (!mensagens.length) return 0;

    const r = await enviarExpo(mensagens, opcoes);
    if (r.invalidos.length && !disp.legado) {
      const invalidos = new Set(r.invalidos);
      for (const [uid, toks] of disp.porUsuario) disp.porUsuario.set(uid, toks.filter(t => !invalidos.has(t)));
      try {
        const { error } = await db.from('push_dispositivos').delete().in('token', [...invalidos]);
        if (error) console.error('[push] Erro ao apagar aparelhos inválidos:', error.message);
      } catch (e) {
        console.error('[push] Falha ao apagar aparelhos inválidos:', msgErro(e));
      }
    }
    return r.enviados;
  } catch (e) {
    console.error('[push] Falha no envio para o app:', msgErro(e));
    return 0;
  }
}

// ── Web push (web_push_subscriptions) ───────────────────────────────────────

export type InscricaoWeb = { user_id: string; endpoint: string; p256dh: string; auth: string };
/** `webpush.sendNotification` (injetado para os testes). */
export type EnviarWeb = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;

/**
 * Manda o web push para cada inscrição. Erro numa não impede as outras; só apaga a inscrição
 * quando o serviço de push diz que ela não existe mais (HTTP 404/410) — falha passageira não
 * desinscreve ninguém. @returns quantos foram aceitos. Nunca lança.
 */
export async function enviarWebPush(
  db: ClienteDbCron, inscricoes: InscricaoWeb[], payload: string, enviar: EnviarWeb,
): Promise<number> {
  let enviados = 0;
  for (const sub of inscricoes) {
    try {
      await enviar({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      enviados++;
    } catch (e) {
      const status = (e as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        try { await db.from('web_push_subscriptions').delete().eq('endpoint', sub.endpoint); } catch { /* segue */ }
      } else {
        console.error(`[push] Web push falhou (HTTP ${status ?? '?'}).`);
      }
    }
  }
  return enviados;
}

/** Agrupa as inscrições web por usuário. */
export function inscricoesPorUsuario(subs: InscricaoWeb[] | null | undefined): Map<string, InscricaoWeb[]> {
  const m = new Map<string, InscricaoWeb[]>();
  for (const s of subs ?? []) {
    const arr = m.get(s.user_id) ?? [];
    arr.push(s);
    m.set(s.user_id, arr);
  }
  return m;
}
