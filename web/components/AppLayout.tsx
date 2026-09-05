import { getAppContext } from '@/lib/auth/server-context';
import Sidebar from '@/components/Sidebar';
import { PrivacyProvider, PRIVACY_NOFLASH_SCRIPT } from '@/components/privacy';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { empresa, empresaId, role } = await getAppContext();

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--color-bg)' }}>
      <script dangerouslySetInnerHTML={{ __html: PRIVACY_NOFLASH_SCRIPT }} />
      <Sidebar
        empresaId={empresaId}
        empresaNome={empresa.nome}
        empresaLogo={empresa.logo_url ?? null}
        empresaSegmento={empresa.segmento ?? 'Estúdio'}
        role={role}
      />
      {/* Desktop: margin-left da sidebar. Mobile: a bottom nav come o rodape e a
          status bar translucida come o topo, entao os dois lados reservam a
          safe area em vez de usar um padding fixo.
          overflow-y-visible é explícito (não só a ausência da classe): por spec,
          "overflow-x: hidden" sozinho faz o overflow-y computado virar "auto" em
          vez de "visible" quando o eixo oposto não é declarado. Isso transformava
          este <main> num scroll container de verdade — e no iOS Safari um
          scroll container aninhado entre <body> e um modal position:fixed quebra
          o fixed (o modal passa a se mover/voltar com o toque, "elástico", em vez
          de ficar preso à tela). Sem efeito visual: este <main> nunca precisou
          rolar por conta própria, a altura sempre acompanha o conteúdo. */}
      <main className="flex-1 md:ml-60 pt-[var(--bm-mobile-content-top)] md:pt-8 pb-[var(--bm-mobile-content-bottom)] md:pb-10 px-4 md:px-8 bm-page overflow-x-hidden overflow-y-visible min-w-0">
        <PrivacyProvider>{children}</PrivacyProvider>
      </main>
    </div>
  );
}
