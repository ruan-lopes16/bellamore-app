/**
 * @file empresa-ativa.ts
 * Empresa escolhida por quem participa de mais de uma empresa, igual em web e app.
 * - Web: cookie `bm_empresa` (gravado por `POST /api/empresa-ativa` depois de validar o vínculo).
 * - App: AsyncStorage `bm_empresa` (lido em `carregarSessao`).
 * O valor guardado é só uma preferência: vale apenas se for um vínculo ativo da pessoa.
 * Senão cai na empresa mais antiga, sempre a mesma (nunca "a primeira que o banco devolveu").
 */

/** Nome do cookie do web com o id da empresa escolhida. */
export const COOKIE_EMPRESA_ATIVA = 'bm_empresa';

/** Chave do AsyncStorage do app com o id da empresa escolhida (mesmo nome do cookie). */
export const STORAGE_EMPRESA_ATIVA = COOKIE_EMPRESA_ATIVA;

/** O mínimo de uma linha de `empresa_membros` para escolher a empresa. */
export type VinculoEmpresa = {
  id: string;
  empresa_id: string;
  created_at?: string | null;
  /** Ausente = ativo (a consulta normalmente já filtra `ativo = true`). */
  ativo?: boolean | null;
};

function instante(ts: string | null | undefined): number {
  if (!ts) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/**
 * Empresa ativa da pessoa: a `preferida` (cookie/AsyncStorage) se for um vínculo ativo dela;
 * senão a mais antiga (`created_at`, depois `id`). Sem vínculo ativo → `null`.
 * Determinística: a mesma lista em qualquer ordem dá a mesma resposta.
 */
export function escolherEmpresaAtiva<T extends VinculoEmpresa>(
  vinculos: readonly T[], preferida: string | null | undefined,
): T | null {
  const ativos = vinculos.filter(v => v.ativo !== false);
  if (ativos.length === 0) return null;
  if (preferida) {
    const p = ativos.find(v => v.empresa_id === preferida);
    if (p) return p;
  }
  return [...ativos].sort((a, b) => {
    const d = instante(a.created_at) - instante(b.created_at);
    if (d !== 0 && !Number.isNaN(d)) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}

/** O mínimo do client supabase-js usado por `temVinculoAtivo`. */
export interface ClienteDbVinculo {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabela: string): any;
}

/**
 * A pessoa já participa de alguma empresa (vínculo ativo em `empresa_membros` ou dona de empresa
 * ativa)? Usado antes de criar empresa: a RPC `criar_empresa_completo` não confere isso, e uma
 * 2ª empresa por engano só se evita aqui.
 * @throws Error se a leitura falhar — nunca vira "sem empresa".
 */
export async function temVinculoAtivo(db: ClienteDbVinculo, userId: string): Promise<boolean> {
  const [membros, donas] = await Promise.all([
    db.from('empresa_membros').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('ativo', true),
    db.from('empresas').select('id', { count: 'exact', head: true }).eq('owner_id', userId).eq('ativo', true),
  ]);
  if (membros.error || donas.error) throw new Error('Não foi possível conferir suas empresas. Confira a conexão e tente de novo.');
  return (membros.count ?? 0) + (donas.count ?? 0) > 0;
}
