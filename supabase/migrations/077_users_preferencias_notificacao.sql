-- ============================================================
-- 077 — Preferências de notificação por usuário
-- ============================================================
-- Cada pessoa escolhe quais dos 2 avisos push quer receber: resumo diário
-- e lembrete de atendimento. Controla tanto o push quanto a criação da
-- linha em notificacoes — é "parar de receber" mesmo, não só silenciar o
-- aparelho. Ver /api/cron/resumo-diario e /api/cron/lembretes.
--
-- true por padrão — ninguém perde notificação sem escolher desligar.
-- Sem policy nova — "users: editar proprio" (migration 001) já cobre
-- usuário editando a própria linha (mesma usada hoje por nome/telefone).
--
-- Rollback:
--   alter table public.users
--     drop column if exists notif_resumo_diario,
--     drop column if exists notif_lembrete_atendimento;

alter table public.users
  add column if not exists notif_resumo_diario       boolean not null default true,
  add column if not exists notif_lembrete_atendimento boolean not null default true;
