import { getAppContext } from '@/lib/auth/server-context';
import { exigirAcesso } from '@/lib/auth/requireRole';

export default async function EquipeLayout({ children }: { children: React.ReactNode }) {
  const { permissoes } = await getAppContext();
  exigirAcesso(permissoes, 'equipe.gerenciar');
  return <>{children}</>;
}
