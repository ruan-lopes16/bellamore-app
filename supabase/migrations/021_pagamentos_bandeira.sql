-- Adiciona coluna bandeira para identificar a bandeira do cartão nos pagamentos
-- (Visa, Mastercard, Elo, Amex, Hipercard etc.)
alter table public.pagamentos
  add column if not exists bandeira text;
