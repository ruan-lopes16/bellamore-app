'use client';
import { createContext, useContext, useMemo } from 'react';
import { pode, type Acesso, type PermissoesUsuario } from '@shared/permissoes';

const Ctx = createContext<PermissoesUsuario>({ isOwner: false, papel: null, chaves: [] });

/** Disponibiliza para componentes client as permissões lidas no servidor (getAppContext). */
export function PermissoesProvider({ value, children }: { value: PermissoesUsuario; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Uso: const { pode } = usePermissoes(); if (pode('clientes.arquivar')) ... */
export function usePermissoes() {
  const p = useContext(Ctx);
  return useMemo(() => ({ ...p, pode: (a: Acesso) => pode(p, a) }), [p]);
}
