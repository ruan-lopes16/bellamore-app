-- ============================================================
-- MIGRATION 041 — Documenta 'owner' no enum perfil_role
--
-- O enum perfil_role (migration 001) nunca declarou 'owner', mas a
-- migration 032 e todo o código (web/mobile) já leem/gravam
-- role = 'owner' em empresa_membros. Isso só funciona porque a
-- segurança (RLS) nunca dependeu desse valor — is_gestor_ou_owner()
-- (003_despesas_policies.sql) decide "é dona" checando
-- empresas.owner_id, não a coluna role. Ou seja, 'owner' já existe
-- no banco por alteração direta fora de migration (schema drift);
-- esta migration só torna isso reproduzível a partir do zero.
-- ============================================================

ALTER TYPE perfil_role ADD VALUE IF NOT EXISTS 'owner';
