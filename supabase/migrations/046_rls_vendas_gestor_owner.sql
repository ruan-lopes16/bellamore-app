-- ============================================================
-- MIGRATION 046 — RLS: vendas avulsas restritas a gestor/owner
--
-- "vendas" (vendas avulsas de produto, fora de comanda/agendamento)
-- não tem coluna nenhuma que identifique qual profissional realizou
-- a venda, e não gera comissão. Não existe um jeito correto de
-- mostrar "só o que é dela" aqui — então, como fatura da empresa sem
-- relação com a comissão de ninguém, a leitura fica restrita a
-- gestor/owner (mesmo tratamento de despesas/financeiro/relatórios).
--
-- INSERT continua liberado para qualquer membro ativo: o fluxo de
-- comanda (web/app/(app)/comanda/page.tsx) registra uma venda avulsa
-- automaticamente quando a profissional vende um produto durante o
-- próprio atendimento — isso precisa continuar funcionando. O que
-- fica restrito é a leitura do histórico/faturamento agregado (tela
-- "Vendas", aba Histórico) e edição/remoção.
-- ============================================================

DROP POLICY IF EXISTS "vendas: membro gerencia" ON public.vendas;

CREATE POLICY "vendas: membro insere"
  ON public.vendas FOR INSERT
  WITH CHECK (empresa_id IN (SELECT minha_empresas()));

CREATE POLICY "vendas: gestor ou owner ve"
  ON public.vendas FOR SELECT
  USING (is_gestor_ou_owner(empresa_id));

CREATE POLICY "vendas: gestor ou owner atualiza"
  ON public.vendas FOR UPDATE
  USING (is_gestor_ou_owner(empresa_id));

CREATE POLICY "vendas: gestor ou owner deleta"
  ON public.vendas FOR DELETE
  USING (is_gestor_ou_owner(empresa_id));

DROP POLICY IF EXISTS "venda_itens: membro gerencia" ON public.venda_itens;

CREATE POLICY "venda_itens: membro insere"
  ON public.venda_itens FOR INSERT
  WITH CHECK (empresa_id IN (SELECT minha_empresas()));

CREATE POLICY "venda_itens: gestor ou owner ve"
  ON public.venda_itens FOR SELECT
  USING (is_gestor_ou_owner(empresa_id));

CREATE POLICY "venda_itens: gestor ou owner atualiza"
  ON public.venda_itens FOR UPDATE
  USING (is_gestor_ou_owner(empresa_id));

CREATE POLICY "venda_itens: gestor ou owner deleta"
  ON public.venda_itens FOR DELETE
  USING (is_gestor_ou_owner(empresa_id));
