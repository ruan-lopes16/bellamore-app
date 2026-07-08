-- View auxiliar para comparação coluna-a-coluna (estoque_atual <= estoque_minimo)
-- PostgREST não suporta referência de colunas em .filter() no cliente JS;
-- a query passa a string "estoque_minimo" como valor literal, gerando erro 22P02.
create or replace view public.v_produtos_estoque_baixo
with (security_invoker = true) as
select * from public.produtos
where estoque_atual <= estoque_minimo;
