import { getAppContext } from '@/lib/auth/server-context';
import ComissoesGestorView from './ComissoesGestorView';
import ComissoesProfissionalView from './ComissoesProfissionalView';

export default async function ComissoesPage() {
  const { role } = await getAppContext();
  return role === 'profissional' ? <ComissoesProfissionalView /> : <ComissoesGestorView />;
}
