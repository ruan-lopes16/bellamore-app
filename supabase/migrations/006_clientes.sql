-- ============================================================
-- CLIENTES — tabela interna (sem vínculo com auth.users)
-- ============================================================

create table public.clientes (
  id              uuid primary key default uuid_generate_v4(),
  empresa_id      uuid not null references public.empresas(id) on delete cascade,
  nome            text not null,
  telefone        text,
  email           text,
  data_nascimento date,
  observacoes     text,
  ativo           boolean default true,
  created_at      timestamptz default now()
);

alter table public.clientes enable row level security;

create policy "clientes: membro ve"
  on public.clientes for select
  using (empresa_id in (select minha_empresas()));

create policy "clientes: gestor pode inserir"
  on public.clientes for insert
  with check (is_gestor_ou_owner(empresa_id));

create policy "clientes: gestor pode atualizar"
  on public.clientes for update
  using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));

create policy "clientes: owner pode deletar"
  on public.clientes for delete
  using (
    exists (
      select 1 from public.empresas
      where id = empresa_id and owner_id = auth.uid()
    )
  );
