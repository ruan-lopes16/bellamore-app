import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { COOKIE_EMPRESA_ATIVA } from '@shared/empresa-ativa';
import {
  carregarVinculosAtivos, resolverEmpresaAtiva, opcoesCookieEmpresaAtiva,
} from '@/lib/auth/empresa-ativa';

/** Empresa ativa e as empresas em que a pessoa tem vínculo ativo (para o seletor). */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sessão expirada. Entre de novo.' }, { status: 401 });
  try {
    const { ativo, vinculos } = await resolverEmpresaAtiva(
      supabase, user.id, req.cookies.get(COOKIE_EMPRESA_ATIVA)?.value,
    );
    return NextResponse.json({
      empresaId: ativo?.empresa_id ?? null,
      vinculos: vinculos.map(v => ({ empresa_id: v.empresa_id, nome: v.empresa.nome, role: v.role })),
    });
  } catch {
    return NextResponse.json({ error: 'Não foi possível carregar as empresas.' }, { status: 500 });
  }
}

/** Troca a empresa ativa: grava o cookie só depois de confirmar que o vínculo está ativo. */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sessão expirada. Entre de novo.' }, { status: 401 });

  let empresaId: unknown;
  try { ({ empresaId } = await req.json() as { empresaId?: unknown }); } catch { /* corpo inválido */ }
  if (typeof empresaId !== 'string' || !empresaId) {
    return NextResponse.json({ error: 'Empresa não informada.' }, { status: 400 });
  }

  let vinculos;
  try { vinculos = await carregarVinculosAtivos(supabase, user.id); }
  catch { return NextResponse.json({ error: 'Não foi possível carregar as empresas.' }, { status: 500 }); }

  if (!vinculos.some(v => v.empresa_id === empresaId)) {
    return NextResponse.json({ error: 'Você não faz parte desta empresa.' }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true, empresaId });
  res.cookies.set(COOKIE_EMPRESA_ATIVA, empresaId, opcoesCookieEmpresaAtiva(process.env.NODE_ENV === 'production'));
  return res;
}
