-- ============================================================
-- 081 — Profissional pode cadastrar e editar cliente
-- ============================================================
-- Bug de produção (2026-10-02): profissionais não conseguiam cadastrar clientes.
-- Desde a 006, INSERT e UPDATE em public.clientes exigiam is_gestor_ou_owner(),
-- mas web e app mostram "Novo cliente" (tela Clientes e cadastro rápido dentro
-- do agendamento) para todos os papéis — a profissional preenchia o formulário
-- e o banco recusava com "new row violates row-level security policy".
--
-- Decisão do dono: liberar já cadastrar E editar para qualquer membro ativo da
-- empresa. A futura tela de permissões em Configurações passa a controlar isso.
-- DELETE continua só da dona (policy da 006 intocada).
--
-- Arquivar (UPDATE ativo = false) também é um UPDATE, e o botão aparece para
-- todos os papéis. Para a liberação de edição não liberar arquivamento de
-- carona, um trigger mantém a mudança de `ativo` restrita a gestor/owner.
-- (auth.uid() nulo = service role / SQL editor, não é barrado.)
--
-- Rollback:
--   drop trigger if exists trg_clientes_ativo_so_gestor on public.clientes;
--   drop function if exists public.fn_clientes_ativo_so_gestor();
--   drop policy "clientes: membro pode inserir"   on public.clientes;
--   drop policy "clientes: membro pode atualizar" on public.clientes;
--   create policy "clientes: gestor pode inserir" on public.clientes for insert
--     with check (is_gestor_ou_owner(empresa_id));
--   create policy "clientes: gestor pode atualizar" on public.clientes for update
--     using (is_gestor_ou_owner(empresa_id)) with check (is_gestor_ou_owner(empresa_id));

drop policy if exists "clientes: gestor pode inserir"   on public.clientes;
drop policy if exists "clientes: gestor pode atualizar" on public.clientes;
drop policy if exists "clientes: membro pode inserir"   on public.clientes;
drop policy if exists "clientes: membro pode atualizar" on public.clientes;

create policy "clientes: membro pode inserir"
  on public.clientes for insert
  with check (empresa_id in (select minha_empresas()));

create policy "clientes: membro pode atualizar"
  on public.clientes for update
  using (empresa_id in (select minha_empresas()))
  with check (empresa_id in (select minha_empresas()));

create or replace function public.fn_clientes_ativo_so_gestor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ativo is distinct from old.ativo
     and auth.uid() is not null
     and not is_gestor_ou_owner(old.empresa_id) then
    raise exception 'Só a dona ou a gestora pode arquivar ou reativar cliente'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clientes_ativo_so_gestor on public.clientes;
create trigger trg_clientes_ativo_so_gestor
  before update of ativo on public.clientes
  for each row execute function public.fn_clientes_ativo_so_gestor();

notify pgrst, 'reload schema';
