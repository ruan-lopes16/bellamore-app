-- ============================================================
-- MIGRATION 050 — guarda contra cliente_id nulo no trigger de
-- taxa de cancelamento
--
-- 047_taxa_cancelamento_schema.sql declara
-- taxas_cancelamento.cliente_id uuid not null, mas
-- agendamentos.cliente_id é nullable desde
-- 027_fix_user_delete_cascade.sql (drop not null), e
-- 031_rollback_migration027.sql repõe a FK com "on delete set null"
-- sem nunca restaurar o not null nem garantir backfill completo
-- ("onde possível").
--
-- Sem guarda, cancelar/marcar falta em um agendamento com
-- cliente_id nulo faz o INSERT em taxas_cancelamento violar o
-- not null constraint. Como o trigger é AFTER UPDATE na mesma
-- transação, isso reverte a própria mudança de status: o usuário
-- fica impossibilitado de cancelar o agendamento.
--
-- Esta migration recria gerar_taxa_cancelamento() (CREATE OR
-- REPLACE, a função anterior de 048 é substituída por inteiro,
-- não há ALTER FUNCTION em Postgres) com uma guarda: se
-- new.cliente_id for nulo, apenas retorna sem tentar gerar a
-- taxa. O trigger trg_gerar_taxa_cancelamento já criado em 048
-- continua apontando para esta função pelo nome, então não é
-- necessário recriá-lo.
-- ============================================================

create or replace function public.gerar_taxa_cancelamento()
returns trigger as $$
declare
  v_empresa      public.empresas%rowtype;
  v_valor        numeric(10,2);
  v_deve_aplicar boolean;
begin
  if old.status = new.status then
    return new;
  end if;

  -- Reverteu de cancelado/faltou para outro status: anula a taxa pendente
  if old.status in ('cancelado', 'faltou') and new.status not in ('cancelado', 'faltou') then
    update public.taxas_cancelamento
      set status = 'cancelada'
      where agendamento_id = new.id and status = 'pendente';
    return new;
  end if;

  if new.status not in ('cancelado', 'faltou') then
    return new;
  end if;

  -- Agendamento sem cliente vinculado (órfão de 027/031, ou cliente
  -- excluído depois via "on delete set null"): não há a quem cobrar,
  -- e taxas_cancelamento.cliente_id é not null. Sai sem gerar a taxa
  -- em vez de deixar o INSERT abaixo violar o constraint e reverter
  -- o UPDATE de status inteiro.
  if new.cliente_id is null then
    return new;
  end if;

  select * into v_empresa from public.empresas where id = new.empresa_id;
  if not found or not v_empresa.taxa_cancelamento_ativa then
    return new;
  end if;

  v_deve_aplicar := (new.status = 'cancelado' and v_empresa.taxa_cancelamento_aplica_cancelado)
                  or (new.status = 'faltou'    and v_empresa.taxa_cancelamento_aplica_faltou);
  if not v_deve_aplicar then
    return new;
  end if;

  v_valor := case v_empresa.taxa_cancelamento_modo
    when 'fixo' then v_empresa.taxa_cancelamento_valor
    else round(coalesce(new.valor, 0) * v_empresa.taxa_cancelamento_valor / 100, 2)
  end;

  insert into public.taxas_cancelamento (empresa_id, agendamento_id, cliente_id, valor, status)
  values (new.empresa_id, new.id, new.cliente_id, v_valor, 'pendente')
  on conflict (agendamento_id) do nothing;

  return new;
end;
$$ language plpgsql security definer set search_path = public;
