-- ============================================================
-- 072 — Limpeza diária de notificações
-- ============================================================
-- "todos os tipos de notificação, depois de mandadas e virado o dia, são
--  excluídos para não armazenar coisas à toa no banco" (pedido do usuário).
--
-- Todo dia às 01:00 (BRT) apaga TODA linha de public.notificacoes criada
-- antes do início do dia atual, independente do tipo. O que precisa
-- reaparecer (estoque baixo, despesas a vencer, agendamentos do dia) é
-- recalculado ao vivo na tela de Notificações — nada disso depende de
-- linhas guardadas.
--
-- Pré-requisito: pg_cron (criado na migration 071).
--
-- Rollback:
--   select cron.unschedule('limpeza-notificacoes');

-- 04:00 UTC = 01:00 America/Sao_Paulo
select cron.schedule(
  'limpeza-notificacoes',
  '0 4 * * *',
  $$
    delete from public.notificacoes
    where created_at < date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  $$
);
