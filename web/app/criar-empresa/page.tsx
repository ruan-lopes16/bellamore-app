import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { carregarVinculosAtivos } from '@/lib/auth/empresa-ativa';
import ConvitesRecebidosBanner from '@/components/ConvitesRecebidosBanner';
import CriarEmpresaForm from './CriarEmpresaForm';

/**
 * Criar o estúdio. Quem já tem vínculo ativo com alguma empresa vai para o painel: criar uma 2ª
 * empresa por engano (link antigo do e-mail, voltar no navegador) não é possível por aqui.
 * Erro ao ler os vínculos mostra um aviso com "Tentar de novo", nunca o formulário: a RPC
 * `criar_empresa_completo` não confere vínculo existente, então só se cria com "sem vínculo" confirmado.
 */
export default async function CriarEmpresaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/criar-empresa');

  let temVinculo = false;
  let erroVinculos = false;
  try {
    temVinculo = (await carregarVinculosAtivos(supabase, user.id)).length > 0;
  } catch {
    erroVinculos = true;
  }
  if (temVinculo) redirect('/dashboard');

  if (erroVinculos) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--color-bg)' }}>
        <div role="alert" className="w-full max-w-sm rounded-2xl p-6 text-center"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 700, color: 'var(--color-ink)', marginBottom: 6 }}>
            Não foi possível conferir suas empresas.
          </p>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-ink3)', marginBottom: 16 }}>
            Confira a conexão e tente de novo.
          </p>
          <Link href="/criar-empresa" prefetch={false} className="press inline-flex items-center justify-center h-10 px-5 rounded-xl text-sm font-bold"
            style={{ background: 'var(--color-primary)', color: '#fff' }}>
            Tentar de novo
          </Link>
        </div>
      </main>
    );
  }

  return <CriarEmpresaForm banner={<ConvitesRecebidosBanner semEmpresa />} />;
}
