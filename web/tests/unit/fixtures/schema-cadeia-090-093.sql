-- Complemento para rodar 090 → 091 → 092 → 093 em sequência no PGlite (teste cadeia-090-093).
-- Carregado DEPOIS de schema-comanda-090.sql e ANTES de schema-alinhamentos-093.sql (que liga a RLS
-- de comandas/itens/pagamentos/vendas/pacote_uso como em produção na 089). Acrescenta só o que a
-- 091 e a 092 precisam e a comanda_pertence_ao_profissional da 089 (o stub da 090 devolve true).
-- NÃO é o schema de produção.

-- 091: colunas da 047 em empresas e a tabela de taxas.
alter table empresas
  add column nome text,
  add column taxa_cancelamento_ativa boolean not null default false,
  add column taxa_cancelamento_modo text not null default 'percentual',
  add column taxa_cancelamento_valor numeric(10,2) not null default 0,
  add column taxa_cancelamento_aplica_cancelado boolean not null default true,
  add column taxa_cancelamento_aplica_faltou boolean not null default true;
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

-- 092: users, auth.users, perfil_role e empresa_membros com id/contrato/unique.
create table auth.users (id uuid primary key, email text);
create table users (id uuid primary key, nome text, email text);
create type perfil_role as enum ('owner', 'gestor', 'profissional', 'cliente');
alter table empresa_membros alter column role type perfil_role using role::perfil_role;
alter table empresa_membros
  add column id uuid primary key default gen_random_uuid(),
  add column tipo_contrato text check (tipo_contrato in ('pj', 'clt')),
  add column created_at timestamptz default now(),
  add constraint empresa_membros_empresa_user_key unique (empresa_id, user_id);
create function eh_dona_da_empresa(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.empresas where id = p_empresa and owner_id = auth.uid()) $$;
alter table empresa_membros enable row level security;
create policy "membros: ver da empresa" on empresa_membros for select using (empresa_id in (select minha_empresas()));
create policy "membros: gestor ou owner convida" on empresa_membros for insert with check (
  role = any (array['gestor'::perfil_role, 'profissional'::perfil_role])
  and tem_permissao(empresa_id, 'equipe.gerenciar'));

-- 089: comanda_pertence_ao_profissional (atendimento dela ou quem fechou), sem olhar vínculo.
create or replace function comanda_pertence_ao_profissional(p_comanda_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.agendamentos a
                  where a.comanda_id = p_comanda_id and a.profissional_id = auth.uid())
      or exists (select 1 from public.comandas c
                  where c.id = p_comanda_id and c.profissional_id = auth.uid()) $$;

-- 089: UPDATE/DELETE de itens e DELETE de pagamentos (editar comanda). O SELECT e o INSERT vêm de
-- schema-alinhamentos-093.sql.
create policy "comanda_itens: profissional ou gestor atualiza" on comanda_itens for update using (
  is_gestor_ou_owner(empresa_id) or comanda_pertence_ao_profissional(comanda_id)
  or tem_permissao(empresa_id, 'agenda.gerenciar_outras'));
create policy "comanda_itens: profissional ou gestor deleta" on comanda_itens for delete using (
  is_gestor_ou_owner(empresa_id) or comanda_pertence_ao_profissional(comanda_id)
  or tem_permissao(empresa_id, 'agenda.gerenciar_outras'));
create policy "pagamentos: profissional ou gestor deleta" on pagamentos for delete using (
  is_gestor_ou_owner(empresa_id)
  or (comanda_id is not null and comanda_pertence_ao_profissional(comanda_id))
  or (comanda_id is not null and tem_permissao(empresa_id, 'agenda.gerenciar_outras')));

-- 083: UPDATE de empresa_membros (desativar) com equipe.gerenciar.
create policy "membros: gestor ou owner atualiza" on empresa_membros for update
  using (tem_permissao(empresa_id, 'equipe.gerenciar')) with check (tem_permissao(empresa_id, 'equipe.gerenciar'));

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on auth.users to authenticated;
