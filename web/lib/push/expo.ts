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
import { semMigration097, limiteVistoEm } from '@shared/push-dispositivos';

export const URL_EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';
export const LOTE_EXPO = 100;
export const URL_EXPO_RECIBOS = 'https://exp.host/--/api/v2/push/getReceipts';
/** A Expo aceita até 1000 ids por consulta de recibos; usamos 300 (limite combinado na spec). */
export const LOTE_RECIBOS = 300;
/** Recibos só ficam prontos depois de um tempo: antes disso nem consultamos. */
export const MIN_RECIBO_MIN = 15;
/** Recibo sem resposta da Expo depois disso é descartado (a Expo só guarda 24 h). */
export const HORAS_RECIBO = 24;

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

/** Par (ticket, token) de um envio aceito pela Expo, para ler o recibo depois. */
export type ParRecibo = { ticketId: string; token: string };

export type OpcoesExpo = {
  fetchFn?: typeof fetch;
  accessToken?: string;
  /** Chamado a cada lote com os tickets `ok`. Se lançar, só é registrado no log: o envio segue. */
  aoReceberTickets?: (pares: ParRecibo[]) => Promise<void>;
};

/** Aparelhos expo por usuário. `legado` = vieram de `users.push_token` (nunca escrever neles). */
export type DispositivosExpo = {
  porUsuario: Map<string, string[]>;
  legado: boolean;
  /** A leitura falhou (erro do banco que NÃO é "097 ausente"): o mapa vazio não quer dizer "ninguém tem aparelho". */
  erro?: boolean;
};

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
      const tickets = Array.isArray(json?.data) ? (json.data as { status?: string; id?: string; details?: { error?: string } }[]) : null;
      if (!tickets) {
        falhas += lote.length;
        console.error('[push] Resposta da Expo sem a lista de recibos.');
        continue;
      }
      const pares: ParRecibo[] = [];
      lote.forEach((m, j) => {
        const t = tickets[j];
        if (t?.status === 'ok') {
          enviados++;
          if (typeof t.id === 'string' && t.id) pares.push({ ticketId: t.id, token: m.to });
          return;
        }
        falhas++;
        if (t?.details?.error === 'DeviceNotRegistered') invalidos.push(m.to);
      });
      if (pares.length && opcoes.aoReceberTickets) {
        try { await opcoes.aoReceberTickets(pares); } catch (e) {
          console.error('[push] Falha ao guardar os recibos:', msgErro(e));
        }
      }
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
 * @param opcoes.agora relógio (testes). Só aparelhos com `visto_em` dos últimos 30 dias recebem
 *   (o app renova `visto_em` ao abrir); o fallback `users.push_token` não tem essa data e não muda.
 */
export async function carregarDispositivosExpo(
  db: ClienteDbCron, empresaId: string, userIds: string[], opcoes: { legado: boolean; agora?: Date },
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
      .eq('plataforma', 'expo')
      .gte('visto_em', limiteVistoEm(opcoes.agora ?? new Date()));
    if (!error) {
      for (const d of (data ?? []) as { user_id: string; token: string }[]) {
        if (quero.has(d.user_id) && ehTokenExpo(d.token)) add(d.user_id, d.token.trim());
      }
      return { porUsuario, legado: false };
    }
    if (!semMigration097(error)) {
      console.error('[push] Erro ao ler push_dispositivos:', error.message);
      return { porUsuario, legado: false, erro: true };
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
      return { porUsuario, legado: true, erro: true };
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
    return { porUsuario, legado: false, erro: true };
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

    // Sem a 097 (legado) os recibos não são guardados: o cron só apaga aparelhos de push_dispositivos.
    const r = await enviarExpo(mensagens, disp.legado ? opcoes : { ...opcoes, aoReceberTickets: pares => gravarRecibos(db, pares) });
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

/** Erro de tabela/coluna que ainda não existe (102 não aplicada). */
export function semMigration102(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return semMigration097(e) || e.code === '42703' || e.code === 'PGRST204'
    || /push_enviado_em|push_recibos/i.test(e.message ?? '');
}

/** Guarda os pares (ticket, token) em push_recibos. Sem a 102 a tabela não existe: pula em silêncio. */
async function gravarRecibos(db: ClienteDbCron, pares: ParRecibo[]): Promise<void> {
  const { error } = await db.from('push_recibos').upsert(
    pares.map(p => ({ ticket_id: p.ticketId, token: p.token })),
    { onConflict: 'ticket_id', ignoreDuplicates: true },
  );
  if (error && !semMigration102(error)) console.error('[push] Erro ao guardar recibos:', error.message);
}

/**
 * Lê na Expo os recibos dos envios com mais de 15 min (push_recibos), apaga de push_dispositivos o
 * aparelho com `DeviceNotRegistered` e limpa a tabela: recibos lidos e os com mais de 24 h.
 * Recibo que a Expo ainda não devolveu (e tem menos de 24 h) fica para a próxima passada. Falha de
 * rede/HTTP num lote deixa os recibos dele intactos. Sem a 102 não faz nada. Nunca lança nem
 * registra token em log.
 * @returns quantos recibos foram lidos e quantos aparelhos foram apagados.
 */
export async function lerRecibosExpo(
  db: ClienteDbCron, opcoes: OpcoesExpo & { agora: Date },
): Promise<{ lidos: number; apagados: number }> {
  const resultado = { lidos: 0, apagados: 0 };
  try {
    const fetchFn = opcoes.fetchFn ?? fetch;
    const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (opcoes.accessToken) headers.Authorization = `Bearer ${opcoes.accessToken}`;
    const limiteMin = new Date(opcoes.agora.getTime() - MIN_RECIBO_MIN * 60_000).toISOString();
    const limiteDia = new Date(opcoes.agora.getTime() - HORAS_RECIBO * 3_600_000).toISOString();

    const { data, error } = await db.from('push_recibos')
      .select('ticket_id, token').lte('criado_em', limiteMin).order('criado_em', { ascending: true }).limit(3000);
    if (error) {
      if (!semMigration102(error)) console.error('[push] Erro ao ler push_recibos:', error.message);
      return resultado;
    }
    const recibos = (data ?? []) as { ticket_id: string; token: string }[];

    for (let i = 0; i < recibos.length; i += LOTE_RECIBOS) {
      const lote = recibos.slice(i, i + LOTE_RECIBOS);
      try {
        const res = await fetchFn(URL_EXPO_RECIBOS, { method: 'POST', headers, body: JSON.stringify({ ids: lote.map(r => r.ticket_id) }) });
        if (!res.ok) { console.error(`[push] Expo respondeu HTTP ${res.status} na leitura de recibos.`); continue; }
        const json = (await res.json()) as { data?: Record<string, { status?: string; details?: { error?: string } }> };
        const mapa = json?.data;
        if (!mapa || typeof mapa !== 'object') { console.error('[push] Resposta da Expo sem recibos.'); continue; }
        const lidos = lote.filter(r => mapa[r.ticket_id]);
        const invalidos = [...new Set(lidos.filter(r => mapa[r.ticket_id].details?.error === 'DeviceNotRegistered').map(r => r.token))];
        if (invalidos.length) {
          const { error: eDel } = await db.from('push_dispositivos').delete().in('token', invalidos);
          if (eDel) { console.error('[push] Erro ao apagar aparelhos dos recibos:', eDel.message); continue; }
          resultado.apagados += invalidos.length;
        }
        if (lidos.length) {
          const { error: eRec } = await db.from('push_recibos').delete().in('ticket_id', lidos.map(r => r.ticket_id));
          if (eRec) console.error('[push] Erro ao limpar recibos lidos:', eRec.message);
          resultado.lidos += lidos.length;
        }
      } catch (e) {
        console.error('[push] Falha ao ler recibos da Expo:', msgErro(e));
      }
    }

    const { error: eVelhos } = await db.from('push_recibos').delete().lt('criado_em', limiteDia);
    if (eVelhos) console.error('[push] Erro ao limpar recibos antigos:', eVelhos.message);
  } catch (e) {
    console.error('[push] Falha na leitura de recibos:', msgErro(e));
  }
  return resultado;
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
