-- ============================================================
-- MIGRATION 053 — fecha brecha de NULL na protecao de owner_id
--
-- A migration 051 bloqueava troca de owner_id com:
--   if new.owner_id is distinct from old.owner_id and old.owner_id <> auth.uid() then
--     raise exception ...
--   end if;
--
-- `empresas.owner_id` e nullable (FK com "on delete set null"). Em SQL,
-- `<>` retorna NULL (nao TRUE) quando um dos lados e NULL, entao quando
-- old.owner_id is null a condicao inteira vira NULL, o "if" segue o ramo
-- falso e NENHUMA excecao e disparada — um gestor de uma empresa sem
-- owner (dono deletado) conseguia se autodeclarar owner livremente.
--
-- Nova regra: so o owner atual (auth.uid() = old.owner_id) pode alterar
-- owner_id. Se nao houver owner atual (old.owner_id is null), NINGUEM
-- pode alterar owner_id atraves deste UPDATE amplo de gestor — a
-- atribuicao de um owner para empresa orfa deve ser um mecanismo
-- explicito e separado, nao efeito colateral de editar outros campos.
--
-- Cuidado com a ordem do NULL-check: a guarda tem que testar
-- `old.owner_id is not null` (nao `auth.uid() is not null`). Em SQL,
-- TRUE AND NULL = NULL (nao FALSE), entao se a guarda checasse
-- auth.uid() em vez de old.owner_id, o caso "empresa orfa + gestor
-- autenticado" ainda cairia em NULL AND ... = NULL -> NOT NULL = NULL,
-- e o IF do plpgsql trata NULL como falso (nao dispara a excecao) —
-- reproduzindo exatamente o bug da migration 051. Checando
-- `old.owner_id is not null` primeiro, o AND vira FALSE (nao NULL)
-- quando a empresa e orfa, entao NOT FALSE = TRUE e a excecao dispara.
-- ============================================================

create or replace function public.protege_empresa_owner_id()
returns trigger as $$
begin
  if new.owner_id is distinct from old.owner_id
     and not (old.owner_id is not null and old.owner_id = auth.uid()) then
    raise exception 'Apenas o dono da empresa pode alterar o proprietario.';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- A trigger em si (trg_protege_empresa_owner_id) ja aponta para esta
-- funcao via CREATE OR REPLACE FUNCTION; nao e necessario recriar o
-- trigger, apenas garantir que ele segue ativo.
drop trigger if exists trg_protege_empresa_owner_id on public.empresas;

create trigger trg_protege_empresa_owner_id
  before update on public.empresas
  for each row
  execute function public.protege_empresa_owner_id();
