import { cache } from 'react';
import { redirect } from 'next/navigation';
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
  permissoes: PermissoesUsuario;
  empresa: AppEmpresaContext;
};

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

    const { data: membro } = await supabase
      .from('empresa_membros')
      .select('empresa_id, role, empresa:empresas(id, nome, logo_url, segmento, meta_mensal)')
      .eq('user_id', user.id)
      .eq('ativo', true)
      .limit(1)
      .single();

    if (!membro) redirect('/criar-empresa');

    const empresa = membro.empresa as unknown as AppEmpresaContext | null;
    if (!empresa) redirect('/criar-empresa');

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
    };
  } catch (err) {
    if (isNextRedirectError(err)) throw err;
    // Sessão presente porém inválida (cookie corrompido/expirado — ex.: um
    // app instalado na tela de início do iOS mantém sua própria partição de
    // storage, separada da aba do Safari, e pode carregar uma sessão velha)
    // derrubava a página inteira com "Algo deu errado" em vez de mandar pro
    // login. Trata qualquer erro inesperado aqui como deslogado.
    redirect('/login');
  }
});
