alter table public.pacote_servicos enable row level security;

create policy "pacote_servicos: membros podem ver"
  on public.pacote_servicos
  for select
  using (
    exists (
      select 1 from public.pacotes p
      where p.id = pacote_id
        and p.empresa_id = any(minha_empresas())
    )
  );

create policy "pacote_servicos: gestor pode inserir"
  on public.pacote_servicos
  for insert
  with check (
    exists (
      select 1 from public.pacotes p
      where p.id = pacote_id
        and is_gestor_ou_owner(p.empresa_id)
    )
  );

create policy "pacote_servicos: gestor pode atualizar"
  on public.pacote_servicos
  for update
  using (
    exists (
      select 1 from public.pacotes p
      where p.id = pacote_id
        and is_gestor_ou_owner(p.empresa_id)
    )
  )
  with check (
    exists (
      select 1 from public.pacotes p
      where p.id = pacote_id
        and is_gestor_ou_owner(p.empresa_id)
    )
  );

create policy "pacote_servicos: owner pode deletar"
  on public.pacote_servicos
  for delete
  using (
    exists (
      select 1 from public.pacotes p
      join public.empresas e on e.id = p.empresa_id
      where p.id = pacote_id
        and e.owner_id = auth.uid()
    )
  );
