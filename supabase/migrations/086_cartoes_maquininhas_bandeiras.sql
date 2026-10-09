-- ============================================================
-- 086 — Cartões: maquininhas, bandeiras e taxas por parcela
-- ============================================================
-- Spec: docs/superpowers/specs/2026-10-09-cartoes-configuraveis-e-vendas-app-design.md
-- EXECUTE NO SUPABASE SQL EDITOR (migrations manuais; NÃO usar `supabase db push`).
--
-- Cada empresa cadastra maquininhas (com máximo de parcelas) e bandeiras. Cada maquininha tem uma
-- tabela padrão (bandeira_id null: débito + crédito 1x..máx) e exceções por bandeira. O seed abaixo
-- cria, para cada empresa, as 5 bandeiras de antes e uma maquininha "Maquininha" com as taxas da 084
-- (débito; crédito 1x = à vista; 2x a 12x = parcelado) — nada muda nos números no dia em que roda.
-- Empresa nova ganha o mesmo seed por trigger. As colunas taxa_cartao_* da 084 deixam de ser editadas.
-- Pagamentos antigos mantêm taxa_perc; maquininha_id fica null neles.
--
-- Rollback:
--   drop trigger if exists trg_semear_cartoes_empresa on public.empresas;
--   drop function if exists public.trg_fn_semear_cartoes_empresa(), public.semear_cartoes_empresa(uuid);
--   alter table public.pagamentos drop column if exists maquininha_id;
--   drop table if exists public.cartao_taxas, public.cartao_maquininhas, public.cartao_bandeiras;

create table if not exists public.cartao_bandeiras (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave      text not null,
  nome       text not null,
  ativa      boolean not null default true,
  ordem      int not null default 0,
  created_at timestamptz not null default now(),
  unique (empresa_id, chave)
);

create table if not exists public.cartao_maquininhas (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  nome         text not null,
  max_parcelas int not null default 12 check (max_parcelas between 1 and 18),
  ativa        boolean not null default true,
  padrao       boolean not null default false,
  ordem        int not null default 0,
  created_at   timestamptz not null default now()
);
create unique index if not exists uq_cartao_maquininha_padrao
  on public.cartao_maquininhas (empresa_id) where padrao and ativa;

create table if not exists public.cartao_taxas (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  maquininha_id uuid not null references public.cartao_maquininhas(id) on delete cascade,
  bandeira_id   uuid references public.cartao_bandeiras(id) on delete cascade,
  modalidade    text not null check (modalidade in ('debito', 'credito')),
  parcelas      int not null check (parcelas between 1 and 18),
  taxa numeric(6,4) not null check (taxa between 0 and 0.2),
  check (modalidade = 'credito' or parcelas = 1)
);
create unique index if not exists uq_cartao_taxas_linha
  on public.cartao_taxas (maquininha_id, coalesce(bandeira_id, '00000000-0000-0000-0000-000000000000'::uuid), modalidade, parcelas);

alter table public.pagamentos
  add column if not exists maquininha_id uuid references public.cartao_maquininhas(id) on delete set null;

-- RLS: leitura para membros, escrita com a permissão config.taxas (083).
alter table public.cartao_bandeiras enable row level security;
alter table public.cartao_maquininhas enable row level security;
alter table public.cartao_taxas enable row level security;

drop policy if exists "cartao_bandeiras: membro ve" on public.cartao_bandeiras;
create policy "cartao_bandeiras: membro ve" on public.cartao_bandeiras for select
  using (empresa_id in (select minha_empresas()));
drop policy if exists "cartao_bandeiras: config.taxas edita" on public.cartao_bandeiras;
create policy "cartao_bandeiras: config.taxas edita" on public.cartao_bandeiras for all
  using (tem_permissao(empresa_id, 'config.taxas'))
  with check (tem_permissao(empresa_id, 'config.taxas'));

drop policy if exists "cartao_maquininhas: membro ve" on public.cartao_maquininhas;
create policy "cartao_maquininhas: membro ve" on public.cartao_maquininhas for select
  using (empresa_id in (select minha_empresas()));
drop policy if exists "cartao_maquininhas: config.taxas edita" on public.cartao_maquininhas;
create policy "cartao_maquininhas: config.taxas edita" on public.cartao_maquininhas for all
  using (tem_permissao(empresa_id, 'config.taxas'))
  with check (tem_permissao(empresa_id, 'config.taxas'));

drop policy if exists "cartao_taxas: membro ve" on public.cartao_taxas;
create policy "cartao_taxas: membro ve" on public.cartao_taxas for select
  using (empresa_id in (select minha_empresas()));
drop policy if exists "cartao_taxas: config.taxas edita" on public.cartao_taxas;
create policy "cartao_taxas: config.taxas edita" on public.cartao_taxas for all
  using (tem_permissao(empresa_id, 'config.taxas'))
  with check (tem_permissao(empresa_id, 'config.taxas'));

-- Seed de uma empresa (só se ela ainda não tem maquininha).
create or replace function public.semear_cartoes_empresa(p_empresa_id uuid)
returns void as $$
declare
  v_debito    numeric(6,4);
  v_avista    numeric(6,4);
  v_parcelado numeric(6,4);
  v_maq       uuid;
  n           int;
begin
  if exists (select 1 from public.cartao_maquininhas where empresa_id = p_empresa_id) then
    return;
  end if;

  insert into public.cartao_bandeiras (empresa_id, chave, nome, ordem) values
    (p_empresa_id, 'visa', 'Visa', 1),
    (p_empresa_id, 'mastercard', 'Master', 2),
    (p_empresa_id, 'elo', 'Elo', 3),
    (p_empresa_id, 'amex', 'Amex', 4),
    (p_empresa_id, 'hipercard', 'Hipercard', 5)
  on conflict (empresa_id, chave) do nothing;

  select coalesce(taxa_cartao_debito, 0.0239), coalesce(taxa_cartao_credito_avista, 0.0499),
         coalesce(taxa_cartao_credito_parcelado, 0.0559)
    into v_debito, v_avista, v_parcelado
    from public.empresas where id = p_empresa_id;

  insert into public.cartao_maquininhas (empresa_id, nome, max_parcelas, padrao, ordem)
  values (p_empresa_id, 'Maquininha', 12, true, 1)
  returning id into v_maq;

  insert into public.cartao_taxas (empresa_id, maquininha_id, bandeira_id, modalidade, parcelas, taxa)
  values (p_empresa_id, v_maq, null, 'debito', 1, coalesce(v_debito, 0.0239)),
         (p_empresa_id, v_maq, null, 'credito', 1, coalesce(v_avista, 0.0499));
  for n in 2..12 loop
    insert into public.cartao_taxas (empresa_id, maquininha_id, bandeira_id, modalidade, parcelas, taxa)
    values (p_empresa_id, v_maq, null, 'credito', n, coalesce(v_parcelado, 0.0559));
  end loop;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.trg_fn_semear_cartoes_empresa()
returns trigger as $$
begin
  perform public.semear_cartoes_empresa(new.id);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_semear_cartoes_empresa on public.empresas;
create trigger trg_semear_cartoes_empresa
  after insert on public.empresas
  for each row execute function public.trg_fn_semear_cartoes_empresa();

-- Empresas existentes.
select public.semear_cartoes_empresa(id) from public.empresas;

notify pgrst, 'reload schema';
