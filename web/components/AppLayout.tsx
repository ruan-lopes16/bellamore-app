import { getAppContext } from '@/lib/auth/server-context';
import Sidebar from '@/components/Sidebar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { empresa, empresaId, role } = await getAppContext();

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--color-bg)' }}>
      <Sidebar
        empresaId={empresaId}
        empresaNome={empresa.nome}
        empresaLogo={empresa.logo_url ?? null}
        empresaSegmento={empresa.segmento ?? 'Estúdio'}
        role={role}
      />
      {/* Desktop: margin-left da sidebar; Mobile: padding-bottom da bottom nav */}
      <main className="flex-1 md:ml-60 pb-[var(--bm-mobile-content-bottom)] md:pb-10 px-4 md:px-8 py-6 md:py-8 bm-page overflow-x-hidden min-w-0">
        {children}
      </main>
    </div>
  );
}
