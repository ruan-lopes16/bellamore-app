'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { rotaInicial } from '@/lib/permissions';
import type { PerfilRole } from '@/types';

type Estado = 'carregando' | 'formulario' | 'sucesso' | 'erro';

export default function AceitarConvitePage() {
  const router = useRouter();
  const supabase = createClient();

  const [estado, setEstado] = useState<Estado>('carregando');
  const [erro, setErro] = useState('');
  const [nome, setNome] = useState('');
  const [empresaNome, setEmpresaNome] = useState('');
  const [role, setRole] = useState<PerfilRole | 'owner'>('profissional');

  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setErro('Este link de convite é inválido ou já expirou. Peça para reenviarem o convite.');
        setEstado('erro');
        return;
      }

      setNome((user.user_metadata?.nome as string) || '');

      const { data: membro } = await supabase
        .from('empresa_membros')
        .select('role, empresa:empresas(nome)')
        .eq('user_id', user.id)
        .eq('ativo', true)
        .limit(1)
        .single();

      if (membro) {
        setRole(membro.role as PerfilRole | 'owner');
        setEmpresaNome((membro.empresa as unknown as { nome: string } | null)?.nome ?? '');
      }

      setEstado('formulario');
    })();
  }, [supabase]);

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
    setSalvando(false);

    if (error) {
      setErro(error.message);
      return;
    }

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
            {estado === 'sucesso' ? 'Tudo certo!' : 'Bem-vinda ao time'}
          </h1>
          {empresaNome && estado !== 'erro' && (
            <p className="text-text-3 text-sm mt-1">Convite de {empresaNome}</p>
          )}
        </div>

        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
          {estado === 'carregando' && (
            <p className="text-center text-text-3 text-sm py-6">Validando seu convite...</p>
          )}

          {estado === 'erro' && (
            <div className="text-center py-4">
              <p className="text-red text-sm mb-4">{erro}</p>
              <a href="/login" className="text-accent font-semibold text-sm hover:underline">Ir para o login</a>
            </div>
          )}

          {estado === 'formulario' && (
            <form onSubmit={confirmarSenha} className="flex flex-col gap-4">
              <p className="text-text-2 text-sm">
                {nome ? `Oi, ${nome}! ` : ''}Crie uma senha para acessar sua conta.
              </p>

              <div>
                <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">Senha</label>
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
                {salvando ? 'Ativando conta...' : 'Ativar minha conta'}
              </button>
            </form>
          )}

          {estado === 'sucesso' && (
            <div className="text-center py-2">
              <p className="text-text-2 text-sm mb-5">
                Sua conta foi ativada{empresaNome ? ` e você já faz parte da equipe de ${empresaNome}` : ''}.
              </p>
              <button
                onClick={() => router.push(rotaInicial(role))}
                className="w-full h-11 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition"
              >
                Continuar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
