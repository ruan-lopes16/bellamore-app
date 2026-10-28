/**
 * @file web/lib/push/cron-lembretes.ts
 * Motor do cron de lembretes (rota /api/cron/lembretes), separado da rota para ser testado com db
 * e fetch falsos. 1 push único, 30 min antes de cada atendimento agendado/confirmado, pelo web push
 * E pelo app nativo (Expo), para a profissional do atendimento e as donas/gestoras da empresa.
 *
 * Único de verdade: `lembrete_30min_em` é marcado ANTES de enviar, e só se ainda estiver vazio
 * (`.is(null)` + `.select('id')`). Se outro cron já marcou, ou a marcação falhou, nada é enviado —
 * o lembrete nunca repete. Depois de marcado, cada canal (web, app, linha em notificacoes) falha
 * sozinho, sem levar os outros junto.
 *
 * Quem desligou `users.notif_lembrete_atendimento` (077) é pulado (nem push, nem notificação).
 * Sem a 097 o app não recebe pelo servidor: o app antigo já agenda o lembrete local, e
 * `users.push_token` faria o aviso chegar dobrado.
 */
import {
  selecionarLembrete, corpoLembrete, tituloLembrete, destinatarios,
  ALVO_MIN, FOLGA_MIN, type AgLembrete,
} from '@shared/lembretes';
import {
  carregarDispositivosExpo, enviarPushExpo, enviarWebPush, inscricoesPorUsuario,
  type ClienteDbCron, type EnviarWeb, type InscricaoWeb,
} from './expo';

export type DepsCron = {
  db: ClienteDbCron;
  enviarWeb: EnviarWeb;
  fetchFn?: typeof fetch;
  expoAccessToken?: string;
};

const SEL = `id, profissional_id, data_hora_inicio, lembrete_30min_em,
  cliente:clientes!agendamentos_cliente_id_fkey(nome),
  servico:servicos(nome),
  agendamento_servicos(ordem, servico:servicos(nome)),
  pacote_cliente:pacote_clientes(pacote:pacotes(nome))`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapAg(r: any): AgLembrete {
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
}

/** Roda uma passada do cron. @returns quantos pushes (web + app) foram aceitos. */
export async function executarCronLembretes(deps: DepsCron & { agora: Date }): Promise<{ enviados: number }> {
  const { db, agora } = deps;
  const opcoesExpo = { fetchFn: deps.fetchFn, accessToken: deps.expoAccessToken };
  const limiteSup = new Date(agora.getTime() + (ALVO_MIN + FOLGA_MIN) * 60_000).toISOString();

  const { data: empresas, error: errEmp } = await db.from('empresas').select('id').eq('ativo', true);
  if (errEmp) console.error('[lembretes] Erro ao ler empresas:', errEmp.message);

  let enviados = 0;

  for (const empresa of (empresas ?? []) as { id: string }[]) {
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

    const elegiveis = selecionarLembrete(((agsRaw ?? []) as any[]).map(mapAg), agora);
    if (!elegiveis.length) continue;

    const subsPorUser = inscricoesPorUsuario(subs as InscricaoWeb[] | null);
    const querLembrete = new Set(
      ((membros ?? []) as any[])
        .filter(m => m.usuario?.notif_lembrete_atendimento !== false)
        .map(m => m.user_id as string),
    );
    const disp = await carregarDispositivosExpo(db, empId, [...querLembrete], { legado: false });

    for (const ag of elegiveis) {
      // Marca primeiro: só quem conseguir marcar (ainda vazio) envia.
      const marcado = await db.from('agendamentos')
        .update({ lembrete_30min_em: agora.toISOString() })
        .eq('id', ag.id)
        .is('lembrete_30min_em', null)
        .select('id');
      if (marcado.error) {
        console.error('[lembretes] Erro ao marcar lembrete enviado:', marcado.error.message);
        continue;
      }
      if (!(marcado.data ?? []).length) continue;

      const titulo = tituloLembrete();
      const body = corpoLembrete(ag);
      const destino = destinatarios(ag.profissional_id, (membros ?? []) as { user_id: string; role: string }[])
        .filter(uid => querLembrete.has(uid));

      // Web push
      const vistos = new Set<string>();
      const inscricoes: InscricaoWeb[] = [];
      for (const uid of destino) {
        for (const s of subsPorUser.get(uid) ?? []) {
          if (vistos.has(s.endpoint)) continue;
          vistos.add(s.endpoint);
          inscricoes.push(s);
        }
      }
      enviados += await enviarWebPush(db, inscricoes, JSON.stringify({ title: titulo, body, url: '/agenda' }), deps.enviarWeb);

      // App nativo
      enviados += await enviarPushExpo(
        db, disp,
        destino.map(userId => ({ userId, titulo, corpo: body, dados: { tipo: 'agendamento', url: '/agenda' } })),
        opcoesExpo,
      );

      // Notificação no sino (só da profissional do atendimento, como antes)
      if (querLembrete.has(ag.profissional_id)) {
        try {
          const { error } = await db.from('notificacoes').insert({
            user_id: ag.profissional_id, empresa_id: empId,
            tipo: 'agendamento', titulo, mensagem: body,
          });
          if (error) console.error('[lembretes] Erro ao gravar notificação:', error.message);
        } catch (e) {
          console.error('[lembretes] Falha ao gravar notificação:', e instanceof Error ? e.message : String(e));
        }
      }
    }
  }

  return { enviados };
}
