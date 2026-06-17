-- ============================================================
-- MIGRATION 017 — Função SECURITY DEFINER para criação de empresa
-- Executa upsert em public.users + insert em empresas + empresa_membros
-- atomicamente, sem depender de políticas RLS do cliente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.criar_empresa_completo(
  p_nome      text,
  p_telefone  text DEFAULT NULL,
  p_endereco  text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_empresa_id uuid;
BEGIN
  INSERT INTO public.users (id, nome, email)
  SELECT auth.uid(),
         COALESCE(raw_user_meta_data->>'nome', split_part(email, '@', 1)),
         email
  FROM auth.users WHERE id = auth.uid()
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.empresas (owner_id, nome, telefone, endereco, ativo)
  VALUES (auth.uid(), p_nome, p_telefone, p_endereco, true)
  RETURNING id INTO v_empresa_id;

  INSERT INTO public.empresa_membros (empresa_id, user_id, role, ativo)
  VALUES (v_empresa_id, auth.uid(), 'gestor', true);

  RETURN v_empresa_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
