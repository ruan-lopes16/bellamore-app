-- ============================================================
-- MIGRATION 002 — campos de perfil estendido em users
-- ============================================================

alter table public.users
  add column if not exists email        text,
  add column if not exists data_nascimento date,
  add column if not exists endereco     text;
