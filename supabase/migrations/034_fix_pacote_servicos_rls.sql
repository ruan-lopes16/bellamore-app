-- Corrige RLS de pacote_servicos para evitar falha ao vincular servicos
-- logo apos criar um pacote no catalogo.

alter table public.pacote_servicos enable row level security;

drop policy if exists "pacote_servicos: membros podem ver" on public.pacote_servicos;
drop policy if exists "pacote_servicos: gestor pode inserir" on public.pacote_servicos;
drop policy if exists "pacote_servicos: gestor pode atualizar" on public.pacote_servicos;
drop policy if exists "pacote_servicos: owner pode deletar" on public.pacote_servicos;
drop policy if exists "pacote_servicos: membro gerencia insert" on public.pacote_servicos;
drop policy if exists "pacote_servicos: membro gerencia delete" on public.pacote_servicos;

create policy "pacote_servicos: membro ve"
  on public.pacote_servicos
  for select
  using (
    exists (
      select 1
      from public.pacotes p
      where p.id = pacote_servicos.pacote_id
        and p.empresa_id in (select minha_empresas())
    )
  );

create policy "pacote_servicos: membro insere"
  on public.pacote_servicos
  for insert
  with check (
    exists (
      select 1
      from public.pacotes p
      where p.id = pacote_servicos.pacote_id
        and p.empresa_id in (select minha_empresas())
    )
  );

create policy "pacote_servicos: membro atualiza"
  on public.pacote_servicos
  for update
  using (
    exists (
      select 1
      from public.pacotes p
      where p.id = pacote_servicos.pacote_id
        and p.empresa_id in (select minha_empresas())
    )
  )
  with check (
    exists (
      select 1
      from public.pacotes p
      where p.id = pacote_servicos.pacote_id
        and p.empresa_id in (select minha_empresas())
    )
  );

create policy "pacote_servicos: membro remove"
  on public.pacote_servicos
  for delete
  using (
    exists (
      select 1
      from public.pacotes p
      where p.id = pacote_servicos.pacote_id
        and p.empresa_id in (select minha_empresas())
    )
  );
