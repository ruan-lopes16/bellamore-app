import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { COOKIE_EMPRESA_ATIVA } from '@shared/empresa-ativa';
import { resolverEmpresaAtiva } from '@/lib/auth/empresa-ativa';
import { gravarInscricaoWebPush } from '@/lib/push/inscricao-web';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sessão expirada. Entre de novo.' }, { status: 401 });

  let corpo: unknown;
  try { corpo = await req.json(); } catch { corpo = null; }

  // Mesma empresa que as telas mostram (cookie `bm_empresa` validado), nunca uma qualquer.
  let membro;
  try {
    ({ ativo: membro } = await resolverEmpresaAtiva(supabase, user.id, req.cookies.get(COOKIE_EMPRESA_ATIVA)?.value));
  } catch {
    return NextResponse.json({ error: 'Não foi possível carregar a empresa.' }, { status: 500 });
  }
  if (!membro) return NextResponse.json({ error: 'Nenhuma empresa ativa.' }, { status: 400 });

  // Upsert por (user_id, endpoint): trocar de empresa move a inscrição para a nova. Conferido.
  try {
    await gravarInscricaoWebPush(supabase, user.id, membro.empresa_id, corpo as Parameters<typeof gravarInscricaoWebPush>[3]);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Não foi possível salvar a inscrição.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
