-- ============================================================
-- TAXA DE RESERVA — configuração por empresa + tabela de cobranças
--
-- Diferente de taxas_cancelamento (gerada automaticamente por trigger),
-- taxas_reserva é inserida diretamente pelo app no momento em que um
-- agendamento é criado (o valor pode ser negociado por agendamento).
-- ============================================================

alter table public.empresas
  add column taxa_reserva_ativa boolean not null default false,
  add column taxa_reserva_modo text not null default 'percentual',
  add column taxa_reserva_valor numeric(10,2) not null default 0;

alter table public.empresas
  add constraint empresas_taxa_reserva_modo_check
  check (taxa_reserva_modo in ('percentual', 'fixo'));

create table public.taxas_reserva (
  id             uuid primary key default uuid_generate_v4(),
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  agendamento_id uuid not null references public.agendamentos(id) on delete cascade,
  cliente_id     uuid references public.clientes(id) on delete cascade,
  valor          numeric(10,2) not null,
  status         text not null default 'pendente',
  created_at     timestamptz not null default now(),
  paga_em        timestamptz,
  constraint taxas_reserva_status_check check (status in ('pendente', 'pago', 'retida')),
  constraint taxas_reserva_agendamento_id_key unique (agendamento_id)
);

alter table public.taxas_reserva enable row level security;

create policy "taxas_reserva: membro insere"
  on public.taxas_reserva for insert
  with check (empresa_id = any(minha_empresas()));

create policy "taxas_reserva: gestor ou owner ve"
  on public.taxas_reserva for select
  using (is_gestor_ou_owner(empresa_id));

create policy "taxas_reserva: gestor ou owner atualiza"
  on public.taxas_reserva for update
  using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));
