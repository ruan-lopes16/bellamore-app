-- Complemento do schema-comanda-090.sql para rodar a migration 093 no PGlite (Postgres em memória).
-- Carregado DEPOIS do stub da 090 e da própria 090. Troca as funções de permissão do stub por
-- versões que olham o vínculo de verdade (dona, membro ativo, papel gestor) e liga a RLS com as
-- policies que a 093 encontra em produção (consulta de 2026-10-15), para a 093 substituí-las:
--   app.uid   → auth.uid()
--   app.negar → chaves que tem_permissao nega a quem não é a dona (ex.: 'vendas.acessar,financeiro.ver')
-- NÃO é o schema de produção: serve só para exercitar policies e funções.

create table cartao_maquininhas (id uuid primary key, empresa_id uuid, nome text);

create or replace function minha_empresas() returns setof uuid language sql stable security definer as $$
  select empresa_id from public.empresa_membros where user_id = auth.uid() and ativo = true
  union
  select id from public.empresas where owner_id = auth.uid()
$$;
create or replace function is_gestor_ou_owner(uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.empresas where id = $1 and owner_id = auth.uid())
      or exists (select 1 from public.empresa_membros
                  where empresa_id = $1 and user_id = auth.uid() and role = 'gestor' and ativo = true)
$$;
create or replace function tem_permissao(p_empresa uuid, p_chave text) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.empresas where id = p_empresa and owner_id = auth.uid())
      or (exists (select 1 from public.empresa_membros
                   where empresa_id = p_empresa and user_id = auth.uid() and ativo = true)
          and position(p_chave in coalesce(current_setting('app.negar', true), '')) = 0)
$$;

-- comandas (083 INSERT; 089 SELECT/UPDATE; 073 DELETE — com o ramo direto que a 093 tira)
alter table comandas enable row level security;
create policy "comandas: membro insere" on comandas for insert
  with check (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'comanda.fechar'));
create policy "comandas: profissional ou gestor ve" on comandas for select using (
  is_gestor_ou_owner(empresa_id) or profissional_id = auth.uid() or comanda_pertence_ao_profissional(id)
  or tem_permissao(empresa_id, 'agenda.gerenciar_outras'));
create policy "comandas: profissional ou gestor atualiza" on comandas for update using (
  is_gestor_ou_owner(empresa_id) or profissional_id = auth.uid() or comanda_pertence_ao_profissional(id)
  or tem_permissao(empresa_id, 'agenda.gerenciar_outras'));
create policy "comandas: profissional ou gestor deleta" on comandas for delete using (
  is_gestor_ou_owner(empresa_id) or profissional_id = auth.uid() or comanda_pertence_ao_profissional(id));

-- comanda_itens (089 + "membro insere" da 075)
alter table comanda_itens enable row level security;
create policy "comanda_itens: membro insere" on comanda_itens for insert
  with check (empresa_id in (select minha_empresas()));
create policy "comanda_itens: profissional ou gestor ve" on comanda_itens for select using (
  is_gestor_ou_owner(empresa_id) or comanda_pertence_ao_profissional(comanda_id)
  or tem_permissao(empresa_id, 'agenda.gerenciar_outras'));

-- pagamentos (086 SELECT, 089 DELETE, "membro insere" da 075)
alter table pagamentos enable row level security;
create policy "pagamentos: membro insere" on pagamentos for insert
  with check (empresa_id in (select minha_empresas()));
create policy "pagamentos: profissional ou gestor ve" on pagamentos for select using (
  tem_permissao(empresa_id, 'financeiro.ver')
  or (comanda_id is not null and comanda_pertence_ao_profissional(comanda_id))
  or (comanda_id is not null and tem_permissao(empresa_id, 'agenda.gerenciar_outras'))
  or (venda_id is not null and tem_permissao(empresa_id, 'vendas.acessar')));

-- vendas / venda_itens ("membro gerencia" + 086)
alter table vendas enable row level security;
create policy "vendas: membro gerencia" on vendas for all
  using (empresa_id in (select minha_empresas())) with check (empresa_id in (select minha_empresas()));
create policy "vendas: vendas.acessar ve" on vendas for select using (tem_permissao(empresa_id, 'vendas.acessar'));
create policy "vendas: vendas.acessar deleta" on vendas for delete using (
  tem_permissao(empresa_id, 'vendas.acessar') and created_at > now() - interval '10 minutes'
  and not exists (select 1 from public.venda_itens vi where vi.venda_id = vendas.id));
alter table venda_itens enable row level security;
create policy "venda_itens: membro gerencia" on venda_itens for all
  using (empresa_id in (select minha_empresas())) with check (empresa_id in (select minha_empresas()));
create policy "venda_itens: vendas.acessar ve" on venda_itens for select using (tem_permissao(empresa_id, 'vendas.acessar'));

-- pacote_uso ("membro gerencia" da 010) e pacote_clientes (083)
alter table pacote_uso enable row level security;
create policy "pacote_uso: membro gerencia" on pacote_uso for all
  using (empresa_id in (select minha_empresas())) with check (empresa_id in (select minha_empresas()));
alter table pacote_clientes enable row level security;
create policy "pacote_clientes: membro ve" on pacote_clientes for select using (empresa_id in (select minha_empresas()));
create policy "pacote_clientes: vender" on pacote_clientes for insert
  with check (empresa_id in (select minha_empresas()) and tem_permissao(empresa_id, 'pacotes.vender'));

grant select, insert, update, delete on all tables in schema public to authenticated;
