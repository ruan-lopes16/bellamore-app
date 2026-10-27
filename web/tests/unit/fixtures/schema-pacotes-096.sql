-- Complemento para rodar a 096 em cima da cadeia 090 → 095 no PGlite (teste pacotes-096).
-- Carregado DEPOIS de schema-comanda-090.sql, schema-cadeia-090-093.sql, schema-alinhamentos-093.sql
-- e das migrations 090–095. Acrescenta só o que a 096 lê e as policies de pacote_clientes que a 083
-- deixou em produção (UPDATE e DELETE para membro; a 096 troca a de DELETE).
-- NÃO é o schema de produção.

alter table pacotes add column if not exists nome text, add column if not exists ativo boolean default true,
  add column if not exists preco numeric(10,2);
create table pacote_servicos (pacote_id uuid not null references pacotes(id) on delete cascade,
  servico_id uuid not null references servicos(id) on delete cascade, quantidade int default 1,
  primary key (pacote_id, servico_id));
create table servico_produtos (id uuid primary key default gen_random_uuid(),
  servico_id uuid not null references servicos(id) on delete cascade, produto_id uuid, quantidade numeric);

-- 083: pacote_clientes UPDATE/DELETE para membro (a 096 restringe o DELETE).
create policy "pacote_clientes: membro atualiza" on pacote_clientes for update
  using (empresa_id in (select minha_empresas())) with check (empresa_id in (select minha_empresas()));
create policy "pacote_clientes: membro exclui" on pacote_clientes for delete
  using (empresa_id in (select minha_empresas()));

grant select, insert, update, delete on all tables in schema public to authenticated;
