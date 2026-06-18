import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { endpoint, keys } = await req.json() as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };

  const { data: membro } = await supabase
    .from('empresa_membros')
    .select('empresa_id')
    .eq('user_id', user.id).eq('ativo', true).limit(1).single();
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
