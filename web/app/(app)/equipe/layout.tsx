import { getAppContext } from '@/lib/auth/server-context';
import { exigirPermissao } from '@/lib/auth/requireRole';

export default async function EquipeLayout({ children }: { children: React.ReactNode }) {
  const { role } = await getAppContext();
  await exigirPermissao(role, 'gerenciar_profissionais');
  return <>{children}</>;
}
