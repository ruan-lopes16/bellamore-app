import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { codigo } = await req.json();
  const codigoEsperado = process.env.INVITE_CODE;

  // Se INVITE_CODE não estiver configurado, cadastro está aberto (desenvolvimento)
  if (!codigoEsperado) {
    return NextResponse.json({ valido: true });
  }

  return NextResponse.json({ valido: codigo?.trim() === codigoEsperado.trim() });
}
