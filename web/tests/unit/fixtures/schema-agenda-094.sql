-- Esquema mínimo para rodar a migration 094 no PGlite (Postgres em memória) dentro do vitest.
-- Só as tabelas/colunas/funções que a 094 toca, com a RLS e os triggers vigentes em produção (093):
--   agendamentos: policies "ver" e "equipe atualiza" da 083;
--   avaliacoes: tabela e policy ampla "empresa_all_avaliacoes" da 030 (a 094 derruba);
--   empresa_membros: triggers da 043 (reatribuir/papel), 083 (papel só pela dona) e 092 (histórico),
--   e a policy de UPDATE da 083 (equipe.gerenciar).
-- As funções de permissão leem configurações da sessão:
--   app.uid   → auth.uid()
--   app.negar → chaves que tem_permissao nega a quem não é a dona (ex.: 'agenda.ver_equipe')
-- NÃO é o schema de produção: serve só para exercitar a lógica da 094.
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create role anon;
create role authenticated;
grant usage on schema auth to authenticated;
grant usage on schema public to authenticated;

create type perfil_role as enum ('owner', 'gestor', 'profissional', 'cliente');
create type agendamento_status as enum ('agendado','confirmado','concluido','cancelado','faltou');

create table empresas (id uuid primary key, owner_id uuid);
create table empresa_membros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  user_id uuid not null,
  role perfil_role not null default 'profissional',
  ativo boolean not null default true,
  percentual_comissao numeric(5,2) default 0,
  tipo_contrato text,
  constraint empresa_membros_empresa_user_key unique (empresa_id, user_id)
);
create table clientes (id uuid primary key, empresa_id uuid);
create table comandas (id uuid primary key, empresa_id uuid);
create table agendamentos (
  id uuid primary key, empresa_id uuid, profissional_id uuid, cliente_id uuid,
  comanda_id uuid references comandas(id), status agendamento_status default 'agendado', valor numeric(10,2) default 0,
  servico_id uuid, pacote_cliente_id uuid, desconto_rateado numeric(10,2) default 0
);
create table equipe_historico (id uuid primary key default gen_random_uuid(), empresa_id uuid, alvo_user_id uuid, acao text, detalhe jsonb, feito_por uuid);

-- 030
create table avaliacoes (
  id              uuid        default gen_random_uuid() primary key,
  empresa_id      uuid        not null references empresas(id)          on delete cascade,
  agendamento_id  uuid        unique       references agendamentos(id)  on delete cascade,
  cliente_id      uuid        not null references clientes(id)          on delete cascade,
  profissional_id uuid                     references empresa_membros(id) on delete set null,
  nota            smallint    not null     check (nota between 1 and 5),
  comentario      text,
  created_at      timestamptz default now()
);
alter table avaliacoes enable row level security;
create policy "empresa_all_avaliacoes" on avaliacoes
  using (empresa_id in (select empresa_id from empresa_membros where user_id = auth.uid() and ativo = true))
  with check (empresa_id in (select empresa_id from empresa_membros where user_id = auth.uid() and ativo = true));

-- Permissões (mesma ordem de tem_permissao da 083: dona → vínculo ativo → chave)
create function minha_empresas() returns setof uuid language sql stable security definer as $$
  select empresa_id from public.empresa_membros where user_id = auth.uid() and ativo = true
  union
  select id from public.empresas where owner_id = auth.uid()
$$;
create function is_gestor_ou_owner(uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.empresas where id = $1 and owner_id = auth.uid())
      or exists (select 1 from public.empresa_membros
                  where empresa_id = $1 and user_id = auth.uid() and role = 'gestor' and ativo = true)
$$;
create function tem_permissao(p_empresa uuid, p_chave text) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.empresas where id = p_empresa and owner_id = auth.uid())
      or (exists (select 1 from public.empresa_membros
                   where empresa_id = p_empresa and user_id = auth.uid() and ativo = true)
          and position(p_chave in coalesce(current_setting('app.negar', true), '')) = 0)
$$;

-- agendamentos (083)
alter table agendamentos enable row level security;
create policy "agendamentos: ver" on agendamentos for select using (
  profissional_id = auth.uid()
  or (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'agenda.ver_equipe')));
create policy "agendamentos: equipe atualiza" on agendamentos for update
  using (empresa_id in (select minha_empresas())
         and (tem_permissao(empresa_id, 'agenda.gerenciar_outras') or profissional_id = auth.uid()))
  with check (empresa_id in (select minha_empresas())
         and (tem_permissao(empresa_id, 'agenda.gerenciar_outras') or profissional_id = auth.uid()));

-- empresa_membros: RLS (083) e os triggers vigentes (043, 083, 092 — corpos de produção).
alter table empresa_membros enable row level security;
create policy "membros: ver da empresa" on empresa_membros for select using (empresa_id in (select minha_empresas()));
create policy "membros: gestor ou owner atualiza" on empresa_membros for update
  using (tem_permissao(empresa_id, 'equipe.gerenciar')) with check (tem_permissao(empresa_id, 'equipe.gerenciar'));

create function bloquear_alteracao_role() returns trigger language plpgsql security definer as $$
begin
  if new.user_id is distinct from old.user_id or new.empresa_id is distinct from old.empresa_id then
    raise exception 'Não é possível reatribuir esta associação a outro usuário/empresa.';
  end if;
  if new.role is distinct from old.role then
    if new.role = 'owner' or old.role = 'owner' then raise exception 'O papel de dona não pode ser alterado.'; end if;
    if new.user_id = auth.uid() then raise exception 'Não é possível alterar o próprio papel.'; end if;
    if not exists (select 1 from public.empresas where id = new.empresa_id and owner_id = auth.uid()) then
      raise exception 'Somente a dona da empresa pode alterar o papel de um membro.';
    end if;
  end if;
  return new;
end $$;
create trigger trg_bloquear_alteracao_role before update on empresa_membros
  for each row execute function bloquear_alteracao_role();

create function fn_membros_papel_so_dona() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null
     and not exists (select 1 from public.empresas where id = old.empresa_id and owner_id = auth.uid()) then
    raise exception 'Só a dona pode mudar o papel de alguém' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_membros_papel_so_dona before update of role on empresa_membros
  for each row execute function fn_membros_papel_so_dona();

create function fn_equipe_historico_membro() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ativo is distinct from old.ativo then
    insert into public.equipe_historico (empresa_id, alvo_user_id, acao, feito_por)
      values (new.empresa_id, new.user_id, case when new.ativo then 'reativado' else 'desativado' end, auth.uid());
  end if;
  if new.role is distinct from old.role then
    insert into public.equipe_historico (empresa_id, alvo_user_id, acao, feito_por) values (new.empresa_id, new.user_id, 'papel_trocado', auth.uid());
  end if;
  if new.percentual_comissao is distinct from old.percentual_comissao then
    insert into public.equipe_historico (empresa_id, alvo_user_id, acao, feito_por) values (new.empresa_id, new.user_id, 'comissao_trocada', auth.uid());
  end if;
  if new.tipo_contrato is distinct from old.tipo_contrato then
    insert into public.equipe_historico (empresa_id, alvo_user_id, acao, feito_por) values (new.empresa_id, new.user_id, 'contrato_trocado', auth.uid());
  end if;
  return null;
end $$;
create trigger trg_equipe_historico_membro after update on empresa_membros
  for each row execute function fn_equipe_historico_membro();

alter table clientes enable row level security;
create policy "clientes ver" on clientes for select using (empresa_id in (select minha_empresas()));

-- Comissão do atendimento (001 + 085: agendamento_id opcional, comanda_item_id) e o trigger de
-- conclusão com o corpo vigente (gerar_comissao da 090, trg_gerar_comissao da 065). Sem índice
-- único por atendimento, igual a produção. RLS: só leitura e UPDATE de gestora/dona (083), nenhuma
-- policy de DELETE — apagar só por função security definer.
create type comissao_status as enum ('pendente', 'pago');
create table comissoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  profissional_id uuid not null,
  agendamento_id uuid references agendamentos(id),
  comanda_item_id uuid,
  valor_servico numeric(10,2) not null,
  percentual numeric(5,2) not null,
  valor_comissao numeric(10,2) generated always as (round(valor_servico * percentual / 100, 2)) stored,
  status comissao_status default 'pendente',
  created_at timestamptz default now()
);
alter table comissoes enable row level security;
create policy "comissoes: ver" on comissoes for select
  using (profissional_id = auth.uid() or is_gestor_ou_owner(empresa_id));
create policy "comissoes: gestor ou owner atualiza" on comissoes for update
  using (is_gestor_ou_owner(empresa_id)) with check (is_gestor_ou_owner(empresa_id));

create function gerar_comissao() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_percentual numeric(5,2);
begin
  if new.status = 'concluido' and old.status != 'concluido' then
    if new.pacote_cliente_id is not null then
      return new;
    end if;
    select percentual_comissao into v_percentual
    from public.empresa_membros
    where empresa_id = new.empresa_id and user_id = new.profissional_id;
    if v_percentual is not null and v_percentual > 0 then
      insert into public.comissoes (empresa_id, profissional_id, agendamento_id, valor_servico, percentual)
      values (new.empresa_id, new.profissional_id, new.id,
              greatest(new.valor - coalesce(new.desconto_rateado, 0), 0), v_percentual);
    end if;
  end if;
  return new;
end $$;
create trigger trg_gerar_comissao after update on agendamentos
  for each row execute function gerar_comissao();

-- Pacotes (010, 011, 036, 037) e o trigger de sessão com o corpo vigente (078). O saldo é
-- contagem de pacote_uso por pacote_cliente_id (não há coluna de saldo).
create table servicos (id uuid primary key, empresa_id uuid);
create table pacotes (id uuid primary key, empresa_id uuid, controla_sessoes boolean not null default true);
create table pacote_servicos (pacote_id uuid references pacotes(id), servico_id uuid references servicos(id), quantidade int);
create table pacote_clientes (
  id uuid primary key, empresa_id uuid not null references empresas(id), cliente_id uuid, pacote_id uuid references pacotes(id),
  status text not null default 'ativo', data_validade date
);
create table pacote_uso (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  pacote_cliente_id uuid not null references pacote_clientes(id) on delete cascade,
  servico_id uuid references servicos(id),
  agendamento_id uuid references agendamentos(id),
  created_at timestamptz default now(),
  constraint pacote_uso_agendamento_unico unique (agendamento_id)
);
alter table pacote_uso enable row level security;
create policy "pacote_uso: membro ve" on pacote_uso for select using (empresa_id in (select minha_empresas()));

create function fn_registrar_uso_pacote() returns trigger language plpgsql security definer as $$
declare
  v_pc_id      uuid;
  v_empresa_id uuid;
begin
  if new.status <> 'concluido' or old.status = 'concluido' then
    return new;
  end if;
  if new.pacote_cliente_id is not null then
    select pc.id, pc.empresa_id into v_pc_id, v_empresa_id
      from public.pacote_clientes pc join public.pacotes p on p.id = pc.pacote_id
     where pc.id = new.pacote_cliente_id and pc.empresa_id = new.empresa_id and p.controla_sessoes = true;
  elsif new.comanda_id is null then
    select pc.id, pc.empresa_id into v_pc_id, v_empresa_id
      from public.pacote_clientes pc
      join public.pacotes p on p.id = pc.pacote_id and p.controla_sessoes = true
      join public.pacote_servicos ps on ps.pacote_id = pc.pacote_id and ps.servico_id = new.servico_id
     where pc.cliente_id = new.cliente_id and pc.empresa_id = new.empresa_id and pc.status = 'ativo'
       and (pc.data_validade is null or pc.data_validade >= current_date)
       and (ps.quantidade is null
            or (select count(*) from public.pacote_uso pu where pu.pacote_cliente_id = pc.id)
               < (select coalesce(sum(ps2.quantidade), 0) from public.pacote_servicos ps2
                   where ps2.pacote_id = pc.pacote_id and ps2.quantidade is not null))
     order by pc.data_validade asc nulls last
     limit 1;
  end if;
  if v_pc_id is not null then
    insert into public.pacote_uso (empresa_id, pacote_cliente_id, servico_id, agendamento_id)
    values (v_empresa_id, v_pc_id, new.servico_id, new.id)
    on conflict (agendamento_id) do nothing;
  end if;
  return new;
end $$;
create trigger trg_uso_pacote after update on agendamentos
  for each row execute function fn_registrar_uso_pacote();

grant select, insert, update, delete on all tables in schema public to authenticated;
