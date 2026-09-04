import type { Metadata, Viewport } from 'next';
import { Fraunces, Plus_Jakarta_Sans } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';
import { Providers } from './providers';
import { SwRegister } from '@/components/SwRegister';
import { ClickSpark } from '@/components/ClickSpark';

const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
});

const jakarta = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Bellamore',
  description: 'Gestão de salões e estúdios de estética',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable:       true,
    statusBarStyle: 'black-translucent',
    title:         'Bellamore',
  },
};

/**
 * maximumScale + userScalable desligam o pinch-zoom. O iOS ignora os dois no
 * Safari em aba normal (decisao de acessibilidade da Apple desde o iOS 10), mas
 * respeita no PWA instalado na tela de inicio — que e como o app e usado. Quem
 * de fato resolve o zoom de foco em todos os contextos e a regra de 16px em
 * globals.css; isto aqui e reforco.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

// DIAGNÓSTICO TEMPORÁRIO — banner fixo escrito direto no DOM via <script>,
// sem depender de React/hidratação nem de alert(). O diagnóstico anterior
// (alert() dentro do SwRegister) nunca apareceu quando o app era aberto pelo
// ícone da tela de início do iOS, mesmo depois de corrigido o crash do
// Server Component — isso sugere que a hidratação do React (ou o próprio
// alert()) pode não estar completando nesse contexto específico. Este script
// roda de forma síncrona assim que o body existe, antes de qualquer
// JS de framework, e escreve um banner que fica preso na tela (sem precisar
// de toque para aparecer, ao contrário do alert()). Remover depois.
const BANNER_DIAGNOSTICO = `
(function () {
  function le() {
    var d = {
      serviceWorker: 'serviceWorker' in navigator,
      pushManager: 'PushManager' in window,
      notification: typeof Notification !== 'undefined',
      permissao: typeof Notification !== 'undefined' ? Notification.permission : 'sem-api',
      standalone: (navigator.standalone === true) ? true : (navigator.standalone === false ? false : 'indefinido'),
      displayModeStandalone: (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || false,
      ua: navigator.userAgent.slice(0, 60),
    };
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#111;color:#0f0;font:11px monospace;padding:10px;white-space:pre-wrap;max-height:60vh;overflow:auto;';
    el.textContent = 'DIAG PUSH (banner):\\n' + JSON.stringify(d, null, 1);
    el.onclick = function () { el.remove(); };
    document.body.appendChild(el);
  }
  if (document.body) { le(); } else { document.addEventListener('DOMContentLoaded', le); }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${fraunces.variable} ${jakarta.variable} h-full`}>
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: BANNER_DIAGNOSTICO }} />
        <Providers>{children}</Providers>
        <ClickSpark />
        <SwRegister />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
