-- Migration 078: trava escrita de servicos/pacotes/pacote_servicos para gestor/owner
--
-- `servicos` nunca teve policy de INSERT/UPDATE/DELETE rastreada em nenhuma
-- migration (só a de SELECT, em 001_initial_schema.sql:372) — mas a feature
-- de editar serviço funciona em produção hoje, então é possível que exista
-- uma policy criada à mão no SQL editor e nunca capturada aqui (schema
-- drift, já documentado no projeto). `pacotes`/`pacote_servicos` SIM têm
-- policies rastreadas ("membro insere/atualiza/exclui", migrations
-- 005/010/034/035) abertas a qualquer role.
--
-- Por segurança contra os dois casos (policy desconhecida OU conhecida),
-- este bloco varre pg_policies e derruba TODA policy de INSERT/UPDATE/DELETE
-- dessas 3 tabelas antes de criar as novas — nomes antigos não importam.
-- Policies são somadas com OR: só adicionar uma restritiva sem remover a
-- permissiva antiga não teria efeito nenhum.

do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('servicos', 'pacotes', 'pacote_servicos')
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

create policy "servicos: gestor gerencia"
  on public.servicos
  for all
  using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));

-- SELECT de servicos continua liberado pra qualquer membro (fica intacto,
-- não foi dropado acima — o loop só pega INSERT/UPDATE/DELETE).

create policy "pacotes: gestor gerencia"
  on public.pacotes
  for all
  using (is_gestor_ou_owner(empresa_id))
  with check (is_gestor_ou_owner(empresa_id));

create policy "pacote_servicos: gestor gerencia"
  on public.pacote_servicos
  for all
  using (
    exists (
      select 1 from public.pacotes p
      where p.id = pacote_servicos.pacote_id
        and is_gestor_ou_owner(p.empresa_id)
    )
  )
  with check (
    exists (
      select 1 from public.pacotes p
      where p.id = pacote_servicos.pacote_id
        and is_gestor_ou_owner(p.empresa_id)
    )
  );

-- pacote_clientes (vender) e pacote_uso (registrar sessão) NÃO são tocados
-- aqui — continuam FOR ALL abertos a qualquer membro ativo (migration 010).
