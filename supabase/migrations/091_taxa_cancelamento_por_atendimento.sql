-- ============================================================
-- 091 — Taxa de cancelamento dispensável por atendimento
-- ============================================================
-- Spec: docs/superpowers/specs/2026-10-15-taxas-por-atendimento-design.md
--
-- A chave geral da empresa (taxa_cancelamento_ativa + aplica_cancelado/aplica_faltou) continua
-- sendo o padrão. Cada atendimento ganha agendamentos.cobrar_taxa_cancelamento (default true):
--   * falso no momento em que o status vira cancelado/faltou → nenhuma taxa é criada;
--   * desligado depois (ex.: "Dispensar" no Financeiro) → a taxa 'pendente' deste atendimento
--     vira 'cancelada' (taxa 'paga' nunca é tocada);
--   * religado com o status ainda cancelado/faltou → cria a taxa ou reativa a linha 'cancelada'
--     (mesmo ON CONFLICT da 052).
-- O corpo de gerar_taxa_cancelamento() é o da 052 por inteiro (reativação após revert, guarda de
-- cliente nulo, security definer, search_path); muda só a guarda de entrada ("status OU
-- cobrar_taxa_cancelamento mudou") e o bloco de dispensa.
-- O trigger já era "after update" (qualquer coluna, desde a 048); é recriado igual, só para
-- deixar explícito que reage também à coluna nova.
-- A dispensa vale só para o episódio de cancelamento: o BEFORE UPDATE resetar_cobrar_taxa_cancelamento
-- volta cobrar_taxa_cancelamento para true quando o status SAI de cancelado/faltou (reagendamento).
-- Sem isso, um atendimento dispensado, reagendado e cancelado de novo por um caminho que envia só
-- `status` (tela antiga/PWA em cache) ficaria sem taxa em silêncio.
-- Sem a 091 as telas não enviam a coluna (detecção em shared/taxas-atendimento.ts) e tudo
-- funciona como antes. Idempotente.
--
-- Rollback:
--   1. Rodar de novo o create or replace function de 052_taxa_cancelamento_reativa_apos_revert.sql
--      (antes do drop column, porque a função nova lê a coluna).
--   2. drop trigger if exists trg_resetar_cobrar_taxa_cancelamento on public.agendamentos;
--      drop function if exists public.resetar_cobrar_taxa_cancelamento();
--   3. alter table public.agendamentos drop column if exists cobrar_taxa_cancelamento;
--   4. notify pgrst, 'reload schema';
-- ============================================================

alter table public.agendamentos
  add column if not exists cobrar_taxa_cancelamento boolean not null default true;

create or replace function public.gerar_taxa_cancelamento()
returns trigger as $$
declare
  v_empresa      public.empresas%rowtype;
  v_valor        numeric(10,2);
  v_deve_aplicar boolean;
  v_status_mudou boolean;
  v_cobrar_mudou boolean;
begin
  v_status_mudou := old.status is distinct from new.status;
  v_cobrar_mudou := old.cobrar_taxa_cancelamento is distinct from new.cobrar_taxa_cancelamento;

  if not v_status_mudou and not v_cobrar_mudou then
    return new;
  end if;

  -- Reverteu de cancelado/faltou para outro status: anula a taxa pendente
  if v_status_mudou
     and old.status in ('cancelado', 'faltou') and new.status not in ('cancelado', 'faltou') then
    update public.taxas_cancelamento
      set status = 'cancelada'
      where agendamento_id = new.id and status = 'pendente';
    return new;
  end if;

  if new.status not in ('cancelado', 'faltou') then
    return new;
  end if;

  -- Atendimento dispensado da taxa (na hora de cancelar/marcar falta, ou depois): não cria, e
  -- se já existe uma taxa 'pendente' deste atendimento, encerra como 'cancelada'.
  -- Taxa 'paga' nunca é tocada.
  if not new.cobrar_taxa_cancelamento then
    update public.taxas_cancelamento
      set status = 'cancelada'
      where agendamento_id = new.id and status = 'pendente';
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
  -- por um reagendamento anterior, ou dispensada e agora religada),
  -- reativa-a em vez de ignorar o INSERT. Linhas 'pendente' ou 'paga'
  -- nunca sao tocadas aqui.
  insert into public.taxas_cancelamento (empresa_id, agendamento_id, cliente_id, valor, status)
  values (new.empresa_id, new.id, new.cliente_id, v_valor, 'pendente')
  on conflict (agendamento_id) do update
    set status = 'pendente', valor = excluded.valor, created_at = now(), paga_em = null
    where taxas_cancelamento.status = 'cancelada';

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Sair de cancelado/faltou encerra o episódio: a dispensa não vale para um cancelamento futuro.
create or replace function public.resetar_cobrar_taxa_cancelamento()
returns trigger as $$
begin
  if old.status in ('cancelado', 'faltou') and new.status not in ('cancelado', 'faltou') then
    new.cobrar_taxa_cancelamento := true;
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists trg_resetar_cobrar_taxa_cancelamento on public.agendamentos;

create trigger trg_resetar_cobrar_taxa_cancelamento
  before update on public.agendamentos
  for each row
  execute function public.resetar_cobrar_taxa_cancelamento();

drop trigger if exists trg_gerar_taxa_cancelamento on public.agendamentos;

create trigger trg_gerar_taxa_cancelamento
  after update on public.agendamentos
  for each row
  execute function public.gerar_taxa_cancelamento();

notify pgrst, 'reload schema';
