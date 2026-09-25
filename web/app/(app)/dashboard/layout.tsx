import { redirect } from 'next/navigation';
import { getAppContext } from '@/lib/auth/server-context';
import { temPermissao, rotaInicial } from '@/lib/permissions';
import type { PerfilRole } from '@/types';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { role } = await getAppContext();
  const efetivo = (role ?? 'profissional') as 'owner' | PerfilRole;
  const podeAcessar = temPermissao(efetivo, 'ver_resumo_financeiro') || temPermissao(efetivo, 'ver_proprios_agendamentos');
  if (!podeAcessar) redirect(rotaInicial(efetivo));
  return <>{children}</>;
}
