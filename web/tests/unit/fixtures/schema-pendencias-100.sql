-- Complemento para rodar a cadeia 096 (despesas) → 097 → 098 → 099 → 100 no PGlite (teste
-- pendencias-100-pglite), em cima do esquema montado como no teste pacotes-096 (090 → 096).
-- Acrescenta só as colunas e tabelas que essas migrations leem e que os stubs anteriores não têm.
-- NÃO é o schema de produção.

-- 097 (push): users.push_token, created_at de empresas/membros, notificacoes.lida.
alter table users add column if not exists push_token text;
alter table empresas add column if not exists created_at timestamptz default now();
alter table empresa_membros add column if not exists created_at timestamptz default now();
alter table notificacoes add column if not exists lida boolean default false;

-- 098/099 (cartões): taxas legadas da empresa, maquininhas completas, bandeiras e tabela de taxas.
alter table empresas add column if not exists taxa_cartao_debito numeric,
  add column if not exists taxa_cartao_credito_avista numeric,
  add column if not exists taxa_cartao_credito_parcelado numeric;
alter table cartao_maquininhas add column if not exists max_parcelas int not null default 12,
  add column if not exists ativa boolean not null default true,
  add column if not exists padrao boolean not null default false,
  add column if not exists ordem int not null default 0;
create table if not exists cartao_bandeiras (id uuid primary key default gen_random_uuid(), empresa_id uuid not null,
  chave text not null, nome text not null, ativa boolean not null default true, ordem int not null default 0,
  unique (empresa_id, chave));
create table if not exists cartao_taxas (id uuid primary key default gen_random_uuid(), empresa_id uuid not null,
  maquininha_id uuid not null references cartao_maquininhas(id) on delete cascade,
  bandeira_id uuid references cartao_bandeiras(id) on delete cascade, modalidade text not null,
  parcelas int not null, taxa numeric(6,4) not null);

-- 100 (validade do pacote pelo dia do atendimento): início do atendimento.
alter table agendamentos add column if not exists data_hora_inicio timestamptz;

grant select, insert, update, delete on all tables in schema public to authenticated;
