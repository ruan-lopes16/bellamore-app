-- ============================================================
-- PRODUTOS — adiciona coluna qtd_por_unidade
-- Usada quando unidade = 'pct' para registrar quantas
-- unidades existem dentro de cada pacote.
-- Ex: 1 pct de luvas = 100 par
-- ============================================================

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS qtd_por_unidade numeric(10,3) NOT NULL DEFAULT 1;
