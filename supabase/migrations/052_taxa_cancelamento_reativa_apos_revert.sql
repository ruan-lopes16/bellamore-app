-- ============================================================
-- MIGRATION 052 — reativa taxa de cancelamento apos reagendamento
-- e novo cancelamento
--
-- Fluxo problematico: agendamento e cancelado -> trigger cria taxa
-- 'pendente'. Salao reagenda de volta para 'agendado' -> trigger
-- (ramo de reversao) marca essa mesma linha como 'cancelada'.
-- Cliente cancela de novo (reagendar-e-cancelar-de-novo e um fluxo
-- perfeitamente normal) -> o INSERT abaixo, com
-- "on conflict (agendamento_id) do nothing", nao faz nada, porque
-- ja existe uma linha para esse agendamento_id (agora 'cancelada').
-- Nenhuma taxa nova e gerada para o segundo cancelamento real, e a
-- empresa deixa de cobrar silenciosamente. Sem erro, sem log.
--
-- Esta migration recria gerar_taxa_cancelamento() (CREATE OR
-- REPLACE; a funcao de 050 e substituida por inteiro) trocando
-- apenas a clausula ON CONFLICT: em vez de "do nothing", reativa a
-- linha existente quando (e somente quando) ela estiver
-- 'cancelada' — nunca sobrescreve uma linha 'pendente' ou 'paga'.
-- ============================================================

create or replace function public.gerar_taxa_cancelamento()
returns trigger as $$
declare
  v_empresa      public.empresas%rowtype;
  v_valor        numeric(10,2);
  v_deve_aplicar boolean;
begin
  if old.status = new.status then
    return new;
  end if;

  -- Reverteu de cancelado/faltou para outro status: anula a taxa pendente
  if old.status in ('cancelado', 'faltou') and new.status not in ('cancelado', 'faltou') then
    update public.taxas_cancelamento
      set status = 'cancelada'
      where agendamento_id = new.id and status = 'pendente';
    return new;
  end if;

  if new.status not in ('cancelado', 'faltou') then
    return new;
  end if;

  -- Agendamento sem cliente vinculado (órfão de 027/031, ou cliente
  -- excluído depois via "on delete set null"): não há a quem cobrar,
  -- e taxas_cancelamento.cliente_id é not null. Sai sem gerar a taxa
  -- em vez de deixar o INSERT abaixo violar o constraint e reverter
  -- o UPDATE de status inteiro.
  if new.cliente_id is null then
    return new;
  end if;

  select * into v_empresa from public.empresas where id = new.empresa_id;
  if not found or not v_empresa.taxa_cancelamento_ativa then
    return new;
  end if;

  v_deve_aplicar := (new.status = 'cancelado' and v_empresa.taxa_cancelamento_aplica_cancelado)
                  or (new.status = 'faltou'    and v_empresa.taxa_cancelamento_aplica_faltou);
  if not v_deve_aplicar then
    return new;
  end if;

  v_valor := case v_empresa.taxa_cancelamento_modo
    when 'fixo' then v_empresa.taxa_cancelamento_valor
    else round(coalesce(new.valor, 0) * v_empresa.taxa_cancelamento_valor / 100, 2)
  end;

  -- Se ja existe uma linha 'cancelada' para este agendamento (revertida
  -- por um reagendamento anterior), reativa-a em vez de ignorar o
  -- INSERT: caso contrario o segundo cancelamento nunca gera cobranca.
  -- Linhas 'pendente' ou 'paga' nunca sao tocadas aqui.
  insert into public.taxas_cancelamento (empresa_id, agendamento_id, cliente_id, valor, status)
  values (new.empresa_id, new.id, new.cliente_id, v_valor, 'pendente')
  on conflict (agendamento_id) do update
    set status = 'pendente', valor = excluded.valor, created_at = now(), paga_em = null
    where taxas_cancelamento.status = 'cancelada';

  return new;
end;
$$ language plpgsql security definer set search_path = public;
