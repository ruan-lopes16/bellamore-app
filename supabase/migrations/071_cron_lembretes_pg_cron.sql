-- ============================================================
-- 071 — Agendadores de notificação (pg_cron + pg_net)
-- ============================================================
-- Substitua os DOIS placeholders antes de aplicar (aparecem 2x):
--   <APP_URL>      → origem pública do app, ex.: https://bellamore-app.vercel.app
--   <CRON_SECRET>  → mesmo valor de process.env.CRON_SECRET na Vercel
--
-- Pré-requisitos: extensões pg_cron e pg_net habilitadas no projeto Supabase.
--
-- Jobs criados:
--   lembretes-atendimento  a cada 5 min  → push 1h e 15 min antes de cada atendimento
--   resumo-diario          07:00 BRT     → 1 push com agendamentos do dia / despesas / estoque
--
-- Rodar de novo com o mesmo nome SUBSTITUI o job (não duplica).
--
-- Rollback:
--   select cron.unschedule('lembretes-atendimento');
--   select cron.unschedule('resumo-diario');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove nomes de versões anteriores, se existirem (ignora se não existir).
select cron.unschedule(jobid)
from cron.job
where jobname in ('prune-notificacoes-agendamento');

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

-- 10:00 UTC = 07:00 America/Sao_Paulo
select cron.schedule(
  'resumo-diario',
  '0 10 * * *',
  $$
    select net.http_get(
      url     := '<APP_URL>/api/cron/resumo-diario',
      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
    );
  $$
);
