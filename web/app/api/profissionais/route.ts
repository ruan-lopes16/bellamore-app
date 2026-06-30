import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(req: NextRequest) {
  try {
    const { empresaId, nome, telefone, email, percentual_comissao } = await req.json();

    if (!empresaId || !nome) {
      return NextResponse.json({ error: 'Nome e empresa são obrigatórios.' }, { status: 400 });
    }

    // Verifica que o usuário logado é membro ativo dessa empresa
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: membroReq } = await supabase
      .from('empresa_membros')
      .select('empresa_id')
      .eq('user_id', user.id)
      .eq('empresa_id', empresaId)
      .eq('ativo', true)
      .single();
    if (!membroReq) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const emailFinal = email?.trim().toLowerCase() || `prof.${crypto.randomUUID()}@interno.app`;

    let userId: string | null = null;

    // 1. Tenta criar a conta de auth
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email:         emailFinal,
      password:      crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { nome: nome.trim() },
    });

    if (authError) {
      if (authError.message.toLowerCase().includes('already')) {
        // Busca na tabela pública (mais eficiente que listUsers com paginação)
        const { data: existing } = await adminClient
          .from('users')
          .select('id')
          .eq('email', emailFinal)
          .single();
        if (!existing) {
          return NextResponse.json({ error: 'Usuário já existe, mas não foi possível localizá-lo.' }, { status: 400 });
        }
        userId = existing.id;
      } else {
        return NextResponse.json({ error: authError.message }, { status: 400 });
      }
    } else {
      userId = authData.user.id;
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

    const roleToUse = existing?.role ?? 'profissional';

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

    return NextResponse.json({ membro });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Erro interno.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { userId, nome, telefone, email, membroId, percentual_comissao } = await req.json();

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

    const empresaIds = (requesterMembros ?? []).map((m: any) => m.empresa_id);
    if (empresaIds.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: alvoMembro } = await supabase
      .from('empresa_membros')
      .select('empresa_id')
      .eq('user_id', userId)
      .in('empresa_id', empresaIds)
      .limit(1)
      .single();

    if (!alvoMembro) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { error } = await adminClient.from('users').update({
      nome:     nome.trim(),
      telefone: telefone?.trim() || null,
      email:    email?.trim().toLowerCase() || null,
    }).eq('id', userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await adminClient.auth.admin.updateUserById(userId, {
      user_metadata: { nome: nome.trim() },
    });

    // Atualiza percentual de comissão se fornecido
    if (membroId != null && percentual_comissao != null) {
      const { error: errComissao } = await adminClient
        .from('empresa_membros')
        .update({ percentual_comissao })
        .eq('id', membroId);
      if (errComissao) return NextResponse.json({ error: errComissao.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Erro interno.' }, { status: 500 });
  }
}
