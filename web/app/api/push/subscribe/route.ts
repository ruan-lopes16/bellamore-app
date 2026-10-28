import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { COOKIE_EMPRESA_ATIVA } from '@shared/empresa-ativa';
import { resolverEmpresaAtiva } from '@/lib/auth/empresa-ativa';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { endpoint, keys } = await req.json() as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };

  // Mesma empresa que as telas mostram (cookie `bm_empresa` validado), nunca uma qualquer.
  let membro;
  try {
    ({ ativo: membro } = await resolverEmpresaAtiva(supabase, user.id, req.cookies.get(COOKIE_EMPRESA_ATIVA)?.value));
  } catch {
    return NextResponse.json({ error: 'Não foi possível carregar a empresa.' }, { status: 500 });
  }
  if (!membro) return NextResponse.json({ error: 'No company' }, { status: 400 });

  await supabase.from('web_push_subscriptions').upsert({
    user_id:    user.id,
    empresa_id: membro.empresa_id,
    endpoint,
    p256dh:     keys.p256dh,
    auth:       keys.auth,
  }, { onConflict: 'user_id, endpoint' });

  return NextResponse.json({ ok: true });
}
