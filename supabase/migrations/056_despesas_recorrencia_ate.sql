-- ============================================================
-- DESPESAS — data de término opcional para recorrência
--
-- Quando preenchida, o auto-lançamento mensal (web) continua sugerindo
-- a despesa até o mês em que a data cai (inclusive); a partir do mês
-- seguinte, para de sugerir. Sem data, a recorrência não tem fim
-- (comportamento anterior, inalterado).
-- ============================================================

alter table public.despesas
  add column recorrencia_ate date;
