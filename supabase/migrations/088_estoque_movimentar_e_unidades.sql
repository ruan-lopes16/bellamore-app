-- ============================================================
-- MIGRATION 088 — Movimentação de estoque conferida no banco + unidades por empresa
-- Spec: docs/superpowers/specs/2026-10-13-paridade-estoque-design.md
--
-- 1) movimentar_estoque: a entrada/saída manual (tela de Estoque, web e app) passa a ser
--    gravada por uma função que trava o produto e recusa saída maior que o saldo. Antes a
--    saída era conferida só contra o saldo que a tela mostrava: duas saídas ao mesmo tempo
--    deixavam o estoque negativo.
--    - SECURITY INVOKER: as policies de sempre valem (INSERT de estoque_movimentos exige
--      estoque.acessar; o trigger atualizar_estoque, security definer desde a 083, baixa o saldo).
--    - Trava: pg_advisory_xact_lock com a MESMA chave da 087 ('venda_estoque:' || produto),
--      então venda avulsa e movimentação manual do mesmo produto ficam em fila.
--      A baixa automática da comanda continua sem trava (decisão do dono de 29/09).
--    - Sem RETURNING (exigiria a policy de SELECT); devolve o saldo relido depois do insert.
--    - Nunca mudar a assinatura: clientes antigos receberiam PGRST202 e cairiam no caminho
--      antigo (sem trava). Mudança futura = função nova.
-- 2) estoque_unidades_empresa: quais unidades de medida cada empresa quer ver no seletor do
--    cadastro de produto (catálogo fixo em shared/estoque.ts). Sem linha = lista padrão.
--    Leitura para membro; escrita para quem tem estoque.acessar (não usa a tabela empresas,
--    que só a dona edita).
--
-- Rollback:
--   drop function if exists public.movimentar_estoque(uuid, text, numeric, text);
--   drop table if exists public.estoque_unidades_empresa;
--   notify pgrst, 'reload schema';
-- ============================================================

-- ── 1. movimentar_estoque ─────────────────────────────────────
create or replace function public.movimentar_estoque(
  p_produto uuid,
  p_tipo text,
  p_quantidade numeric,
  p_motivo text
) returns numeric
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_empresa uuid;
  v_nome    text;
  v_unidade text;
  v_saldo   numeric;
begin
  if p_tipo is null or p_tipo not in ('entrada', 'saida') then
    raise exception 'Tipo de movimentação inválido.';
  end if;
  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'Informe uma quantidade maior que zero.';
  end if;

  select pr.empresa_id into v_empresa from public.produtos pr where pr.id = p_produto;
  if not found then
    raise exception 'Produto não encontrado.';
  end if;
  if not tem_permissao(v_empresa, 'estoque.acessar') then
    raise exception 'Você não tem permissão para movimentar o estoque.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('venda_estoque:' || p_produto::text, 0));

  -- Relido depois da trava: enxerga o saldo de quem gravou antes (READ COMMITTED).
  select pr.nome, pr.unidade, pr.estoque_atual into v_nome, v_unidade, v_saldo
    from public.produtos pr where pr.id = p_produto;

  if p_tipo = 'saida' and coalesce(v_saldo, 0) < p_quantidade then
    raise exception 'Estoque insuficiente: % (restam % %)',
      v_nome, trim_scale(coalesce(v_saldo, 0)), coalesce(v_unidade, 'un');
  end if;

  insert into public.estoque_movimentos (empresa_id, produto_id, tipo, quantidade, motivo)
  values (v_empresa, p_produto, p_tipo::movimento_tipo, p_quantidade, nullif(btrim(coalesce(p_motivo, '')), ''));

  select pr.estoque_atual into v_saldo from public.produtos pr where pr.id = p_produto;
  return v_saldo;
end;
$$;

revoke all on function public.movimentar_estoque(uuid, text, numeric, text) from public, anon;
grant execute on function public.movimentar_estoque(uuid, text, numeric, text) to authenticated;

-- ── 2. estoque_unidades_empresa ───────────────────────────────
create table if not exists public.estoque_unidades_empresa (
  empresa_id    uuid primary key references public.empresas(id) on delete cascade,
  unidades      text[] not null check (cardinality(unidades) between 1 and 50),
  atualizado_em timestamptz not null default now()
);

alter table public.estoque_unidades_empresa enable row level security;

drop policy if exists "estoque_unidades_empresa: membro ve" on public.estoque_unidades_empresa;
create policy "estoque_unidades_empresa: membro ve" on public.estoque_unidades_empresa
  for select
  using (empresa_id in (select minha_empresas()));

drop policy if exists "estoque_unidades_empresa: estoque insere" on public.estoque_unidades_empresa;
create policy "estoque_unidades_empresa: estoque insere" on public.estoque_unidades_empresa
  for insert
  with check (tem_permissao(empresa_id, 'estoque.acessar'));

drop policy if exists "estoque_unidades_empresa: estoque atualiza" on public.estoque_unidades_empresa;
create policy "estoque_unidades_empresa: estoque atualiza" on public.estoque_unidades_empresa
  for update
  using (tem_permissao(empresa_id, 'estoque.acessar'))
  with check (tem_permissao(empresa_id, 'estoque.acessar'));

notify pgrst, 'reload schema';
