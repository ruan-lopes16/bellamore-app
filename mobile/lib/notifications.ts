import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Controla como as notificações aparecem com o app em primeiro plano
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registrarPushToken(userId: string): Promise<void> {
  // Simuladores não têm suporte a push nativo
  if (!Device.isDevice) return;

  const { status: statusAtual } = await Notifications.getPermissionsAsync();
  let statusFinal = statusAtual;

  if (statusAtual !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    statusFinal = status;
  }

  if (statusFinal !== 'granted') return;

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

  await supabase
    .from('users')
    .update({ push_token: token })
    .eq('id', userId);
}

/**
 * Agenda lembretes LOCAIS (sem servidor) para os atendimentos futuros do
 * usuário: 1 disparo às 18:00 da véspera + 1 disparo 30 min antes.
 * Recria tudo a cada chamada — chamar quando a agenda recarrega.
 */
export async function agendarLembretesLocais(
  ags: { id: string; dataHoraInicio: string; clienteNome: string | null; servicoNome: string | null }[],
): Promise<void> {
  if (!Device.isDevice) return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  // Limpa os agendados e reprograma do zero (evita duplicar / manter obsoletos).
  await Notifications.cancelAllScheduledNotificationsAsync();

  const agora = Date.now();

  for (const ag of ags) {
    const inicio = new Date(ag.dataHoraInicio).getTime();
    if (Number.isNaN(inicio) || inicio <= agora) continue;

    const cli = ag.clienteNome ?? 'Cliente';
    const serv = ag.servicoNome ?? 'Atendimento';
    const hhmm = new Date(ag.dataHoraInicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    // 30 min antes
    const t30 = new Date(inicio - 30 * 60_000);
    if (t30.getTime() > agora) {
      await Notifications.scheduleNotificationAsync({
        identifier: `ag-${ag.id}-30`,
        content: { title: 'Lembrete de atendimento', body: `Em 30 min: ${cli} — ${serv} · ${hhmm}` },
        trigger: { date: t30 },
      });
    }

    // Véspera às 18:00
    const vespera = new Date(inicio);
    vespera.setDate(vespera.getDate() - 1);
    vespera.setHours(18, 0, 0, 0);
    if (vespera.getTime() > agora) {
      await Notifications.scheduleNotificationAsync({
        identifier: `ag-${ag.id}-vespera`,
        content: { title: 'Atendimento amanhã', body: `Amanhã às ${hhmm}: ${cli} — ${serv}` },
        trigger: { date: vespera },
      });
    }
  }
}

// Mapa de tipo de notificação → rota de destino ao tocar
export function rotaParaNotificacao(
  tipo?: string,
  role?: string
): string {
  const base = role === 'profissional' ? '/(profissional)' : '/(empresa)';
  switch (tipo) {
    case 'agendamento':    return `${base}/agenda`;
    case 'comissao':       return `${base}/comissoes`;
    case 'pagamento':      return `${base}/financeiro`;
    case 'estoque_baixo':  return `/(empresa)/estoque`;
    case 'cliente_sumido': return `/(empresa)/clientes`;
    default:               return `${base}/notificacoes`;
  }
}
