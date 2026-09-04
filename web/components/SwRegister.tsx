'use client';

import { useEffect } from 'react';

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = window.atob(base64);
  const arr     = new Uint8Array([...raw].map(c => c.charCodeAt(0)));
  return arr.buffer.slice(0) as ArrayBuffer;
}

export function SwRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(async registration => {
        // Aguarda o SW estar ativo antes de subscrever
        await navigator.serviceWorker.ready;

        // Só pede permissão quando o usuário ainda não decidiu — repetir o
        // pedido após um "denied" não reabre o prompt, só gera o aviso do
        // Chrome de permissão bloqueada por dispensa repetida.
        if (Notification.permission === 'denied') return;
        const permission = Notification.permission === 'granted'
          ? 'granted'
          : await Notification.requestPermission();
        if (permission !== 'granted') return;

        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidKey) return;

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

        await fetch('/api/push/subscribe', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(subscription),
        });
      })
      .catch(() => {});
  }, []);

  return null;
}
