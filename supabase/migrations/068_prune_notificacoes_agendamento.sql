-- ============================================================
-- 068 — Limpeza diária de alertas de agendamento passados
-- ============================================================
-- "depois que passou o dia, essas notificações de alerta podem ser
--  excluídas — apenas as de agendamento" (pedido do usuário).
--
-- Todo dia às 05:00 apaga as linhas de notificacoes com tipo
-- 'agendamento' criadas antes do início do dia atual. Notificações de
-- estoque, despesas, comissões e aniversário NÃO são tocadas.
--
-- Pré-requisito: pg_cron (já criado na migration 067).
--
-- Rollback:
--   select cron.unschedule('prune-notificacoes-agendamento');

select cron.schedule(
  'prune-notificacoes-agendamento',
  '0 5 * * *',
  $$
    delete from public.notificacoes
    where tipo = 'agendamento'
      and created_at < date_trunc('day', now());
  $$
);
