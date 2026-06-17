import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const adminClient = createClient(
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
      // Se o erro é "já existe" — busca o usuário pelo email no auth
      if (authError.message.toLowerCase().includes('already')) {
        // Busca via listUsers (filtra por email)
        const { data: list } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
        const found = list?.users.find(u => u.email === emailFinal);
        if (!found) {
          return NextResponse.json({ error: 'Usuário já existe, mas não foi possível localizá-lo.' }, { status: 400 });
        }
        userId = found.id;
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

    // 3. Adiciona à empresa como profissional
    const { data: membro, error: membroError } = await adminClient
      .from('empresa_membros')
      .upsert({
        empresa_id:          empresaId,
        user_id:             userId,
        role:                'profissional',
        percentual_comissao: percentual_comissao ?? 0,
        ativo:               true,
      }, { onConflict: 'empresa_id,user_id' })
      .select('id, user_id, percentual_comissao, ativo, created_at, user:users(id, nome, telefone, email)')
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
    const { userId, nome, telefone, email } = await req.json();

    if (!userId || !nome?.trim()) {
      return NextResponse.json({ error: 'userId e nome são obrigatórios.' }, { status: 400 });
    }

    const { error } = await adminClient.from('users').update({
      nome:     nome.trim(),
      telefone: telefone?.trim() || null,
      email:    email?.trim().toLowerCase() || null,
    }).eq('id', userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // Atualiza metadados do auth também
    await adminClient.auth.admin.updateUserById(userId, {
      user_metadata: { nome: nome.trim() },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Erro interno.' }, { status: 500 });
  }
}
