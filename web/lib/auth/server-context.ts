import { cache } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { COOKIE_EMPRESA_ATIVA } from '@shared/empresa-ativa';
import { resolverEmpresaAtiva, type VinculoAtivo } from '@/lib/auth/empresa-ativa';
import { decidirDestinoSessao } from '@shared/destino-sessao';
import { createClient } from '@/lib/supabase/server';
import { carregarMinhasPermissoes, papelDeRole } from '@shared/permissoes-consultas';
import type { PermissoesUsuario } from '@shared/permissoes';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type AppEmpresaContext = {
  id: string;
  nome: string;
  logo_url: string | null;
  segmento: string | null;
  meta_mensal: number | null;
};

export type AppContext = {
  supabase: SupabaseServerClient;
  user: { id: string };
  empresaId: string;
  role: string | null;
  isOwner: boolean;
  /**
   * `null` = a RPC `minhas_permissoes` falhou: o AppLayout mostra o erro com "Tentar de novo" no
   * lugar da página, `pode(null, …)` é sempre falso e `exigirAcesso` não redireciona.
   */
  permissoes: PermissoesUsuario | null;
  empresa: AppEmpresaContext;
  /** Empresas em que a pessoa tem vínculo ativo (seletor de empresa, só com 2 ou mais). */
  vinculos: { empresa_id: string; nome: string }[];
};

/**
 * A leitura dos vínculos com empresas falhou. Não é "sem sessão" (login) nem "sem empresa"
 * (criar-empresa): o AppLayout captura este erro e mostra "Não foi possível carregar suas empresas".
 */
export class ErroVinculosError extends Error {
  constructor() {
    super('Não foi possível carregar suas empresas.');
    this.name = 'ErroVinculosError';
  }
}

/**
 * `redirect()` do Next.js funciona lançando um erro interno com
 * `digest` começando em "NEXT_REDIRECT" — precisa atravessar o catch abaixo
 * sem ser tratado como falha de sessão, senão o redirect nunca acontece.
 */
function isNextRedirectError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && 'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

export const getAppContext = cache(async (): Promise<AppContext> => {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    // Empresa ativa: cookie `bm_empresa` se for vínculo ativo da pessoa, senão a mais antiga
    // (regra única de shared). Nunca "a primeira que o banco devolveu".
    const cookieStore = await cookies();
    let resolvido: { ativo: VinculoAtivo | null; vinculos: VinculoAtivo[] } | null = null;
    try {
      resolvido = await resolverEmpresaAtiva(supabase, user.id, cookieStore.get(COOKIE_EMPRESA_ATIVA)?.value);
    } catch {
      resolvido = null;
    }
    const destino = decidirDestinoSessao({ temSessao: true, erroVinculos: resolvido === null, temVinculo: !!resolvido?.ativo });
    if (destino === 'erro-vinculos') throw new ErroVinculosError();
    if (destino === 'criar-empresa' || !resolvido?.ativo) redirect('/criar-empresa');
    const { ativo: membro, vinculos } = resolvido;

    const empresa: AppEmpresaContext = membro.empresa;

    const isOwner = membro.role === 'owner';
    const permissoes = await carregarMinhasPermissoes(supabase, membro.empresa_id, isOwner, papelDeRole(membro.role));

    return {
      supabase,
      user: { id: user.id },
      empresaId: membro.empresa_id,
      role: membro.role ?? null,
      isOwner,
      permissoes,
      empresa,
      vinculos: vinculos.map(v => ({ empresa_id: v.empresa_id, nome: v.empresa.nome })),
    };
  } catch (err) {
    if (isNextRedirectError(err)) throw err;
    if (err instanceof ErroVinculosError) throw err;
    // Sessão presente porém inválida (cookie corrompido/expirado — ex.: um
    // app instalado na tela de início do iOS mantém sua própria partição de
    // storage, separada da aba do Safari, e pode carregar uma sessão velha)
    // derrubava a página inteira com "Algo deu errado" em vez de mandar pro
    // login. Trata qualquer erro inesperado aqui como deslogado.
    redirect('/login');
  }
});
