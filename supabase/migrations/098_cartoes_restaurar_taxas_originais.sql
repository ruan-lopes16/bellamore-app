-- ============================================================
-- 098 — Cartões: restaurar as taxas originais da maquininha
-- ============================================================
-- EXECUTE NO SUPABASE SQL EDITOR (migrations manuais; NÃO usar `supabase db push`).
--
-- Antes da 086 as taxas eram fixas no código (InfinitePay): débito 2,39%, crédito 1x 4,99% e
-- crédito de 2x a 18x 5,59% (web/lib/taxas-cartao.ts, commit 4d50f3a). O seed da 086 só criou
-- 2x..12x e deixou a maquininha com máximo de 12 parcelas — 13x..18x ficaram sem taxa e os
-- pagamentos gravados depois da 086 sem linha na tabela ficaram com taxa_perc/valor_liquido nulos
-- (taxa de cartão = 0 nos números do Financeiro/Dashboard/Relatórios → lucro inflado).
--
-- Esta migration:
--   1. completa a tabela padrão de cada maquininha chamada 'Maquininha' (a semeada pela 086) até
--      18x, com a taxa de 2x+ da própria empresa (084), sem tocar em nenhuma linha já existente;
--   1b. cadastra a bandeira Diners Club com a taxa própria dela no crédito (3,19% / 3,79%);
--   2. preenche taxa_perc e valor_liquido dos pagamentos de cartão pagos a partir de 13/10/2026
--      (dia em que a 086 entrou) que ficaram sem taxa, pela regra de antes (débito / 1x / 2x+);
--      pagamentos que já têm taxa nunca são alterados.
--
-- Conferir ANTES de rodar (quantos pagamentos serão preenchidos):
--   select count(*), sum(valor) from public.pagamentos
--    where metodo in ('debito','credito') and status = 'pago' and valor > 0
--      and taxa_perc is null and valor_liquido is null and created_at >= timestamptz '2026-10-13 00:00:00-03';
--
-- Rollback (só do passo 2, se preciso):
--   update public.pagamentos set taxa_perc = null, valor_liquido = null
--    where id in (<ids anotados do select de conferência>);
-- (o passo 1 é aditivo: as linhas 13x..18x podem ser removidas pela tela de Cartões.)

-- 1) Tabela padrão até 18x nas maquininhas semeadas pela 086.
update public.cartao_maquininhas
   set max_parcelas = 18
 where nome = 'Maquininha' and max_parcelas < 18;

insert into public.cartao_taxas (empresa_id, maquininha_id, bandeira_id, modalidade, parcelas, taxa)
select m.empresa_id, m.id, null, 'credito', n,
       coalesce(e.taxa_cartao_credito_parcelado, 0.0559)
  from public.cartao_maquininhas m
  join public.empresas e on e.id = m.empresa_id
 cross join generate_series(2, 18) as n
 where m.nome = 'Maquininha'
   and not exists (
     select 1 from public.cartao_taxas t
      where t.maquininha_id = m.id and t.bandeira_id is null
        and t.modalidade = 'credito' and t.parcelas = n
   );

-- 1b) Diners Club: bandeira com taxa própria no crédito (1x 3,19%; 2x a 18x 3,79%, recebimento em
--     30 dias). Sem exceção no débito: cai na tabela padrão. Só cria o que ainda não existe.
insert into public.cartao_bandeiras (empresa_id, chave, nome, ordem)
select m.empresa_id, 'diners-club', 'Diners Club',
       coalesce((select max(b.ordem) from public.cartao_bandeiras b where b.empresa_id = m.empresa_id), 0) + 1
  from public.cartao_maquininhas m
 where m.nome = 'Maquininha'
on conflict (empresa_id, chave) do nothing;

insert into public.cartao_taxas (empresa_id, maquininha_id, bandeira_id, modalidade, parcelas, taxa)
select m.empresa_id, m.id, b.id, 'credito', n, case when n = 1 then 0.0319 else 0.0379 end
  from public.cartao_maquininhas m
  join public.cartao_bandeiras b on b.empresa_id = m.empresa_id and b.chave = 'diners-club'
 cross join generate_series(1, 18) as n
 where m.nome = 'Maquininha'
   and not exists (
     select 1 from public.cartao_taxas t
      where t.maquininha_id = m.id and t.bandeira_id = b.id
        and t.modalidade = 'credito' and t.parcelas = n
   );

-- 2) Pagamentos de cartão gravados sem taxa desde a 086.
update public.pagamentos p
   set taxa_perc = x.taxa,
       valor_liquido = round(p.valor * (1 - x.taxa), 2)
  from (
    select g.id,
           case
             when g.metodo = 'debito' then coalesce(e.taxa_cartao_debito, 0.0239)
             when coalesce(g.parcelas, 1) <= 1 then coalesce(e.taxa_cartao_credito_avista, 0.0499)
             else coalesce(e.taxa_cartao_credito_parcelado, 0.0559)
           end as taxa
      from public.pagamentos g
      join public.empresas e on e.id = g.empresa_id
     where g.metodo in ('debito', 'credito') and g.status = 'pago' and g.valor > 0
       and g.taxa_perc is null and g.valor_liquido is null
       and g.created_at >= timestamptz '2026-10-13 00:00:00-03'
  ) x
 where p.id = x.id;

notify pgrst, 'reload schema';
