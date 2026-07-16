-- Fechamentos historicos sem criar atendimentos, vendas ou pagamentos artificiais.
-- Os gastos permanecem em public.despesas para preservar categoria e descricao.

create table if not exists public.financeiro_ajustes_mensais (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  mes            date not null,
  receita_bruta  numeric(10,2) not null check (receita_bruta >= 0),
  comissao_paga  numeric(10,2) not null check (comissao_paga >= 0),
  observacao     text,
  created_at     timestamptz not null default now(),
  unique (empresa_id, mes)
);

create index if not exists idx_financeiro_ajustes_mensais_empresa_mes
  on public.financeiro_ajustes_mensais (empresa_id, mes);

alter table public.financeiro_ajustes_mensais enable row level security;

drop policy if exists "financeiro_ajustes_mensais: membro ve" on public.financeiro_ajustes_mensais;
create policy "financeiro_ajustes_mensais: membro ve"
  on public.financeiro_ajustes_mensais for select
  using (empresa_id in (select minha_empresas()));

drop policy if exists "financeiro_ajustes_mensais: gestor pode inserir" on public.financeiro_ajustes_mensais;
create policy "financeiro_ajustes_mensais: gestor pode inserir"
  on public.financeiro_ajustes_mensais for insert
  with check (is_gestor_ou_owner(empresa_id));

drop policy if exists "financeiro_ajustes_mensais: gestor pode atualizar" on public.financeiro_ajustes_mensais;
create policy "financeiro_ajustes_mensais: gestor pode atualizar"
  on public.financeiro_ajustes_mensais for update
  using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));

drop policy if exists "financeiro_ajustes_mensais: owner pode deletar" on public.financeiro_ajustes_mensais;
create policy "financeiro_ajustes_mensais: owner pode deletar"
  on public.financeiro_ajustes_mensais for delete
  using (
    exists (
      select 1 from public.empresas
      where id = empresa_id and owner_id = auth.uid()
    )
  );
