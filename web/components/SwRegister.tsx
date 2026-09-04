'use client';

import { useEffect, useState } from 'react';

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = window.atob(base64);
  const arr     = new Uint8Array([...raw].map(c => c.charCodeAt(0)));
  return arr.buffer.slice(0) as ArrayBuffer;
}

// DIAGNÓSTICO TEMPORÁRIO — remover assim que a inscrição de push for
// confirmada funcionando ponta a ponta num dispositivo novo.
function diagnosticoPush(dados: Record<string, unknown>) {
  alert('Diagnóstico push (' + (typeof navigator !== 'undefined' && (navigator as any).standalone ? 'standalone' : 'aba') + '):\n' + JSON.stringify(dados, null, 2));
}

async function registrarEInscrever(): Promise<{ ok: boolean; motivo?: string; status?: number }> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, motivo: 'sem serviceWorker/PushManager' };
  }
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return { ok: false, motivo: 'sem VAPID key' };

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

  const resp = await fetch('/api/push/subscribe', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(subscription),
  });
  return { ok: resp.ok, status: resp.status };
}

/**
 * Registra o Service Worker e (re)sincroniza a inscrição de push
 * automaticamente — mas SÓ quando a permissão já foi concedida antes. No
 * Safari/iOS, chamar `Notification.requestPermission()` fora de um gesto
 * direto do usuário (ex.: dentro de um useEffect, ao carregar a página) é
 * negado silenciosamente: nenhum popup do sistema aparece, o app nem chega
 * a ser listado em Ajustes > Notificações, e `Notification.permission` vira
 * "denied" sem o usuário nunca ter visto nada — foi exatamente isso que
 * impedia qualquer inscrição nova de funcionar. O pedido de permissão em si
 * agora só acontece no clique do botão em `BotaoAtivarNotificacoes`, abaixo.
 */
export function SwRegister() {
  useEffect(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    registrarEInscrever().catch(() => {});
  }, []);

  return null;
}

/**
 * Botão flutuante "Ativar notificações" — só aparece quando a permissão
 * ainda não foi decidida (`default`). Chama `Notification.requestPermission()`
 * como a primeira coisa dentro do handler de clique, preservando o gesto do
 * usuário exigido pelo Safari/iOS para o popup do sistema aparecer de verdade.
 */
export function BotaoAtivarNotificacoes() {
  const [visivel,  setVisivel]  = useState(false);
  const [ativando, setAtivando] = useState(false);

  useEffect(() => {
    const apto = 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
    setVisivel(apto && Notification.permission === 'default');
  }, []);

  async function ativar() {
    setAtivando(true);
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== 'granted') {
        diagnosticoPush({ etapa: 'botão: permissão não concedida', resultadoPrompt: permissao });
        setVisivel(false);
        return;
      }
      const resultado = await registrarEInscrever();
      diagnosticoPush({ etapa: 'botão: fluxo concluído', ...resultado });
      setVisivel(false);
    } catch (err) {
      diagnosticoPush({ etapa: 'botão: exceção', erro: String(err) });
    } finally {
      setAtivando(false);
    }
  }

  if (!visivel) return null;

  return (
    <button
      onClick={ativar}
      disabled={ativando}
      style={{
        position: 'fixed', left: 16, right: 16, bottom: 'calc(84px + env(safe-area-inset-bottom))',
        zIndex: 9998, height: 48, borderRadius: 16,
        background: 'var(--color-primary, #2C1654)', color: '#fff',
        fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700,
        border: 'none', boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
        opacity: ativando ? 0.7 : 1,
      }}
    >
      {ativando ? 'Ativando…' : '🔔 Ativar notificações de atendimento'}
    </button>
  );
}
