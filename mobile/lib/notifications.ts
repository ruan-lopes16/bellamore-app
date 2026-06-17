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
