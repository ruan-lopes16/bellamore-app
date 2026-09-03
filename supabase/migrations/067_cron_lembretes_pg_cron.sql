-- ============================================================
-- 067 — Agendador dos lembretes de atendimento (pg_cron + pg_net)
-- ============================================================
-- Chama GET <APP_URL>/api/cron/lembretes a cada 5 minutos. A rota é
-- idempotente (ver migration 066). Substitua os DOIS placeholders antes
-- de aplicar:
--   <APP_URL>      → origem pública do app web, ex.: https://app.bellamore.com.br
--   <CRON_SECRET>  → mesmo valor de process.env.CRON_SECRET na Vercel
--
-- Pré-requisitos no projeto Supabase: extensões pg_cron e pg_net
-- disponíveis (Dashboard → Database → Extensions).
--
-- Rollback:
--   select cron.unschedule('lembretes-atendimento');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'lembretes-atendimento',
  '*/5 * * * *',
  $$
    select net.http_get(
      url     := '<APP_URL>/api/cron/lembretes',
      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
    );
  $$
);
