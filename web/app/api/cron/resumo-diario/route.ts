import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { corpoResumoDiario, corpoResumoDiarioProfissional } from '@shared/lembretes';

export const dynamic = 'force-dynamic';

/**
 * Resumo diário. Chamado 1x/dia pelo pg_cron (migration 071, 07:00 BRT).
 * Conteúdo por papel:
 * - owner/gestor: visão da empresa — nº de atendimentos do dia, despesas
 *   vencendo hoje, estoque baixo.
 * - profissional: visão pessoal — nº de atendimentos dela hoje e quanto ela
 *   já comissionou hoje (de atendimentos já concluídos).
 * Quem não tem nada a reportar não recebe push nem linha em notificacoes.
 *
 * Grava 1 linha em notificacoes por membro ativo com algo a reportar (tipo
 * 'resumo') — a migration 072 apaga essas linhas na madrugada seguinte.
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

    const [{ data: agsHoje }, { data: comissoesHoje }, { data: despVenc }, { data: estoque }, { data: membros }, { data: subs }] = await Promise.all([
      db.from('agendamentos').select('id, profissional_id, status')
        .eq('empresa_id', empId)
        .gte('data_hora_inicio', inicioHoje).lte('data_hora_inicio', fimHoje)
        .not('status', 'in', '("cancelado","faltou")'),
      db.from('comissoes').select('valor_comissao, profissional_id, agendamento:agendamentos!inner(data_hora_inicio)')
        .eq('empresa_id', empId)
        .gte('agendamento.data_hora_inicio', inicioHoje).lte('agendamento.data_hora_inicio', fimHoje),
      db.from('despesas').select('id')
        .eq('empresa_id', empId).eq('status', 'pendente')
        .eq('data_vencimento', hojeStr),
      db.from('v_produtos_estoque_baixo').select('id').eq('empresa_id', empId).eq('ativo', true),
      db.from('empresa_membros').select('user_id, role').eq('empresa_id', empId).eq('ativo', true),
      db.from('web_push_subscriptions').select('user_id, endpoint, p256dh, auth').eq('empresa_id', empId),
    ]);

    // ── Empresa (owner/gestor): nº de agendado/confirmado hoje + despesas + estoque.
    const nAgsEmpresa = (agsHoje ?? []).filter(a => a.status === 'agendado' || a.status === 'confirmado').length;
    const bodyEmpresa = corpoResumoDiario({
      agendamentos: nAgsEmpresa,
      despesasVencendo: (despVenc ?? []).length,
      estoqueBaixo: (estoque ?? []).length,
    });

    // ── Pessoal (profissional): atendimentos dela hoje + comissão já gerada hoje.
    const atendimentosPorProf = new Map<string, number>();
    for (const ag of agsHoje ?? []) {
      atendimentosPorProf.set(ag.profissional_id, (atendimentosPorProf.get(ag.profissional_id) ?? 0) + 1);
    }
    const comissaoPorProf = new Map<string, number>();
    for (const c of (comissoesHoje ?? []) as { valor_comissao: number; profissional_id: string }[]) {
      comissaoPorProf.set(c.profissional_id, (comissaoPorProf.get(c.profissional_id) ?? 0) + Number(c.valor_comissao));
    }

    type Sub = { user_id: string; endpoint: string; p256dh: string; auth: string };
    const subsPorUser = new Map<string, Sub[]>();
    for (const s of (subs ?? []) as Sub[]) {
      const arr = subsPorUser.get(s.user_id) ?? [];
      arr.push(s);
      subsPorUser.set(s.user_id, arr);
    }

    const linhas: { user_id: string; empresa_id: string; tipo: string; titulo: string; mensagem: string }[] = [];

    for (const m of (membros ?? []) as { user_id: string; role: string }[]) {
      const body = m.role === 'profissional'
        ? corpoResumoDiarioProfissional({
            atendimentos: atendimentosPorProf.get(m.user_id) ?? 0,
            comissao: comissaoPorProf.get(m.user_id) ?? 0,
          })
        : bodyEmpresa;
      if (!body) continue;

      for (const sub of subsPorUser.get(m.user_id) ?? []) {
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

      linhas.push({ user_id: m.user_id, empresa_id: empId, tipo: 'resumo', titulo: 'Resumo do dia', mensagem: body });
    }

    if (linhas.length) await db.from('notificacoes').insert(linhas);
  }

  return NextResponse.json({ ok: true, enviados });
}
