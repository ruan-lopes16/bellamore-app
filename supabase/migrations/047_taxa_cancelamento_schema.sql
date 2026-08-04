-- ============================================================
-- TAXA DE CANCELAMENTO — configuração por empresa + tabela de cobranças
-- ============================================================

alter table public.empresas
  add column taxa_cancelamento_ativa boolean not null default false,
  add column taxa_cancelamento_modo text not null default 'percentual',
  add column taxa_cancelamento_valor numeric(10,2) not null default 0,
  add column taxa_cancelamento_aplica_cancelado boolean not null default true,
  add column taxa_cancelamento_aplica_faltou boolean not null default true;

alter table public.empresas
  add constraint empresas_taxa_cancelamento_modo_check
  check (taxa_cancelamento_modo in ('percentual', 'fixo'));

create table public.taxas_cancelamento (
  id             uuid primary key default uuid_generate_v4(),
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  agendamento_id uuid not null references public.agendamentos(id) on delete cascade,
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  valor          numeric(10,2) not null,
  status         text not null default 'pendente',
  created_at     timestamptz not null default now(),
  paga_em        timestamptz,
  constraint taxas_cancelamento_status_check check (status in ('pendente', 'pago', 'cancelada')),
  constraint taxas_cancelamento_agendamento_id_key unique (agendamento_id)
);

alter table public.taxas_cancelamento enable row level security;

create policy "taxas_cancelamento: gestor ou owner ve"
  on public.taxas_cancelamento for select
  using (is_gestor_ou_owner(empresa_id));

create policy "taxas_cancelamento: gestor ou owner atualiza"
  on public.taxas_cancelamento for update
  using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));
