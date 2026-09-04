import type { Metadata, Viewport } from 'next';
import { Fraunces, Plus_Jakarta_Sans } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';
import { Providers } from './providers';
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${fraunces.variable} ${jakarta.variable} h-full`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
        <ClickSpark />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
