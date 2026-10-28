'use client';
import { createContext, useContext } from 'react';

/** Empresa ativa resolvida no servidor (`getAppContext`), disponível para as telas client. */
export type EmpresaAtiva = {
  empresaId: string;
  role: string | null;
  isOwner: boolean;
};

const Ctx = createContext<EmpresaAtiva | null>(null);

/** Fornecido pelo AppLayout: a mesma empresa que o servidor escolheu (cookie `bm_empresa` validado). */
export function EmpresaAtivaProvider({ value, children }: { value: EmpresaAtiva; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Empresa ativa da pessoa logada. Substitui as consultas `.limit(1)` em `empresa_membros`, que
 * pegavam uma empresa qualquer de quem participa de mais de uma.
 * Uso: `const { empresaId } = useEmpresaAtiva();`
 */
export function useEmpresaAtiva(): EmpresaAtiva {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEmpresaAtiva fora do EmpresaAtivaProvider.');
  return v;
}

/**
 * Troca a empresa ativa (grava o cookie pelo servidor, que valida o vínculo). Lança com a
 * mensagem da API se não der. Quem chama recarrega a página depois.
 */
export async function trocarEmpresaAtiva(empresaId: string): Promise<void> {
  const res = await fetch('/api/empresa-ativa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ empresaId }),
  });
  if (!res.ok) {
    const corpo = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(corpo?.error ?? 'Não foi possível trocar de empresa.');
  }
}
