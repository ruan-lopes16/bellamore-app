import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { hojeBRT } from '@shared/periodos';
import { executarCronResumo } from '@/lib/push/cron-resumo';

export const dynamic = 'force-dynamic';

/**
 * Resumo diário. Chamado 1x/dia pelo pg_cron (migration 071, 07:00 BRT).
 * Conteúdo por papel e por permissão:
 * - owner/gestor: visão da empresa — nº de atendimentos do dia, despesas
 *   vencendo hoje (só com `financeiro.ver`) e estoque baixo (só com
 *   `estoque.acessar`).
 * - profissional: visão pessoal — nº de atendimentos dela hoje e quanto ela
 *   já comissionou hoje (mais despesas/estoque, se tiver essas permissões).
 * Quem não tem nada a reportar, ou desligou `users.notif_resumo_diario`
 * (migration 077), não recebe push nem linha em notificacoes.
 *
 * Envia pelo web push e pelo app nativo (Expo, só nos aparelhos da mesma
 * empresa; sem a 097, `users.push_token` só leitura). Regras e testes em
 * `web/lib/push/cron-resumo.ts`. A migration 072 apaga as linhas 'resumo'
 * de notificacoes na madrugada seguinte.
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

  // "Hoje" em Brasília (YYYY-MM-DD), pela fonte única de períodos.
  const { enviados } = await executarCronResumo({
    db,
    hoje: hojeBRT(),
    enviarWeb: (sub, payload) => webpush.sendNotification(sub, payload),
    expoAccessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
  });

  return NextResponse.json({ ok: true, enviados });
}
