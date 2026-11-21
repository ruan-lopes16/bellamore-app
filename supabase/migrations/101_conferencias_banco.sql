-- ============================================================
-- MIGRATION 101 — Conferências no banco (B13)
-- Spec:  docs/superpowers/specs/2026-11-10-permissoes-pendencias-c-design.md (seção B13)
-- Plano: docs/superpowers/plans/2026-11-10-permissoes-pendencias-c.md (Task 1)
-- Deploy: docs/superpowers/notes/2026-11-10-deploy-101.md
--
-- EXECUTE NO SUPABASE SQL EDITOR (migrations manuais; NÃO usar `supabase db push`).
-- Idempotente: `drop policy if exists` + `create policy`, constraint criada só se ainda não existe,
-- `create or replace function`, `drop trigger if exists` + `create trigger`.
-- Requer a 100 (a seção 0 recusa rodar sem ela). Ordem em relação ao deploy: livre — o código não
-- depende da 101, ela só acrescenta travas para gravações feitas direto pela API.
--
-- POR QUE CADA PARTE
--
-- 1) "pacote_uso: altera" — corpo EXATO da 093 (seção 7), com uma única mudança: o `with check`
--    passa a exigir o mesmo que o INSERT ("pacote_uso: registra"): o pacote_cliente_id é da mesma
--    empresa do uso. Antes, um UPDATE pela API podia apontar o uso para um pacote de outra empresa.
--    "pacote_uso: registra" já tinha a conferência (093) e não muda.
--
-- 2) pagamentos — constraint pagamentos_comanda_xor_venda: um pagamento é da comanda OU da venda,
--    nunca dos dois. Criada `not valid`: vale para toda linha nova ou alterada e não falha com dados
--    antigos. Nenhuma função grava as duas colunas juntas (conferido: fechar_comanda/editar_comanda
--    gravam só comanda_id; registrar_venda_avulsa(_v2) e vender_pacote gravam só venda_id — 090, 093,
--    096). A nota de deploy traz a contagem das linhas antigas e o `validate constraint` opcional.
--
-- 3) Cartões entre empresas — trigger fn_cartao_mesma_empresa (security invoker, search_path public):
--    - cartao_taxas: maquininha_id e bandeira_id (se houver) da mesma empresa_id da taxa;
--    - pagamentos: maquininha_id (se houver) da mesma empresa_id do pagamento.
--    Recusa com "Maquininha ou bandeira de outra empresa." (P0001). Trigger e não FK composta para
--    não mexer nas FKs existentes. Só dispara quando empresa_id/maquininha_id/bandeira_id mudam
--    (`update of ...`): uma linha antiga eventualmente torta não trava updates de outras colunas
--    (ex.: recálculo de taxa_perc como na 098/099). Invoker: quem não enxerga a maquininha pela RLS
--    ("membro ve" da 086) também é recusado; funções security definer enxergam tudo.
--    fechar_comanda/editar_comanda/registrar_venda_avulsa_v2 já conferiam a maquininha (093,
--    conferir_vinculos_empresa); o trigger cobre o INSERT/UPDATE direto pela API.
--
-- CONFERÊNCIAS (só leitura, depois de rodar):
--   select policyname, cmd, with_check from pg_policies
--    where tablename = 'pacote_uso' and policyname = 'pacote_uso: altera';   -- with_check com pacote_clientes
--   select conname, convalidated from pg_constraint
--    where conname = 'pagamentos_comanda_xor_venda';                          -- 1 linha (false até validar)
--   select tgrelid::regclass, tgname from pg_trigger
--    where tgname in ('trg_cartao_taxas_mesma_empresa', 'trg_pagamentos_maquininha_mesma_empresa'); -- 2 linhas
--   select prosecdef, proconfig from pg_proc where proname = 'fn_cartao_mesma_empresa';  -- false, search_path=public
--
-- ROLLBACK:
--   drop trigger if exists trg_cartao_taxas_mesma_empresa on public.cartao_taxas;
--   drop trigger if exists trg_pagamentos_maquininha_mesma_empresa on public.pagamentos;
--   drop function if exists public.fn_cartao_mesma_empresa();
--   alter table public.pagamentos drop constraint if exists pagamentos_comanda_xor_venda;
--   "pacote_uso: altera": rodar de novo o trecho da policy na seção 7 da 093.
--   notify pgrst, 'reload schema';
-- ============================================================

-- ── 0. Pré-requisito: 100 ─────────────────────────────────────
do $$
begin
  if to_regprocedure('public.excluir_venda_pacotes(uuid, uuid)') is null then
    raise exception 'Rode a 100 antes da 101.';
  end if;
end $$;

-- ── 1. pacote_uso: UPDATE confere a empresa do pacote ─────────
drop policy if exists "pacote_uso: altera" on public.pacote_uso;
create policy "pacote_uso: altera" on public.pacote_uso for update
  using (
    empresa_id in (select minha_empresas())
    and (
      tem_permissao(empresa_id, 'pacotes.vender')
      or (agendamento_id is not null
          and exists (select 1 from public.agendamentos a
                       where a.id = pacote_uso.agendamento_id
                         and a.empresa_id = pacote_uso.empresa_id
                         and (a.profissional_id = auth.uid()
                              or tem_permissao(empresa_id, 'agenda.gerenciar_outras'))))
    )
  )
  with check (
    empresa_id in (select minha_empresas())
    -- 101: mesma conferência do INSERT ("pacote_uso: registra").
    and exists (select 1 from public.pacote_clientes pc
                 where pc.id = pacote_uso.pacote_cliente_id and pc.empresa_id = pacote_uso.empresa_id)
    and (
      tem_permissao(empresa_id, 'pacotes.vender')
      or (agendamento_id is not null
          and exists (select 1 from public.agendamentos a
                       where a.id = pacote_uso.agendamento_id
                         and a.empresa_id = pacote_uso.empresa_id
                         and (a.profissional_id = auth.uid()
                              or tem_permissao(empresa_id, 'agenda.gerenciar_outras'))))
    )
  );

-- ── 2. pagamentos: comanda OU venda ───────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'pagamentos_comanda_xor_venda'
                    and conrelid = 'public.pagamentos'::regclass) then
    alter table public.pagamentos
      add constraint pagamentos_comanda_xor_venda
      check (not (comanda_id is not null and venda_id is not null)) not valid;
  end if;
end $$;

-- ── 3. Cartões entre empresas ─────────────────────────────────
create or replace function public.fn_cartao_mesma_empresa()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.maquininha_id is not null
     and not exists (select 1 from public.cartao_maquininhas m
                      where m.id = new.maquininha_id and m.empresa_id = new.empresa_id) then
    raise exception 'Maquininha ou bandeira de outra empresa.' using errcode = 'P0001';
  end if;
  -- if aninhado: pagamentos não tem bandeira_id (só o texto `bandeira`), e new.bandeira_id não pode
  -- ser avaliado fora de cartao_taxas.
  if tg_table_name = 'cartao_taxas' then
    if new.bandeira_id is not null
       and not exists (select 1 from public.cartao_bandeiras b
                        where b.id = new.bandeira_id and b.empresa_id = new.empresa_id) then
      raise exception 'Maquininha ou bandeira de outra empresa.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.fn_cartao_mesma_empresa() from public, anon, authenticated;

drop trigger if exists trg_cartao_taxas_mesma_empresa on public.cartao_taxas;
create trigger trg_cartao_taxas_mesma_empresa
  before insert or update of empresa_id, maquininha_id, bandeira_id on public.cartao_taxas
  for each row execute function public.fn_cartao_mesma_empresa();

drop trigger if exists trg_pagamentos_maquininha_mesma_empresa on public.pagamentos;
create trigger trg_pagamentos_maquininha_mesma_empresa
  before insert or update of empresa_id, maquininha_id on public.pagamentos
  for each row execute function public.fn_cartao_mesma_empresa();

notify pgrst, 'reload schema';
