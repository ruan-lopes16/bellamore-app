import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export const dynamic = 'force-dynamic';

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

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const hoje       = new Date();
  const hojeStr    = hoje.toISOString().slice(0, 10);
  const daqui7     = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const inicioHoje = `${hojeStr}T00:00:00`;
  const fimHoje    = `${hojeStr}T23:59:59`;

  const { data: empresas } = await supabaseAdmin
    .from('empresas').select('id').eq('ativo', true);

  let enviados = 0;

  for (const empresa of empresas ?? []) {
    const empId = empresa.id;

    const [{ count: totalAgs }, { data: despVenc }, { data: estoqueAlertas }] = await Promise.all([
      supabaseAdmin.from('agendamentos')
        .select('id', { count: 'exact', head: true })
        .eq('empresa_id', empId)
        .gte('data_hora_inicio', inicioHoje)
        .lte('data_hora_inicio', fimHoje)
        .in('status', ['agendado', 'confirmado']),

      supabaseAdmin.from('despesas')
        .select('descricao,valor,data_vencimento')
        .eq('empresa_id', empId)
        .eq('status', 'pendente')
        .gte('data_vencimento', hojeStr)
        .lte('data_vencimento', daqui7)
        .order('data_vencimento')
        .limit(3),

      supabaseAdmin.from('v_produtos_estoque_baixo')
        .select('id')
        .eq('empresa_id', empId)
        .eq('ativo', true),
    ]);

    const qtdAgs     = totalAgs ?? 0;
    const qtdDesp    = (despVenc ?? []).length;
    const qtdEstoque = (estoqueAlertas ?? []).length;

    const linhas: string[] = [];
    if (qtdAgs     > 0) linhas.push(`📅 ${qtdAgs} atendimento${qtdAgs === 1 ? '' : 's'} hoje`);
    if (qtdDesp    > 0) linhas.push(`💰 ${qtdDesp} despesa${qtdDesp === 1 ? '' : 's'} vencendo em breve`);
    if (qtdEstoque > 0) linhas.push(`📦 ${qtdEstoque} produto${qtdEstoque === 1 ? '' : 's'} com estoque baixo`);

    if (linhas.length === 0) continue;

    const { data: subs } = await supabaseAdmin
      .from('web_push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('empresa_id', empId);

    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({
            title: 'Bellamore — Bom dia! ✦',
            body:  linhas.join('\n'),
            url:   '/dashboard',
          }),
        );
        enviados++;
      } catch {
        await supabaseAdmin.from('web_push_subscriptions')
          .delete().eq('endpoint', sub.endpoint);
      }
    }
  }

  return NextResponse.json({ ok: true, enviados });
}
