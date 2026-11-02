import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ehCaminhoInterno } from '@shared/navegacao';
import { carregarVinculosAtivos } from '@/lib/auth/empresa-ativa';
import { destinoCallback } from '@/lib/auth/destino-pos-login';

/**
 * Volta do link do e-mail (confirmação de cadastro, convite, redefinir senha).
 * Com `next` interno, vai para ele. Sem `next`: `/dashboard` para quem já tem vínculo ativo e
 * `/criar-empresa` para quem não tem (antes ia sempre para `/criar-empresa`, e quem já tinha
 * empresa podia criar uma 2ª por engano).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next');

  const supabase = await createClient();
  if (code) await supabase.auth.exchangeCodeForSession(code);

  if (ehCaminhoInterno(nextParam)) return NextResponse.redirect(`${origin}${nextParam}`);

  let temEmpresa = true;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) temEmpresa = (await carregarVinculosAtivos(supabase, user.id)).length > 0;
  } catch {
    // Erro ao ler os vínculos: /dashboard, e o getAppContext manda para /criar-empresa se não houver.
    temEmpresa = true;
  }

  return NextResponse.redirect(`${origin}${destinoCallback(nextParam, temEmpresa)}`);
}
