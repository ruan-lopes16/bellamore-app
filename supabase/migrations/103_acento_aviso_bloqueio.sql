-- ============================================================
-- MIGRATION 103 — Acento no título do aviso de bloqueio pendente
--
-- POR QUÊ: o trigger da 069 grava o aviso 'bloqueio_pendente' com o título
-- "Bloqueio aguardando aprovacao" (sem acento). Desde a 102 esse título também
-- sai no push do celular. Esta migration recria notificar_bloqueio() com o
-- corpo EXATO da 069, trocando só "aprovacao" por "aprovação", e corrige os
-- avisos que já estão no sino.
--
-- EXECUTE NO SUPABASE SQL EDITOR (migrations manuais; NÃO usar supabase db push).
-- Idempotente. Ordem livre em relação ao deploy (não há código novo).
--
-- CONFERÊNCIAS (só leitura, depois de rodar):
--   select count(*) from public.notificacoes where titulo = 'Bloqueio aguardando aprovacao';  -- 0
--   select position('aprovação' in prosrc) > 0 from pg_proc where proname = 'notificar_bloqueio'; -- true
--
-- ROLLBACK: rodar de novo a 069 (volta o título sem acento).
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
           'Bloqueio aguardando aprovação',
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

-- Avisos que já estão no sino (o trigger da 097 só barra a API; o SQL Editor passa).
update public.notificacoes
   set titulo = 'Bloqueio aguardando aprovação'
 where titulo = 'Bloqueio aguardando aprovacao';

notify pgrst, 'reload schema';
