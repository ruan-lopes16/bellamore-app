-- ============================================================
-- MIGRATION 043 — empresa_membros: policies de escrita + trigger de role
--
-- empresa_membros nunca teve policy de INSERT nem UPDATE (só SELECT,
-- migration 001). Isso deixava sem efeito, sob RLS:
--   - o toggle ativo/inativo em Equipe (web e mobile chamam
--     supabase.from('empresa_membros').update({ativo}) direto)
--   - o convite direto do mobile quando o usuário já existe
--     (convidar-profissional.tsx faz upsert client-side)
-- Esta migration:
--   1. Permite INSERT de novo membro por gestor/owner — role
--      'profissional' por qualquer um dos dois, role 'gestor' só
--      pela dona (owner_id da empresa).
--   2. Permite UPDATE geral (ativo, percentual_comissao) por
--      gestor/owner — corrige o toggle ativo/inativo.
--   3. Bloqueia, via trigger, qualquer UPDATE que mude a coluna role
--      fora da regra: só a dona altera role; ninguém altera o
--      próprio role; role 'owner' nunca é atribuído/removido por
--      aqui (só a função criar_empresa_completo, que roda como
--      SECURITY DEFINER e não passa por RLS/trigger de policy).
--   4. Bloqueia, via o mesmo trigger, qualquer UPDATE que reatribua
--      user_id ou empresa_id — a policy de UPDATE acima é permissiva
--      o bastante (is_gestor_ou_owner) para deixar essas colunas
--      passarem sem o guard explícito; sem isso um gestor poderia
--      trocar o user_id de uma linha com role='gestor' para promover
--      um cúmplice sem nunca alterar a coluna role.
-- ============================================================

CREATE POLICY "membros: gestor ou owner convida"
  ON public.empresa_membros
  FOR INSERT
  WITH CHECK (
    role IN ('gestor', 'profissional')
    AND is_gestor_ou_owner(empresa_id)
    AND (
      role = 'profissional'
      OR EXISTS (
        SELECT 1 FROM public.empresas
        WHERE id = empresa_id AND owner_id = auth.uid()
      )
    )
  );

CREATE POLICY "membros: gestor ou owner atualiza"
  ON public.empresa_membros
  FOR UPDATE
  USING (is_gestor_ou_owner(empresa_id))
  WITH CHECK (is_gestor_ou_owner(empresa_id));

CREATE OR REPLACE FUNCTION public.bloquear_alteracao_role()
RETURNS trigger AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
    RAISE EXCEPTION 'Não é possível reatribuir esta associação a outro usuário/empresa.';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NEW.role = 'owner' OR OLD.role = 'owner' THEN
      RAISE EXCEPTION 'O papel de dona não pode ser alterado.';
    END IF;
    IF NEW.user_id = auth.uid() THEN
      RAISE EXCEPTION 'Não é possível alterar o próprio papel.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.empresas
      WHERE id = NEW.empresa_id AND owner_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Somente a dona da empresa pode alterar o papel de um membro.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_bloquear_alteracao_role ON public.empresa_membros;
CREATE TRIGGER trg_bloquear_alteracao_role
  BEFORE UPDATE ON public.empresa_membros
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_alteracao_role();
