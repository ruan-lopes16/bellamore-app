-- ============================================================
-- COMANDAS — rastreio de quanto do desconto veio de taxa de reserva
--
-- Quando uma comanda desconta taxas de reserva já pagas dos
-- agendamentos que a compõem, o valor descontado entra somado na
-- coluna `desconto` já existente (para `valor_final` continuar
-- correto sem precisar mexer na coluna gerada) e, separadamente,
-- nesta coluna nova — só para auditoria/rastreio de quanto foi
-- desconto manual vs. taxa de reserva já paga.
-- ============================================================

alter table public.comandas
  add column desconto_reserva numeric(10,2) not null default 0;
