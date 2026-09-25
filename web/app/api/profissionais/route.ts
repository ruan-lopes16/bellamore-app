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
    const { empresaId, nome, telefone, email, senha, percentual_comissao, role } = await req.json();

    if (!empresaId || !nome?.trim() || !email?.trim() || !senha) {
      return NextResponse.json({ error: 'Nome, e-mail, senha e empresa são obrigatórios.' }, { status: 400 });
    }
    if (String(senha).length < 6) {
      return NextResponse.json({ error: 'A senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
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
      .select('empresa_id, role')
      .eq('user_id', requesterId)
      .eq('empresa_id', empresaId)
      .eq('ativo', true)
      .single();
    if (!membroReq) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const roleSolicitado: 'gestor' | 'profissional' = role === 'gestor' ? 'gestor' : 'profissional';
    if (!podeAtribuirRole(membroReq.role as 'owner' | 'gestor' | 'profissional', roleSolicitado)) {
      return NextResponse.json({ error: 'Você não pode atribuir esse papel.' }, { status: 403 });
    }

    const emailFinal = email.trim().toLowerCase();

    let userId: string | null = null;
    let status: 'adicionado' | 'criado';

    // 1. Tenta criar a conta de auth já com a senha definida
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email:         emailFinal,
      password:      senha,
      email_confirm: true,
      user_metadata: { nome: nome.trim() },
    });

    if (authError) {
      if (authError.message.toLowerCase().includes('already')) {
        // Já existe conta com esse e-mail — só vincula à empresa, não mexe na senha dela.
        const { data: existing } = await adminClient
          .from('users')
          .select('id')
          .eq('email', emailFinal)
          .single();
        if (!existing) {
          return NextResponse.json({ error: 'Usuário já existe, mas não foi possível localizá-lo.' }, { status: 400 });
        }
        userId = existing.id;
        status = 'adicionado';
      } else {
        return NextResponse.json({ error: authError.message }, { status: 400 });
      }
    } else {
      userId = authData.user.id;
      status = 'criado';
    }

    // 2. Garante perfil em public.users
    await adminClient.from('users').upsert({
      id:       userId,
      nome:     nome.trim(),
      telefone: telefone?.trim() || null,
      email:    emailFinal,
    }, { onConflict: 'id' });

    // 3. Adiciona à empresa como profissional (preserva role existente via insert+ignore, atualiza só dados)
    const { data: existing } = await adminClient
      .from('empresa_membros')
      .select('id, role')
      .eq('empresa_id', empresaId)
      .eq('user_id', userId!)
      .single();

    const roleToUse = existing?.role ?? roleSolicitado;

    const { data: membro, error: membroError } = await adminClient
      .from('empresa_membros')
      .upsert({
        empresa_id:          empresaId,
        user_id:             userId,
        role:                roleToUse,
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

export async function PATCH(req: NextRequest) {
  try {
    const { userId, nome, telefone, email, membroId, percentual_comissao, tipo_contrato } = await req.json();
    const tc = tipo_contrato === 'pj' || tipo_contrato === 'clt' ? tipo_contrato : null;

    if (!userId || !nome?.trim()) {
      return NextResponse.json({ error: 'userId e nome são obrigatórios.' }, { status: 400 });
    }

    // Verifica que o usuário logado pertence à mesma empresa que o alvo
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: requesterMembros } = await supabase
      .from('empresa_membros')
      .select('empresa_id')
      .eq('user_id', user.id)
      .eq('ativo', true);

    const empresaIds = (requesterMembros ?? []).map(
      (m: { empresa_id: string }) => m.empresa_id,
    );
    if (empresaIds.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: alvoMembro } = await supabase
      .from('empresa_membros')
      .select('empresa_id')
      .eq('user_id', userId)
      .in('empresa_id', empresaIds)
      .limit(1)
      .single();

    if (!alvoMembro) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const adminClient = createAdminClient();
    const { error } = await adminClient.from('users').update({
      nome:     nome.trim(),
      telefone: telefone?.trim() || null,
      email:    email?.trim().toLowerCase() || null,
    }).eq('id', userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await adminClient.auth.admin.updateUserById(userId, {
      user_metadata: { nome: nome.trim() },
    });

    // Atualiza dados do vínculo (tipo de contrato sempre; comissão só se fornecida)
    if (membroId != null) {
      const patch: Record<string, unknown> = { tipo_contrato: tc };
      if (percentual_comissao != null) patch.percentual_comissao = percentual_comissao;
      const { error: errMembro } = await adminClient
        .from('empresa_membros')
        .update(patch)
        .eq('id', membroId);
      if (errMembro) return NextResponse.json({ error: errMembro.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
