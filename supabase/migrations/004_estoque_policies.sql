-- ============================================================
-- ESTOQUE — Policies de escrita para gestores/owners
-- ============================================================
-- Reutiliza is_gestor_ou_owner() criada na 003_despesas_policies

-- ----------------------------------------------------------------
-- PRODUTOS
-- ----------------------------------------------------------------

-- INSERT: apenas gestores e owners
create policy "produtos: gestor pode inserir"
  on public.produtos
  for insert
  with check (is_gestor_ou_owner(empresa_id));

-- UPDATE: apenas gestores e owners
create policy "produtos: gestor pode atualizar"
  on public.produtos
  for update
  using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));

-- DELETE: apenas owner
create policy "produtos: owner pode deletar"
  on public.produtos
  for delete
  using (
    exists (
      select 1 from public.empresas
      where id = empresa_id and owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------
-- ESTOQUE_MOVIMENTOS
-- ----------------------------------------------------------------

-- INSERT: gestores/owners registram entradas, saídas e ajustes;
--         profissionais podem registrar saídas vinculadas a agendamentos seus
create policy "estoque_movimentos: gestor pode inserir"
  on public.estoque_movimentos
  for insert
  with check (
    is_gestor_ou_owner(empresa_id)
    or (
      tipo = 'saida'
      and agendamento_id is not null
      and exists (
        select 1 from public.agendamentos
        where id = agendamento_id
          and profissional_id = auth.uid()
          and empresa_id = estoque_movimentos.empresa_id
      )
    )
  );

-- UPDATE: apenas gestores e owners (correções manuais)
create policy "estoque_movimentos: gestor pode atualizar"
  on public.estoque_movimentos
  for update
  using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));

-- DELETE: apenas owner
create policy "estoque_movimentos: owner pode deletar"
  on public.estoque_movimentos
  for delete
  using (
    exists (
      select 1 from public.empresas
      where id = empresa_id and owner_id = auth.uid()
    )
  );
