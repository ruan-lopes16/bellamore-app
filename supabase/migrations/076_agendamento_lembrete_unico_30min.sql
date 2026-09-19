-- ============================================================
-- 076 — Lembrete de atendimento: janela única de 30 min
-- ============================================================
-- A migration 070 criou duas colunas (1h antes + 15 min antes). O produto
-- mudou de ideia: agora é 1 push único, 30 min antes de cada atendimento,
-- somado ao resumo diário (que não muda — outra rota, outro ledger).
-- Ver shared/lembretes.ts e /api/cron/lembretes.
--
-- Nula por padrão. Sem policy nova — a cobertura de RLS de agendamentos já
-- vale para colunas novas, e o cron usa service_role.
--
-- Rollback:
--   alter table public.agendamentos drop column if exists lembrete_30min_em;

alter table public.agendamentos
  drop column if exists lembrete_1h_em,
  drop column if exists lembrete_15min_em,
  add  column if not exists lembrete_30min_em timestamptz;
