'use client';
import { createContext, useContext, useMemo } from 'react';
import { pode, type Acesso, type PermissoesUsuario } from '@shared/permissoes';

/** Sem permissões carregadas: nada liberado. */
const SEM_PERMISSOES: PermissoesUsuario = { isOwner: false, papel: null, chaves: [] };

const Ctx = createContext<PermissoesUsuario>(SEM_PERMISSOES);

/**
 * Disponibiliza para componentes client as permissões lidas no servidor (getAppContext).
 * `null` (RPC falhou) vira "nada liberado" — o AppLayout já mostra o erro no lugar da página.
 */
export function PermissoesProvider({ value, children }: { value: PermissoesUsuario | null; children: React.ReactNode }) {
  return <Ctx.Provider value={value ?? SEM_PERMISSOES}>{children}</Ctx.Provider>;
}

/** Uso: const { pode } = usePermissoes(); if (pode('clientes.arquivar')) ... */
export function usePermissoes() {
  const p = useContext(Ctx);
  return useMemo(() => ({ ...p, pode: (a: Acesso) => pode(p, a) }), [p]);
}
