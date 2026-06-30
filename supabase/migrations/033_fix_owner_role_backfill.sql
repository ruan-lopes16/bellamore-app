-- ============================================================
-- MIGRATION 033 — Corrige role do owner em empresa_membros
--
-- Depende da 032 (enum 'owner' já deve existir).
--
-- Problema 1: criar_empresa_completo usava role='gestor' para o owner.
-- Problema 2: registros existentes com owner tendo role errado.
-- ============================================================

-- Corrige a função de criação de empresa
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
  VALUES (v_empresa_id, auth.uid(), 'owner', true);

  RETURN v_empresa_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Corrige registros existentes onde o owner_id da empresa não tem role='owner'
UPDATE public.empresa_membros em
SET role = 'owner'
FROM public.empresas e
WHERE em.empresa_id = e.id
  AND em.user_id    = e.owner_id
  AND em.role      <> 'owner';
