import type { PerfilRole } from '@/types';
export { pode } from '@shared/permissoes';
export type { Acesso, PermissoesUsuario, ChavePermissao } from '@shared/permissoes';

export function rotaInicial(role: PerfilRole | 'owner'): string {
  switch (role) {
    case 'owner':
    case 'gestor':
    case 'profissional': return '/dashboard';
    default:            return '/login';
  }
}

/**
 * Papel que quem convida/cadastra pode dar (fixo, fora do catálogo): só a dona cria gestora. Papel
 * Profissional fica liberado para qualquer um que já passou por `equipe.gerenciar` — inclusive a
 * profissional que recebeu essa exceção. Passe `'owner'` quando `isOwner` (dono da empresa), mesmo que o
 * vínculo dela diga outro papel.
 */
export function podeAtribuirRole(
  quemConvida: 'owner' | PerfilRole,
  roleAlvo: 'gestor' | 'profissional',
): boolean {
  if (roleAlvo === 'gestor') return quemConvida === 'owner';
  return true;
}
