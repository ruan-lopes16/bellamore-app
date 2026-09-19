import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import {
  selecionarLembrete, corpoLembrete, tituloLembrete, destinatarios,
  ALVO_MIN, FOLGA_MIN, type AgLembrete,
} from '@shared/lembretes';

export const dynamic = 'force-dynamic';

/**
 * Motor de lembretes de atendimento. Chamado a cada ~5 min pelo pg_cron
 * (migration 071). Envia 1 push único, 30 min antes de cada atendimento
 * (agendado ou confirmado). Idempotente: usa agendamentos.lembrete_30min_em
 * como ledger, nunca reenvia.
 *
 * Não dispara para atendimento já concluído (comanda fechada = status
 * 'concluido'), cancelado, ou cujo horário já passou.
 *
 * Cada destinatário com `users.notif_lembrete_atendimento = false`
 * (migration 077) é pulado — nem push, nem linha em notificacoes. A coluna
 * `lembrete_30min_em` é marcada mesmo assim, pra não reavaliar o mesmo
 * atendimento a cada 5 min só porque ninguém tinha o aviso ligado.
 *
 * Cada envio grava 1 linha em notificacoes (tipo 'agendamento') — a
 * migration 072 apaga essas linhas todo dia de madrugada.
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
  const limiteSup = new Date(agora.getTime() + (ALVO_MIN + FOLGA_MIN) * 60_000).toISOString();

  const { data: empresas } = await db.from('empresas').select('id').eq('ativo', true);

  let enviados = 0;

  const SEL = `id, profissional_id, data_hora_inicio, lembrete_30min_em,
    cliente:clientes!agendamentos_cliente_id_fkey(nome),
    servico:servicos(nome),
    agendamento_servicos(ordem, servico:servicos(nome)),
    pacote_cliente:pacote_clientes(pacote:pacotes(nome))`;

  const mapAg = (r: any): AgLembrete => {
    const pacoteNome = r.pacote_cliente?.pacote?.nome as string | undefined;
    const multi = [...(r.agendamento_servicos ?? [])]
      .sort((a: any, b: any) => a.ordem - b.ordem)
      .map((s: any) => s.servico?.nome)
      .filter(Boolean);
    const descricao_servico = pacoteNome
      ? `Pacote ${pacoteNome}`
      : (multi.length ? multi.join(' + ') : (r.servico?.nome ?? null));
    return {
      id: r.id,
      profissional_id: r.profissional_id,
      data_hora_inicio: r.data_hora_inicio,
      cliente_nome: r.cliente?.nome ?? null,
      descricao_servico,
      lembrete_30min_em: r.lembrete_30min_em,
    };
  };

  for (const empresa of empresas ?? []) {
    const empId = empresa.id;

    const [{ data: membros }, { data: subs }, { data: agsRaw }] = await Promise.all([
      db.from('empresa_membros').select('user_id, role, usuario:users(notif_lembrete_atendimento)').eq('empresa_id', empId).eq('ativo', true),
      db.from('web_push_subscriptions').select('user_id, endpoint, p256dh, auth').eq('empresa_id', empId),
      db.from('agendamentos').select(SEL)
        .eq('empresa_id', empId)
        .in('status', ['agendado', 'confirmado'])
        .gte('data_hora_inicio', agora.toISOString())
        .lte('data_hora_inicio', limiteSup),
    ]);

    type Sub = { user_id: string; endpoint: string; p256dh: string; auth: string };
    const subsPorUser = new Map<string, Sub[]>();
    for (const s of (subs ?? []) as Sub[]) {
      const arr = subsPorUser.get(s.user_id) ?? [];
      arr.push(s);
      subsPorUser.set(s.user_id, arr);
    }

    const querLembrete = new Set(
      (membros ?? [])
        .filter((m: any) => m.usuario?.notif_lembrete_atendimento !== false)
        .map((m: any) => m.user_id),
    );

    async function pushPara(userIds: string[], titulo: string, body: string) {
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
      }
    }

    const ags = (agsRaw ?? []).map(mapAg);

    for (const ag of selecionarLembrete(ags, agora)) {
      const titulo = tituloLembrete();
      const body = corpoLembrete(ag);

      const destino = destinatarios(ag.profissional_id, membros ?? []).filter(uid => querLembrete.has(uid));
      if (destino.length) await pushPara(destino, titulo, body);

      if (querLembrete.has(ag.profissional_id)) {
        await db.from('notificacoes').insert({
          user_id: ag.profissional_id, empresa_id: empId,
          tipo: 'agendamento', titulo, mensagem: body,
        });
      }

      // Marca mesmo sem destinatário elegível — evita reavaliar o mesmo
      // atendimento a cada 5 min dentro da janela.
      await db.from('agendamentos').update({ lembrete_30min_em: agora.toISOString() }).eq('id', ag.id);
    }
  }

  return NextResponse.json({ ok: true, enviados });
}
