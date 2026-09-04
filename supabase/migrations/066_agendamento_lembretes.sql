-- ============================================================
-- 066 — Rastreio de lembretes de atendimento
-- ============================================================
-- Duas colunas de marca-tempo em agendamentos. O cron de lembretes
-- (/api/cron/lembretes) roda a cada 5 min e usa estas colunas como
-- ledger de idempotência: preenche ao enviar o push e nunca reenvia.
--
-- Cadência: 1 push 1h antes + 1 push 15 min antes de cada atendimento.
--
-- Nulas por padrão. Sem policy nova — a cobertura de RLS de
-- agendamentos já vale para colunas novas, e o cron usa service_role.
--
-- (Uma versão anterior deste arquivo usava lembrete_vespera_em /
--  lembrete_30min_em; o drop abaixo torna a migration segura de aplicar
--  mesmo em bancos onde a versão antiga chegou a rodar.)
--
-- Rollback:
--   alter table public.agendamentos
--     drop column if exists lembrete_1h_em,
--     drop column if exists lembrete_15min_em;

alter table public.agendamentos
  drop column if exists lembrete_vespera_em,
  drop column if exists lembrete_30min_em,
  add  column if not exists lembrete_1h_em    timestamptz,
  add  column if not exists lembrete_15min_em timestamptz;
