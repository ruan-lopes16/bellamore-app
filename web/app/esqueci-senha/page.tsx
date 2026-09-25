'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/redefinir-senha`,
    });
    setLoading(false);

    if (error) {
      setErro(error.message);
      return;
    }
    setEnviado(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <img
            src="/icon.png" alt="Bellamore" width={80} height={80}
            className="w-20 h-20 mx-auto mb-4 rounded-[22%]"
            style={{ filter: 'drop-shadow(0 4px 16px rgba(44,23,80,0.3))' }}
          />
          <h1 className="font-serif text-3xl text-text leading-tight">Esqueceu sua senha?</h1>
          <p className="text-text-3 text-sm mt-1">Informe seu e-mail e enviaremos um link de redefinição</p>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
          {enviado ? (
            <div className="text-center py-2">
              <p className="text-text-2 text-sm mb-5">
                Se <strong>{email}</strong> estiver cadastrado, você vai receber um e-mail com o
                link para redefinir sua senha em instantes.
              </p>
              <a href="/login" className="text-accent font-semibold text-sm hover:underline">Voltar para o login</a>
            </div>
          ) : (
            <form onSubmit={enviar} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">E-mail</label>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com" required
                  className="w-full h-11 px-3.5 rounded-xl border border-border bg-bg text-text text-sm font-medium placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"
                />
              </div>

              {erro && <p className="text-red text-sm text-center">{erro}</p>}

              <button
                type="submit" disabled={loading}
                className="h-11 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-60 mt-1"
              >
                {loading ? 'Enviando...' : 'Enviar link de redefinição'}
              </button>

              <a href="/login" className="text-center text-text-3 text-sm hover:underline">Voltar para o login</a>
            </form>
          )}
        </div>

      </div>
    </div>
  );
}
