-- Migration 079: meta mensal pessoal da profissional (distinta da
-- meta_mensal da empresa, que é do dono e vive em `empresas`).
--
-- Não existe policy de UPDATE em empresa_membros que libere o próprio
-- membro alterar a própria linha (migration 043 restringe UPDATE a
-- is_gestor_ou_owner) — de propósito, pra ninguém mexer no próprio role/
-- percentual_comissao/ativo. Por isso a meta pessoal não pode ser uma
-- policy de UPDATE nova: seria ampliar esse acesso pra linha inteira.
-- Uma função SECURITY DEFINER resolve, restrita a essa única coluna e à
-- própria linha do usuário autenticado.

alter table public.empresa_membros
  add column if not exists meta_mensal_pessoal numeric(10,2);

create or replace function public.definir_minha_meta_mensal(p_valor numeric, p_empresa_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_valor is not null and p_valor < 0 then
    raise exception 'Meta não pode ser negativa';
  end if;

  update public.empresa_membros
  set meta_mensal_pessoal = p_valor
  where user_id = auth.uid()
    and ativo = true
    and empresa_id = p_empresa_id;
end;
$$;

grant execute on function public.definir_minha_meta_mensal(numeric, uuid) to authenticated;
