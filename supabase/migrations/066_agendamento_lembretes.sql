-- ============================================================
-- 066 — Rastreio de lembretes de atendimento
-- ============================================================
-- Duas colunas de marca-tempo em agendamentos. O cron de lembretes
-- (/api/cron/lembretes) roda a cada 5 min e usa estas colunas como
-- ledger de idempotência: preenche ao enviar o push e nunca reenvia.
--
-- Nulas por padrão. Sem policy nova — a cobertura de RLS de
-- agendamentos já vale para colunas novas, e o cron usa service_role.
--
-- Rollback:
--   alter table public.agendamentos
--     drop column if exists lembrete_vespera_em,
--     drop column if exists lembrete_30min_em;

alter table public.agendamentos
  add column if not exists lembrete_vespera_em timestamptz,
  add column if not exists lembrete_30min_em   timestamptz;
