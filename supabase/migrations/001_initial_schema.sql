-- ============================================================
-- APP ESTÉTICA — SCHEMA INICIAL
-- ============================================================

-- Extensões
create extension if not exists "uuid-ossp";

-- ============================================================
-- USERS (espelha auth.users do Supabase)
-- ============================================================
create table public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  telefone    text,
  foto_url    text,
  created_at  timestamptz default now()
);

-- ============================================================
-- EMPRESAS
-- ============================================================
create table public.empresas (
  id                  uuid primary key default uuid_generate_v4(),
  owner_id            uuid not null references public.users(id),
  nome                text not null,
  cnpj                text,
  endereco            text,
  telefone            text,
  logo_url            text,
  horario_funcionamento jsonb,  -- { seg: {inicio: "08:00", fim: "18:00"}, ... }
  ativo               boolean default true,
  created_at          timestamptz default now()
);

-- ============================================================
-- EMPRESA_MEMBROS (multi-tenant + perfis)
-- ============================================================
create type perfil_role as enum ('gestor', 'profissional', 'cliente');

create table public.empresa_membros (
  id                    uuid primary key default uuid_generate_v4(),
  empresa_id            uuid not null references public.empresas(id) on delete cascade,
  user_id               uuid not null references public.users(id) on delete cascade,
  role                  perfil_role not null,
  percentual_comissao   numeric(5,2) default 0,  -- % para profissionais
  ativo                 boolean default true,
  created_at            timestamptz default now(),
  unique(empresa_id, user_id)
);

-- ============================================================
-- SERVICOS
-- ============================================================
create table public.servicos (
  id               uuid primary key default uuid_generate_v4(),
  empresa_id       uuid not null references public.empresas(id) on delete cascade,
  nome             text not null,
  descricao        text,
  preco            numeric(10,2) not null,
  custo            numeric(10,2) default 0,
  duracao_minutos  int not null default 60,
  categoria        text,
  ativo            boolean default true,
  created_at       timestamptz default now()
);

-- ============================================================
-- PACOTES
-- ============================================================
create table public.pacotes (
  id              uuid primary key default uuid_generate_v4(),
  empresa_id      uuid not null references public.empresas(id) on delete cascade,
  nome            text not null,
  preco           numeric(10,2) not null,
  validade_dias   int default 90,
  ativo           boolean default true,
  created_at      timestamptz default now()
);

create table public.pacote_servicos (
  pacote_id   uuid not null references public.pacotes(id) on delete cascade,
  servico_id  uuid not null references public.servicos(id) on delete cascade,
  quantidade  int default 1,
  primary key (pacote_id, servico_id)
);

-- ============================================================
-- COMANDAS
-- ============================================================
create type comanda_status as enum ('aberta', 'fechada');

create table public.comandas (
  id               uuid primary key default uuid_generate_v4(),
  empresa_id       uuid not null references public.empresas(id),
  cliente_id       uuid not null references public.users(id),
  profissional_id  uuid references public.users(id),
  status           comanda_status default 'aberta',
  valor_total      numeric(10,2) default 0,
  desconto         numeric(10,2) default 0,
  valor_final      numeric(10,2) generated always as (valor_total - desconto) stored,
  observacao       text,
  fechada_at       timestamptz,
  created_at       timestamptz default now()
);

-- ============================================================
-- AGENDAMENTOS (tabela central)
-- ============================================================
create type agendamento_status as enum (
  'agendado', 'confirmado', 'concluido', 'cancelado', 'faltou'
);

create table public.agendamentos (
  id               uuid primary key default uuid_generate_v4(),
  empresa_id       uuid not null references public.empresas(id),
  profissional_id  uuid not null references public.users(id),
  cliente_id       uuid not null references public.users(id),
  servico_id       uuid not null references public.servicos(id),
  comanda_id       uuid references public.comandas(id),
  data_hora_inicio timestamptz not null,
  data_hora_fim    timestamptz not null,
  status           agendamento_status default 'agendado',
  valor            numeric(10,2) not null,
  observacao       text,
  created_at       timestamptz default now(),
  -- garante que fim > início
  constraint check_horario check (data_hora_fim > data_hora_inicio)
);

-- Index para checar conflitos globais por profissional
create index idx_agendamentos_profissional_horario
  on public.agendamentos(profissional_id, data_hora_inicio, data_hora_fim)
  where status not in ('cancelado', 'faltou');

-- ============================================================
-- FUNÇÃO: bloquear conflito de horário global por profissional
-- ============================================================
create or replace function check_conflito_horario()
returns trigger as $$
begin
  if exists (
    select 1 from public.agendamentos
    where profissional_id = NEW.profissional_id
      and id != NEW.id
      and status not in ('cancelado', 'faltou')
      and data_hora_inicio < NEW.data_hora_fim
      and data_hora_fim    > NEW.data_hora_inicio
  ) then
    raise exception 'Conflito de horário: profissional já possui agendamento nesse período.';
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_check_conflito_horario
  before insert or update on public.agendamentos
  for each row execute function check_conflito_horario();

-- ============================================================
-- PAGAMENTOS
-- ============================================================
create type pagamento_metodo as enum ('dinheiro', 'pix', 'credito', 'debito', 'cortesia');
create type pagamento_status as enum ('pendente', 'pago', 'estornado');

create table public.pagamentos (
  id               uuid primary key default uuid_generate_v4(),
  empresa_id       uuid not null references public.empresas(id),
  comanda_id       uuid references public.comandas(id),
  agendamento_id   uuid references public.agendamentos(id),
  cliente_id       uuid references public.users(id),
  valor            numeric(10,2) not null,
  metodo           pagamento_metodo not null,
  status           pagamento_status default 'pendente',
  created_at       timestamptz default now()
);

-- ============================================================
-- COMISSOES
-- ============================================================
create type comissao_status as enum ('pendente', 'pago');

create table public.comissoes (
  id               uuid primary key default uuid_generate_v4(),
  empresa_id       uuid not null references public.empresas(id),
  profissional_id  uuid not null references public.users(id),
  agendamento_id   uuid not null references public.agendamentos(id),
  valor_servico    numeric(10,2) not null,
  percentual       numeric(5,2) not null,
  valor_comissao   numeric(10,2) generated always as (
                     round(valor_servico * percentual / 100, 2)
                   ) stored,
  status           comissao_status default 'pendente',
  created_at       timestamptz default now()
);

-- ============================================================
-- FUNÇÃO: gerar comissão automaticamente ao concluir agendamento
-- ============================================================
create or replace function gerar_comissao()
returns trigger as $$
declare
  v_percentual numeric(5,2);
begin
  -- só age quando status muda para 'concluido'
  if NEW.status = 'concluido' and OLD.status != 'concluido' then
    -- busca o percentual do profissional nessa empresa
    select percentual_comissao into v_percentual
    from public.empresa_membros
    where empresa_id = NEW.empresa_id
      and user_id    = NEW.profissional_id
      and role       = 'profissional';

    if v_percentual is not null and v_percentual > 0 then
      insert into public.comissoes
        (empresa_id, profissional_id, agendamento_id, valor_servico, percentual)
      values
        (NEW.empresa_id, NEW.profissional_id, NEW.id, NEW.valor, v_percentual);
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_gerar_comissao
  after update on public.agendamentos
  for each row execute function gerar_comissao();

-- ============================================================
-- PRODUTOS E ESTOQUE
-- ============================================================
create table public.produtos (
  id               uuid primary key default uuid_generate_v4(),
  empresa_id       uuid not null references public.empresas(id) on delete cascade,
  nome             text not null,
  categoria        text,
  unidade          text default 'un',
  preco_custo      numeric(10,2) default 0,
  preco_venda      numeric(10,2) default 0,
  estoque_atual    numeric(10,3) default 0,
  estoque_minimo   numeric(10,3) default 0,
  ativo            boolean default true,
  created_at       timestamptz default now()
);

create type movimento_tipo as enum ('entrada', 'saida', 'ajuste');

create table public.estoque_movimentos (
  id               uuid primary key default uuid_generate_v4(),
  produto_id       uuid not null references public.produtos(id),
  empresa_id       uuid not null references public.empresas(id),
  tipo             movimento_tipo not null,
  quantidade       numeric(10,3) not null,
  motivo           text,
  agendamento_id   uuid references public.agendamentos(id),
  created_at       timestamptz default now()
);

-- Atualiza estoque_atual automaticamente
create or replace function atualizar_estoque()
returns trigger as $$
begin
  if NEW.tipo = 'entrada' then
    update public.produtos set estoque_atual = estoque_atual + NEW.quantidade
    where id = NEW.produto_id;
  elsif NEW.tipo = 'saida' then
    update public.produtos set estoque_atual = estoque_atual - NEW.quantidade
    where id = NEW.produto_id;
  elsif NEW.tipo = 'ajuste' then
    update public.produtos set estoque_atual = NEW.quantidade
    where id = NEW.produto_id;
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_atualizar_estoque
  after insert on public.estoque_movimentos
  for each row execute function atualizar_estoque();

-- ============================================================
-- DESPESAS
-- ============================================================
create type despesa_status as enum ('pendente', 'pago');

create table public.despesas (
  id                uuid primary key default uuid_generate_v4(),
  empresa_id        uuid not null references public.empresas(id) on delete cascade,
  descricao         text not null,
  categoria         text,
  valor             numeric(10,2) not null,
  recorrente        boolean default false,
  periodicidade     text,  -- 'mensal', 'semanal', 'anual'
  data_vencimento   date,
  data_pagamento    date,
  status            despesa_status default 'pendente',
  created_at        timestamptz default now()
);

-- ============================================================
-- ANAMNESE
-- ============================================================
create table public.anamnese_fichas (
  id               uuid primary key default uuid_generate_v4(),
  empresa_id       uuid not null references public.empresas(id),
  cliente_id       uuid not null references public.users(id),
  profissional_id  uuid references public.users(id),
  respostas        jsonb not null default '{}',
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  unique(empresa_id, cliente_id)
);

-- ============================================================
-- NOTIFICACOES
-- ============================================================
create table public.notificacoes (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.users(id) on delete cascade,
  empresa_id  uuid references public.empresas(id),
  tipo        text not null,  -- 'agendamento', 'comissao', 'pagamento', 'estoque_baixo'
  titulo      text not null,
  mensagem    text,
  lida        boolean default false,
  created_at  timestamptz default now()
);

-- ============================================================
-- RLS — ROW LEVEL SECURITY
-- ============================================================
alter table public.users              enable row level security;
alter table public.empresas           enable row level security;
alter table public.empresa_membros    enable row level security;
alter table public.servicos           enable row level security;
alter table public.agendamentos       enable row level security;
alter table public.comandas           enable row level security;
alter table public.pagamentos         enable row level security;
alter table public.comissoes          enable row level security;
alter table public.produtos           enable row level security;
alter table public.estoque_movimentos enable row level security;
alter table public.despesas           enable row level security;
alter table public.anamnese_fichas    enable row level security;
alter table public.notificacoes       enable row level security;
alter table public.pacotes            enable row level security;

-- Função auxiliar: retorna empresa_ids do usuário logado
create or replace function minha_empresas()
returns setof uuid as $$
  select empresa_id from public.empresa_membros
  where user_id = auth.uid() and ativo = true
  union
  select id from public.empresas
  where owner_id = auth.uid();
$$ language sql security definer;

-- users: cada um vê apenas seu próprio perfil
create policy "users: ver proprio" on public.users
  for select using (id = auth.uid());
create policy "users: editar proprio" on public.users
  for update using (id = auth.uid());

-- empresas: membro ou owner
create policy "empresas: membro pode ver" on public.empresas
  for select using (id in (select minha_empresas()));
create policy "empresas: owner pode editar" on public.empresas
  for all using (owner_id = auth.uid());

-- empresa_membros: membro vê os da sua empresa
create policy "membros: ver da empresa" on public.empresa_membros
  for select using (empresa_id in (select minha_empresas()));

-- servicos, produtos, despesas, pacotes: membro da empresa
create policy "servicos: membro ve" on public.servicos
  for select using (empresa_id in (select minha_empresas()));
create policy "produtos: membro ve" on public.produtos
  for select using (empresa_id in (select minha_empresas()));
create policy "despesas: membro ve" on public.despesas
  for select using (empresa_id in (select minha_empresas()));
create policy "pacotes: membro ve" on public.pacotes
  for select using (empresa_id in (select minha_empresas()));

-- agendamentos: profissional vê os seus, empresa/gestor vê todos
create policy "agendamentos: ver" on public.agendamentos
  for select using (
    empresa_id in (select minha_empresas())
    or profissional_id = auth.uid()
    or cliente_id = auth.uid()
  );

-- comissoes: profissional vê as suas, empresa/gestor vê todas da empresa
create policy "comissoes: ver" on public.comissoes
  for select using (
    profissional_id = auth.uid()
    or empresa_id in (select minha_empresas())
  );

-- notificacoes: cada um vê as suas
create policy "notificacoes: ver proprias" on public.notificacoes
  for select using (user_id = auth.uid());

-- anamnese: profissional e empresa da ficha
create policy "anamnese: ver" on public.anamnese_fichas
  for select using (
    cliente_id = auth.uid()
    or empresa_id in (select minha_empresas())
  );
