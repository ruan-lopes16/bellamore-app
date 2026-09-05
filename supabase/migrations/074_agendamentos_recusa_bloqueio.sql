-- ============================================================
-- MIGRATION 074 — agendamentos: recusa horário coberto por bloqueio
--
-- Contexto: a migration 020 removeu o trigger de conflito
-- agendamento×agendamento (virou aviso client-side, que permite
-- "agendar mesmo assim"). Com isso, bloqueio de agenda ficou SÓ
-- visual — nada no servidor impede um INSERT em agendamentos sobre
-- um bloqueio. Esta migration cria a trava real, APENAS para o caso
-- bloqueio; NÃO ressuscita a trava agendamento×agendamento.
--
-- Comportamento:
--   • BEFORE INSERT OR UPDATE ON agendamentos, FOR EACH ROW.
--   • Ignora NEW.status IN ('cancelado','faltou').
--   • Em UPDATE, só valida se data_hora_inicio, data_hora_fim OU
--     profissional_id mudaram — não trava troca de status de um
--     agendamento que já existia quando o bloqueio foi criado depois.
--   • Colisão = existe agenda_bloqueios na MESMA empresa, com
--     situacao IN ('aprovado','pendente') (pendente também trava),
--     escopo 'geral' OU profissional_id = NEW.profissional_id, e
--     sobreposição meia-aberta com [NEW.data_hora_inicio,
--     NEW.data_hora_fim).
--   • Colidiu => RAISE EXCEPTION com texto que começa por
--     'Horário bloqueado' (os apps casam por substring).
--
-- SECURITY DEFINER + search_path = public: o trigger precisa enxergar
-- bloqueios 'pendente', que a policy "bloqueios: ver" (068) esconde de
-- quem não é gestor/owner nem autor. Mesmo padrão das migrations 069 e
-- 073.
--
-- Aditivo: nenhuma linha existente é alterada. Só INSERT/UPDATE novos
-- que caiam sobre bloqueio passam a falhar — que é o pedido.
--
-- Rollback: drop trigger trg_check_agendamento_bloqueio on
-- public.agendamentos;  drop function public.check_agendamento_bloqueio();
-- ============================================================

create or replace function public.check_agendamento_bloqueio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_motivo text;
begin
  if NEW.status in ('cancelado', 'faltou') then
    return NEW;
  end if;

  if TG_OP = 'UPDATE'
     and NEW.data_hora_inicio is not distinct from OLD.data_hora_inicio
     and NEW.data_hora_fim    is not distinct from OLD.data_hora_fim
     and NEW.profissional_id  is not distinct from OLD.profissional_id then
    return NEW;
  end if;

  select coalesce(b.motivo, 'bloqueio')
    into v_motivo
  from public.agenda_bloqueios b
  where b.empresa_id = NEW.empresa_id
    and b.situacao in ('aprovado', 'pendente')
    and (b.escopo = 'geral' or b.profissional_id = NEW.profissional_id)
    and b.data_inicio < NEW.data_hora_fim
    and b.data_fim    > NEW.data_hora_inicio
  order by b.data_inicio
  limit 1;

  if found then
    raise exception
      'Horário bloqueado na agenda (%). Remova o bloqueio para agendar nesse período.',
      v_motivo
      using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_check_agendamento_bloqueio on public.agendamentos;
create trigger trg_check_agendamento_bloqueio
  before insert or update on public.agendamentos
  for each row execute function public.check_agendamento_bloqueio();
