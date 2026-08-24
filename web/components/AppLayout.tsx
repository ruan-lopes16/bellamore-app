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
      {/* Desktop: margin-left da sidebar. Mobile: a bottom nav come o rodape e a
          status bar translucida come o topo, entao os dois lados reservam a
          safe area em vez de usar um padding fixo. */}
      <main className="flex-1 md:ml-60 pt-[var(--bm-mobile-content-top)] md:pt-8 pb-[var(--bm-mobile-content-bottom)] md:pb-10 px-4 md:px-8 bm-page overflow-x-hidden min-w-0">
        {children}
      </main>
    </div>
  );
}
