import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { podeAtribuirRole, pode } from '@/lib/permissions';
import { quemChama } from '@/lib/auth/quem-chama';
import { carregarPermissoesDoMembro } from '@shared/permissoes-consultas';
import { emailValido, vinculoParaGravar, type TipoContrato } from '@shared/equipe';

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

/**
 * Convida alguém para a equipe (web e app). Conta nova recebe o e-mail de convite; conta existente só é
 * vinculada. Vínculo existente nunca tem comissão/contrato zerados: só troca o que veio no corpo
 * (`vinculoParaGravar`).
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
    if (!podeAtribuirRole(membroReq.role as 'owner' | 'gestor' | 'profissional', roleSolicitado)) {
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
      .select('id, role, percentual_comissao, tipo_contrato')
      .eq('empresa_id', empresaId)
      .eq('user_id', userId)
      .maybeSingle();
    if (errAtual) {
      return NextResponse.json({ error: 'Não foi possível ler o vínculo atual. Tente de novo.' }, { status: 500 });
    }

    const atual = membroAtual as { role: string; percentual_comissao: number; tipo_contrato: TipoContrato | null } | null;
    const v = vinculoParaGravar(atual, { percentual_comissao, tipo_contrato });
    if ('erro' in v) return NextResponse.json({ error: v.erro }, { status: 400 });

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
