import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { carregarVinculosAtivos } from '@/lib/auth/empresa-ativa';
import ConvitesRecebidosBanner from '@/components/ConvitesRecebidosBanner';
import CriarEmpresaForm from './CriarEmpresaForm';

/**
 * Criar o estúdio. Quem já tem vínculo ativo com alguma empresa vai para o painel: criar uma 2ª
 * empresa por engano (link antigo do e-mail, voltar no navegador) não é possível por aqui.
 * Erro ao ler os vínculos mostra o formulário (a RPC do banco é a última palavra).
 */
export default async function CriarEmpresaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/criar-empresa');

  let temVinculo = false;
  try {
    temVinculo = (await carregarVinculosAtivos(supabase, user.id)).length > 0;
  } catch {
    temVinculo = false;
  }
  if (temVinculo) redirect('/dashboard');

  return <CriarEmpresaForm banner={<ConvitesRecebidosBanner semEmpresa />} />;
}
