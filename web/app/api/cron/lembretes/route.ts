import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import {
  ehHoraDaVespera, selecionar30min, selecionarVespera,
  corpo30min, resumosVespera, destinatarios, type AgLembrete,
} from '@shared/lembretes';

export const dynamic = 'force-dynamic';

/**
 * Motor de lembretes de atendimento. Chamado a cada ~5 min pelo pg_cron
 * (migration 067). Idempotente: usa agendamentos.lembrete_vespera_em /
 * lembrete_30min_em como ledger para nunca reenviar.
 *
 * - Véspera: a partir das 18:00 (America/Sao_Paulo), 1 push-resumo por
 *   profissional com atendimento amanhã.
 * - 30 min antes: 1 push individual por atendimento.
 * Cada envio também grava uma linha em notificacoes (tipo 'agendamento').
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

  const agora = new Date();

  // Janela "amanhã" e "hoje" em America/Sao_Paulo, como YYYY-MM-DD.
  const fmtDia = (d: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  const hojeStr   = fmtDia(agora);
  const amanhaStr = fmtDia(new Date(agora.getTime() + 24 * 3600_000));

  const { data: empresas } = await db.from('empresas').select('id').eq('ativo', true);

  let enviados = 0;

  // Colunas comuns das queries de agendamento
  const SEL = `id, profissional_id, data_hora_inicio, lembrete_vespera_em, lembrete_30min_em,
    cliente:clientes!agendamentos_cliente_id_fkey(nome), servico:servicos(nome)`;

  const mapAg = (r: any): AgLembrete => ({
    id: r.id,
    profissional_id: r.profissional_id,
    data_hora_inicio: r.data_hora_inicio,
    cliente_nome: r.cliente?.nome ?? null,
    servico_nome: r.servico?.nome ?? null,
    lembrete_vespera_em: r.lembrete_vespera_em,
    lembrete_30min_em: r.lembrete_30min_em,
  });

  for (const empresa of empresas ?? []) {
    const empId = empresa.id;

    const [{ data: membros }, { data: subs }] = await Promise.all([
      db.from('empresa_membros').select('user_id, role').eq('empresa_id', empId).eq('ativo', true),
      db.from('web_push_subscriptions').select('user_id, endpoint, p256dh, auth').eq('empresa_id', empId),
    ]);

    type Sub = { user_id: string; endpoint: string; p256dh: string; auth: string };
    const subsPorUser = new Map<string, Sub[]>();
    for (const s of (subs ?? []) as Sub[]) {
      const arr = subsPorUser.get(s.user_id) ?? [];
      arr.push(s);
      subsPorUser.set(s.user_id, arr);
    }

    async function enviar(userIds: string[], titulo: string, body: string, empresaId: string) {
      const vistos = new Set<string>();
      for (const uid of userIds) {
        for (const sub of subsPorUser.get(uid) ?? []) {
          if (vistos.has(sub.endpoint)) continue;
          vistos.add(sub.endpoint);
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              JSON.stringify({ title: titulo, body, url: '/agenda' }),
            );
            enviados++;
          } catch {
            await db.from('web_push_subscriptions').delete().eq('endpoint', sub.endpoint);
          }
        }
        // Histórico na central de notificações
        await db.from('notificacoes').insert({
          user_id: uid, empresa_id: empresaId, tipo: 'agendamento',
          titulo, mensagem: body,
        });
      }
    }

    // ── 30 min antes ────────────────────────────────────────────
    const { data: agsHoje } = await db.from('agendamentos')
      .select(SEL)
      .eq('empresa_id', empId)
      .gte('data_hora_inicio', `${hojeStr}T00:00:00-03:00`)
      .lte('data_hora_inicio', `${hojeStr}T23:59:59-03:00`)
      .in('status', ['agendado', 'confirmado']);

    for (const ag of selecionar30min((agsHoje ?? []).map(mapAg), agora)) {
      await enviar(destinatarios(ag.profissional_id, membros ?? []), 'Lembrete de atendimento', corpo30min(ag), empId);
      await db.from('agendamentos').update({ lembrete_30min_em: agora.toISOString() }).eq('id', ag.id);
    }

    // ── Véspera (a partir das 18:00) ────────────────────────────
    if (ehHoraDaVespera(agora)) {
      const { data: agsAmanha } = await db.from('agendamentos')
        .select(SEL)
        .eq('empresa_id', empId)
        .gte('data_hora_inicio', `${amanhaStr}T00:00:00-03:00`)
        .lte('data_hora_inicio', `${amanhaStr}T23:59:59-03:00`)
        .in('status', ['agendado', 'confirmado']);

      const pendentes = selecionarVespera((agsAmanha ?? []).map(mapAg));
      if (pendentes.length > 0) {
        for (const { profissionalId, corpo } of resumosVespera(pendentes)) {
          await enviar(destinatarios(profissionalId, membros ?? []), 'Atendimentos de amanhã', corpo, empId);
        }
        await db.from('agendamentos')
          .update({ lembrete_vespera_em: agora.toISOString() })
          .in('id', pendentes.map(a => a.id));
      }
    }
  }

  return NextResponse.json({ ok: true, enviados });
}
