-- ============================================================
-- MIGRATION 096 — Despesas recorrentes: "pular este mês"
--
-- EXECUTE NO SUPABASE SQL EDITOR (migrations manuais; NÃO usar `supabase db push`).
--
-- POR QUE: o banner de recorrentes sugere toda série sem linha no mês. Quem decide não lançar
-- (ou apaga o lançamento) via a série voltar. Esta tabela guarda "esta série NÃO vale neste mês".
-- `chave` = descrição||categoria (shared/despesas.ts#chaveDespesa); `mes` = primeiro dia do mês.
--
-- RLS: membro da empresa lê; escreve quem tem `despesas.gerenciar`. Sem UPDATE/DELETE.
--
-- ROLLBACK: drop table public.despesas_recorrentes_puladas;
-- ============================================================

create table if not exists public.despesas_recorrentes_puladas (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave      text not null,
  mes        date not null,
  created_at timestamptz not null default now(),
  unique (empresa_id, chave, mes)
);

alter table public.despesas_recorrentes_puladas enable row level security;

drop policy if exists "puladas: membro le" on public.despesas_recorrentes_puladas;
create policy "puladas: membro le" on public.despesas_recorrentes_puladas for select
  using (empresa_id in (select minha_empresas()));

drop policy if exists "puladas: gerencia insere" on public.despesas_recorrentes_puladas;
create policy "puladas: gerencia insere" on public.despesas_recorrentes_puladas for insert
  with check (tem_permissao(empresa_id, 'despesas.gerenciar'));
