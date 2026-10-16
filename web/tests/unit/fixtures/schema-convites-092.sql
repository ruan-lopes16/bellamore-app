-- Esquema mínimo para rodar a migration 092 no PGlite (Postgres em memória) dentro do vitest.
-- Tabelas que a 092 toca, os triggers vigentes de empresa_membros (043 e 083, copiados) e as
-- funções de permissão: tem_permissao lê a sessão (app.negar = chaves negadas; não-membro e
-- sem sessão sempre false), eh_dona_da_empresa e minha_empresas iguais às de produção.
-- Os privilégios padrão imitam o Supabase (anon/authenticated com tudo nas tabelas novas),
-- para o teste provar que os revokes da 092 valem.
-- NÃO é o schema de produção: serve só para exercitar a lógica.
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create table auth.users (id uuid primary key, email text);
create role anon;
create role authenticated;
grant usage on schema auth to authenticated, anon;
grant usage on schema public to authenticated, anon;
alter default privileges in schema public grant all on tables to anon, authenticated;

create type perfil_role as enum ('owner', 'gestor', 'profissional', 'cliente');

create table empresas (id uuid primary key, owner_id uuid, nome text);
create table users (id uuid primary key, nome text, email text);
create table empresa_membros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role perfil_role not null,
  percentual_comissao numeric(5,2) default 0,
  tipo_contrato text check (tipo_contrato in ('pj', 'clt')),
  ativo boolean default true,
  created_at timestamptz default now(),
  unique (empresa_id, user_id)
);

create function minha_empresas() returns setof uuid language sql stable security definer as $$
  select empresa_id from public.empresa_membros where user_id = auth.uid() and ativo = true
  union select id from public.empresas where owner_id = auth.uid() $$;
create function eh_dona_da_empresa(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.empresas where id = p_empresa and owner_id = auth.uid())
    or exists (select 1 from public.empresa_membros
               where empresa_id = p_empresa and user_id = auth.uid() and ativo = true and role::text = 'owner')) $$;
create function tem_permissao(p_empresa uuid, p_chave text) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
    and (public.eh_dona_da_empresa(p_empresa)
         or (exists (select 1 from public.empresa_membros where empresa_id = p_empresa and user_id = auth.uid() and ativo = true)
             and position(p_chave in coalesce(current_setting('app.negar', true), '')) = 0)) $$;

-- 043: trg_bloquear_alteracao_role (corpo igual ao de produção).
create function bloquear_alteracao_role() returns trigger as $$
begin
  if new.user_id is distinct from old.user_id or new.empresa_id is distinct from old.empresa_id then
    raise exception 'Não é possível reatribuir esta associação a outro usuário/empresa.';
  end if;
  if new.role is distinct from old.role then
    if new.role = 'owner' or old.role = 'owner' then raise exception 'O papel de dona não pode ser alterado.'; end if;
    if new.user_id = auth.uid() then raise exception 'Não é possível alterar o próprio papel.'; end if;
    if not exists (select 1 from public.empresas where id = new.empresa_id and owner_id = auth.uid()) then
      raise exception 'Somente a dona da empresa pode alterar o papel de um membro.';
    end if;
  end if;
  return new;
end $$ language plpgsql security definer;
create trigger trg_bloquear_alteracao_role before update on empresa_membros
  for each row execute function bloquear_alteracao_role();

-- 083: trg_membros_papel_so_dona.
create function fn_membros_papel_so_dona() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null
     and not exists (select 1 from public.empresas where id = old.empresa_id and owner_id = auth.uid()) then
    raise exception 'Só a dona pode mudar o papel de alguém' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_membros_papel_so_dona before update of role on empresa_membros
  for each row execute function fn_membros_papel_so_dona();

-- RLS de empresa_membros como em produção (083): SELECT de membro, UPDATE e INSERT com equipe.gerenciar.
-- A 092 derruba a policy de INSERT (conta existente nunca é vinculada sem aceite).
alter table empresa_membros enable row level security;
create policy "membros: ver da empresa" on empresa_membros for select using (empresa_id in (select minha_empresas()));
create policy "membros: gestor ou owner atualiza" on empresa_membros for update
  using (tem_permissao(empresa_id, 'equipe.gerenciar')
         and (eh_dona_da_empresa(empresa_id) or (role = 'profissional'::perfil_role and user_id <> auth.uid())))
  with check (tem_permissao(empresa_id, 'equipe.gerenciar')
         and (eh_dona_da_empresa(empresa_id) or (role = 'profissional'::perfil_role and user_id <> auth.uid())));
create policy "membros: gestor ou owner convida" on empresa_membros for insert with check (
  role = any (array['gestor'::perfil_role, 'profissional'::perfil_role])
  and tem_permissao(empresa_id, 'equipe.gerenciar')
  and (role = 'profissional'::perfil_role
       or exists (select 1 from empresas where empresas.id = empresa_membros.empresa_id and empresas.owner_id = auth.uid())));
