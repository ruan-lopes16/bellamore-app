import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { Stack, router, SplashScreen } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import * as Crypto from 'expo-crypto';
import { registrarGeradorUuid } from '@shared/uuid';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { rotaInicial } from '@/lib/permissions';
import { sincronizarPushDispositivo, cancelarLembretesLocais, rotaParaNotificacao } from '@/lib/notifications';
import { TapSpark } from '@/components/TapSpark';
import { ErroPermissoes } from '@/components/ErroPermissoes';
import { SemAcesso } from '@/components/SemAcesso';

SplashScreen.preventAutoHideAsync();

// Ids gerados no app (vendas, comandas, agendamentos) com UUID criptográfico: o Hermes não
// tem crypto.randomUUID e, sem isto, shared/uuid.ts cairia em Math.random.
registrarGeradorUuid(() => Crypto.randomUUID());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 2 }, // 2 min cache
  },
});

export default function RootLayout() {
  const { carregarSessao, roleAtivo, isOwner, user, semEmpresa, permissoesErro, empresaAtiva } = useAuthStore();
  const notifListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();

  useEffect(() => {
    // Escuta mudanças de sessão (login / logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!session) {
          // Sessão expirada/encerrada: zera o estado local, senão o efeito de
          // redirecionamento (user/roleAtivo antigos) joga de volta para a home.
          useAuthStore.getState().limparSessao();
          // Sem sessão não dá para tirar o aparelho do servidor; os lembretes locais saem já.
          void cancelarLembretesLocais();
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
    // Ao voltar ao app, relê as permissões (a dona pode ter mudado algo enquanto estava fechado).
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void useAuthStore.getState().recarregarPermissoes();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // Redireciona quando identidade/papel mudam (depende de user?.id, não do objeto
    // `user`: um SIGNED_IN repetido não deve mandar o usuário de volta à home).
    if (user && semEmpresa) { router.replace('/criar-empresa' as any); return; }
    if (user && roleAtivo) {
      const rota = rotaInicial(isOwner ? 'owner' : roleAtivo);
      // Papel desconhecido logado: tela "Sem acesso" (abaixo), nunca o login.
      if (rota !== '/(auth)/login') router.replace(rota as any);
    }
  }, [user?.id, roleAtivo, isOwner, semEmpresa]);

  useEffect(() => {
    // Registra (idempotente) o aparelho na empresa ativa, na abertura e na troca de empresa.
    // Nunca pede permissão aqui: o pedido só sai de "Ativar notificações" (Configurações).
    // Sem permissão concedida: nem push nem lembrete local.
    if (!user || !empresaAtiva) return;
    sincronizarPushDispositivo({ userId: user.id, empresaId: empresaAtiva.id, pedirPermissao: false })
      .catch(() => { /* push é acessório: a falha não trava o app; Configurações mostra o status */ });
  }, [user?.id, empresaAtiva?.id]);

  useEffect(() => {
    if (!user) return;

    // Notificação recebida com app em primeiro plano
    notifListener.current = Notifications.addNotificationReceivedListener(() => {
      queryClient.invalidateQueries({ queryKey: ['notificacoes'] });
    });

    // Usuário tocou em uma notificação
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const tipo = response.notification.request.content.data?.tipo as string | undefined;
        // Área lida na hora do toque (a pessoa pode ter trocado de empresa depois do listener).
        const s = useAuthStore.getState();
        const area = !s.isOwner && s.roleAtivo === 'profissional' ? 'profissional' : 'empresa';
        const rota = rotaParaNotificacao(tipo, area);
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
      {/* Permissões não carregaram: nada liberado, erro com "Tentar de novo" por cima da tela. */}
      {user && permissoesErro && <ErroPermissoes />}
      {/* Logado com papel que o app não conhece: "Sem acesso", não o login. */}
      {user && roleAtivo && !isOwner && rotaInicial(roleAtivo) === '/(auth)/login' && <SemAcesso podeVoltar={false} />}
    </QueryClientProvider>
  );
}
