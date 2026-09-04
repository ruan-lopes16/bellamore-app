import type { Metadata, Viewport } from 'next';
import { Fraunces, Plus_Jakarta_Sans } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';
import { Providers } from './providers';
import { SwRegister, BotaoAtivarNotificacoes } from '@/components/SwRegister';
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

// DIAGNÓSTICO TEMPORÁRIO — roda inteiramente fora do React (script síncrono
// direto no body), registrando cada etapa numa faixa fixa na tela. O alerta
// anterior dentro do SwRegister (React) nunca apareceu ao abrir pelo ícone
// da tela de início do iOS, mesmo com o crash de Server Component já
// corrigido — isso sugere que algo trava depois da hidratação do React ou
// dentro dela. Este script também captura window.onerror/unhandledrejection
// (que o React normalmente engole em produção) e refaz o fluxo completo de
// registro do Service Worker + pedido de permissão + inscrição, sem passar
// pelo React, pra isolar se o problema é a API do navegador ou o próprio
// React nesse contexto. Remover depois que a causa for confirmada.
const VAPID_KEY_DEBUG = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const BANNER_DIAGNOSTICO = `
(function () {
  var VAPID = ${JSON.stringify(VAPID_KEY_DEBUG)};
  var linhas = [];
  var painel = null;
  function desenha() {
    if (!painel) {
      painel = document.createElement('div');
      painel.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#111;color:#0f0;font:10px monospace;padding:8px;white-space:pre-wrap;max-height:70vh;overflow:auto;';
      painel.onclick = function () { painel.remove(); painel = null; };
      document.body.appendChild(painel);
    }
    painel.textContent = 'DIAG PUSH:\\n' + linhas.join('\\n');
  }
  function log(msg) {
    linhas.push(String(msg));
    if (document.body) desenha(); else document.addEventListener('DOMContentLoaded', desenha);
  }

  window.addEventListener('error', function (e) {
    log('ERRO GLOBAL: ' + (e.message || e.error) + ' @ ' + (e.filename || '?') + ':' + (e.lineno || '?'));
  });
  window.addEventListener('unhandledrejection', function (e) {
    log('PROMISE REJEITADA: ' + (e.reason && (e.reason.message || e.reason)));
  });

  function b64ToArray(base64) {
    var padding = '='.repeat((4 - (base64.length % 4)) % 4);
    var b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = window.atob(b64);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  log('cap: sw=' + ('serviceWorker' in navigator) + ' push=' + ('PushManager' in window) + ' notif=' + (typeof Notification !== 'undefined') + ' perm=' + (typeof Notification !== 'undefined' ? Notification.permission : '-') + ' standalone=' + navigator.standalone + ' vapid=' + (VAPID.length > 0));

  (async function () {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) { log('parou: sem serviceWorker/PushManager'); return; }
      log('registrando SW...');
      var reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      log('SW registrado, aguardando ready...');
      await navigator.serviceWorker.ready;
      log('SW pronto. Permissão atual: ' + Notification.permission);
      if (Notification.permission === 'denied') { log('parou: permissão negada antes'); return; }
      var permissao = Notification.permission;
      if (permissao !== 'granted') {
        log('chamando requestPermission()...');
        permissao = await Notification.requestPermission();
        log('requestPermission() retornou: ' + permissao);
      }
      if (permissao !== 'granted') { log('parou: permissão não concedida (' + permissao + ')'); return; }
      if (!VAPID) { log('parou: sem VAPID key'); return; }
      log('obtendo/criando subscription...');
      var sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToArray(VAPID) });
        log('subscription criada.');
      } else {
        log('subscription já existia.');
      }
      log('enviando ao servidor...');
      var resp = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
      log('servidor respondeu: ' + resp.status);
    } catch (err) {
      log('EXCEÇÃO: ' + (err && (err.message || err)) + (err && err.stack ? (' | ' + String(err.stack).slice(0,200)) : ''));
    }
  })();
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
        <BotaoAtivarNotificacoes />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
