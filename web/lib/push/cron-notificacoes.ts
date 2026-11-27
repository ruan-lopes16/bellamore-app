/**
 * @file web/lib/push/cron-notificacoes.ts
 * Parte do cron de 5 em 5 minutos (rota /api/cron/lembretes) que envia o push dos avisos de bloqueio
 * de agenda (spec 2026-11-20, C14) e lê os recibos da Expo (B14). Separado da rota para ser testado
 * com db e fetch falsos.
 *
 * Avisos: `notificacoes` com tipo bloqueio_pendente/aprovado/recusado (trigger da 069), ainda sem
 * `push_enviado_em` e criadas nas últimas 24 h. Título e mensagem vão como estão, pelo web push e
 * pelo app, só para os aparelhos da empresa do aviso. Sem preferência: é um aviso que pede ação.
 *
 * Único de verdade: `push_enviado_em` é marcado ANTES de enviar, só se ainda estiver nulo
 * (`.is(null)` + `.select('id')`), mesmo padrão de `lembrete_30min_em`. Se a leitura de aparelhos/
 * inscrições falhar, nada é marcado (o próximo cron tenta de novo, dentro da janela de 24 h).
 * Sem a 102 (coluna inexistente) o envio é pulado em silêncio.
 */
import { enviarPushExpo, enviarWebPush, carregarDispositivosExpo, inscricoesPorUsuario, lerRecibosExpo, semMigration102,
  type ClienteDbCron, type EnviarWeb, type InscricaoWeb } from './expo';
import { rotaDoAviso } from '@shared/notificacoes';

export const TIPOS_PUSH_BLOQUEIO = ['bloqueio_pendente', 'bloqueio_aprovado', 'bloqueio_recusado'] as const;
/** Avisos que viram push pelo cron: os de bloqueio e a troca de login (B12, sem e-mail sem domínio próprio). */
export const TIPOS_PUSH_AVISO = [...TIPOS_PUSH_BLOQUEIO, 'login_trocado'] as const;
/** Avisos mais velhos que isto nunca recebem push (já perderam o sentido). */
export const HORAS_PUSH_BLOQUEIO = 24;
const LIMITE_POR_PASSADA = 200;

export type DepsCronNotificacoes = {
  db: ClienteDbCron;
  enviarWeb: EnviarWeb;
  agora: Date;
  fetchFn?: typeof fetch;
  expoAccessToken?: string;
};

type Aviso = { id: string; user_id: string; empresa_id: string | null; tipo?: string | null; titulo: string; mensagem: string | null };

/**
 * Envia o push dos avisos de bloqueio pendentes e lê os recibos da Expo. Nunca lança.
 * @returns pushes aceitos (web + app) e recibos lidos.
 */
export async function executarCronNotificacoes(deps: DepsCronNotificacoes): Promise<{ enviados: number; recibos: number }> {
  const { db, agora } = deps;
  const opcoesExpo = { fetchFn: deps.fetchFn, accessToken: deps.expoAccessToken };
  let enviados = 0;

  try {
    const desde = new Date(agora.getTime() - HORAS_PUSH_BLOQUEIO * 3_600_000).toISOString();
    const { data, error } = await db.from('notificacoes')
      .select('id, user_id, empresa_id, tipo, titulo, mensagem')
      .in('tipo', [...TIPOS_PUSH_AVISO])
      .is('push_enviado_em', null)
      .gte('created_at', desde)
      .order('created_at', { ascending: true })
      .limit(LIMITE_POR_PASSADA);
    if (error) {
      if (!semMigration102(error)) console.error('[notificacoes-push] Erro ao ler avisos:', error.message);
    } else {
      for (const aviso of (data ?? []) as Aviso[]) {
        enviados += await enviarAviso(db, aviso, deps, opcoesExpo);
      }
    }
  } catch (e) {
    console.error('[notificacoes-push] Falha no push de bloqueio:', e instanceof Error ? e.message : String(e));
  }

  const { lidos } = await lerRecibosExpo(db, { ...opcoesExpo, agora });
  return { enviados, recibos: lidos };
}

async function enviarAviso(
  db: ClienteDbCron, aviso: Aviso, deps: DepsCronNotificacoes,
  opcoesExpo: { fetchFn?: typeof fetch; accessToken?: string },
): Promise<number> {
  try {
    if (!aviso.empresa_id) return 0; // sem empresa não há como limitar os aparelhos: fica só no sino

    const [{ data: subs, error: errSubs }, disp] = await Promise.all([
      db.from('web_push_subscriptions').select('user_id, endpoint, p256dh, auth')
        .eq('empresa_id', aviso.empresa_id).eq('user_id', aviso.user_id),
      carregarDispositivosExpo(db, aviso.empresa_id, [aviso.user_id], { legado: false, agora: deps.agora }),
    ]);
    // Leitura falhou: não marca (marcar sem conseguir enviar perderia o aviso).
    if (errSubs || disp.erro) {
      console.error('[notificacoes-push] Erro ao ler inscrições/aparelhos; tenta no próximo cron.');
      return 0;
    }

    const marcado = await db.from('notificacoes')
      .update({ push_enviado_em: deps.agora.toISOString() })
      .eq('id', aviso.id)
      .is('push_enviado_em', null)
      .select('id');
    if (marcado.error) {
      if (!semMigration102(marcado.error)) console.error('[notificacoes-push] Erro ao marcar aviso:', marcado.error.message);
      return 0;
    }
    if (!(marcado.data ?? []).length) return 0; // outro cron já marcou

    const corpo = aviso.mensagem ?? '';
    const inscricoes = inscricoesPorUsuario(subs as InscricaoWeb[] | null).get(aviso.user_id) ?? [];
    let n = await enviarWebPush(db, inscricoes, JSON.stringify({ title: aviso.titulo, body: corpo, url: rotaDoAviso(aviso.tipo, 'web') }), deps.enviarWeb);
    n += await enviarPushExpo(
      db, disp,
      [{ userId: aviso.user_id, titulo: aviso.titulo, corpo, dados: { tipo: aviso.tipo ?? 'bloqueio', url: rotaDoAviso(aviso.tipo, 'web') } }],
      opcoesExpo,
    );
    return n;
  } catch (e) {
    console.error('[notificacoes-push] Falha ao enviar o aviso:', e instanceof Error ? e.message : String(e));
    return 0;
  }
}
