-- ============================================================
-- MIGRATION 100 — Pendências de dinheiro e falhas silenciosas
-- Spec:  docs/superpowers/specs/2026-11-03-pendencias-dinheiro-falhas-design.md (seção "Banco")
-- Plano: docs/superpowers/plans/2026-11-03-pendencias-dinheiro-falhas.md (Task 1)
--
-- EXECUTE NO SUPABASE SQL EDITOR (migrations manuais; NÃO usar `supabase db push`).
-- Idempotente: `create or replace function`, `drop trigger if exists` + `create trigger`; o backfill
-- só pega linhas 'retida' de atendimentos reabertos (rodar de novo não acha nada novo).
-- Requer a 096 (a seção 0 recusa rodar sem ela: traz pacote_clientes.venda_id/comanda_id, a função
-- excluir_pacote_cliente e a chave app.pacote_rpc das guardas). Ordem em relação ao deploy: rodar ANTES do deploy desta branch.
-- Sem a 100, o botão "Excluir a venda inteira" mostra "Atualize o sistema: falta a migration 100."
--
-- POR QUE CADA PARTE
--
-- A1) reter_taxa_reserva() — corpo da 061 (nenhuma migration posterior a recriou), com um ramo novo
--     logo depois de `if old.status = new.status`: quando o atendimento sai de cancelado/faltou para
--     qualquer outro status, as taxas 'retida' dele voltam a 'pago' (se tinham paga_em) ou 'pendente'.
--     Antes, cancelar e depois reagendar deixava a taxa 'retida' para sempre (a cliente podia pagar a
--     taxa de novo e a comanda não descontava a já paga, que só olha 'pago'). O ramo NÃO retorna: o
--     fluxo segue e, se o novo status é 'concluido', a 'pendente' reaberta vira 'cancelada' (061).
--     Números: a receita da taxa é datada por paga_em e conta 'pago' e 'retida' do mesmo jeito
--     (shared/kpis-financeiros.ts#ehTaxaReservaReceita) — reabrir não muda faturamento nenhum.
--     Backfill pela mesma regra só para atendimentos HOJE em agendado/confirmado.
--
--     Atendimentos já 'concluido' com taxa 'retida' NÃO são alterados (a cliente pode ter pago duas
--     vezes — decisão de devolução é do dono). Consulta só de leitura para listar, ANTES de rodar:
--       select c.nome as cliente, a.data_hora_inicio, t.valor as taxa, t.paga_em, a.comanda_id
--         from public.taxas_reserva t
--         join public.agendamentos a on a.id = t.agendamento_id
--         left join public.clientes c on c.id = a.cliente_id
--        where t.status = 'retida' and a.status = 'concluido'
--        order by a.data_hora_inicio;
--
-- A5) fn_registrar_uso_pacote() — corpo EXATO da 078, com uma única troca: a validade do pacote é
--     comparada com o DIA DO ATENDIMENTO em Brasília, não com CURRENT_DATE (dia do servidor, em UTC, e
--     do momento da conclusão). Um atendimento às 22h de Brasília do último dia de validade já é o dia
--     seguinte em UTC, e concluir no dia seguinte também perdia a sessão. Mais `set search_path = public`
--     (create or replace zera o que a 090 tinha posto com alter function). O trigger trg_uso_pacote não muda.
--
-- A2) Venda com vários pacotes só sai inteira.
--     - excluir_pacote_cliente (corpo da 096): se a venda do pacote tem mais de um pacote, recusa
--       ("Esta venda tem N pacotes..."). O ramo antigo, que só diminuía vendas.valor_total e deixava os
--       pagamentos (faturamento e caixa diferentes), sai — ficou inalcançável.
--     - excluir_venda_pacotes(p_empresa, p_venda) (nova): security definer, mesmas conferências de
--       empresa e permissão; trava a venda e os pacotes; recusa venda que não é de pacote, pacote com
--       sessão usada ou cobrado numa comanda; desliga os atendimentos e apaga pacotes, pagamentos,
--       itens e a venda, conferindo as linhas. Os pacotes saem ANTES da venda (a guarda definer de
--       vendas, trg_guarda_venda_de_pacote, recusa apagar venda que ainda tem pacote).
--
-- B1) Vínculo com a comanda não sai pela API: trigger before update of comanda_id em agendamentos.
--     Pela API (current_user authenticated/anon), um comanda_id já gravado não muda nem volta a nulo
--     ("Já fechado na comanda. Para mudar, edite a comanda."). fechar_comanda/editar_comanda só gravam
--     comanda_id em linha sem vínculo ou com o mesmo id, então passam. SQL Editor/suporte (postgres) e
--     funções security definer (current_user = dona da função) também passam.
--
-- CONFERÊNCIAS (só leitura, depois de rodar):
--   select count(*) from public.taxas_reserva t join public.agendamentos a on a.id = t.agendamento_id
--    where t.status = 'retida' and a.status in ('agendado', 'confirmado');                         -- 0
--   select proname, prosecdef, proconfig from pg_proc where proname in
--    ('reter_taxa_reserva', 'fn_registrar_uso_pacote', 'excluir_pacote_cliente', 'excluir_venda_pacotes',
--     'fn_trava_vinculo_comanda');  -- definer = true, exceto fn_trava_vinculo_comanda; search_path=public em todas
--   select tgname from pg_trigger where tgrelid = 'public.agendamentos'::regclass
--    and tgname in ('trg_reter_taxa_reserva', 'trg_uso_pacote', 'trg_trava_vinculo_comanda');       -- 3 linhas
--
-- ROLLBACK:
--   drop trigger if exists trg_trava_vinculo_comanda on public.agendamentos;
--   drop function if exists public.fn_trava_vinculo_comanda();
--   drop function if exists public.excluir_venda_pacotes(uuid, uuid);
--   excluir_pacote_cliente: rodar de novo a seção 3 da 096.
--   fn_registrar_uso_pacote: rodar de novo a 078 e `alter function public.fn_registrar_uso_pacote() set search_path = public;`
--   reter_taxa_reserva: rodar de novo a seção 2 da 061.
--   (o backfill da A1 não é desfeito: as linhas voltaram ao estado de antes do cancelamento.)
--   notify pgrst, 'reload schema';
-- ============================================================

-- ── 0. Pré-requisito: 096 ─────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'pacote_clientes' and column_name = 'venda_id')
     or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'pacote_clientes' and column_name = 'comanda_id')
     or to_regprocedure('public.excluir_pacote_cliente(uuid, uuid)') is null then
    raise exception 'Rode a 096 antes da 100.';
  end if;
end $$;

-- ── A1. Taxa de reserva retida volta ao reabrir ───────────────
create or replace function public.reter_taxa_reserva()
returns trigger as $$
begin
  if old.status = new.status then
    return new;
  end if;

  -- 100: o atendimento saiu de cancelado/faltou (foi reaberto). A taxa que este trigger reteve volta ao
  -- que era: 'pago' se tinha sido paga (paga_em), senão 'pendente'. Sem return: se o novo status é
  -- 'concluido', o ramo abaixo cancela a pendente reaberta, como em qualquer conclusão.
  if old.status in ('cancelado', 'faltou') and new.status not in ('cancelado', 'faltou') then
    update public.taxas_reserva
      set status = case when paga_em is not null then 'pago' else 'pendente' end
      where agendamento_id = new.id and status = 'retida';
  end if;

  -- Atendimento aconteceu. A taxa que continuou 'pendente' nunca foi
  -- cobrada a parte, e a comanda ja cobrou o valor cheio — encerra a linha
  -- sem virar receita (ver cabecalho da 061). Linhas 'pago' e 'retida' nao sao
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

drop trigger if exists trg_reter_taxa_reserva on public.agendamentos;
create trigger trg_reter_taxa_reserva
  after update on public.agendamentos
  for each row
  execute function public.reter_taxa_reserva();

-- Backfill: atendimentos já reabertos (hoje agendado/confirmado) com taxa presa em 'retida'.
update public.taxas_reserva t
   set status = case when t.paga_em is not null then 'pago' else 'pendente' end
  from public.agendamentos a
 where a.id = t.agendamento_id
   and t.status = 'retida'
   and a.status in ('agendado', 'confirmado');

-- ── A5. Validade da sessão pelo dia do atendimento ────────────
-- Corpo exato da 078; única troca: CURRENT_DATE → dia do atendimento em Brasília.
create or replace function public.fn_registrar_uso_pacote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pc_id      uuid;
  v_empresa_id uuid;
BEGIN
  IF NEW.status <> 'concluido' OR OLD.status = 'concluido' THEN
    RETURN NEW;
  END IF;

  IF NEW.pacote_cliente_id IS NOT NULL THEN
    -- Vínculo explícito escolhido no agendamento ou na comanda
    SELECT pc.id, pc.empresa_id
      INTO v_pc_id, v_empresa_id
    FROM public.pacote_clientes pc
    JOIN public.pacotes p ON p.id = pc.pacote_id
    WHERE pc.id = NEW.pacote_cliente_id
      AND pc.empresa_id = NEW.empresa_id
      AND p.controla_sessoes = true;
  ELSIF NEW.comanda_id IS NULL THEN
    -- Busca automática por serviço — só quando o atendimento NÃO passou
    -- pela Comanda (ela é quem decide, quando passa por lá).
    SELECT pc.id, pc.empresa_id
      INTO v_pc_id, v_empresa_id
    FROM public.pacote_clientes pc
    JOIN public.pacotes p
      ON p.id = pc.pacote_id
     AND p.controla_sessoes = true
    JOIN public.pacote_servicos ps
      ON ps.pacote_id = pc.pacote_id
     AND ps.servico_id = NEW.servico_id
    WHERE pc.cliente_id    = NEW.cliente_id
      AND pc.empresa_id    = NEW.empresa_id
      AND pc.status        = 'ativo'
      AND (pc.data_validade IS NULL OR pc.data_validade >= (NEW.data_hora_inicio at time zone 'America/Sao_Paulo')::date)
      AND (
        ps.quantidade IS NULL  -- sessões ilimitadas para este serviço
        OR (
          SELECT COUNT(*) FROM public.pacote_uso pu WHERE pu.pacote_cliente_id = pc.id
        ) < (
          SELECT COALESCE(SUM(ps2.quantidade), 0)
            FROM public.pacote_servicos ps2
           WHERE ps2.pacote_id = pc.pacote_id AND ps2.quantidade IS NOT NULL
        )
      )
    ORDER BY pc.data_validade ASC NULLS LAST
    LIMIT 1;
  END IF;
  -- ELSE (pacote_cliente_id nulo E comanda_id preenchido): a Comanda
  -- decidiu não usar pacote neste atendimento — v_pc_id fica NULL, nenhuma
  -- sessão é consumida.

  IF v_pc_id IS NOT NULL THEN
    INSERT INTO public.pacote_uso
      (empresa_id, pacote_cliente_id, servico_id, agendamento_id)
    VALUES
      (v_empresa_id, v_pc_id, NEW.servico_id, NEW.id)
    ON CONFLICT (agendamento_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ── A2. excluir_pacote_cliente (corpo da 096 + recusa de venda com vários) ──
create or replace function public.excluir_pacote_cliente(p_empresa uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venda   uuid;
  v_comanda uuid;
  v_n       int;
  v_rows    int;
begin
  if auth.uid() is null or p_empresa is null or not (p_empresa in (select minha_empresas())) then
    raise exception 'Você não faz parte desta empresa.' using errcode = '42501';
  end if;
  if not (tem_permissao(p_empresa, 'pacotes.vender') or is_gestor_ou_owner(p_empresa)) then
    raise exception 'Você não tem permissão para excluir pacote vendido.' using errcode = '42501';
  end if;

  select pc.venda_id, pc.comanda_id into v_venda, v_comanda
    from public.pacote_clientes pc
   where pc.id = p_id and pc.empresa_id = p_empresa
   for update;
  if not found then
    raise exception 'Pacote vendido não encontrado.';
  end if;
  -- Cobrado numa comanda (novo ou "a cobrar"): a comanda mantém o item e os pagamentos, e a edição da
  -- comanda não tira pacotes (090/093). Apagar daqui deixaria o faturamento diferente da comanda.
  if v_comanda is not null then
    raise exception 'Este pacote foi cobrado numa comanda e não pode ser excluído aqui. Para cancelar, fale com a dona.';
  end if;
  if exists (select 1 from public.pacote_uso pu where pu.pacote_cliente_id = p_id) then
    raise exception 'Este pacote já tem sessões usadas. Para cancelar, fale com a dona.';
  end if;

  -- 100: venda com vários pacotes só sai inteira (excluir_venda_pacotes). Tirar uma unidade deixava
  -- os pagamentos da venda inteira e o faturamento diferente do caixa.
  if v_venda is not null then
    select count(*) into v_n from public.pacote_clientes pc where pc.venda_id = v_venda;
    if v_n > 1 then
      raise exception 'Esta venda tem % pacotes. Para tirar só um, exclua a venda inteira e venda de novo os que ficam.', v_n;
    end if;
  end if;

  -- Atendimentos ligados ao pacote voltam a ser atendimentos comuns (a FK não tem cascata).
  update public.agendamentos set pacote_cliente_id = null
   where pacote_cliente_id = p_id and empresa_id = p_empresa;

  delete from public.pacote_clientes where id = p_id and empresa_id = p_empresa;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Não foi possível excluir o pacote vendido.';
  end if;

  -- Venda ligada ("agora", a de comanda foi recusada acima) e só deste pacote: sai inteira, com os
  -- pagamentos e os itens.
  if v_venda is not null then
    delete from public.pagamentos where venda_id = v_venda and empresa_id = p_empresa;
    delete from public.venda_itens where venda_id = v_venda and empresa_id = p_empresa;
    delete from public.vendas where id = v_venda and empresa_id = p_empresa;
  end if;
end;
$$;

revoke all on function public.excluir_pacote_cliente(uuid, uuid) from public, anon;
grant execute on function public.excluir_pacote_cliente(uuid, uuid) to authenticated;

-- ── A2. excluir_venda_pacotes (nova) ──────────────────────────
create or replace function public.excluir_venda_pacotes(p_empresa uuid, p_venda uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids   uuid[];
  v_n     int;
  v_pags  int;
  v_itens int;
  v_rows  int;
begin
  if auth.uid() is null or p_empresa is null or not (p_empresa in (select minha_empresas())) then
    raise exception 'Você não faz parte desta empresa.' using errcode = '42501';
  end if;
  if not (tem_permissao(p_empresa, 'pacotes.vender') or is_gestor_ou_owner(p_empresa)) then
    raise exception 'Você não tem permissão para excluir pacote vendido.' using errcode = '42501';
  end if;

  perform 1 from public.vendas v where v.id = p_venda and v.empresa_id = p_empresa for update;
  if not found then
    raise exception 'Venda não encontrada.';
  end if;

  -- Trava os pacotes da venda (nada é vendido, usado ou cobrado em paralelo).
  perform 1 from public.pacote_clientes pc
   where pc.venda_id = p_venda and pc.empresa_id = p_empresa
   order by pc.id
   for update;
  select coalesce(array_agg(pc.id order by pc.id), '{}') into v_ids
    from public.pacote_clientes pc
   where pc.venda_id = p_venda and pc.empresa_id = p_empresa;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then
    raise exception 'Esta venda não é de pacote.';
  end if;
  if exists (select 1 from public.pacote_clientes pc
              where pc.venda_id = p_venda and pc.empresa_id <> p_empresa) then
    raise exception 'Venda não encontrada.';
  end if;
  if exists (select 1 from public.pacote_uso pu where pu.pacote_cliente_id = any(v_ids)) then
    raise exception 'Um dos pacotes desta venda já tem sessões usadas. Para cancelar, fale com a dona.';
  end if;
  if exists (select 1 from public.pacote_clientes pc where pc.id = any(v_ids) and pc.comanda_id is not null) then
    raise exception 'Um dos pacotes desta venda foi cobrado numa comanda e não pode ser excluído aqui. Para cancelar, fale com a dona.';
  end if;

  -- Liga a chave das guardas da 096 (local à transação). Como definer, current_user já é a dona da
  -- função e a guarda de pacote_clientes passaria; a chave deixa explícito e vale se o dono mudar.
  perform set_config('app.pacote_rpc', 'on', true);

  -- Atendimentos ligados aos pacotes voltam a ser atendimentos comuns (a FK não tem cascata).
  update public.agendamentos set pacote_cliente_id = null
   where pacote_cliente_id = any(v_ids) and empresa_id = p_empresa;

  -- Pacotes antes da venda: trg_guarda_venda_de_pacote recusa apagar venda que ainda tem pacote.
  delete from public.pacote_clientes where id = any(v_ids) and empresa_id = p_empresa;
  get diagnostics v_rows = row_count;
  if v_rows <> v_n then
    raise exception 'Não foi possível excluir os pacotes da venda.';
  end if;

  select count(*) into v_pags from public.pagamentos where venda_id = p_venda and empresa_id = p_empresa;
  delete from public.pagamentos where venda_id = p_venda and empresa_id = p_empresa;
  get diagnostics v_rows = row_count;
  if v_rows <> v_pags then
    raise exception 'Não foi possível excluir os pagamentos da venda.';
  end if;

  select count(*) into v_itens from public.venda_itens where venda_id = p_venda and empresa_id = p_empresa;
  delete from public.venda_itens where venda_id = p_venda and empresa_id = p_empresa;
  get diagnostics v_rows = row_count;
  if v_rows <> v_itens then
    raise exception 'Não foi possível excluir os itens da venda.';
  end if;

  delete from public.vendas where id = p_venda and empresa_id = p_empresa;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Não foi possível excluir a venda.';
  end if;
end;
$$;

revoke all on function public.excluir_venda_pacotes(uuid, uuid) from public, anon;
grant execute on function public.excluir_venda_pacotes(uuid, uuid) to authenticated;

-- ── B1. Vínculo com a comanda não sai pela API ────────────────
-- Sem security definer: precisa enxergar o role de quem chama (authenticated/anon = API).
create or replace function public.fn_trava_vinculo_comanda()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.comanda_id is not null
     and new.comanda_id is distinct from old.comanda_id
     and current_user in ('authenticated', 'anon') then
    raise exception 'Já fechado na comanda. Para mudar, edite a comanda.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_trava_vinculo_comanda() from public, anon, authenticated;

drop trigger if exists trg_trava_vinculo_comanda on public.agendamentos;
create trigger trg_trava_vinculo_comanda
  before update of comanda_id on public.agendamentos
  for each row execute function public.fn_trava_vinculo_comanda();

notify pgrst, 'reload schema';
