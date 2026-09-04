-- ============================================================
-- MIGRATION 069 — agenda_bloqueios: notificacoes de aprovacao
--
-- Trigger SECURITY DEFINER (padrao da 028) que grava em
-- public.notificacoes nos 3 eventos do fluxo:
--   • profissional cria pedido (INSERT, situacao='pendente')
--       -> 'bloqueio_pendente' p/ cada gestor ativo + owner (dedupe)
--   • gestor/owner aprova (UPDATE pendente -> aprovado)
--       -> 'bloqueio_aprovado' p/ criado_por
--   • gestor/owner recusa (DELETE de pendente por TERCEIRO)
--       -> 'bloqueio_recusado' p/ criado_por
-- Demais casos -> sem notificacao.
--
-- notificacoes nao tem policy de INSERT — insercao so via trigger
-- SECURITY DEFINER (igual 028). Tudo defensivo: criado_por NULL ->
-- nao faz nada e devolve a linha, NUNCA aborta a operacao.
-- ============================================================

create or replace function public.notificar_bloqueio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_autor_nome text;
  v_quando     text;
  v_motivo     text;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    v_quando := to_char(NEW.data_inicio at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
  else
    v_quando := to_char(OLD.data_inicio at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
  end if;

  -- 1. Pedido novo -> avisa a gestao
  if tg_op = 'INSERT' and NEW.situacao = 'pendente' and NEW.criado_por is not null then
    select nome into v_autor_nome from public.users where id = NEW.criado_por;
    v_motivo := case NEW.motivo
      when 'folga'      then 'Folga'
      when 'feriado'    then 'Feriado'
      when 'almoco'     then 'Almoço'
      when 'reuniao'    then 'Reunião'
      when 'manutencao' then 'Manutenção'
      when 'outro'      then 'Outro'
      else coalesce(NEW.motivo, 'sem motivo')
    end;

    insert into public.notificacoes (user_id, empresa_id, tipo, titulo, mensagem)
    select u.uid, NEW.empresa_id, 'bloqueio_pendente',
           'Bloqueio aguardando aprovacao',
           coalesce(split_part(v_autor_nome, ' ', 1), 'Profissional')
             || ' pediu bloqueio em ' || v_quando || ' (' || v_motivo || ')'
    from (
      select m.user_id as uid
        from public.empresa_membros m
       where m.empresa_id = NEW.empresa_id and m.ativo = true and m.role = 'gestor'
      union
      select e.owner_id
        from public.empresas e
       where e.id = NEW.empresa_id and e.owner_id is not null
    ) u
    where u.uid is not null and u.uid <> NEW.criado_por;

    return NEW;
  end if;

  -- 2. Aprovado -> avisa o autor
  if tg_op = 'UPDATE'
     and OLD.situacao = 'pendente' and NEW.situacao = 'aprovado'
     and NEW.criado_por is not null then
    insert into public.notificacoes (user_id, empresa_id, tipo, titulo, mensagem)
    values (NEW.criado_por, NEW.empresa_id, 'bloqueio_aprovado',
            'Bloqueio aprovado',
            'Seu bloqueio de ' || v_quando || ' foi aprovado.');
    return NEW;
  end if;

  -- 3. Recusado (delete de pendente por terceiro) -> avisa o autor
  if tg_op = 'DELETE'
     and OLD.situacao = 'pendente'
     and OLD.criado_por is not null
     and OLD.criado_por <> auth.uid() then
    insert into public.notificacoes (user_id, empresa_id, tipo, titulo, mensagem)
    values (OLD.criado_por, OLD.empresa_id, 'bloqueio_recusado',
            'Bloqueio recusado',
            'Seu bloqueio de ' || v_quando || ' foi recusado.');
    return OLD;
  end if;

  if tg_op = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

drop trigger if exists trg_notificar_bloqueio on public.agenda_bloqueios;
create trigger trg_notificar_bloqueio
  after insert or update or delete on public.agenda_bloqueios
  for each row execute function public.notificar_bloqueio();
