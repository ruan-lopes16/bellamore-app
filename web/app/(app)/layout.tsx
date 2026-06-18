import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Sidebar from '@/components/Sidebar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Resolve empresa via membros — funciona para qualquer role
  const { data: membro } = await supabase
    .from('empresa_membros')
    .select('empresa_id, empresa:empresas(id, nome, logo_url)')
    .eq('user_id', user.id)
    .eq('ativo', true)
    .limit(1)
    .single();
  if (!membro) redirect('/criar-empresa');
  const empresa = membro.empresa as unknown as { id: string; nome: string; logo_url: string | null } | null;
  if (!empresa) redirect('/criar-empresa');

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar empresaNome={empresa.nome} empresaLogo={empresa.logo_url ?? null} />
      <main className="flex-1 ml-60 p-8 min-h-screen">
        {children}
      </main>
    </div>
  );
}
