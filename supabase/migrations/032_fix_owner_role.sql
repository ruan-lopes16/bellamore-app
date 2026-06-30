-- ============================================================
-- MIGRATION 032 — Adiciona 'owner' ao enum perfil_role
--
-- ATENÇÃO: ALTER TYPE ADD VALUE não pode estar na mesma
-- transação que queries que usam o novo valor.
-- Rode esta migration ANTES da 033.
-- ============================================================

ALTER TYPE perfil_role ADD VALUE IF NOT EXISTS 'owner';
