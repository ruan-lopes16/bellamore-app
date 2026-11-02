/**
 * @file empresa-ativa.ts (web, servidor)
 * Empresa ativa de quem participa de mais de uma empresa: lê os vínculos ativos da pessoa e
 * escolhe pela regra única de `@shared/empresa-ativa` (cookie `bm_empresa` se for vínculo ativo,
 * senão a mais antiga). Usado por `getAppContext`, `GET/POST /api/empresa-ativa` e o push subscribe.
 * Sem imports do Next para ser testável com um client falso.
 */
import { escolherEmpresaAtiva, type VinculoEmpresa } from '@shared/empresa-ativa';

/** Dados da empresa carregados junto com o vínculo (mesmo formato de `AppEmpresaContext`). */
export type EmpresaDoVinculo = {
  id: string;
  nome: string;
  logo_url: string | null;
  segmento: string | null;
  meta_mensal: number | null;
};

/** Vínculo ativo de `empresa_membros` com o papel e a empresa. */
export type VinculoAtivo = VinculoEmpresa & { role: string | null; empresa: EmpresaDoVinculo };

/** O mínimo do client supabase-js usado aqui. */
export interface ClienteDbEmpresaAtiva {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabela: string): any;
}

/**
 * Todos os vínculos ativos da pessoa (com a empresa), em ordem `created_at`, `id`.
 * Vínculo sem empresa visível é descartado. Erro do banco lança (nunca vira "sem empresa").
 */
export async function carregarVinculosAtivos(db: ClienteDbEmpresaAtiva, userId: string): Promise<VinculoAtivo[]> {
  const { data, error } = await db.from('empresa_membros')
    .select('id, empresa_id, role, created_at, empresa:empresas(id, nome, logo_url, segmento, meta_mensal)')
    .eq('user_id', userId).eq('ativo', true)
    .order('created_at', { ascending: true }).order('id', { ascending: true });
  if (error) throw new Error(error.message ?? 'Não foi possível carregar as empresas.');
  return ((data ?? []) as Record<string, unknown>[])
    .filter(l => l.empresa)
    .map(l => ({
      id: String(l.id),
      empresa_id: String(l.empresa_id),
      created_at: (l.created_at as string | null) ?? null,
      role: (l.role as string | null) ?? null,
      empresa: l.empresa as EmpresaDoVinculo,
    }));
}

/** Vínculos da pessoa e o escolhido como ativo (`null` = nenhum vínculo ativo). */
export async function resolverEmpresaAtiva(
  db: ClienteDbEmpresaAtiva, userId: string, preferida: string | null | undefined,
): Promise<{ ativo: VinculoAtivo | null; vinculos: VinculoAtivo[] }> {
  const vinculos = await carregarVinculosAtivos(db, userId);
  return { ativo: escolherEmpresaAtiva(vinculos, preferida), vinculos };
}

/** Opções do cookie `bm_empresa`: httpOnly, sameSite lax, path /, secure em produção, 1 ano. */
export function opcoesCookieEmpresaAtiva(producao: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: producao,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  };
}
