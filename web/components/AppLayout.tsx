import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Sidebar from '@/components/Sidebar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: membro } = await supabase
    .from('empresa_membros')
    .select('empresa_id, empresa:empresas(id, nome)')
    .eq('user_id', user.id)
    .eq('ativo', true)
    .limit(1)
    .single();
  if (!membro) redirect('/criar-empresa');
  const empresa = membro.empresa as unknown as { id: string; nome: string } | null;
  if (!empresa) redirect('/criar-empresa');

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--color-bg)' }}>
      <Sidebar empresaNome={empresa.nome} />
      {/* Desktop: margin-left da sidebar; Mobile: padding-bottom da bottom nav */}
      <main className="flex-1 md:ml-60 pb-24 md:pb-0 px-4 md:px-8 py-6 md:py-8 bm-page">
        {children}
      </main>
    </div>
  );
}
