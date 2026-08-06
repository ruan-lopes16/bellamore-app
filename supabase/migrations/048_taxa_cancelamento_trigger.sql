-- ============================================================
-- TAXA DE CANCELAMENTO — trigger de geração automática
--
-- Espelha o padrão de gerar_comissao() (024_fix_comissao_security_definer.sql):
-- SECURITY DEFINER para rodar independente de RLS, disparado em
-- AFTER UPDATE OF status em agendamentos.
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

drop trigger if exists trg_gerar_taxa_cancelamento on public.agendamentos;

create trigger trg_gerar_taxa_cancelamento
  after update on public.agendamentos
  for each row
  execute function public.gerar_taxa_cancelamento();
