-- ============================================================
-- 085 — Comissão de serviço extra lançado na comanda
-- ============================================================
-- Spec: docs/superpowers/specs/2026-10-08-comanda-b-recursos-app-design.md
-- EXECUTE NO SUPABASE SQL EDITOR (migrations manuais; NÃO usar `supabase db push`).
--
-- Antes: só o atendimento agendado gerava comissão (trg_gerar_comissao, 065). Serviço
-- extra da comanda guardava `comanda_itens.profissional_id`, mas ninguém recebia comissão.
-- Agora: item `servico` com profissional gera comissão pelo percentual dela
-- (empresa_membros.percentual_comissao), igual ao atendimento.
--   - UPDATE do item reconcilia com o estado atual: se qualifica (serviço, profissional com
--     percentual > 0, valor > 0) e não há comissão, cria (ex.: valor 0 → positivo); se deixou de
--     qualificar (valor 0, profissional removida, tipo mudou), a pendente some; valor/quantidade
--     alterados → valor_servico acompanha (pendente ou paga — mesma regra da 075);
--   - comissão paga nunca é apagada: trocar profissional/tipo ou apagar o item é bloqueado;
--   - um item tem no máximo uma comissão (índice único parcial).
-- SECURITY DEFINER: a profissional que fecha a comanda não tem INSERT/UPDATE em `comissoes`.
-- Sem backfill: extras antigos não ganham comissão (decisão de não reescrever histórico).
--
-- Rollback:
--   drop trigger if exists trg_gerar_comissao_item on public.comanda_itens;
--   drop trigger if exists trg_sincronizar_comissao_item on public.comanda_itens;
--   drop trigger if exists trg_apagar_comissao_item on public.comanda_itens;
--   drop function if exists public.gerar_comissao_item(), public.sincronizar_comissao_item(), public.apagar_comissao_item();
--   drop index if exists uq_comissoes_comanda_item;
--   delete from public.comissoes where comanda_item_id is not null;
--   alter table public.comissoes drop constraint if exists comissoes_origem;
--   alter table public.comissoes drop column if exists comanda_item_id;
--   alter table public.comissoes alter column agendamento_id set not null;

alter table public.comissoes
  add column if not exists comanda_item_id uuid references public.comanda_itens(id);
alter table public.comissoes alter column agendamento_id drop not null;
alter table public.comissoes drop constraint if exists comissoes_origem;
alter table public.comissoes add constraint comissoes_origem check (agendamento_id is not null or comanda_item_id is not null);
drop index if exists idx_comissoes_comanda_item;
create unique index if not exists uq_comissoes_comanda_item on public.comissoes(comanda_item_id) where comanda_item_id is not null;

-- Insere a comissão de um item (usado no INSERT e na troca de profissional).
create or replace function public.gerar_comissao_item()
returns trigger as $$
declare
  v_percentual numeric(5,2);
begin
  if new.tipo = 'servico' and new.profissional_id is not null and new.valor_unit * new.quantidade > 0 then
    select percentual_comissao into v_percentual
      from public.empresa_membros
     where empresa_id = new.empresa_id and user_id = new.profissional_id;
    if v_percentual is not null and v_percentual > 0 then
      insert into public.comissoes (empresa_id, profissional_id, comanda_item_id, valor_servico, percentual)
      values (new.empresa_id, new.profissional_id, new.id, round(new.valor_unit * new.quantidade, 2), v_percentual);
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Reconcilia a comissão do item com o estado ATUAL dele (cria, atualiza ou remove).
create or replace function public.sincronizar_comissao_item()
returns trigger as $$
declare
  v_percentual numeric(5,2);
  v_qualifica boolean := false;
  v_mudou_dono boolean := new.profissional_id is distinct from old.profissional_id or new.tipo is distinct from old.tipo;
  v_mudou_valor boolean := new.valor_unit is distinct from old.valor_unit or new.quantidade is distinct from old.quantidade;
begin
  -- Comissão já paga: nunca apaga; troca de dono é bloqueada, valor acompanha (regra da 075).
  if exists (select 1 from public.comissoes where comanda_item_id = new.id and status = 'pago') then
    if v_mudou_dono then
      raise exception 'Comissão deste serviço já foi paga';
    end if;
    if v_mudou_valor then
      update public.comissoes
         set valor_servico = round(new.valor_unit * new.quantidade, 2)
       where comanda_item_id = new.id;
    end if;
    return new;
  end if;

  if new.tipo = 'servico' and new.profissional_id is not null and new.valor_unit * new.quantidade > 0 then
    select percentual_comissao into v_percentual
      from public.empresa_membros
     where empresa_id = new.empresa_id and user_id = new.profissional_id;
    v_qualifica := v_percentual is not null and v_percentual > 0;
  end if;

  if v_mudou_dono or not v_qualifica then
    delete from public.comissoes where comanda_item_id = new.id;
  end if;

  if v_qualifica then
    if exists (select 1 from public.comissoes where comanda_item_id = new.id) then
      if v_mudou_valor then
        update public.comissoes
           set valor_servico = round(new.valor_unit * new.quantidade, 2)
         where comanda_item_id = new.id;
      end if;
    else
      insert into public.comissoes (empresa_id, profissional_id, comanda_item_id, valor_servico, percentual)
      values (new.empresa_id, new.profissional_id, new.id, round(new.valor_unit * new.quantidade, 2), v_percentual);
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.apagar_comissao_item()
returns trigger as $$
begin
  if exists (select 1 from public.comissoes where comanda_item_id = old.id and status = 'pago') then
    raise exception 'Comissão deste serviço já foi paga';
  end if;
  delete from public.comissoes where comanda_item_id = old.id;
  return old;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_gerar_comissao_item on public.comanda_itens;
create trigger trg_gerar_comissao_item
  after insert on public.comanda_itens
  for each row execute function public.gerar_comissao_item();

drop trigger if exists trg_sincronizar_comissao_item on public.comanda_itens;
create trigger trg_sincronizar_comissao_item
  after update on public.comanda_itens
  for each row execute function public.sincronizar_comissao_item();

drop trigger if exists trg_apagar_comissao_item on public.comanda_itens;
create trigger trg_apagar_comissao_item
  before delete on public.comanda_itens
  for each row execute function public.apagar_comissao_item();

notify pgrst, 'reload schema';
