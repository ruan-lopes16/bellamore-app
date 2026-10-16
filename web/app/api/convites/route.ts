import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { podeAtribuirRole, pode } from '@/lib/permissions';
import { quemChama, clienteComoQuemChama } from '@/lib/auth/quem-chama';
import { carregarPermissoesDoMembro } from '@shared/permissoes-consultas';
import { podeGerenciarMembro } from '@shared/permissoes';
import { emailValido, vinculoParaGravar, type TipoContrato } from '@shared/equipe';
import { gravarConvitePendente, faltaMigration092, ERRO_SEM_MIGRATION_092 } from '@/lib/equipe/convite-pendente';
import { mensagemErroBanco } from '@shared/erros';

function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY nao configurada.');
  }

  return createAdmin(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const ERRO_GERENCIAR_MEMBRO = 'Você só pode editar profissionais da equipe (não a dona, outra gestora ou você mesma).';

/**
 * Convida alguém para a equipe (web e app). Conta nova recebe o e-mail de convite do Supabase e o vínculo
 * na hora (`status: 'convite_enviado'`). Conta que já existe:
 * - com vínculo ATIVO nesta empresa → atualiza o vínculo como antes (`status: 'adicionado'`);
 * - sem vínculo ou com vínculo inativo → nunca vincula sem aceite: grava o convite pendente (092) e
 *   responde `{ status: 'convite_pendente', convite }`; sem a 092, 503.
 * Vínculo existente nunca tem comissão/contrato zerados: só troca o que veio no corpo (`vinculoParaGravar`).
 */
export async function POST(req: NextRequest) {
  try {
    const { empresaId, nome, telefone, email, role, percentual_comissao, tipo_contrato } = await req.json();

    if (!empresaId || !nome?.trim() || !email?.trim()) {
      return NextResponse.json({ error: 'Nome, e-mail e empresa são obrigatórios.' }, { status: 400 });
    }
    if (!emailValido(String(email))) {
      return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 });
    }
    // Valida comissão/contrato antes de enviar qualquer convite.
    const validacao = vinculoParaGravar(null, { percentual_comissao, tipo_contrato });
    if ('erro' in validacao) return NextResponse.json({ error: validacao.erro }, { status: 400 });

    const adminClient = createAdminClient();
    const requesterId = await quemChama(req, adminClient);
    if (!requesterId) return NextResponse.json({ error: 'Sessão expirada. Entre de novo.' }, { status: 401 });

    const { data: membroReq } = await adminClient
      .from('empresa_membros')
      .select('empresa_id, role, empresa:empresas(nome)')
      .eq('user_id', requesterId)
      .eq('empresa_id', empresaId)
      .eq('ativo', true)
      .maybeSingle();
    if (!membroReq) return NextResponse.json({ error: 'Você não faz parte desta empresa.' }, { status: 403 });

    const permsReq = await carregarPermissoesDoMembro(adminClient, empresaId, requesterId);
    if (!permsReq || !pode(permsReq, 'equipe.gerenciar')) {
      return NextResponse.json({ error: 'Você não tem permissão para gerenciar a equipe.' }, { status: 403 });
    }

    const roleSolicitado: 'gestor' | 'profissional' = role === 'gestor' ? 'gestor' : 'profissional';
    // Só a dona cria gestora; papel Profissional basta `equipe.gerenciar` (conferido acima), inclusive para a
    // profissional que recebeu essa exceção.
    if (!podeAtribuirRole(permsReq.isOwner ? 'owner' : (membroReq.role as 'gestor' | 'profissional'), roleSolicitado)) {
      return NextResponse.json({ error: 'Você não pode convidar alguém com esse papel.' }, { status: 403 });
    }
    const emailFinal = email.trim().toLowerCase();
    const empresaNome = (membroReq.empresa as unknown as { nome: string } | null)?.nome ?? '';
    const origin = new URL(req.url).origin;

    // 1. Usuário já tem conta? Adiciona direto à empresa.
    const { data: existing } = await adminClient
      .from('users')
      .select('id')
      .eq('email', emailFinal)
      .maybeSingle();

    let userId: string;
    let status: 'adicionado' | 'convite_enviado';

    if (existing) {
      userId = existing.id;
      status = 'adicionado';
    } else {
      // 2. Envia convite real por e-mail via Supabase Auth (cria a conta e dispara o template "Invite user")
      const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(emailFinal, {
        redirectTo: `${origin}/auth/callback?next=/convite/aceitar`,
        data: { nome: nome.trim(), empresa_nome: empresaNome, role: roleSolicitado },
      });

      if (inviteError) {
        return NextResponse.json({ error: 'Não foi possível enviar o convite. Confira o e-mail e tente de novo.' }, { status: 400 });
      }

      userId = inviteData.user.id;
      status = 'convite_enviado';

      if (telefone?.trim()) {
        await adminClient.from('users').update({ telefone: telefone.trim() }).eq('id', userId);
      }
    }

    // 3. Garante o vínculo com a empresa: preserva papel, comissão e contrato de quem já era da equipe.
    const { data: membroAtual, error: errAtual } = await adminClient
      .from('empresa_membros')
      .select('id, role, percentual_comissao, tipo_contrato, ativo')
      .eq('empresa_id', empresaId)
      .eq('user_id', userId)
      .maybeSingle();
    if (errAtual) {
      return NextResponse.json({ error: 'Não foi possível ler o vínculo atual. Tente de novo.' }, { status: 500 });
    }

    const atual = membroAtual as { role: string; percentual_comissao: number; tipo_contrato: TipoContrato | null; ativo: boolean } | null;
    const contaExistente = status === 'adicionado';
    if (atual || contaExistente) {
      // Mesma regra do PATCH (a gestora não mexe na dona, em outra gestora nem em si mesma, e não
      // reativa nem convida de novo quem não pode gerenciar) — vale também para vínculo inativo.
      const { data: emp, error: errEmp } = await adminClient.from('empresas').select('owner_id').eq('id', empresaId).maybeSingle();
      if (errEmp) return NextResponse.json({ error: 'Erro interno. Tente de novo.' }, { status: 500 });
      const roleAlvo = (emp as { owner_id?: string } | null)?.owner_id === userId ? 'owner' : (atual?.role ?? roleSolicitado);
      if (!podeGerenciarMembro({ isOwner: permsReq.isOwner, userId: requesterId }, true, { role: roleAlvo, userId })) {
        return NextResponse.json({ error: ERRO_GERENCIAR_MEMBRO }, { status: 403 });
      }
    }
    const v = vinculoParaGravar(atual, { percentual_comissao, tipo_contrato });
    if ('erro' in v) return NextResponse.json({ error: v.erro }, { status: 400 });

    // 4. Conta que já existia sem vínculo ATIVO nesta empresa: nunca vincula (nem reativa) sem aceite —
    //    só grava o convite pendente (092). Ela aceita no app ou no site.
    if (contaExistente && !atual?.ativo) {
      const roleConvite = atual ? atual.role : roleSolicitado;
      if (roleConvite !== 'gestor' && roleConvite !== 'profissional') {
        return NextResponse.json({ error: ERRO_GERENCIAR_MEMBRO }, { status: 403 });
      }
      const r = await gravarConvitePendente(adminClient, {
        empresaId, userId, email: emailFinal, nome: nome.trim(), role: roleConvite,
        percentual_comissao: v.valores.percentual_comissao, tipo_contrato: v.valores.tipo_contrato,
        convidadoPor: requesterId, quemConvidaEhDona: permsReq.isOwner,
      });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ status: 'convite_pendente', convite: r.convite });
    }

    const { data: membro, error: membroError } = await adminClient
      .from('empresa_membros')
      .upsert({
        empresa_id:          empresaId,
        user_id:             userId,
        role:                atual?.role ?? roleSolicitado,
        percentual_comissao: v.valores.percentual_comissao,
        tipo_contrato:       v.valores.tipo_contrato,
        ativo:               true,
      }, { onConflict: 'empresa_id,user_id' })
      .select('id, user_id, role, percentual_comissao, tipo_contrato, ativo, created_at, user:users(id, nome, telefone, email)')
      .single();

    if (membroError) {
      return NextResponse.json({ error: 'Não foi possível vincular a pessoa à empresa.' }, { status: 400 });
    }

    return NextResponse.json({ status, membro });
  } catch {
    return NextResponse.json({ error: 'Erro interno. Tente de novo.' }, { status: 500 });
  }
}

/**
 * Cancela um convite pendente (web e app via Bearer). Corpo: `{ empresaId, conviteId }`. Chama
 * `cancelar_convite` (092) COMO quem chama — a função confere `equipe.gerenciar` e que convite de gestora
 * só a dona cancela. Sem a 092, 503. Erros do banco voltam em português (`mensagemErroBanco`).
 */
export async function DELETE(req: NextRequest) {
  try {
    const corpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const empresaId = corpo?.empresaId;
    const conviteId = corpo?.conviteId;
    if (!empresaId || typeof empresaId !== 'string' || !conviteId || typeof conviteId !== 'string') {
      return NextResponse.json({ error: 'Empresa e convite são obrigatórios.' }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const requesterId = await quemChama(req, adminClient);
    if (!requesterId) return NextResponse.json({ error: 'Sessão expirada. Entre de novo.' }, { status: 401 });

    const db = await clienteComoQuemChama(req);
    const { error } = await db.rpc('cancelar_convite', { p_empresa: empresaId, p_convite: conviteId });
    if (error) {
      if (faltaMigration092(error)) return NextResponse.json({ error: ERRO_SEM_MIGRATION_092 }, { status: 503 });
      return NextResponse.json(
        { error: mensagemErroBanco(error, 'cancelar o convite') },
        { status: error.code === '42501' ? 403 : 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Erro interno. Tente de novo.' }, { status: 500 });
  }
}
