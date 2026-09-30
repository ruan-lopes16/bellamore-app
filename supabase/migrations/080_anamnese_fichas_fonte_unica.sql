-- 080_anamnese_fichas_fonte_unica.sql
--
-- Anamnese passa a ter UMA fonte: public.anamnese_fichas (web e mobile).
--
-- Antes: o web gravava a ficha como JSON dentro de clientes.observacoes (texto),
-- e o mobile tentava gravar em anamnese_fichas — mas a tabela só tinha policy de
-- SELECT (001), então todo INSERT/UPDATE do mobile era barrado pelo RLS. E a
-- policy de SELECT ainda comparava auth.uid() vs cliente_id, que perdeu sentido
-- desde a 031 (cliente_id aponta para public.clientes, não para auth.users).
--
-- Esta migration:
--  1. recria as policies (ver/inserir/atualizar) para membros da empresa;
--  2. copia as fichas de clientes.observacoes para anamnese_fichas.respostas
--     (formato antigo do web; o app normaliza na leitura via shared/anamnese.ts);
--  3. limpa clientes.observacoes SÓ nas linhas migradas — o campo volta a ser
--     "observações internas" em texto livre.
-- Idempotente: pode rodar mais de uma vez.
--
-- Rollback do passo 3 (se precisar): as fichas continuam em anamnese_fichas;
--   update public.clientes c set observacoes = f.respostas::text
--   from public.anamnese_fichas f where f.cliente_id = c.id and c.observacoes is null;

alter table public.anamnese_fichas enable row level security;

drop policy if exists "anamnese: ver" on public.anamnese_fichas;
create policy "anamnese: ver" on public.anamnese_fichas
  for select using (empresa_id in (select minha_empresas()));

drop policy if exists "anamnese: inserir" on public.anamnese_fichas;
create policy "anamnese: inserir" on public.anamnese_fichas
  for insert with check (empresa_id in (select minha_empresas()));

drop policy if exists "anamnese: atualizar" on public.anamnese_fichas;
create policy "anamnese: atualizar" on public.anamnese_fichas
  for update using (empresa_id in (select minha_empresas()))
  with check (empresa_id in (select minha_empresas()));

-- 2. Migra as fichas que o web guardava em clientes.observacoes.
insert into public.anamnese_fichas (empresa_id, cliente_id, respostas, created_at, updated_at)
select c.empresa_id,
       c.id,
       c.observacoes::jsonb,
       coalesce((c.observacoes::jsonb ->> 'salvo_em')::timestamptz, now()),
       coalesce((c.observacoes::jsonb ->> 'salvo_em')::timestamptz, now())
from public.clientes c
where c.observacoes is not null
  and c.observacoes ~ '^\s*\{'
  and (c.observacoes::jsonb ? 'alergias')
on conflict (empresa_id, cliente_id) do nothing;

-- 3. Libera clientes.observacoes nas linhas já migradas.
update public.clientes
   set observacoes = null
 where observacoes is not null
   and observacoes ~ '^\s*\{'
   and (observacoes::jsonb ? 'alergias')
   and exists (select 1 from public.anamnese_fichas f
                where f.cliente_id = clientes.id and f.empresa_id = clientes.empresa_id);

notify pgrst, 'reload schema';
