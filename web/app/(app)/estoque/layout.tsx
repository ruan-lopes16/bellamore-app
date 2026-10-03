import { getAppContext } from '@/lib/auth/server-context';
import { exigirAcesso } from '@/lib/auth/requireRole';

export default async function EstoqueLayout({ children }: { children: React.ReactNode }) {
  const { permissoes } = await getAppContext();
  exigirAcesso(permissoes, 'estoque.acessar');
  return <>{children}</>;
}
