-- ============================================================
-- MIGRATION 045 — RLS: comandas/comanda_itens/pagamentos por profissional
--
-- As policies "comandas: membro gerencia" e "comanda_itens: membro
-- gerencia" (migrations 001/009) liberam QUALQUER membro ativo da
-- empresa para ler e escrever QUALQUER comanda, independente de quem
-- atendeu — uma profissional conseguia ver (e editar) comandas de
-- colegas, incluindo valores. Esta migration restringe leitura e
-- escrita de linhas já existentes à profissional que atendeu ou a
-- gestor/owner.
--
-- comandas.profissional_id não é preenchido pelo fluxo atual do app
-- (fica sempre null), então a checagem real usa
-- agendamentos.profissional_id via agendamentos.comanda_id.
--
-- INSERT continua liberado para qualquer membro ativo — criar uma
-- comanda nova (ou seus itens) para o próprio atendimento precisa
-- continuar funcionando; a checagem de dono só faz sentido para
-- linhas que já existem.
-- ============================================================

CREATE OR REPLACE FUNCTION public.comanda_pertence_ao_profissional(p_comanda_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agendamentos a
    WHERE a.comanda_id = p_comanda_id AND a.profissional_id = auth.uid()
  );
$$;

-- comandas ------------------------------------------------------
DROP POLICY IF EXISTS "comandas: membro gerencia" ON public.comandas;

CREATE POLICY "comandas: membro insere"
  ON public.comandas FOR INSERT
  WITH CHECK (empresa_id IN (SELECT minha_empresas()));

CREATE POLICY "comandas: profissional ou gestor ve"
  ON public.comandas FOR SELECT
  USING (
    is_gestor_ou_owner(empresa_id)
    OR profissional_id = auth.uid()
    OR comanda_pertence_ao_profissional(id)
  );

CREATE POLICY "comandas: profissional ou gestor atualiza"
  ON public.comandas FOR UPDATE
  USING (
    is_gestor_ou_owner(empresa_id)
    OR profissional_id = auth.uid()
    OR comanda_pertence_ao_profissional(id)
  );

CREATE POLICY "comandas: profissional ou gestor deleta"
  ON public.comandas FOR DELETE
  USING (
    is_gestor_ou_owner(empresa_id)
    OR profissional_id = auth.uid()
    OR comanda_pertence_ao_profissional(id)
  );

-- comanda_itens ---------------------------------------------------
DROP POLICY IF EXISTS "comanda_itens: membro gerencia" ON public.comanda_itens;

CREATE POLICY "comanda_itens: membro insere"
  ON public.comanda_itens FOR INSERT
  WITH CHECK (empresa_id IN (SELECT minha_empresas()));

CREATE POLICY "comanda_itens: profissional ou gestor ve"
  ON public.comanda_itens FOR SELECT
  USING (
    is_gestor_ou_owner(empresa_id)
    OR profissional_id = auth.uid()
    OR comanda_pertence_ao_profissional(comanda_id)
  );

CREATE POLICY "comanda_itens: profissional ou gestor atualiza"
  ON public.comanda_itens FOR UPDATE
  USING (
    is_gestor_ou_owner(empresa_id)
    OR profissional_id = auth.uid()
    OR comanda_pertence_ao_profissional(comanda_id)
  );

CREATE POLICY "comanda_itens: profissional ou gestor deleta"
  ON public.comanda_itens FOR DELETE
  USING (
    is_gestor_ou_owner(empresa_id)
    OR profissional_id = auth.uid()
    OR comanda_pertence_ao_profissional(comanda_id)
  );

-- pagamentos ------------------------------------------------------
-- Mantém a policy de INSERT como está (criar um pagamento pra
-- própria comanda continua liberado). Restringe leitura e remoção a
-- pagamentos da própria comanda, ou a gestor/owner. Pagamentos sem
-- comanda_id (vendas avulsas via PDV) ficam só para gestor/owner,
-- coerente com a migration 046 (vendas: só gestor/owner).
DROP POLICY IF EXISTS "pagamentos: membro ve" ON public.pagamentos;
DROP POLICY IF EXISTS "pagamentos: membro seleciona" ON public.pagamentos;

CREATE POLICY "pagamentos: profissional ou gestor ve"
  ON public.pagamentos FOR SELECT
  USING (
    is_gestor_ou_owner(empresa_id)
    OR (comanda_id IS NOT NULL AND comanda_pertence_ao_profissional(comanda_id))
  );

CREATE POLICY "pagamentos: profissional ou gestor deleta"
  ON public.pagamentos FOR DELETE
  USING (
    is_gestor_ou_owner(empresa_id)
    OR (comanda_id IS NOT NULL AND comanda_pertence_ao_profissional(comanda_id))
  );
