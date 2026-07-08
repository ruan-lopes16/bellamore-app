import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

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
  empresa: AppEmpresaContext;
};

export const getAppContext = cache(async (): Promise<AppContext> => {
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

  return {
    supabase,
    user: { id: user.id },
    empresaId: membro.empresa_id,
    role: membro.role ?? null,
    empresa,
  };
});
