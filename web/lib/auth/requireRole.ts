import { redirect } from 'next/navigation';
import type { PerfilRole } from '@/types';
import { temPermissao, rotaInicial, type Permissao } from '@/lib/permissions';

export async function exigirPermissao(role: string | null, permissao: Permissao) {
  const efetivo = (role ?? 'profissional') as 'owner' | PerfilRole;
  if (!temPermissao(efetivo, permissao)) {
    redirect(rotaInicial(efetivo));
  }
}
