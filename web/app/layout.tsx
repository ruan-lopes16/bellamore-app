import type { Metadata } from 'next';
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
  icons: { icon: '/favicon.svg' },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable:       true,
    statusBarStyle: 'black-translucent',
    title:         'Bellamore',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${fraunces.variable} ${jakarta.variable} h-full`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
        <ClickSpark />
        <SwRegister />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
