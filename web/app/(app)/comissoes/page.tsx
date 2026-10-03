import { getAppContext } from '@/lib/auth/server-context';
import { pode } from '@/lib/permissions';
import ComissoesGestorView from './ComissoesGestorView';
import ComissoesProfissionalView from './ComissoesProfissionalView';

export default async function ComissoesPage() {
  const { permissoes } = await getAppContext();
  return pode(permissoes, 'comissoes.ver_todas') ? <ComissoesGestorView /> : <ComissoesProfissionalView />;
}
