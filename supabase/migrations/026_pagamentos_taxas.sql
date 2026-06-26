-- Adiciona colunas de taxa e parcelamento na tabela de pagamentos
alter table public.pagamentos
  add column if not exists parcelas      integer       not null default 1,
  add column if not exists taxa_perc     numeric(5,4),
  add column if not exists valor_liquido numeric(10,2);
