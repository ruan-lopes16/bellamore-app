import { useMemo } from 'react';
import { PerfilRole } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { pode, type Acesso } from '@shared/permissoes';

export { pode };
export type { Acesso };

/** `const { pode } = usePermissoes(); if (pode('clientes.arquivar')) ...` */
export function usePermissoes() {
  const p = useAuthStore(s => s.permissoes);
  const permissoesCarregadas = useAuthStore(s => s.permissoesCarregadas);
  return useMemo(() => ({ ...p, permissoesCarregadas, pode: (a: Acesso) => pode(p, a) }), [p, permissoesCarregadas]);
}

// Retorna a rota inicial baseada no perfil
export function rotaInicial(role: PerfilRole | 'owner'): string {
  switch (role) {
    case 'owner':
    case 'gestor':
      return '/(empresa)/dashboard';
    case 'profissional':
      return '/(profissional)/inicio';
    default:
      return '/(auth)/login';
  }
}

export function podeAtribuirRole(
  quemConvida: 'owner' | PerfilRole,
  roleAlvo: 'gestor' | 'profissional'
): boolean {
  if (roleAlvo === 'gestor') return quemConvida === 'owner';
  return quemConvida === 'owner' || quemConvida === 'gestor';
}
