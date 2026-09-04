'use client';

import { useEffect } from 'react';

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = window.atob(base64);
  const arr     = new Uint8Array([...raw].map(c => c.charCodeAt(0)));
  return arr.buffer.slice(0) as ArrayBuffer;
}

// DIAGNÓSTICO TEMPORÁRIO — remover assim que o problema de push no iOS for
// identificado. Mostra 1x por navegador (localStorage) as flags de suporte
// e o resultado real do fluxo, porque o iOS instalado não estava nem
// exibindo o prompt de permissão e não há devtools remoto disponível.
function diagnosticoPush(dados: Record<string, unknown>) {
  // Sem trava de "1x só": Safari (aba) e o app instalado na tela de início
  // compartilham o mesmo localStorage (mesma origem), então uma trava global
  // impedia ver o diagnóstico do segundo contexto depois de já ter visto o
  // primeiro. Sempre mostra enquanto este código de debug estiver no ar.
  alert('Diagnóstico push (' + (typeof navigator !== 'undefined' && (navigator as any).standalone ? 'standalone' : 'aba') + '):\n' + JSON.stringify(dados, null, 2));
}

export function SwRegister() {
  useEffect(() => {
    const caps = {
      serviceWorker: 'serviceWorker' in navigator,
      pushManager:   'PushManager' in window,
      notification:  typeof Notification !== 'undefined',
      permissao:     typeof Notification !== 'undefined' ? Notification.permission : 'sem-api',
      standalone:    (navigator as any).standalone ?? 'indefinido',
      vapidPresente: !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    };

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      diagnosticoPush({ ...caps, etapa: 'saiu antes de registrar o SW (falta serviceWorker ou PushManager)' });
      return;
    }

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(async registration => {
        // Aguarda o SW estar ativo antes de subscrever
        await navigator.serviceWorker.ready;

        // Só pede permissão quando o usuário ainda não decidiu — repetir o
        // pedido após um "denied" não reabre o prompt, só gera o aviso do
        // Chrome de permissão bloqueada por dispensa repetida.
        if (Notification.permission === 'denied') {
          diagnosticoPush({ ...caps, etapa: 'permissão já negada antes' });
          return;
        }
        const permission = Notification.permission === 'granted'
          ? 'granted'
          : await Notification.requestPermission();
        if (permission !== 'granted') {
          diagnosticoPush({ ...caps, etapa: 'permissão não concedida', resultadoPrompt: permission });
          return;
        }

        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidKey) {
          diagnosticoPush({ ...caps, etapa: 'sem NEXT_PUBLIC_VAPID_PUBLIC_KEY no build' });
          return;
        }

        // Reaproveita a inscrição do dispositivo ou cria uma nova, e SEMPRE
        // re-sincroniza com o servidor. O upsert em /api/push/subscribe é
        // barato e idempotente; sem esta re-sincronização, um dispositivo que
        // chegou a se inscrever mas falhou ao salvar no banco (rede, etc.)
        // ficava invisível para o envio de push para sempre, porque a versão
        // anterior abortava assim que encontrava uma inscrição local.
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            userVisibleOnly:      true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey),
          }));

        const resp = await fetch('/api/push/subscribe', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(subscription),
        });
        diagnosticoPush({ ...caps, etapa: 'inscrição enviada ao servidor', statusResposta: resp.status });
      })
      .catch(err => {
        diagnosticoPush({ ...caps, etapa: 'erro na cadeia de registro/inscrição', erro: String(err) });
      });
  }, []);

  return null;
}
