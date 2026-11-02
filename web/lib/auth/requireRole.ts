import { redirect } from 'next/navigation';
import { pode, type Acesso, type PermissoesUsuario } from '@/lib/permissions';

/**
 * Redireciona para o Dashboard (liberado a todos) quando a pessoa não tem o acesso.
 * Permissões `null` (RPC falhou): não redireciona — o AppLayout já troca a página pelo erro com
 * "Tentar de novo", e a pessoa continua na mesma rota ao tentar de novo.
 */
export function exigirAcesso(permissoes: PermissoesUsuario | null, acesso: Acesso): void {
  if (!permissoes) return;
  if (!pode(permissoes, acesso)) redirect('/dashboard');
}
