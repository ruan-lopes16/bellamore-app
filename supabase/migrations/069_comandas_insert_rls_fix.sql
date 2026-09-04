-- ============================================================
-- 069 — Garante a RLS correta de comandas (fecho de comanda falhava)
-- ============================================================
-- Sintoma em produção: "new row violates row-level security policy for
-- table comandas" ao clicar em "Fechar comanda" (INSERT em public.comandas).
--
-- Causa provável: a migration 045_rls_comandas_pagamentos_por_profissional
-- substitui a policy ampla "comandas: membro gerencia" (criada na 009) por
-- 4 policies separadas, incluindo uma de INSERT explícita
-- ("comandas: membro insere"). Se a 045 nunca foi de fato aplicada neste
-- banco (migration escrita ≠ migration rodada, já visto outras vezes neste
-- projeto), a tabela pode ter ficado sem NENHUMA policy de INSERT — RLS
-- habilitada sem policy nega tudo por padrão.
--
-- Esta migration é idempotente e segura de aplicar em qualquer um dos
-- estados possíveis (009 sem 045, 045 já aplicada, ou nada aplicado):
-- remove todos os nomes de policy conhecidos e recria do zero o conjunto
-- correto (igual ao que a 045 pretendia deixar).

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

DROP POLICY IF EXISTS "comandas: membro gerencia" ON public.comandas;
DROP POLICY IF EXISTS "comandas: membro insere" ON public.comandas;
DROP POLICY IF EXISTS "comandas: profissional ou gestor ve" ON public.comandas;
DROP POLICY IF EXISTS "comandas: profissional ou gestor atualiza" ON public.comandas;
DROP POLICY IF EXISTS "comandas: profissional ou gestor deleta" ON public.comandas;

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
