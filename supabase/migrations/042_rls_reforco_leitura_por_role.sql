-- ============================================================
-- MIGRATION 042 — RLS: leitura por role (despesas, agendamentos, comissões)
--
-- As policies "despesas: membro ve", "agendamentos: ver" e
-- "comissoes: ver" (migration 001) tinham comentários dizendo
-- "profissional vê só as suas / não vê despesas", mas a condição
-- real (`empresa_id in (select minha_empresas())`) libera QUALQUER
-- membro ativo, de qualquer role. Esta migration corrige isso
-- reaproveitando is_gestor_ou_owner() (003_despesas_policies.sql).
-- ============================================================

DROP POLICY IF EXISTS "despesas: membro ve" ON public.despesas;
CREATE POLICY "despesas: gestor ou owner ve"
  ON public.despesas
  FOR SELECT
  USING (is_gestor_ou_owner(empresa_id));

DROP POLICY IF EXISTS "agendamentos: ver" ON public.agendamentos;
CREATE POLICY "agendamentos: ver"
  ON public.agendamentos
  FOR SELECT
  USING (
    profissional_id = auth.uid()
    OR cliente_id = auth.uid()
    OR is_gestor_ou_owner(empresa_id)
  );

DROP POLICY IF EXISTS "comissoes: ver" ON public.comissoes;
CREATE POLICY "comissoes: ver"
  ON public.comissoes
  FOR SELECT
  USING (
    profissional_id = auth.uid()
    OR is_gestor_ou_owner(empresa_id)
  );

-- A UPDATE original (015_comissoes_update_policy.sql) tinha o mesmo
-- problema: o comentário dizia "somente gestores/owners", mas a
-- condição liberava qualquer membro, inclusive a própria profissional
-- marcando sua comissão como paga.
DROP POLICY IF EXISTS "comissoes: membro atualiza" ON public.comissoes;
CREATE POLICY "comissoes: gestor ou owner atualiza"
  ON public.comissoes
  FOR UPDATE
  USING (is_gestor_ou_owner(empresa_id))
  WITH CHECK (is_gestor_ou_owner(empresa_id));
