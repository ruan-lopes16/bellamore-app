import { getAppContext } from '@/lib/auth/server-context';
import { exigirPermissao } from '@/lib/auth/requireRole';

export default async function ServicosLayout({ children }: { children: React.ReactNode }) {
  const { role } = await getAppContext();
  await exigirPermissao(role, 'ver_servicos');
  return <>{children}</>;
}
