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

export default function CadastroPage() {
  const router = useRouter();
  const supabase = createClient();

  const [nome,          setNome]          = useState('');
  const [email,         setEmail]         = useState('');
  const [senha,         setSenha]         = useState('');
  const [confirmar,     setConfirmar]     = useState('');
  const [verSenha,      setVerSenha]      = useState(false);
  const [verConfirmar,  setVerConfirmar]  = useState(false);
  const [erro,          setErro]          = useState('');
  const [loading,       setLoading]       = useState(false);

  async function cadastrar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');

    if (senha !== confirmar) {
      setErro('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password: senha,
      options: {
        data: { nome: nome.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setLoading(false);
    if (error) { setErro(error.message); return; }

    router.push(`/verificar-email?email=${encodeURIComponent(email)}`);
  }

  const inputClass = "w-full h-11 px-3.5 pr-11 rounded-xl border border-border bg-bg text-text text-sm font-medium placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition";

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
            <span className="text-white text-xl font-bold font-serif">✦</span>
          </div>
          <h1 className="font-serif text-3xl text-text leading-tight">Criar conta</h1>
          <p className="text-text-3 text-sm mt-1">Comece a gerenciar seu estúdio</p>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
          <form onSubmit={cadastrar} className="flex flex-col gap-4">

            {/* Nome */}
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Nome completo</label>
              <input
                type="text" value={nome} onChange={e => setNome(e.target.value)}
                placeholder="Seu nome" required
                className="w-full h-11 px-3.5 rounded-xl border border-border bg-bg text-text text-sm font-medium placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">E-mail</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com" required
                className="w-full h-11 px-3.5 rounded-xl border border-border bg-bg text-text text-sm font-medium placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"
              />
            </div>

            {/* Senha */}
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Senha</label>
              <div className="relative">
                <input
                  type={verSenha ? 'text' : 'password'}
                  value={senha} onChange={e => setSenha(e.target.value)}
                  placeholder="mínimo 6 caracteres" required minLength={6}
                  className={inputClass}
                />
                <button type="button" onClick={() => setVerSenha(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-2 transition">
                  <EyeIcon open={verSenha} />
                </button>
              </div>
            </div>

            {/* Confirmar senha */}
            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Confirmar senha</label>
              <div className="relative">
                <input
                  type={verConfirmar ? 'text' : 'password'}
                  value={confirmar} onChange={e => setConfirmar(e.target.value)}
                  placeholder="repita a senha" required minLength={6}
                  className={`${inputClass} ${confirmar && senha !== confirmar ? 'border-red focus:border-red focus:ring-red/20' : ''}`}
                />
                <button type="button" onClick={() => setVerConfirmar(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-2 transition">
                  <EyeIcon open={verConfirmar} />
                </button>
              </div>
              {confirmar && senha !== confirmar && (
                <p className="text-red text-xs mt-1">As senhas não coincidem</p>
              )}
            </div>

            {erro && <p className="text-red text-sm text-center">{erro}</p>}

            <button
              type="submit" disabled={loading}
              className="h-11 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-60 mt-1"
            >
              {loading ? 'Criando conta...' : 'Criar conta'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-text-3 mt-5">
          Já tem conta?{' '}
          <a href="/login" className="text-accent font-semibold hover:underline">Entrar</a>
        </p>
      </div>
    </div>
  );
}
