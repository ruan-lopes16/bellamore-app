import { useEffect, useRef } from 'react';
import { Stack, router, SplashScreen } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { rotaInicial } from '@/lib/permissions';
import { registrarPushToken, rotaParaNotificacao } from '@/lib/notifications';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 2 }, // 2 min cache
  },
});

export default function RootLayout() {
  const { carregarSessao, roleAtivo, isOwner, user } = useAuthStore();
  const notifListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();

  useEffect(() => {
    // Escuta mudanças de sessão (login / logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session) {
          await carregarSessao();
        } else {
          router.replace('/(auth)/login');
        }
        SplashScreen.hideAsync();
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // Redireciona quando o perfil carrega
    if (user && roleAtivo) {
      const rota = rotaInicial(isOwner ? 'owner' : roleAtivo);
      router.replace(rota as any);
    }
  }, [user, roleAtivo, isOwner]);

  useEffect(() => {
    if (!user) return;

    // Registra o token de push do dispositivo
    registrarPushToken(user.id);

    // Notificação recebida com app em primeiro plano
    notifListener.current = Notifications.addNotificationReceivedListener(() => {
      queryClient.invalidateQueries({ queryKey: ['notificacoes'] });
    });

    // Usuário tocou em uma notificação
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const tipo = response.notification.request.content.data?.tipo as string | undefined;
        const role = isOwner ? 'owner' : (roleAtivo ?? undefined);
        const rota = rotaParaNotificacao(tipo, role);
        router.push(rota as any);
      }
    );

    return () => {
      notifListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [user?.id]);

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}
