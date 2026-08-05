-- ============================================================
-- MIGRATION 049 — RLS: gestor pode atualizar dados da empresa
--
-- A única policy de escrita em "empresas" era "empresas: owner pode
-- editar" (for all, using owner_id = auth.uid()), então só o owner
-- conseguia dar UPDATE na linha. As telas de Configurações (web e
-- mobile) permitem que um gestor edite a seção de taxa de
-- cancelamento (colunas taxa_cancelamento_* em public.empresas), mas
-- como o gestor não é owner, o UPDATE era rejeitado pelo RLS.
--
-- Esta migration é aditiva: concede UPDATE a gestor/owner via
-- is_gestor_ou_owner(id) (nesta tabela, o próprio "id" da empresa é o
-- empresa_id), sem tocar na policy "empresas: owner pode editar" já
-- existente.
-- ============================================================

create policy "empresas: gestor pode atualizar"
  on public.empresas for update
  using (is_gestor_ou_owner(id))
  with check (is_gestor_ou_owner(id));
