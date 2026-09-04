import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { corpoResumoDiario } from '@shared/lembretes';

export const dynamic = 'force-dynamic';

/**
 * Resumo diário. Chamado 1x/dia pelo pg_cron (migration 067, 07:00 BRT).
 * Um push por empresa com: nº de atendimentos do dia, despesas que vencem
 * hoje e produtos com estoque baixo. Se não há nada a reportar, não envia.
 *
 * Grava 1 linha em notificacoes por membro ativo (tipo 'resumo') — a
 * migration 068 apaga essas linhas na madrugada seguinte.
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

  // "Hoje" em America/Sao_Paulo, como YYYY-MM-DD
  const hojeStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const inicioHoje = `${hojeStr}T00:00:00-03:00`;
  const fimHoje    = `${hojeStr}T23:59:59-03:00`;

  const { data: empresas } = await db.from('empresas').select('id').eq('ativo', true);

  let enviados = 0;

  for (const empresa of empresas ?? []) {
    const empId = empresa.id;

    const [{ count: nAgs }, { data: despVenc }, { data: estoque }, { data: membros }, { data: subs }] = await Promise.all([
      db.from('agendamentos').select('id', { count: 'exact', head: true })
        .eq('empresa_id', empId)
        .gte('data_hora_inicio', inicioHoje).lte('data_hora_inicio', fimHoje)
        .in('status', ['agendado', 'confirmado']),
      db.from('despesas').select('id')
        .eq('empresa_id', empId).eq('status', 'pendente')
        .eq('data_vencimento', hojeStr),
      db.from('v_produtos_estoque_baixo').select('id').eq('empresa_id', empId).eq('ativo', true),
      db.from('empresa_membros').select('user_id').eq('empresa_id', empId).eq('ativo', true),
      db.from('web_push_subscriptions').select('endpoint, p256dh, auth').eq('empresa_id', empId),
    ]);

    const body = corpoResumoDiario({
      agendamentos: nAgs ?? 0,
      despesasVencendo: (despVenc ?? []).length,
      estoqueBaixo: (estoque ?? []).length,
    });
    if (!body) continue;

    for (const sub of (subs ?? []) as { endpoint: string; p256dh: string; auth: string }[]) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: 'Resumo do dia ✦', body, url: '/dashboard' }),
        );
        enviados++;
      } catch {
        await db.from('web_push_subscriptions').delete().eq('endpoint', sub.endpoint);
      }
    }

    const linhas = (membros ?? []).map(m => ({
      user_id: m.user_id, empresa_id: empId, tipo: 'resumo', titulo: 'Resumo do dia', mensagem: body,
    }));
    if (linhas.length) await db.from('notificacoes').insert(linhas);
  }

  return NextResponse.json({ ok: true, enviados });
}
