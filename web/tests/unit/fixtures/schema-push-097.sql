-- Esquema mínimo para rodar a migration 097 no PGlite (Postgres em memória) dentro do vitest.
-- Só o que a 097 toca, como está em produção (096):
--   users: id + push_token (005);
--   empresas / empresa_membros (001), com created_at (o backfill escolhe a empresa mais antiga);
--   notificacoes (001) com a policy "notificacoes: ver proprias" (001);
--   minha_empresas() (001): vínculo ativo em empresa_membros ou dona por empresas.owner_id.
-- auth.uid() lê a configuração de sessão app.uid.
-- NÃO é o schema de produção: serve só para exercitar a lógica da 097.
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create role anon;
create role authenticated;
create role service_role bypassrls;
grant usage on schema auth to authenticated, anon, service_role;
grant usage on schema public to authenticated, anon, service_role;

create table public.users (
  id         uuid primary key,
  nome       text,
  push_token text
);
create table public.empresas (
  id         uuid primary key,
  owner_id   uuid references public.users(id),
  created_at timestamptz default now()
);
create table public.empresa_membros (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  role       text not null default 'profissional',
  ativo      boolean default true,
  created_at timestamptz default now(),
  unique (empresa_id, user_id)
);

create table public.notificacoes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  empresa_id  uuid references public.empresas(id),
  tipo        text not null,
  titulo      text not null,
  mensagem    text,
  lida        boolean default false,
  created_at  timestamptz default now()
);
alter table public.notificacoes enable row level security;
create policy "notificacoes: ver proprias" on public.notificacoes
  for select using (user_id = auth.uid());

create function public.minha_empresas() returns setof uuid language sql stable security definer as $$
  select empresa_id from public.empresa_membros where user_id = auth.uid() and ativo = true
  union
  select id from public.empresas where owner_id = auth.uid()
$$;

-- Privilégios padrão do Supabase nas tabelas do schema public.
grant select, insert, update, delete on all tables in schema public to authenticated, anon, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, anon, service_role;
