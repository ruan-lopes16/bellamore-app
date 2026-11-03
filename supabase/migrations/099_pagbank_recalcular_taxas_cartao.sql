-- ============================================================
-- 099 — PagBank (plano Essencial): recalcular a taxa de todos os pagamentos de cartão
-- ============================================================
-- EXECUTE NO SUPABASE SQL EDITOR (migrations manuais; NÃO usar `supabase db push`). Rode a 098 antes.
--
-- A empresa sempre usou a PagBank (plano Essencial), nunca a InfinitePay. As taxas do início do projeto
-- (débito 2,39%; crédito 1x 4,99%; 2x a 18x 5,59%) já são as da PagBank para Visa/Master, e a Diners Club
-- tem taxa própria (crédito 1x 3,19%; 2x a 18x 3,79%, 098). Esta migration:
--   1. renomeia a maquininha "Maquininha" para "PagBank";
--   2. guarda uma cópia do que será alterado em public.pagamentos_taxas_backup_099 (para desfazer);
--   3. recalcula taxa_perc e valor_liquido de TODOS os pagamentos de cartão pagos da empresa (desde o
--      primeiro), pela tabela de taxas da maquininha padrão: exceção da bandeira do pagamento, senão a
--      tabela padrão; pagamento sem linha de taxa correspondente (ex.: parcelas fora da tabela) NÃO é tocado;
--   4. vincula à PagBank os pagamentos de cartão que estavam sem maquininha.
-- Pix, dinheiro e cortesia não são alterados.
--
-- Conferir ANTES de rodar (só leitura): ver o bloco "CONFERÊNCIA" no fim deste arquivo.
--
-- Rollback (restaura os valores guardados):
--   update public.pagamentos p
--      set taxa_perc = b.taxa_perc, valor_liquido = b.valor_liquido, maquininha_id = b.maquininha_id
--     from public.pagamentos_taxas_backup_099 b where b.id = p.id;
--   update public.cartao_maquininhas set nome = 'Maquininha'
--    where empresa_id = '603fdaa1-be97-46a0-9333-325b30dea2ef' and nome = 'PagBank';
--   (depois de conferir, a tabela de backup pode ser apagada: drop table public.pagamentos_taxas_backup_099;)

-- 1) Nome da maquininha.
update public.cartao_maquininhas
   set nome = 'PagBank'
 where empresa_id = '603fdaa1-be97-46a0-9333-325b30dea2ef' and nome = 'Maquininha';

-- 2) Backup do estado atual (só roda uma vez: se já existe, mantém o original).
create table if not exists public.pagamentos_taxas_backup_099 as
select id, empresa_id, metodo, parcelas, bandeira, taxa_perc, valor_liquido, maquininha_id, now() as guardado_em
  from public.pagamentos
 where empresa_id = '603fdaa1-be97-46a0-9333-325b30dea2ef'
   and metodo in ('debito', 'credito') and status = 'pago' and valor > 0;
alter table public.pagamentos_taxas_backup_099 enable row level security; -- sem policy: ninguém lê pela API

-- 3) Recalcula taxa e líquido pela maquininha padrão (exceção da bandeira → senão tabela padrão).
with alvo as (
  select p.id, p.valor, m.id as maq,
         coalesce(
           (select t.taxa from public.cartao_taxas t
              join public.cartao_bandeiras b on b.id = t.bandeira_id
             where t.maquininha_id = m.id and b.chave = p.bandeira
               and t.modalidade = p.metodo::text
               and t.parcelas = case when p.metodo::text = 'debito' then 1 else coalesce(p.parcelas, 1) end),
           (select t.taxa from public.cartao_taxas t
             where t.maquininha_id = m.id and t.bandeira_id is null
               and t.modalidade = p.metodo::text
               and t.parcelas = case when p.metodo::text = 'debito' then 1 else coalesce(p.parcelas, 1) end)
         ) as taxa
    from public.pagamentos p
    join public.cartao_maquininhas m on m.empresa_id = p.empresa_id and m.padrao and m.ativa
   where p.empresa_id = '603fdaa1-be97-46a0-9333-325b30dea2ef'
     and p.metodo::text in ('debito', 'credito') and p.status = 'pago' and p.valor > 0
)
update public.pagamentos p
   set taxa_perc = a.taxa,
       valor_liquido = round(p.valor * (1 - a.taxa), 2),
       maquininha_id = coalesce(p.maquininha_id, a.maq)
  from alvo a
 where a.id = p.id and a.taxa is not null;

notify pgrst, 'reload schema';

-- ============================================================
-- CONFERÊNCIA (rode separadamente, só leitura)
-- ============================================================
-- Antes: quanto de taxa está gravado hoje e quanto ficará.
--   select count(*) as pagamentos, sum(valor) as bruto,
--          sum(valor - valor_liquido) as taxa_gravada_hoje
--     from public.pagamentos
--    where empresa_id = '603fdaa1-be97-46a0-9333-325b30dea2ef'
--      and metodo::text in ('debito','credito') and status = 'pago' and valor > 0;
-- Pagamentos que NÃO serão recalculados (sem linha de taxa na tabela):
--   select p.id, p.metodo, p.parcelas, p.bandeira, p.valor from public.pagamentos p
--    where p.empresa_id = '603fdaa1-be97-46a0-9333-325b30dea2ef'
--      and p.metodo::text in ('debito','credito') and p.status = 'pago' and p.valor > 0
--      and coalesce(p.parcelas,1) > 18;
-- Depois: taxa por combinação.
--   select metodo, parcelas, bandeira, taxa_perc, count(*), sum(valor), sum(valor_liquido)
--     from public.pagamentos
--    where empresa_id = '603fdaa1-be97-46a0-9333-325b30dea2ef'
--      and metodo::text in ('debito','credito') and status = 'pago' and valor > 0
--    group by 1,2,3,4 order by 6 desc;
