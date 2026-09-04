import AppLayout from '@/components/AppLayout';
import { SwRegister, BotaoAtivarNotificacoes } from '@/components/SwRegister';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppLayout>{children}</AppLayout>
      {/* Só faz sentido registrar push com uma sessão logada — por isso vive
          aqui (área autenticada) e não no layout raiz, que também cobre
          /login. Tentar inscrever antes do login sempre dava 401. */}
      <SwRegister />
      <BotaoAtivarNotificacoes />
    </>
  );
}
