-- Esquema mínimo para rodar a migration 091 no PGlite. Colunas de empresas da 047 e
-- taxas_cancelamento da 047 (unique em agendamento_id). NÃO é o schema de produção.
create type agendamento_status as enum ('agendado','confirmado','concluido','cancelado','faltou');
create table empresas (
  id uuid primary key,
  taxa_cancelamento_ativa boolean not null default false,
  taxa_cancelamento_modo text not null default 'percentual',
  taxa_cancelamento_valor numeric(10,2) not null default 0,
  taxa_cancelamento_aplica_cancelado boolean not null default true,
  taxa_cancelamento_aplica_faltou boolean not null default true
);
create table clientes (id uuid primary key);
create table agendamentos (
  id uuid primary key,
  empresa_id uuid not null references empresas(id),
  cliente_id uuid references clientes(id),
  status agendamento_status default 'agendado',
  valor numeric(10,2) not null
);
create table taxas_cancelamento (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  agendamento_id uuid not null references agendamentos(id) on delete cascade,
  cliente_id uuid not null references clientes(id),
  valor numeric(10,2) not null,
  status text not null default 'pendente',
  created_at timestamptz not null default now(),
  paga_em timestamptz,
  constraint taxas_cancelamento_status_check check (status in ('pendente', 'pago', 'cancelada')),
  constraint taxas_cancelamento_agendamento_id_key unique (agendamento_id)
);
