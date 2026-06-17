'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email,       setEmail]       = useState('');
  const [senha,       setSenha]       = useState('');
  const [verSenha,    setVerSenha]    = useState(false);
  const [erro,        setErro]        = useState('');
  const [loading,     setLoading]     = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setLoading(false);
    if (error) { setErro('E-mail ou senha incorretos.'); return; }
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
            <span className="text-white text-xl font-bold font-serif">✦</span>
          </div>
          <h1 className="font-serif text-3xl text-text leading-tight">Bem-vindo de volta</h1>
          <p className="text-text-3 text-sm mt-1">Acesse sua conta para continuar</p>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
          <form onSubmit={entrar} className="flex flex-col gap-4">

            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">E-mail</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com" required
                className="w-full h-11 px-3.5 rounded-xl border border-border bg-bg text-text text-sm font-medium placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Senha</label>
              <div className="relative">
                <input
                  type={verSenha ? 'text' : 'password'}
                  value={senha} onChange={e => setSenha(e.target.value)}
                  placeholder="••••••••" required
                  className="w-full h-11 px-3.5 pr-11 rounded-xl border border-border bg-bg text-text text-sm font-medium placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"
                />
                <button
                  type="button" onClick={() => setVerSenha(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-2 transition"
                >
                  <EyeIcon open={verSenha} />
                </button>
              </div>
            </div>

            {erro && <p className="text-red text-sm text-center">{erro}</p>}

            <button
              type="submit" disabled={loading}
              className="h-11 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-60 mt-1"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-text-3 mt-5">
          Não tem conta?{' '}
          <a href="/cadastro" className="text-accent font-semibold hover:underline">Cadastre-se</a>
        </p>
      </div>
    </div>
  );
}
