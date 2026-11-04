'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { desinscreverPushDoNavegador } from '@/components/SwRegister';
import { TITULO_ERRO_VINCULOS } from '@shared/destino-sessao';

const supabase = createClient();

/**
 * Mostrado pelo AppLayout no lugar da página quando a leitura dos vínculos com empresas falhou.
 * Não é "sem sessão" (login) nem "sem empresa" (criar-empresa): "Tentar de novo" relê no servidor
 * e "Sair" faz o mesmo logout do menu (tira a inscrição de push deste navegador antes).
 */
export default function ErroVinculos() {
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    if (saindo) return;
    setSaindo(true);
    try {
      // Antes do signOut: a inscrição de push deste navegador sai junto com a conta.
      await desinscreverPushDoNavegador();
      await supabase.auth.signOut();
    } finally {
      // Erro no meio do caminho não trava o botão; o login confere a sessão de novo.
      setSaindo(false);
      router.push('/login');
    }
  }

  return (
    <div className="rounded-2xl p-8 text-center" role="alert"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', maxWidth: 480, margin: '48px auto' }}>
      <p style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, color: 'var(--color-ink)', marginBottom: 6 }}>
        {TITULO_ERRO_VINCULOS}
      </p>
      <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-ink3)', marginBottom: 16 }}>
        Confira a conexão e tente de novo.
      </p>
      <div className="flex items-center justify-center gap-2">
        <button type="button" onClick={() => router.refresh()}
          className="press px-4 h-10 rounded-2xl text-sm font-bold"
          style={{ background: 'var(--color-primary)', color: '#fff', fontFamily: 'var(--font-sans)' }}>
          Tentar de novo
        </button>
        <button type="button" onClick={sair} disabled={saindo}
          className="press px-4 h-10 rounded-2xl text-sm font-bold disabled:opacity-60"
          style={{ background: 'var(--color-surface)', color: 'var(--color-ink)', border: '1px solid var(--color-border)', fontFamily: 'var(--font-sans)' }}>
          Sair
        </button>
      </div>
    </div>
  );
}
