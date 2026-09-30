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
--  2. copia, linha a linha (bloco DO), as fichas de clientes.observacoes para
--     anamnese_fichas.respostas (formato antigo do web; o app normaliza na leitura
--     via shared/anamnese.ts). Linhas com texto livre/JSON inválido são puladas;
--  3. limpa clientes.observacoes SÓ quando esta execução inseriu a ficha (nunca
--     se ela já existia): o campo volta a ser "observações internas" em texto livre.
-- Idempotente: pode rodar mais de uma vez.
--
-- Rollback do passo 3 (se precisar; restaura o JSON como texto só nas fichas de formato web):
--   update public.clientes c set observacoes = f.respostas::text
--   from public.anamnese_fichas f where f.cliente_id = c.id and c.observacoes is null and f.respostas ? 'alergias';

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

-- 2+3. Migra cada ficha de clientes.observacoes e, SÓ se esta execução de fato a
-- copiou, limpa o campo. Linha a linha: observacoes em texto livre ou JSON
-- malformado é ignorada (não aborta a migration), e uma ficha que já existia em
-- anamnese_fichas (on conflict do nothing) NÃO tem o observacoes apagado.
do $$
declare
  r record;
  j jsonb;
  ts timestamptz;
  nova_id uuid;
begin
  for r in
    select id, empresa_id, observacoes
      from public.clientes
     where observacoes ~ '^\s*\{'
  loop
    begin
      j := r.observacoes::jsonb;
    exception when others then
      continue;
    end;

    if j is null or jsonb_typeof(j) <> 'object' or not (j ? 'alergias') then
      continue;
    end if;

    begin
      ts := coalesce((j ->> 'salvo_em')::timestamptz, now());
    exception when others then
      ts := now();
    end;

    nova_id := null;
    insert into public.anamnese_fichas (empresa_id, cliente_id, respostas, created_at, updated_at)
    values (r.empresa_id, r.id, j, ts, ts)
    on conflict (empresa_id, cliente_id) do nothing
    returning id into nova_id;

    if nova_id is not null then
      update public.clientes set observacoes = null where id = r.id;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
