import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * Id de quem chama a rota de API. Com `Authorization: Bearer <token>` (app), valida o token pelo
 * cliente admin; sem ele (web), usa a sessão do cookie. Devolve `null` quando não há usuário válido.
 */
export async function quemChama(req: NextRequest, adminClient: SupabaseClient): Promise<string | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (token) {
    const { data, error } = await adminClient.auth.getUser(token);
    return error ? null : data.user?.id ?? null;
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export const ERRO_EMAIL_EM_USO = 'Este e-mail já é usado por outra conta.';

/**
 * Traduz o erro do Supabase Auth ao trocar o e-mail de login. Nunca devolve a mensagem crua:
 * e-mail já usado por outra conta → 409; qualquer outro erro → 400 com texto genérico em português.
 */
export function traduzirErroEmailAuth(mensagem: string | null | undefined): { status: 400 | 409; error: string } {
  const m = (mensagem ?? '').toLowerCase();
  if (m.includes('already') || m.includes('registered') || m.includes('exists')) {
    return { status: 409, error: ERRO_EMAIL_EM_USO };
  }
  return { status: 400, error: 'Não foi possível trocar o e-mail de login.' };
}
