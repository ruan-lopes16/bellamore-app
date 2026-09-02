-- ============================================================
-- CATEGORIAS DE SERVICO PERSONALIZADAS
-- ------------------------------------------------------------
-- As 8 categorias fixas continuam no codigo (shared/categorias.ts).
-- Esta tabela guarda apenas as categorias que a empresa cria.
-- servicos.categoria (texto) segue valendo para as fixas;
-- servicos.categoria_id aponta para uma personalizada.
-- No maximo um dos dois preenchido (check servicos_categoria_xor).
-- ============================================================

create table public.categorias_servico (
  id          uuid primary key default uuid_generate_v4(),
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  nome        text not null,
  cor         text not null,   -- hex; um dos valores da paleta curada (shared/categorias.ts)
  icone       text not null,   -- nome de icone lucide; um da lista curada
  created_at  timestamptz default now()
);

-- Nome unico por empresa, case-insensitive
create unique index categorias_servico_empresa_nome_uniq
  on public.categorias_servico (empresa_id, lower(nome));

alter table public.categorias_servico enable row level security;

create policy "categorias_servico: membro ve"
  on public.categorias_servico for select
  using (empresa_id in (select minha_empresas()));

create policy "categorias_servico: gestor insere"
  on public.categorias_servico for insert
  with check (is_gestor_ou_owner(empresa_id));

create policy "categorias_servico: gestor atualiza"
  on public.categorias_servico for update
  using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));

create policy "categorias_servico: gestor deleta"
  on public.categorias_servico for delete
  using (is_gestor_ou_owner(empresa_id));

-- Vinculo no servico
alter table public.servicos
  add column categoria_id uuid references public.categorias_servico(id) on delete set null;

-- built-in (texto) XOR personalizada (fk); ambos nulos = sem categoria (renderiza como Outros)
alter table public.servicos
  add constraint servicos_categoria_xor
  check (categoria is null or categoria_id is null);
