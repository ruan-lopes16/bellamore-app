'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { maskPhone } from '@/lib/masks';

export default function CriarEmpresaPage() {
  const router = useRouter();
  const supabase = createClient();

  const [nome,      setNome]      = useState('');
  const [telefone,  setTelefone]  = useState('');
  const [endereco,  setEndereco]  = useState('');
  const [erro,      setErro]      = useState('');
  const [loading,   setLoading]   = useState(false);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }

    // Garante que public.users existe (pode não existir após limpeza do banco)
    await supabase.from('users').upsert({
      id:    user.id,
      nome:  user.user_metadata?.nome ?? user.email?.split('@')[0] ?? 'Usuário',
      email: user.email ?? '',
    }, { onConflict: 'id' });

    // Cria a empresa
    const { data: empresa, error } = await supabase.from('empresas').insert({
      owner_id: user.id,
      nome:     nome.trim(),
      telefone: telefone.trim() || null,
      endereco: endereco.trim() || null,
      ativo:    true,
    }).select('id').single();

    if (error || !empresa) {
      setLoading(false);
      setErro(error?.message ?? 'Erro ao criar empresa');
      return;
    }

    // Adiciona o dono como membro gestor (necessário para o layout encontrar a empresa)
    await supabase.from('empresa_membros').insert({
      empresa_id: empresa.id,
      user_id:    user.id,
      role:       'gestor',
      ativo:      true,
    });

    setLoading(false);
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
            <span className="text-white text-xl font-bold font-serif">✦</span>
          </div>
          <h1 className="font-serif text-3xl text-text leading-tight">Seu estúdio</h1>
          <p className="text-text-3 text-sm mt-1">
            Cadastre as informações do seu negócio
          </p>
        </div>

        {/* Card */}
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
          <form onSubmit={criar} className="flex flex-col gap-4">

            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">
                Nome do estúdio / salão *
              </label>
              <input
                type="text" value={nome} onChange={e => setNome(e.target.value)}
                placeholder="Ex: Studio Bella Arte"
                required
                className="w-full h-11 px-3.5 rounded-xl border border-border bg-bg text-text text-sm font-medium placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">
                Telefone <span className="text-text-4 normal-case font-normal">(opcional)</span>
              </label>
              <input
                type="tel" value={telefone} onChange={e => setTelefone(maskPhone(e.target.value))}
                placeholder="(11) 99999-9999" maxLength={15}
                className="w-full h-11 px-3.5 rounded-xl border border-border bg-bg text-text text-sm font-medium placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-2 uppercase tracking-wide mb-1.5">
                Endereço <span className="text-text-4 normal-case font-normal">(opcional)</span>
              </label>
              <input
                type="text" value={endereco} onChange={e => setEndereco(e.target.value)}
                placeholder="Rua, número, bairro"
                className="w-full h-11 px-3.5 rounded-xl border border-border bg-bg text-text text-sm font-medium placeholder:text-text-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"
              />
            </div>

            {erro && <p className="text-red text-sm text-center">{erro}</p>}

            <button
              type="submit" disabled={loading || !nome.trim()}
              className="h-11 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition disabled:opacity-50 mt-1"
            >
              {loading ? 'Criando...' : 'Criar estúdio'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-text-4 mt-5">
          Você poderá editar essas informações depois em Configurações.
        </p>
      </div>
    </div>
  );
}
