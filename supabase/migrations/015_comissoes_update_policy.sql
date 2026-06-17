-- ============================================================
-- COMISSOES — políticas de escrita
--
-- A migration inicial (001) criou apenas SELECT em comissoes.
-- Esta migration adiciona UPDATE (para marcar comissões como pagas)
-- e INSERT (para casos onde o trigger não é suficiente).
--
-- Somente membros da empresa (gestores/owners) podem atualizar.
-- O profissional não pode auto-aprovar sua própria comissão.
-- ============================================================

-- UPDATE: gestor/owner marca como 'pago'
DO $$ BEGIN
  CREATE POLICY "comissoes: membro atualiza"
    ON public.comissoes FOR UPDATE
    USING   (empresa_id IN (SELECT minha_empresas()))
    WITH CHECK (empresa_id IN (SELECT minha_empresas()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- INSERT: usado pelo trigger mas também por inserts manuais futuros
DO $$ BEGIN
  CREATE POLICY "comissoes: membro insere"
    ON public.comissoes FOR INSERT
    WITH CHECK (empresa_id IN (SELECT minha_empresas()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
