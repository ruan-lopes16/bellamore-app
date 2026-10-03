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

/** Mudar/atribuir papel é fixo (fora do catálogo): gestora só convida profissional. */
export function podeAtribuirRole(
  quemConvida: 'owner' | PerfilRole,
  roleAlvo: 'gestor' | 'profissional',
): boolean {
  if (roleAlvo === 'gestor') return quemConvida === 'owner';
  return quemConvida === 'owner' || quemConvida === 'gestor';
}
