import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { registrarDispositivoPush, removerDispositivoPush } from '@shared/push-dispositivos';
import { usarLembreteLocal, type ResultadoRegistroPush } from '@shared/lembretes-locais';
import { rotaDoAviso, type AreaApp } from '@shared/notificacoes';
import { horaBRT } from '@shared/periodos';

// Controla como as notificações aparecem com o app em primeiro plano
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// ── Estado do aparelho nesta sessão do app ───────────────────
// Resultado da última sincronização (null = ainda não sincronizou). Decide se o lembrete local
// existe (`usarLembreteLocal`): com o aparelho registrado no servidor, o lembrete vem por push.
let ultimoResultado: ResultadoRegistroPush | null = null;
// Token Expo do aparelho, para tirá-lo do servidor ao sair da conta.
let ultimoToken: string | null = null;
// Últimos atendimentos pedidos por `agendarLembretesLocais`: se a agenda carregou antes do
// registro terminar e ele cair no caminho antigo, os lembretes são agendados com eles.
let ultimosLembretes: { ags: LembreteAtendimento[]; ligado: boolean } | null = null;

type LembreteAtendimento = { id: string; dataHoraInicio: string; clienteNome: string | null; servicoNome: string | null };

// Mensagem da última sincronização que FALHOU por outro motivo que não a 097/permissão (rede,
// token Expo, RPC recusada). `null` = a última deu certo. Configurações (Task 7) mostra o status.
let ultimoErro: string | null = null;

/** Resultado da última sincronização do aparelho (null = ainda não sincronizou nesta sessão). */
export function resultadoRegistroPush(): ResultadoRegistroPush | null {
  return ultimoResultado;
}

/**
 * Erro da última sincronização (null = sem erro). Enquanto houver erro, o aparelho fica sem push
 * novo e sem lembrete local (`usarLembreteLocal` só libera com `'sem_migration'`): nunca em dobro.
 */
export function erroRegistroPush(): string | null {
  return ultimoErro;
}

/** Situação da permissão de notificações do sistema (`'sem_suporte'` em simulador). */
export async function statusPermissaoNotificacoes(): Promise<'concedida' | 'negada' | 'nao_perguntada' | 'sem_suporte'> {
  if (!Device.isDevice) return 'sem_suporte';
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'concedida';
  return status === 'undetermined' && canAskAgain !== false ? 'nao_perguntada' : 'negada';
}

/** Cancela todos os lembretes locais já agendados neste aparelho. */
export async function cancelarLembretesLocais(): Promise<void> {
  try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch { /* sem agendados */ }
}

/**
 * Registra este aparelho para receber push da empresa ativa (idempotente: chamar na abertura do
 * app, na troca de empresa e ao ativar as notificações).
 * - `pedirPermissao: false` (abertura/troca): nunca abre o pedido do sistema; quem não concedeu fica
 *   sem push e sem lembrete local.
 * - `'registrado'` → aparelho em `push_dispositivos`: cancela os lembretes locais (o servidor manda).
 * - `'sem_migration'` (sem a 097) → caminho antigo: `users.push_token` + lembrete local.
 * @throws Error com mensagem em português se o registro falhar por outro motivo.
 */
export async function sincronizarPushDispositivo(opts: {
  userId: string; empresaId: string; pedirPermissao: boolean;
}): Promise<ResultadoRegistroPush> {
  try {
    const r = await sincronizar(opts);
    ultimoErro = null;
    return r;
  } catch (e) {
    ultimoErro = e instanceof Error && e.message ? e.message : 'Não foi possível ativar as notificações neste aparelho.';
    // Sem um 'sem_migration' confirmado, os lembretes locais (de um binário antigo, por exemplo)
    // saem: o aparelho pode seguir registrado no servidor e o lembrete chegaria em dobro.
    if (!usarLembreteLocal(ultimoResultado)) await cancelarLembretesLocais();
    throw new Error(ultimoErro);
  }
}

async function sincronizar(opts: {
  userId: string; empresaId: string; pedirPermissao: boolean;
}): Promise<ResultadoRegistroPush> {
  // Simuladores não têm suporte a push nativo
  if (!Device.isDevice) { ultimoResultado = 'sem_suporte'; return 'sem_suporte'; }

  const { status: statusAtual } = await Notifications.getPermissionsAsync();
  let statusFinal = statusAtual;
  if (statusAtual !== 'granted' && opts.pedirPermissao) {
    const { status } = await Notifications.requestPermissionsAsync();
    statusFinal = status;
  }

  if (statusFinal !== 'granted') {
    // Sem permissão: nem push nem lembrete local.
    ultimoResultado = 'sem_permissao';
    await cancelarLembretesLocais();
    return 'sem_permissao';
  }

  // Canal obrigatório no Android
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'App Estética',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#9B6FE8',
    });
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync();
  ultimoToken = token;

  const resultado = await registrarDispositivoPush(supabase, { empresaId: opts.empresaId, plataforma: 'expo', token });
  ultimoResultado = resultado;

  if (resultado === 'registrado') {
    // O lembrete agora vem do servidor: os locais já agendados chegariam dobrados.
    await cancelarLembretesLocais();
    return resultado;
  }

  // Sem a 097: caminho antigo (token em users + lembrete local).
  const { error } = await supabase.from('users').update({ push_token: token }).eq('id', opts.userId);
  if (error) throw new Error('Não foi possível ativar as notificações neste aparelho.');
  if (ultimosLembretes) await agendarLembretesLocais(ultimosLembretes.ags, ultimosLembretes.ligado);
  return resultado;
}

/**
 * "Ativar notificações" (botão de Configurações): pede a permissão do sistema, se preciso, e
 * registra o aparelho na empresa ativa. Único lugar do app que abre o pedido de permissão.
 */
export async function ativarNotificacoes(userId: string, empresaId: string): Promise<ResultadoRegistroPush> {
  return sincronizarPushDispositivo({ userId, empresaId, pedirPermissao: true });
}

/**
 * Ao sair da conta (chamar ANTES do signOut: a RLS só deixa apagar com a sessão): tira este
 * aparelho de `push_dispositivos` e cancela os lembretes locais. Nunca lança.
 */
export async function desativarPushDoAparelho(): Promise<void> {
  try {
    let token = ultimoToken;
    if (!token && Device.isDevice) {
      const { status } = await Notifications.getPermissionsAsync();
      if (status === 'granted') token = (await Notifications.getExpoPushTokenAsync()).data;
    }
    if (token) await removerDispositivoPush(supabase, token);
  } catch { /* sair nunca falha por causa do push */ }
  await cancelarLembretesLocais();
  ultimoResultado = null;
  ultimoErro = null;
  ultimoToken = null;
  ultimosLembretes = null;
}

/**
 * Agenda lembretes LOCAIS (sem servidor) para os atendimentos futuros do
 * usuário: 1 disparo único, 30 min antes de cada atendimento.
 * Recria tudo a cada chamada — chamar quando a agenda recarrega.
 *
 * Só no caminho antigo (`usarLembreteLocal`: aparelho sem a 097). Com o aparelho registrado no
 * servidor o lembrete vem por push e nada é agendado aqui (não chega dobrado).
 *
 * `notifLembreteAtendimento` é a preferência do usuário (users.notif_lembrete_atendimento,
 * migration 077, default true) — quando false, só limpa os agendados e não
 * reprograma nenhum (o usuário pediu pra parar de receber esse aviso).
 */
export async function agendarLembretesLocais(
  ags: LembreteAtendimento[],
  notifLembreteAtendimento: boolean = true,
): Promise<void> {
  ultimosLembretes = { ags, ligado: notifLembreteAtendimento };
  if (!usarLembreteLocal(ultimoResultado)) return;
  if (!Device.isDevice) return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  // Limpa os agendados e reprograma do zero (evita duplicar / manter obsoletos).
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!notifLembreteAtendimento) return;

  const agora = Date.now();

  for (const ag of ags) {
    const inicio = new Date(ag.dataHoraInicio).getTime();
    if (Number.isNaN(inicio) || inicio <= agora) continue;

    const cli = ag.clienteNome ?? 'Cliente';
    const serv = ag.servicoNome ?? 'Atendimento';
    const hhmm = horaBRT(ag.dataHoraInicio);
    const body = `${cli} · ${serv} · ${hhmm}`;

    // 30 min antes
    const t30 = new Date(inicio - 30 * 60_000);
    if (t30.getTime() > agora) {
      await Notifications.scheduleNotificationAsync({
        identifier: `ag-${ag.id}-30`,
        content: { title: 'Atendimento em 30 minutos', body },
        trigger: { date: t30 },
      });
    }
  }
}

/** Rota que abre ao tocar numa notificação push: a mesma regra dos avisos (`rotaDoAviso`). */
export function rotaParaNotificacao(tipo: string | undefined, area: AreaApp): string {
  return rotaDoAviso(tipo, 'app', area);
}
