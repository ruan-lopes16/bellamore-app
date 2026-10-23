-- ============================================================
-- MIGRATION 095 — Clientes: versiona a coluna `clientes.endereco`
-- Spec: docs/superpowers/specs/2026-10-22-paridade-clientes-design.md (seção "Migration 095")
--
-- EXECUTE NO SUPABASE SQL EDITOR (migrations manuais; NÃO usar `supabase db push`).
--
-- POR QUE: a coluna `endereco` já existe em produção sem migration nenhuma (conferido por consulta
-- à API em 22/10/2026) — foi criada à mão no painel. O web e o app já gravam nela o JSON
-- {logradouro, numero, bairro, complemento} (shared/clientes.ts). Sem esta migration, um banco
-- novo montado só pelos arquivos de `supabase/migrations` não teria a coluna e as telas de
-- clientes quebrariam ao gravar.
--
-- Idempotente (`add column if not exists`): em produção não faz nada. Sem RLS nova — as policies
-- de `clientes` (081/083) valem para a tabela inteira, inclusive esta coluna.
--
-- ROLLBACK: NÃO remover a coluna — ela guarda dado real das clientes (endereços cadastrados).
-- Desfazer esta migration é simplesmente não fazer nada. Se um dia for mesmo preciso (só com
-- backup exportado antes): alter table public.clientes drop column endereco;
-- ============================================================

alter table public.clientes add column if not exists endereco text;

comment on column public.clientes.endereco is
  'JSON {logradouro, numero, bairro, complemento} (shared/clientes.ts); texto livre antigo = logradouro.';

notify pgrst, 'reload schema';
