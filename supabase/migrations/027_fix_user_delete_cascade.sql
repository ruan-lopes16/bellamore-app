-- Migration 027: corrige FK constraints para permitir exclusão de usuários
-- Ordem correta: 1) drop NOT NULL → 2) drop FK → 3) limpar órfãos → 4) recriar FK com SET NULL

-- ============================================================
-- 1. Dropar NOT NULL de todas as colunas que precisam ser nullable
-- ============================================================
alter table public.empresas      alter column owner_id        drop not null;
alter table public.comandas      alter column cliente_id      drop not null;
alter table public.agendamentos  alter column profissional_id drop not null;
alter table public.agendamentos  alter column cliente_id      drop not null;
alter table public.comissoes     alter column profissional_id drop not null;
alter table public.anamnese_fichas alter column cliente_id    drop not null;

-- ============================================================
-- 2. Dropar FK constraints existentes
-- ============================================================
alter table public.empresas     drop constraint if exists empresas_owner_id_fkey;
alter table public.comandas     drop constraint if exists comandas_cliente_id_fkey;
alter table public.comandas     drop constraint if exists comandas_profissional_id_fkey;
alter table public.agendamentos drop constraint if exists agendamentos_profissional_id_fkey;
alter table public.agendamentos drop constraint if exists agendamentos_cliente_id_fkey;
alter table public.pagamentos   drop constraint if exists pagamentos_cliente_id_fkey;
alter table public.comissoes    drop constraint if exists comissoes_profissional_id_fkey;
alter table public.anamnese_fichas drop constraint if exists anamnese_fichas_cliente_id_fkey;
alter table public.anamnese_fichas drop constraint if exists anamnese_fichas_profissional_id_fkey;

-- ============================================================
-- 3. Nulificar referências órfãs (IDs que não existem em public.users)
-- ============================================================
update public.empresas      set owner_id        = null where owner_id        not in (select id from public.users);
update public.comandas      set cliente_id      = null where cliente_id      not in (select id from public.users);
update public.comandas      set profissional_id = null where profissional_id is not null and profissional_id not in (select id from public.users);
update public.agendamentos  set profissional_id = null where profissional_id not in (select id from public.users);
update public.agendamentos  set cliente_id      = null where cliente_id      not in (select id from public.users);
update public.pagamentos    set cliente_id      = null where cliente_id      is not null and cliente_id      not in (select id from public.users);
update public.comissoes     set profissional_id = null where profissional_id not in (select id from public.users);
update public.anamnese_fichas set cliente_id      = null where cliente_id      not in (select id from public.users);
update public.anamnese_fichas set profissional_id = null where profissional_id is not null and profissional_id not in (select id from public.users);

-- ============================================================
-- 4. Recriar FK constraints com ON DELETE SET NULL
-- ============================================================
alter table public.empresas add constraint empresas_owner_id_fkey
  foreign key (owner_id) references public.users(id) on delete set null;

alter table public.comandas add constraint comandas_cliente_id_fkey
  foreign key (cliente_id) references public.users(id) on delete set null;

alter table public.comandas add constraint comandas_profissional_id_fkey
  foreign key (profissional_id) references public.users(id) on delete set null;

alter table public.agendamentos add constraint agendamentos_profissional_id_fkey
  foreign key (profissional_id) references public.users(id) on delete set null;

alter table public.agendamentos add constraint agendamentos_cliente_id_fkey
  foreign key (cliente_id) references public.users(id) on delete set null;

alter table public.pagamentos add constraint pagamentos_cliente_id_fkey
  foreign key (cliente_id) references public.users(id) on delete set null;

alter table public.comissoes add constraint comissoes_profissional_id_fkey
  foreign key (profissional_id) references public.users(id) on delete set null;

alter table public.anamnese_fichas add constraint anamnese_fichas_cliente_id_fkey
  foreign key (cliente_id) references public.users(id) on delete set null;

alter table public.anamnese_fichas add constraint anamnese_fichas_profissional_id_fkey
  foreign key (profissional_id) references public.users(id) on delete set null;
