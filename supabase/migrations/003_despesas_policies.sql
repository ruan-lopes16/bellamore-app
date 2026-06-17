-- ============================================================
-- DESPESAS — Policies de escrita para gestores/owners
-- ============================================================

-- Função auxiliar: verifica se o usuário é gestor ou owner da empresa
create or replace function is_gestor_ou_owner(p_empresa_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.empresas
    where id = p_empresa_id and owner_id = auth.uid()
  )
  or exists (
    select 1 from public.empresa_membros
    where empresa_id = p_empresa_id
      and user_id = auth.uid()
      and role = 'gestor'
      and ativo = true
  );
$$ language sql security definer;

-- INSERT: apenas gestores e owners
create policy "despesas: gestor pode inserir"
  on public.despesas
  for insert
  with check (is_gestor_ou_owner(empresa_id));

-- UPDATE: apenas gestores e owners (para marcar como paga, editar, etc.)
create policy "despesas: gestor pode atualizar"
  on public.despesas
  for update
  using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));

-- DELETE: apenas owner
create policy "despesas: owner pode deletar"
  on public.despesas
  for delete
  using (
    exists (
      select 1 from public.empresas
      where id = empresa_id and owner_id = auth.uid()
    )
  );
