import { getAppContext } from '@/lib/auth/server-context';
import { exigirAcesso } from '@/lib/auth/requireRole';

export default async function VendasLayout({ children }: { children: React.ReactNode }) {
  const { permissoes } = await getAppContext();
  exigirAcesso(permissoes, 'vendas.acessar');
  return <>{children}</>;
}
