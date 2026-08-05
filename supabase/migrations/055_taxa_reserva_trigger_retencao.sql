-- ============================================================
-- TAXA DE RESERVA — retenção automática ao cancelar/faltar
--
-- A linha em taxas_reserva já existe (inserida pelo app na criação do
-- agendamento). Este trigger só muda o status para 'retida' quando o
-- agendamento é cancelado ou o cliente falta — não gera nem reverte.
-- ============================================================

create or replace function public.reter_taxa_reserva()
returns trigger as $$
begin
  if old.status = new.status then
    return new;
  end if;

  if new.status not in ('cancelado', 'faltou') then
    return new;
  end if;

  update public.taxas_reserva
    set status = 'retida'
    where agendamento_id = new.id and status in ('pendente', 'pago');

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_reter_taxa_reserva on public.agendamentos;

create trigger trg_reter_taxa_reserva
  after update on public.agendamentos
  for each row
  execute function public.reter_taxa_reserva();
