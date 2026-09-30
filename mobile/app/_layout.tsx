import { useEffect, useRef } from 'react';
import { Stack, router, SplashScreen } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { rotaInicial } from '@/lib/permissions';
import { registrarPushToken, rotaParaNotificacao } from '@/lib/notifications';
import { TapSpark } from '@/components/TapSpark';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 2 }, // 2 min cache
  },
});

export default function RootLayout() {
  const { carregarSessao, roleAtivo, isOwner, user, semEmpresa } = useAuthStore();
  const notifListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();

  useEffect(() => {
    // Escuta mudanças de sessão (login / logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!session) {
          router.replace('/(auth)/login');
        } else if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          // TOKEN_REFRESHED (a cada ~1h) e USER_UPDATED (trocar senha) NÃO
          // recarregam: recarregar recriava `user`, disparava o redirect para a
          // rota inicial e desfazia a troca de empresa.
          await carregarSessao({ manterEmpresaId: useAuthStore.getState().empresaAtiva?.id });
        }
        SplashScreen.hideAsync();
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // Redireciona quando identidade/papel mudam (depende de user?.id, não do objeto
    // `user`: um SIGNED_IN repetido não deve mandar o usuário de volta à home).
    if (user && semEmpresa) { router.replace('/criar-empresa' as any); return; }
    if (user && roleAtivo) {
      const rota = rotaInicial(isOwner ? 'owner' : roleAtivo);
      router.replace(rota as any);
    }
  }, [user?.id, roleAtivo, isOwner, semEmpresa]);

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
      <TapSpark>
        <Stack screenOptions={{ headerShown: false }} />
      </TapSpark>
    </QueryClientProvider>
  );
}
