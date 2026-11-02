import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { executarCronLembretes } from '@/lib/push/cron-lembretes';

export const dynamic = 'force-dynamic';

/**
 * Motor de lembretes de atendimento. Chamado a cada ~5 min pelo pg_cron
 * (migration 071). Envia 1 push único, 30 min antes de cada atendimento
 * (agendado ou confirmado), pelo web push e pelo app nativo (Expo, só nos
 * aparelhos da mesma empresa — tabela push_dispositivos, migration 097).
 *
 * Idempotente: `agendamentos.lembrete_30min_em` é marcado antes de enviar e
 * só se ainda estiver vazio, então o lembrete nunca repete; cada canal falha
 * sozinho. Regras e testes em `web/lib/push/cron-lembretes.ts`.
 *
 * `EXPO_ACCESS_TOKEN` (opcional) vai no header da Expo quando existe.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { enviados } = await executarCronLembretes({
    db,
    agora: new Date(),
    enviarWeb: (sub, payload) => webpush.sendNotification(sub, payload),
    expoAccessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
  });

  return NextResponse.json({ ok: true, enviados });
}
