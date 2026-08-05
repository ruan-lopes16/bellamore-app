-- ============================================================
-- MIGRATION 051 — protege owner_id contra escalação via gestor
--
-- A migration 049 deu UPDATE em public.empresas para gestor/owner via
-- is_gestor_ou_owner(id). RLS é por linha, não por coluna: sem essa
-- proteção, um gestor poderia trocar owner_id (inclusive para si
-- mesmo) em qualquer UPDATE permitido pela policy. Este trigger
-- bloqueia qualquer alteração de owner_id feita por quem não é o
-- owner atual — só o owner pode transferir a própria empresa.
-- ============================================================

create or replace function public.protege_empresa_owner_id()
returns trigger as $$
begin
  if new.owner_id is distinct from old.owner_id and old.owner_id <> auth.uid() then
    raise exception 'Apenas o dono da empresa pode alterar o proprietario.';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_protege_empresa_owner_id on public.empresas;

create trigger trg_protege_empresa_owner_id
  before update on public.empresas
  for each row
  execute function public.protege_empresa_owner_id();
