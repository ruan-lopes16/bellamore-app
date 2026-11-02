/**
 * @file web/lib/push/cron-resumo.ts
 * Motor do cron do resumo diário (rota /api/cron/resumo-diario), separado da rota para ser testado
 * com db e fetch falsos. Manda pelo web push E pelo app nativo (Expo), e grava 1 linha em
 * notificacoes (tipo 'resumo') por membro com algo a reportar.
 *
 * Conteúdo (`corpoResumoDoMembro`):
 * - dona/gestora: visão da empresa; profissional: visão pessoal (atendimentos e comissão dela).
 * - despesas vencendo hoje só para quem tem `financeiro.ver`; estoque baixo só para quem tem
 *   `estoque.acessar`. Mesma ordem de `tem_permissao` (dona → exceção da pessoa → papel → padrão),
 *   resolvida em lote por empresa com `resolverPermissao` (service role não tem auth.uid(), então
 *   a função SQL não serve aqui). Erro ao ler as permissões: essas duas linhas ficam de fora para
 *   quem não é dona (nunca liberar por falha).
 * - Quem desligou `users.notif_resumo_diario` (077) não recebe nada.
 *
 * Aparelhos do app: só os da empresa do resumo; sem a 097, `users.push_token` (só leitura).
 */
import { corpoResumoDoMembro } from '@shared/lembretes';
import { limitesDias } from '@shared/periodos';
import { ehChavePermissao, resolverPermissao, type ChavePermissao, type LinhasPermissao } from '@shared/permissoes';
import { papelDeRole } from '@shared/permissoes-consultas';
import {
  carregarDispositivosExpo, enviarPushExpo, enviarWebPush, inscricoesPorUsuario,
  type InscricaoWeb,
} from './expo';
import type { DepsCron } from './cron-lembretes';

type ErroDb = { code?: string; message: string } | null;

/** Tabela de permissões ainda não existe (antes da 083): vale o padrão, como em carregarPermissoesDoMembro. */
const tabelaInexistente = (e: ErroDb) => !!e && (e.code === 'PGRST205' || e.code === '42P01');

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Roda o resumo do dia `hoje` (YYYY-MM-DD em Brasília). @returns quantos pushes foram aceitos. */
export async function executarCronResumo(deps: DepsCron & { hoje: string }): Promise<{ enviados: number }> {
  const { db, hoje } = deps;
  const opcoesExpo = { fetchFn: deps.fetchFn, accessToken: deps.expoAccessToken };
  const { startIso: inicioHoje, endIso: fimHoje } = limitesDias(hoje, hoje);

  const { data: empresas, error: errEmp } = await db.from('empresas').select('id, owner_id').eq('ativo', true);
  if (errEmp) console.error('[resumo] Erro ao ler empresas:', errEmp.message);

  let enviados = 0;

  for (const empresa of (empresas ?? []) as { id: string; owner_id: string | null }[]) {
    const empId = empresa.id;

    const [
      { data: agsHoje }, { data: comissoesHoje }, { data: despVenc }, { data: estoque },
      { data: membros }, { data: subs }, rPapel, rMembro,
    ] = await Promise.all([
      db.from('agendamentos').select('id, profissional_id, status')
        .eq('empresa_id', empId)
        .gte('data_hora_inicio', inicioHoje).lte('data_hora_inicio', fimHoje)
        .not('status', 'in', '("cancelado","faltou")'),
      // Comissão gerada hoje: por comissoes.created_at (decisão 2 da Fase 2A), sem embed de
      // agendamentos — entram também as de serviço extra da comanda (agendamento_id null, 085).
      db.from('comissoes').select('valor_comissao, profissional_id')
        .eq('empresa_id', empId)
        .gte('created_at', inicioHoje).lte('created_at', fimHoje),
      db.from('despesas').select('id')
        .eq('empresa_id', empId).eq('status', 'pendente')
        .eq('data_vencimento', hoje),
      db.from('v_produtos_estoque_baixo').select('id').eq('empresa_id', empId).eq('ativo', true),
      db.from('empresa_membros').select('user_id, role, usuario:users(notif_resumo_diario)').eq('empresa_id', empId).eq('ativo', true),
      db.from('web_push_subscriptions').select('user_id, endpoint, p256dh, auth').eq('empresa_id', empId),
      db.from('permissoes_papel').select('papel, chave, permitido').eq('empresa_id', empId),
      db.from('permissoes_membro').select('user_id, chave, permitido').eq('empresa_id', empId),
    ]);

    // ── Permissões da empresa, em lote.
    const permOk = (!rPapel.error || tabelaInexistente(rPapel.error)) && (!rMembro.error || tabelaInexistente(rMembro.error));
    if (!permOk) console.error('[resumo] Erro ao ler permissões; despesas e estoque ficam de fora para quem não é dona.');
    const papelLinhas: Record<string, LinhasPermissao> = {};
    for (const l of (rPapel.error ? [] : rPapel.data ?? []) as { papel: string; chave: string; permitido: boolean }[]) {
      if (ehChavePermissao(l.chave)) (papelLinhas[l.papel] ??= {})[l.chave] = l.permitido;
    }
    const membroLinhas: Record<string, LinhasPermissao> = {};
    for (const l of (rMembro.error ? [] : rMembro.data ?? []) as { user_id: string; chave: string; permitido: boolean }[]) {
      if (ehChavePermissao(l.chave)) (membroLinhas[l.user_id] ??= {})[l.chave] = l.permitido;
    }

    // ── Contagens.
    const nAgsEmpresa = ((agsHoje ?? []) as any[]).filter(a => a.status === 'agendado' || a.status === 'confirmado').length;
    const atendimentosPorProf = new Map<string, number>();
    for (const ag of (agsHoje ?? []) as any[]) {
      atendimentosPorProf.set(ag.profissional_id, (atendimentosPorProf.get(ag.profissional_id) ?? 0) + 1);
    }
    const comissaoPorProf = new Map<string, number>();
    for (const c of (comissoesHoje ?? []) as { valor_comissao: number; profissional_id: string }[]) {
      comissaoPorProf.set(c.profissional_id, (comissaoPorProf.get(c.profissional_id) ?? 0) + Number(c.valor_comissao));
    }

    // ── Corpo de cada membro.
    const corpos: { userId: string; corpo: string }[] = [];
    for (const m of (membros ?? []) as any[]) {
      if (m.usuario?.notif_resumo_diario === false) continue;
      const isOwner = m.role === 'owner' || (!!empresa.owner_id && m.user_id === empresa.owner_id);
      const papel = papelDeRole(m.role);
      const pode = (chave: ChavePermissao) => isOwner || (permOk && resolverPermissao({
        isOwner: false, papel, papelLinhas: (papel && papelLinhas[papel]) || {}, membroLinhas: membroLinhas[m.user_id] ?? {},
      }, chave));
      const corpo = corpoResumoDoMembro({
        visao: m.role === 'profissional' ? 'pessoal' : 'empresa',
        agendamentosEmpresa: nAgsEmpresa,
        atendimentosDela: atendimentosPorProf.get(m.user_id) ?? 0,
        comissaoDela: comissaoPorProf.get(m.user_id) ?? 0,
        despesasVencendo: (despVenc ?? []).length,
        estoqueBaixo: (estoque ?? []).length,
        podeFinanceiro: pode('financeiro.ver'),
        podeEstoque: pode('estoque.acessar'),
      });
      if (corpo) corpos.push({ userId: m.user_id, corpo });
    }
    if (!corpos.length) continue;

    // ── Web push.
    const subsPorUser = inscricoesPorUsuario(subs as InscricaoWeb[] | null);
    for (const c of corpos) {
      enviados += await enviarWebPush(
        db, subsPorUser.get(c.userId) ?? [],
        JSON.stringify({ title: 'Resumo do dia ✦', body: c.corpo, url: '/dashboard' }),
        deps.enviarWeb,
      );
    }

    // ── App nativo (um envio em lotes para a empresa toda).
    const disp = await carregarDispositivosExpo(db, empId, corpos.map(c => c.userId), { legado: true });
    enviados += await enviarPushExpo(
      db, disp,
      corpos.map(c => ({ userId: c.userId, titulo: 'Resumo do dia ✦', corpo: c.corpo, dados: { tipo: 'resumo', url: '/dashboard' } })),
      opcoesExpo,
    );

    // ── Sino.
    try {
      const { error } = await db.from('notificacoes').insert(corpos.map(c => ({
        user_id: c.userId, empresa_id: empId, tipo: 'resumo', titulo: 'Resumo do dia', mensagem: c.corpo,
      })));
      if (error) console.error('[resumo] Erro ao gravar notificações:', error.message);
    } catch (e) {
      console.error('[resumo] Falha ao gravar notificações:', e instanceof Error ? e.message : String(e));
    }
  }

  return { enviados };
}
