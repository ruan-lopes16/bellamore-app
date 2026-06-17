-- ============================================================
-- PUSH TOKEN — adiciona coluna na tabela users
-- ============================================================
-- A policy "users: editar proprio" da 001 já cobre o UPDATE,
-- então não são necessárias novas policies.

alter table public.users
  add column if not exists push_token text;
