-- ============================================================
-- MIGRATION 064 — retiradas e empréstimos da dona
--
-- A dona (owner) precisa registrar dinheiro tirado do estúdio como:
--   - emprestimo: devolve depois (avulso ou parcelado). Gera saldo devedor.
--   - retirada:   tira parte do lucro, sem gerar dívida.
--
-- Um registro em retiradas_socia; as devoluções de um empréstimo ficam em
-- retiradas_socia_devolucoes. Saldo, "quitado" e "parcela X de Y" são
-- SEMPRE derivados na exibição — nada disso é coluna.
--
-- 100% aditivo: nenhuma tabela/coluna/policy/trigger existente é tocada.
-- Nenhuma query de despesas/pagamentos/agendamentos/vendas/comissoes muda —
-- as linhas "Retiradas da dona" / "Resultado após retiradas" nos relatórios
-- leem só estas tabelas novas.
--
-- RLS: owner-only (mais restrito que despesas, que libera gestor). Um gestor
-- NÃO vê as retiradas da dona — decisão de produto, não bug.
--
-- metodo: reaproveita o enum public.pagamento_metodo (dinheiro/pix/credito/
-- debito/cortesia), igual à migration 062. Opcional nos dois sentidos.
-- ============================================================

create type retirada_socia_tipo as enum ('emprestimo', 'retirada');

create table public.retiradas_socia (
  id                  uuid primary key default uuid_generate_v4(),
  empresa_id          uuid not null references public.empresas(id) on delete cascade,
  tipo                retirada_socia_tipo not null,
  valor               numeric(10,2) not null check (valor > 0),
  data                date not null default current_date,
  descricao           text,
  metodo              public.pagamento_metodo,
  parcelado           boolean not null default false,
  total_parcelas      int  check (total_parcelas is null or total_parcelas >= 2),
  valor_parcela       numeric(10,2) check (valor_parcela is null or valor_parcela > 0),
  primeira_parcela_em date,
  convertido_em       date,
  criado_por          uuid references public.users(id),
  created_at          timestamptz default now()
);

create table public.retiradas_socia_devolucoes (
  id           uuid primary key default uuid_generate_v4(),
  retirada_id  uuid not null references public.retiradas_socia(id) on delete cascade,
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  valor        numeric(10,2) not null check (valor > 0),
  data         date not null default current_date,
  metodo       public.pagamento_metodo,
  created_at   timestamptz default now()
);

create index idx_retiradas_socia_empresa_data on public.retiradas_socia(empresa_id, data);
create index idx_retiradas_socia_dev_retirada on public.retiradas_socia_devolucoes(retirada_id);

alter table public.retiradas_socia enable row level security;
alter table public.retiradas_socia_devolucoes enable row level security;

create policy "retiradas_socia: owner full"
  on public.retiradas_socia
  for all
  using (exists (
    select 1 from public.empresas e
    where e.id = retiradas_socia.empresa_id and e.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.empresas e
    where e.id = retiradas_socia.empresa_id and e.owner_id = auth.uid()
  ));

create policy "retiradas_socia_devolucoes: owner full"
  on public.retiradas_socia_devolucoes
  for all
  using (exists (
    select 1 from public.empresas e
    where e.id = retiradas_socia_devolucoes.empresa_id and e.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.empresas e
    where e.id = retiradas_socia_devolucoes.empresa_id and e.owner_id = auth.uid()
  ));
