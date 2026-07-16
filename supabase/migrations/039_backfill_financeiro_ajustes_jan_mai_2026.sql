-- ============================================================
-- BACKFILL: historico financeiro CNPJ ANA (jan-mai/2026)
-- Depende de 038_financeiro_ajustes_mensais.sql.
-- Nao cria atendimentos, vendas, pagamentos nem despesas.
-- ============================================================

insert into public.financeiro_ajustes_mensais (
  empresa_id,
  mes,
  receita_bruta,
  comissao_paga,
  observacao
)
select
  e.id,
  v.mes::date,
  v.receita_bruta,
  v.comissao_paga,
  'Historico financeiro CNPJ ANA - sem taxas de pagamento'
from public.empresas e
cross join (
  values
    ('2026-01-01',  6491.08::numeric, 2920.99::numeric),
    ('2026-02-01',  7353.04::numeric, 3308.87::numeric),
    ('2026-03-01',  9402.10::numeric, 4230.95::numeric),
    ('2026-04-01', 11889.38::numeric, 5350.22::numeric),
    ('2026-05-01',  8170.08::numeric, 3676.54::numeric)
) as v(mes, receita_bruta, comissao_paga)
where e.id = '603fdaa1-be97-46a0-9333-325b30dea2ef'
on conflict (empresa_id, mes) do update
set
  receita_bruta = excluded.receita_bruta,
  comissao_paga = excluded.comissao_paga,
  observacao = excluded.observacao;
