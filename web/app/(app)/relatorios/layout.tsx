import { getAppContext } from '@/lib/auth/server-context';
import { exigirAcesso } from '@/lib/auth/requireRole';

export default async function RelatoriosLayout({ children }: { children: React.ReactNode }) {
  const { permissoes } = await getAppContext();
  exigirAcesso(permissoes, 'financeiro.ver');
  return <>{children}</>;
}
