import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { podeAtribuirRole } from '@/lib/permissions';

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

function errorMessage(error: unknown, fallback = 'Erro interno.') {
  return error instanceof Error ? error.message : fallback;
}

export async function POST(req: NextRequest) {
  try {
    const { empresaId, nome, telefone, email, role, percentual_comissao } = await req.json();

    if (!empresaId || !nome?.trim() || !email?.trim()) {
      return NextResponse.json({ error: 'Nome, e-mail e empresa são obrigatórios.' }, { status: 400 });
    }

    // Verifica quem está chamando: cookie de sessão (web) ou Bearer token (mobile)
    const adminClient = createAdminClient();
    const bearerToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

    let requesterId: string | undefined;
    if (bearerToken) {
      const { data: { user: bearerUser } } = await adminClient.auth.getUser(bearerToken);
      requesterId = bearerUser?.id;
    } else {
      const supabase = await createClient();
      const { data: { user: cookieUser } } = await supabase.auth.getUser();
      requesterId = cookieUser?.id;
    }
    if (!requesterId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: membroReq } = await adminClient
      .from('empresa_membros')
      .select('empresa_id, role, empresa:empresas(nome)')
      .eq('user_id', requesterId)
      .eq('empresa_id', empresaId)
      .eq('ativo', true)
      .single();
    if (!membroReq) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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
      .single();

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
        return NextResponse.json({ error: inviteError.message }, { status: 400 });
      }

      userId = inviteData.user.id;
      status = 'convite_enviado';

      if (telefone?.trim()) {
        await adminClient.from('users').update({ telefone: telefone.trim() }).eq('id', userId);
      }
    }

    // 3. Garante o vínculo com a empresa (preserva role existente se já era membro)
    const { data: membroAtual } = await adminClient
      .from('empresa_membros')
      .select('id, role')
      .eq('empresa_id', empresaId)
      .eq('user_id', userId)
      .single();

    const { data: membro, error: membroError } = await adminClient
      .from('empresa_membros')
      .upsert({
        empresa_id:          empresaId,
        user_id:             userId,
        role:                membroAtual?.role ?? roleSolicitado,
        percentual_comissao: percentual_comissao ?? 0,
        ativo:               true,
      }, { onConflict: 'empresa_id,user_id' })
      .select('id, user_id, role, percentual_comissao, ativo, created_at, user:users(id, nome, telefone, email)')
      .single();

    if (membroError) {
      return NextResponse.json({ error: membroError.message }, { status: 400 });
    }

    return NextResponse.json({ status, membro });
  } catch (err: unknown) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
