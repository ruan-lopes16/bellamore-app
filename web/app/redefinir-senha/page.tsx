'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();

type Estado = 'carregando' | 'formulario' | 'sucesso' | 'erro';

export default function RedefinirSenhaPage() {
  const router = useRouter();

  const [estado, setEstado] = useState<Estado>('carregando');
  const [erro, setErro] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setErro('Este link de redefinição é inválido ou já expirou. Peça um novo link.');
        setEstado('erro');
        return;
      }
      setEstado('formulario');
    })();
  }, []);

  async function confirmarSenha(e: React.FormEvent) {
    e.preventDefault();
    setErro('');

    if (senha.length < 6) {
      setErro('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (senha !== confirmar) {
      setErro('As senhas não coincidem.');
      return;
    }

    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: senha });

    if (error) {
      setSalvando(false);
      setErro(error.message);
      return;
    }

    // Encerra a sessão de recovery para forçar login explícito com a nova senha.
    await supabase.auth.signOut();
    setSalvando(false);
    setEstado('sucesso');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
            <span className="text-white text-xl font-bold font-serif">✦</span>
          </div>
          <h1 className="font-serif text-3xl text-text leading-tight">
            {estado === 'sucesso' ? 'Senha redefinida!' : 'Nova senha'}
          </h1>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
          {estado === 'carregando' && (
            <p className="text-center text-text-3 text-sm py-6">Validando seu link...</p>
          )}

          {estado === 'erro' && (
            <div className="text-center py-4">
              <p className="text-red text-sm mb-4">{erro}</p>
              <a href="/esqueci-senha" className="text-accent font-semibold text-sm hover:underline">Pedir um novo link</a>
            </div>
          )}

          {estado === 'formulario' && (
            <form onSubmit={confirmarSenha} className="flex flex-col gap-4">
              <p className="text-text-2 text-sm">Defina sua nova senha de acesso.</p>

              <div>
                <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Nova senha</label>
                <input
                  type="password" value={senha} onChange={e => setSenha(e.target.value)}
                  placeholder="mínimo 6 caracteres" required minLength={6}
                  className="w-full h-11 px-3.5 rounded-xl border border-border bg-bg text-text text-sm font-medium placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Confirmar senha</label>
                <input
                  type="password" value={confirmar} onChange={e => setConfirmar(e.target.value)}
                  placeholder="repita a senha" required minLength={6}
                  className="w-full h-11 px-3.5 rounded-xl border border-border bg-bg text-text text-sm font-medium placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"
                />
              </div>

              {erro && <p className="text-red text-sm text-center">{erro}</p>}

              <button
                type="submit" disabled={salvando}
                className="h-11 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-60 mt-1"
              >
                {salvando ? 'Salvando...' : 'Salvar nova senha'}
              </button>
            </form>
          )}

          {estado === 'sucesso' && (
            <div className="text-center py-2">
              <p className="text-text-2 text-sm mb-5">Sua senha foi redefinida com sucesso. Entre novamente para continuar.</p>
              <button
                onClick={() => router.push('/login')}
                className="w-full h-11 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition"
              >
                Ir para o login
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
