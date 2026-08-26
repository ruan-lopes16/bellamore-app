-- ============================================================
-- MIGRATION 061 — encerra a taxa de reserva quando o atendimento acontece
--
-- PROBLEMA
-- Uma linha de taxas_reserva nasce 'pendente' (o toggle "Ja foi cobrada?"
-- so chegou em producao em 13/08/2026; antes disso TODA taxa nascia
-- pendente, sem alternativa na tela). A partir dai existiam apenas duas
-- saidas do status 'pendente':
--   1. clique manual no Financeiro  -> 'pago'
--   2. trigger de 055, ao cancelar/faltar -> 'retida'
-- O caminho normal — o atendimento acontecer — nao mexia na linha. Ou seja,
-- todo agendamento concluido deixava para tras uma taxa 'pendente' eterna,
-- e a lista de "Taxas de Reserva" do Financeiro virava um mural de dividas
-- que nao existem.
--
-- POR QUE 'cancelada' E NAO 'pago'
-- Quando a taxa fica pendente, a comanda cobra o valor CHEIO do servico:
-- o desconto de taxa de reserva so olha linhas com status 'pago'
-- (web/app/(app)/comanda/page.tsx e mobile/app/(empresa)/nova-comanda.tsx).
-- Logo o dinheiro dessa taxa ja entrou na receita, dentro do fechamento da
-- comanda. Marcar a linha como 'pago' somaria o mesmo valor uma segunda vez
-- ao faturamento bruto (Dashboard, Financeiro e Relatorios somam
-- taxas_reserva com paga_em preenchido). 'cancelada' encerra a linha sem
-- tocar em nenhum numero — o mesmo estado terminal que taxas_cancelamento
-- ja usa desde a migration 047.
--
-- Esta migration:
--   1. libera o status 'cancelada' no check constraint;
--   2. recria reter_taxa_reserva() com o ramo de conclusao (e o ramo de
--      reversao, para quem desfaz uma conclusao feita por engano);
--   3. faz o backfill das taxas pendentes de agendamentos ja concluidos.
--
-- ROLLBACK do backfill (se precisar desfazer):
--   update public.taxas_reserva set status = 'pendente' where status = 'cancelada';
-- ============================================================

-- ── 1. Novo estado terminal ─────────────────────────────────
alter table public.taxas_reserva
  drop constraint if exists taxas_reserva_status_check;

alter table public.taxas_reserva
  add constraint taxas_reserva_status_check
  check (status in ('pendente', 'pago', 'retida', 'cancelada'));

-- ── 2. Trigger: fecha o ciclo no caminho feliz ──────────────
create or replace function public.reter_taxa_reserva()
returns trigger as $$
begin
  if old.status = new.status then
    return new;
  end if;

  -- Atendimento aconteceu. A taxa que continuou 'pendente' nunca foi
  -- cobrada a parte, e a comanda ja cobrou o valor cheio — encerra a linha
  -- sem virar receita (ver cabecalho). Linhas 'pago' e 'retida' nao sao
  -- tocadas: a paga ja foi descontada na comanda, a retida e outra historia.
  if new.status = 'concluido' then
    update public.taxas_reserva
      set status = 'cancelada'
      where agendamento_id = new.id and status = 'pendente';
    return new;
  end if;

  -- Desfez a conclusao (concluiu por engano e devolveu para a agenda):
  -- o atendimento voltou a ser futuro, entao a taxa volta a ser devida.
  -- So reativa o que ESTE trigger encerrou ('cancelada'); nunca mexe em
  -- 'pago' ou 'retida'.
  if old.status = 'concluido' and new.status in ('agendado', 'confirmado') then
    update public.taxas_reserva
      set status = 'pendente'
      where agendamento_id = new.id and status = 'cancelada';
    return new;
  end if;

  if new.status not in ('cancelado', 'faltou') then
    return new;
  end if;

  update public.taxas_reserva
    set status = 'retida'
    where agendamento_id = new.id and status in ('pendente', 'pago');

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- O trigger de 055 continua valido (mesma funcao, mesmo evento); recriado
-- aqui so para a migration ser auto-suficiente se rodada isolada.
drop trigger if exists trg_reter_taxa_reserva on public.agendamentos;

create trigger trg_reter_taxa_reserva
  after update on public.agendamentos
  for each row
  execute function public.reter_taxa_reserva();

-- ── 3. Backfill do passado ──────────────────────────────────
-- Toda taxa ainda 'pendente' cujo agendamento ja foi concluido: mesmo caso
-- que o trigger acima passa a tratar, so que acumulado desde 06/08/2026.
-- Nao altera receita (linha pendente nunca somou, cancelada tambem nao).
update public.taxas_reserva t
   set status = 'cancelada'
  from public.agendamentos a
 where a.id = t.agendamento_id
   and t.status = 'pendente'
   and a.status = 'concluido';
