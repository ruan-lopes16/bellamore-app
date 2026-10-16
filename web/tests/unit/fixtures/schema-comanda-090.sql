-- Esquema mínimo para rodar a migration 090 no PGlite (Postgres em memória) dentro do vitest.
-- Só as tabelas/colunas/funções que a 090 toca, com os triggers vigentes resumidos (os da 090 são
-- recriados por ela). RLS de verdade só em agendamentos (para o caso "atendimento de colega
-- invisível" da edição); as funções de permissão leem configurações da sessão:
--   app.uid        → auth.uid()
--   app.negar      → lista de chaves que tem_permissao nega (ex.: 'comanda.desconto,pacotes.vender')
--   app.ver_equipe → '1' = vê atendimentos da equipe (agenda.ver_equipe)
-- NÃO é o schema de produção: serve só para exercitar a lógica das funções.
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create role anon;
create role authenticated;
grant usage on schema auth to authenticated;
grant usage on schema public to authenticated;

create type comanda_status as enum ('aberta','fechada');
create type agendamento_status as enum ('agendado','confirmado','concluido','cancelado','faltou');
create type pagamento_metodo as enum ('dinheiro','pix','credito','debito','cortesia');
create type pagamento_status as enum ('pendente','pago','estornado');
create type comissao_status as enum ('pendente','pago');
create type movimento_tipo as enum ('entrada','saida','ajuste');

create table empresas (id uuid primary key, owner_id uuid);
create table empresa_membros (empresa_id uuid, user_id uuid, percentual_comissao numeric(5,2), role text, ativo boolean default true);
create table clientes (id uuid primary key, empresa_id uuid);
create table servicos (id uuid primary key, empresa_id uuid, nome text);
create table pacotes (id uuid primary key, empresa_id uuid, validade_dias int, controla_sessoes boolean default true);
create table pacote_clientes (id uuid primary key default gen_random_uuid(), empresa_id uuid, pacote_id uuid, cliente_id uuid, data_inicio date, data_validade date, valor_pago numeric(10,2), status text, created_at timestamptz default now());
create table comandas (id uuid primary key default gen_random_uuid(), empresa_id uuid not null, cliente_id uuid, clientes_id uuid, profissional_id uuid, status comanda_status default 'aberta', valor_total numeric(10,2) default 0, desconto numeric(10,2) default 0, desconto_reserva numeric(10,2) not null default 0, valor_final numeric(10,2) generated always as (valor_total - desconto) stored, fechada_at timestamptz, created_at timestamptz default now());
create table agendamentos (id uuid primary key default gen_random_uuid(), empresa_id uuid, profissional_id uuid, cliente_id uuid, servico_id uuid, comanda_id uuid references comandas(id), status agendamento_status default 'agendado', valor numeric(10,2) not null, pacote_cliente_id uuid references pacote_clientes(id));
create table agendamento_servicos (id uuid primary key default gen_random_uuid(), agendamento_id uuid references agendamentos(id), servico_id uuid, valor numeric(10,2) not null default 0, empresa_id uuid);
create table comanda_itens (id uuid primary key default gen_random_uuid(), comanda_id uuid not null references comandas(id) on delete cascade, empresa_id uuid, tipo text, descricao text not null, servico_id uuid, produto_id uuid, pacote_id uuid, profissional_id uuid, quantidade numeric(10,3) not null default 1, valor_unit numeric(10,2) not null, created_at timestamptz default now());
create table vendas (id uuid primary key default gen_random_uuid(), empresa_id uuid, cliente_id uuid, valor_total numeric(10,2) not null default 0, desconto numeric(10,2) not null default 0, valor_final numeric(10,2) generated always as (valor_total - desconto) stored, observacao text, created_at timestamptz default now());
create table venda_itens (id uuid primary key default gen_random_uuid(), empresa_id uuid, venda_id uuid references vendas(id), produto_id uuid, quantidade numeric(10,3), preco_unitario numeric(10,2));
create table pagamentos (id uuid primary key default gen_random_uuid(), empresa_id uuid, comanda_id uuid references comandas(id), venda_id uuid references vendas(id), valor numeric(10,2) not null, metodo pagamento_metodo not null, status pagamento_status default 'pendente', bandeira text, parcelas int not null default 1, taxa_perc numeric(5,4), valor_liquido numeric(10,2), maquininha_id uuid, created_at timestamptz default now());
create table comissoes (id uuid primary key default gen_random_uuid(), empresa_id uuid, profissional_id uuid, agendamento_id uuid, comanda_item_id uuid, valor_servico numeric(10,2) not null, percentual numeric(5,2) not null, valor_comissao numeric(10,2) generated always as (round(valor_servico*percentual/100,2)) stored, status comissao_status default 'pendente', created_at timestamptz default now());
create table produtos (id uuid primary key, empresa_id uuid, nome text, tipo text default 'venda', ativo boolean default true, estoque_atual numeric(10,3) default 0, estoque_minimo numeric(10,3) default 0);
create table estoque_movimentos (id uuid primary key default gen_random_uuid(), produto_id uuid, empresa_id uuid, tipo movimento_tipo, quantidade numeric(10,3), motivo text, agendamento_id uuid, created_at timestamptz default now());
create table taxas_reserva (id uuid primary key default gen_random_uuid(), empresa_id uuid, agendamento_id uuid, valor numeric(10,2), status text, paga_em timestamptz);
create table notificacoes (id uuid primary key default gen_random_uuid(), user_id uuid, empresa_id uuid, tipo text, titulo text, mensagem text);
create table pacote_uso (id uuid primary key default gen_random_uuid(), empresa_id uuid, pacote_cliente_id uuid, servico_id uuid, agendamento_id uuid unique);

create function minha_empresas() returns setof uuid language sql stable as $$ select id from public.empresas $$;
create function is_gestor_ou_owner(uuid) returns boolean language sql stable as $$ select true $$;
create function tem_permissao(p_empresa uuid, p_chave text) returns boolean language sql stable as $$
  select auth.uid() is not null and position(p_chave in coalesce(current_setting('app.negar', true), '')) = 0 $$;
create function comanda_pertence_ao_profissional(p_comanda_id uuid) returns boolean language sql stable as $$ select true $$;

-- Triggers vigentes (resumidos). Os de comissão são substituídos pela 090.
create function atualizar_estoque() returns trigger language plpgsql security definer set search_path = public as $$ begin
  if new.tipo = 'saida' then update public.produtos set estoque_atual = estoque_atual - new.quantidade where id = new.produto_id; end if;
  return new; end $$;
create trigger trg_atualizar_estoque after insert on estoque_movimentos for each row execute function atualizar_estoque();
create function notificar_estoque_baixo() returns trigger language plpgsql security definer as $$ begin return new; end $$;
create trigger trg_notif_estoque_baixo after insert on estoque_movimentos for each row execute function notificar_estoque_baixo();
create function fn_registrar_uso_pacote() returns trigger language plpgsql security definer as $$ begin
  if new.status = 'concluido' and old.status <> 'concluido' and new.pacote_cliente_id is not null then
    insert into public.pacote_uso (empresa_id, pacote_cliente_id, servico_id, agendamento_id)
    values (new.empresa_id, new.pacote_cliente_id, new.servico_id, new.id) on conflict (agendamento_id) do nothing;
  end if; return new; end $$;
create trigger trg_uso_pacote after update on agendamentos for each row execute function fn_registrar_uso_pacote();
create function gerar_comissao() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger trg_gerar_comissao after update on agendamentos for each row execute function gerar_comissao();
create function gerar_comissao_item() returns trigger language plpgsql as $$ begin return new; end $$;
create function sincronizar_comissao_item() returns trigger language plpgsql as $$ begin return new; end $$;
create function apagar_comissao_item() returns trigger language plpgsql security definer set search_path = public as $$ begin
  if exists (select 1 from public.comissoes where comanda_item_id = old.id and status = 'pago') then
    raise exception 'Comissão deste serviço já foi paga';
  end if;
  delete from public.comissoes where comanda_item_id = old.id; return old; end $$;
create trigger trg_gerar_comissao_item after insert on comanda_itens for each row execute function gerar_comissao_item();
create trigger trg_sincronizar_comissao_item after update on comanda_itens for each row execute function sincronizar_comissao_item();
create trigger trg_apagar_comissao_item before delete on comanda_itens for each row execute function apagar_comissao_item();

-- RLS: agendamentos com a regra de visibilidade real (próprio ou agenda.ver_equipe).
alter table agendamentos enable row level security;
create policy "ag ver" on agendamentos for select
  using (profissional_id = auth.uid() or current_setting('app.ver_equipe', true) = '1');
create policy "ag atualiza" on agendamentos for update
  using (profissional_id = auth.uid() or current_setting('app.ver_equipe', true) = '1');
create policy "ag insere" on agendamentos for insert with check (true);
alter table estoque_movimentos enable row level security;
alter table comissoes enable row level security;
create policy "comissoes ver" on comissoes for select using (true);
grant select, insert, update, delete on all tables in schema public to authenticated;
