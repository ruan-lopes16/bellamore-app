-- ============================================================
-- 084 — Taxas da maquininha por empresa (editáveis em Configurações)
-- ============================================================
-- Spec: docs/superpowers/specs/2026-10-08-comanda-a-fechamento-correto-design.md
-- Antes fixas no código (web/lib/taxas-cartao.ts, InfinitePay). Padrões = valores de antes,
-- então nada muda no dia em que roda. Sem policy nova: o trigger trg_empresas_nao_dona_so_taxas
-- (083) já deixa quem não é dona alterar só colunas taxa_* com a permissão config.taxas.
-- Pagamentos antigos mantêm o taxa_perc com que foram gravados.
-- Rollback:
--   alter table public.empresas drop column if exists taxa_cartao_debito,
--     drop column if exists taxa_cartao_credito_avista, drop column if exists taxa_cartao_credito_parcelado;

alter table public.empresas
  add column if not exists taxa_cartao_debito            numeric(6,4) not null default 0.0239,
  add column if not exists taxa_cartao_credito_avista    numeric(6,4) not null default 0.0499,
  add column if not exists taxa_cartao_credito_parcelado numeric(6,4) not null default 0.0559;

alter table public.empresas drop constraint if exists empresas_taxas_cartao_faixa;
alter table public.empresas add constraint empresas_taxas_cartao_faixa check (
  taxa_cartao_debito between 0 and 0.2
  and taxa_cartao_credito_avista between 0 and 0.2
  and taxa_cartao_credito_parcelado between 0 and 0.2
);

notify pgrst, 'reload schema';
