'use client';

import { useEffect } from 'react';

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = window.atob(base64);
  const arr     = new Uint8Array([...raw].map(c => c.charCodeAt(0)));
  return arr.buffer.slice(0) as ArrayBuffer;
}

/**
 * Registra o Service Worker (se preciso) e garante uma inscrição de push
 * sincronizada com o servidor. Usada tanto pelo auto-registro silencioso
 * (`SwRegister`, quando a permissão já foi concedida) quanto pelo controle
 * em Configurações (`web/app/(app)/configuracoes/page.tsx`), que chama
 * `Notification.requestPermission()` primeiro, no clique do usuário.
 */
export async function registrarEInscrever(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return;

  // Reaproveita a inscrição do dispositivo ou cria uma nova, e SEMPRE
  // re-sincroniza com o servidor. O upsert em /api/push/subscribe é barato e
  // idempotente; sem isso, um dispositivo que se inscreveu mas falhou ao
  // salvar no banco ficava invisível para o envio de push para sempre.
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
}

/**
 * Registra o Service Worker e (re)sincroniza a inscrição de push
 * automaticamente — mas SÓ quando a permissão já foi concedida antes. No
 * Safari/iOS, chamar `Notification.requestPermission()` fora de um gesto
 * direto do usuário (ex.: dentro de um useEffect, ao carregar a página) é
 * negado silenciosamente: nenhum popup do sistema aparece, o app nem chega
 * a ser listado em Ajustes > Notificações, e `Notification.permission` vira
 * "denied" sem o usuário nunca ter visto nada. O pedido de permissão em si
 * só acontece no clique do controle em Configurações (ver
 * `web/app/(app)/configuracoes/page.tsx`).
 */
export function SwRegister() {
  useEffect(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    registrarEInscrever().catch(() => {});
  }, []);

  return null;
}
