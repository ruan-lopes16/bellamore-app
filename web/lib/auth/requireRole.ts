import { redirect } from 'next/navigation';
import { pode, type Acesso, type PermissoesUsuario } from '@/lib/permissions';

/** Redireciona para o Dashboard (liberado a todos) quando a pessoa não tem o acesso. */
export function exigirAcesso(permissoes: PermissoesUsuario, acesso: Acesso): void {
  if (!pode(permissoes, acesso)) redirect('/dashboard');
}
