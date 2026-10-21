-- ============================================================
-- MIGRATION 094 — Agenda: trava de Concluído com comanda, avaliação com o profissional certo e
-- preferência de abertura da agenda
-- Spec: docs/superpowers/specs/2026-10-19-paridade-agenda-design.md (seção "Migration 094")
-- Plano: docs/superpowers/plans/2026-10-19-paridade-agenda.md (Task 2)
--
-- EXECUTE NO SUPABASE SQL EDITOR (migrations manuais; NÃO usar `supabase db push`).
-- Idempotente: `create or replace function`, `drop trigger/policy if exists` + `create` com o MESMO
-- nome e `add column if not exists`. Requer 030 (avaliacoes), 083 (tem_permissao) e 092/093 (banco
-- de produção hoje). Ordem de deploy livre: as telas detectam a coluna (42703/PGRST204) e a função
-- (PGRST202) e, sem a 094, continuam abrindo a agenda na própria pessoa (shared/agenda-consultas.ts).
--
-- POR QUE CADA PARTE
--
-- 1) Trava de Concluído. Um atendimento fechado numa comanda (comanda_id preenchido) que voltava
--    para agendado/cancelado/faltou deixava comanda, pagamentos, comissão e baixa de estoque
--    gravados para um atendimento "não feito" (e a taxa de cancelamento podia nascer em cima de um
--    atendimento já pago). O trigger BEFORE UPDATE OF status recusa
--    `old.status = 'concluido' and old.comanda_id is not null and new.status <> 'concluido'` com
--    "Já fechado na comanda. Para mudar, edite a comanda." (P0001, que mensagemErroBanco mostra).
--    Concluído SEM comanda (atalho "Marcar como concluído" do app) continua podendo voltar.
--    CONFERÊNCIA (2026-10-19) — nenhum caminho legítimo tira de Concluído um atendimento com comanda:
--    - fechar_comanda (093, corpo atual): o único UPDATE em agendamentos grava `status = 'concluido'`
--      junto com comanda_id (entrada em Concluído, nunca saída).
--    - editar_comanda (093, corpo atual): o único UPDATE em agendamentos muda só `valor` e
--      `desconto_rateado` (travado por teste em web/tests/unit/agenda-094.test.ts). Nenhuma função
--      zera comanda_id.
--    - "Desfazer" do vínculo de pacote (shared/pacotes-consultas.ts#desfazerVinculoPacote) e o
--      "desvincular" da tela Pacotes (web e app) mudam só pacote_cliente_id; o trigger é
--      `of status`, nem dispara.
--    - Excluir atendimento é DELETE (o trigger é de UPDATE) e já é bloqueado para Concluído na tela
--      (shared/agendamentos.ts#podeExcluirAgendamento) desde a 066.
--    - Os triggers de taxa (048–061, 091) mudam o status das TAXAS, nunca o do atendimento.
--    - Telas de status (web agenda, app agendamento/[id] da empresa e da profissional) são exatamente
--      o que a trava passa a recusar quando o atendimento já tem comanda.
--
-- 1b) Tirar de Concluído SEM comanda desfaz a comissão e a sessão de pacote (revisão das tasks 9/10,
--    item I1). Ao concluir sem comanda o banco grava duas coisas, e nada as desfazia na volta:
--    - trg_gerar_comissao (065, corpo atual gerar_comissao da 090): insere a comissão quando
--      `old.status <> 'concluido'`. NÃO há índice único nem conferência de existência em
--      comissoes.agendamento_id (o único índice único é por comanda_item_id, 085) — concluir, voltar
--      e concluir de novo gerava uma SEGUNDA comissão.
--    - trg_uso_pacote (fn_registrar_uso_pacote, corpo atual na 078): insere em pacote_uso. Aqui a
--      duplicata já era evitada (UNIQUE pacote_uso_agendamento_unico da 011 + ON CONFLICT DO
--      NOTHING), mas a sessão ficava consumida com o atendimento cancelado/faltou/agendado.
--      pacote_uso liga ao atendimento por agendamento_id; o saldo do pacote é a CONTAGEM de
--      pacote_uso por pacote_cliente_id (078 e telas) — não existe coluna de saldo para ajustar.
--      pacote_clientes.status ('concluido') só muda à mão na tela Pacotes, não é tocado aqui.
--    - 075 (sincronizar_comissao_valor) só age em Concluído → Concluído; 085 é comissão de item de
--      comanda (agendamento_id nulo) — nenhum dos dois entra neste caminho.
--    O trigger AFTER UPDATE OF status trg_desfaz_conclusao_sem_comanda, para
--    `old.status = 'concluido' and old.comanda_id is null and new.status <> 'concluido'`:
--    - recusa com P0001 "A comissão deste atendimento já foi paga. Não é possível tirar de
--      Concluído." se houver comissão paga do atendimento (vale para a dona também);
--    - senão apaga as comissões PENDENTES do atendimento e as linhas de pacote_uso dele (a sessão
--      volta ao pacote). Concluir de novo gera 1 comissão e consome 1 sessão, como na 1ª vez.
--    security definer + search_path fixo: a profissional não tem DELETE em comissoes (nenhuma
--    policy) e o DELETE de pacote_uso (093) exige permissão que ela pode não ter.
--    Caminho da comanda intocado: com comanda_id a trava acima recusa antes (BEFORE), e a condição
--    `old.comanda_id is null` não casa de qualquer forma.
--
-- 2) Avaliação. avaliacoes.profissional_id é FK para empresa_membros(id) (030), mas o web gravava
--    agendamentos.profissional_id (users.id) — a FK recusava e as notas nunca foram salvas (0 linhas
--    em produção). O trigger BEFORE INSERT OR UPDATE (security definer, search_path fixo: lê o
--    atendimento e o vínculo sem depender da RLS de quem avalia) ignora o valor da tela e preenche
--    profissional_id com o empresa_membros.id da profissional do atendimento (por empresa_id e
--    user_id = agendamentos.profissional_id; null se ela não tem vínculo). Confere também que
--    empresa_id e cliente_id batem com os do atendimento.
--    A policy ampla "empresa_all_avaliacoes" (030: qualquer membro gravava/apagava qualquer
--    avaliação da empresa) sai. Entram:
--    - SELECT: membro ativo (minha_empresas) — Relatórios e perfil da cliente leem;
--    - INSERT e UPDATE: quem pode mexer no atendimento — o próprio atendimento, ou
--      agenda.gerenciar_outras, ou gestora/dona (is_gestor_ou_owner). Mesmo critério da policy de
--      UPDATE de agendamentos (083) e de agendamento_servicos (089);
--    - DELETE: só gestora/dona.
--
-- 3) Preferência de abertura da agenda: empresa_membros.agenda_abre_em ('propria' | 'todas',
--    default 'propria'). Gravada só pela função salvar_preferencia_agenda (security definer,
--    search_path fixo, sem RETURNING, linha conferida com GET DIAGNOSTICS): altera só a linha da
--    própria pessoa (user_id = auth.uid(), vínculo ativo, na empresa pedida) e só aceita 'todas'
--    com tem_permissao(p_empresa, 'agenda.ver_equipe').
--    Por que função e não UPDATE direto: a policy de UPDATE de empresa_membros (083) exige
--    equipe.gerenciar, que a profissional não tem.
--    CONFERÊNCIA (2026-10-19) — os triggers de empresa_membros deixam a coluna nova passar:
--    - trg_bloquear_alteracao_role (043, BEFORE UPDATE): só recusa troca de user_id/empresa_id
--      (reatribuir) ou de role. A função não muda nenhuma das três.
--    - trg_membros_papel_so_dona (083, BEFORE UPDATE OF role): nem dispara.
--    - trg_recalcular_comissoes_pendentes (025, AFTER UPDATE OF percentual_comissao): nem dispara.
--    - trg_equipe_historico_membro (092, AFTER UPDATE): só registra mudança de ativo, role,
--      percentual_comissao e tipo_contrato; a preferência não gera histórico.
--    A função é security definer, então a RLS de UPDATE (equipe.gerenciar) não se aplica a ela.
--
-- Rollback:
--   drop trigger if exists trg_trava_concluido_com_comanda on public.agendamentos;
--   drop function if exists public.fn_trava_concluido_com_comanda();
--   drop trigger if exists trg_desfaz_conclusao_sem_comanda on public.agendamentos;
--   drop function if exists public.fn_desfaz_conclusao_sem_comanda();
--     (comissões e sessões já apagadas por ele não voltam: o atendimento estava fora de Concluído;
--      concluir de novo as recria pelos triggers da 065/078)
--   drop trigger if exists trg_avaliacao_profissional on public.avaliacoes;
--   drop function if exists public.fn_avaliacao_profissional();
--   drop policy if exists "avaliacoes: membro ve" on public.avaliacoes;
--   drop policy if exists "avaliacoes: quem atende grava" on public.avaliacoes;
--   drop policy if exists "avaliacoes: quem atende altera" on public.avaliacoes;
--   drop policy if exists "avaliacoes: gestor apaga" on public.avaliacoes;
--   create policy "empresa_all_avaliacoes" on public.avaliacoes (corpo da 030);
--   drop function if exists public.salvar_preferencia_agenda(uuid, text);
--   alter table public.empresa_membros drop column if exists agenda_abre_em;
--   notify pgrst, 'reload schema';
-- ============================================================

-- ── 1. Trava de Concluído com comanda ────────────────────────
create or replace function public.fn_trava_concluido_com_comanda()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'concluido' and old.comanda_id is not null and new.status <> 'concluido' then
    raise exception 'Já fechado na comanda. Para mudar, edite a comanda.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trava_concluido_com_comanda on public.agendamentos;
create trigger trg_trava_concluido_com_comanda
  before update of status on public.agendamentos
  for each row execute function public.fn_trava_concluido_com_comanda();

-- ── 1b. Tirar de Concluído sem comanda desfaz comissão e sessão ─
-- security definer: a profissional não tem policy de DELETE em comissoes nem em pacote_uso.
create or replace function public.fn_desfaz_conclusao_sem_comanda()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'concluido' and old.comanda_id is null and new.status <> 'concluido' then
    if exists (select 1 from public.comissoes c
                where c.agendamento_id = old.id and c.status = 'pago') then
      raise exception 'A comissão deste atendimento já foi paga. Não é possível tirar de Concluído.'
        using errcode = 'P0001';
    end if;

    delete from public.comissoes
     where agendamento_id = old.id and status = 'pendente';

    -- O saldo do pacote é a contagem de pacote_uso: apagar a linha devolve a sessão.
    delete from public.pacote_uso
     where agendamento_id = old.id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_desfaz_conclusao_sem_comanda on public.agendamentos;
create trigger trg_desfaz_conclusao_sem_comanda
  after update of status on public.agendamentos
  for each row execute function public.fn_desfaz_conclusao_sem_comanda();

-- ── 2. Avaliação com o profissional do atendimento ───────────
create or replace function public.fn_avaliacao_profissional()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_cliente uuid;
  v_prof    uuid;
  v_achou   boolean;
begin
  if new.agendamento_id is null then
    raise exception 'A avaliação precisa de um atendimento.' using errcode = 'P0001';
  end if;

  select a.empresa_id, a.cliente_id, a.profissional_id, true
    into v_empresa, v_cliente, v_prof, v_achou
    from public.agendamentos a
   where a.id = new.agendamento_id;

  if v_achou is null or v_empresa is distinct from new.empresa_id then
    raise exception 'Atendimento não encontrado nesta empresa.' using errcode = 'P0001';
  end if;
  if new.cliente_id is distinct from v_cliente then
    raise exception 'A cliente não confere com a do atendimento.' using errcode = 'P0001';
  end if;

  -- O valor vindo da tela é ignorado: sempre o vínculo (empresa_membros.id) da profissional do atendimento.
  new.profissional_id := (select m.id from public.empresa_membros m
                           where m.empresa_id = v_empresa and m.user_id = v_prof
                           limit 1);
  return new;
end;
$$;

drop trigger if exists trg_avaliacao_profissional on public.avaliacoes;
create trigger trg_avaliacao_profissional
  before insert or update on public.avaliacoes
  for each row execute function public.fn_avaliacao_profissional();

drop policy if exists "empresa_all_avaliacoes" on public.avaliacoes;

drop policy if exists "avaliacoes: membro ve" on public.avaliacoes;
create policy "avaliacoes: membro ve" on public.avaliacoes for select
  using (empresa_id in (select minha_empresas()));

drop policy if exists "avaliacoes: quem atende grava" on public.avaliacoes;
create policy "avaliacoes: quem atende grava" on public.avaliacoes for insert
  with check (
    empresa_id in (select minha_empresas())
    and (is_gestor_ou_owner(empresa_id)
         or tem_permissao(empresa_id, 'agenda.gerenciar_outras')
         or exists (select 1 from public.agendamentos a
                     where a.id = avaliacoes.agendamento_id and a.profissional_id = auth.uid()))
  );

drop policy if exists "avaliacoes: quem atende altera" on public.avaliacoes;
create policy "avaliacoes: quem atende altera" on public.avaliacoes for update
  using (
    empresa_id in (select minha_empresas())
    and (is_gestor_ou_owner(empresa_id)
         or tem_permissao(empresa_id, 'agenda.gerenciar_outras')
         or exists (select 1 from public.agendamentos a
                     where a.id = avaliacoes.agendamento_id and a.profissional_id = auth.uid()))
  )
  with check (
    empresa_id in (select minha_empresas())
    and (is_gestor_ou_owner(empresa_id)
         or tem_permissao(empresa_id, 'agenda.gerenciar_outras')
         or exists (select 1 from public.agendamentos a
                     where a.id = avaliacoes.agendamento_id and a.profissional_id = auth.uid()))
  );

drop policy if exists "avaliacoes: gestor apaga" on public.avaliacoes;
create policy "avaliacoes: gestor apaga" on public.avaliacoes for delete
  using (is_gestor_ou_owner(empresa_id));

-- ── 3. Preferência de abertura da agenda ─────────────────────
alter table public.empresa_membros
  add column if not exists agenda_abre_em text not null default 'propria'
    check (agenda_abre_em in ('propria', 'todas'));

create or replace function public.salvar_preferencia_agenda(p_empresa uuid, p_valor text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linhas int;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre de novo.' using errcode = '42501';
  end if;
  if p_valor is null or p_valor not in ('propria', 'todas') then
    raise exception 'Preferência de agenda inválida.' using errcode = '22023';
  end if;
  if p_valor = 'todas' and not public.tem_permissao(p_empresa, 'agenda.ver_equipe') then
    raise exception 'Você não tem permissão para ver a agenda da equipe.' using errcode = '42501';
  end if;

  update public.empresa_membros
     set agenda_abre_em = p_valor
   where empresa_id = p_empresa and user_id = auth.uid() and ativo = true;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'Seu vínculo com esta empresa não foi encontrado.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.salvar_preferencia_agenda(uuid, text) from public, anon;
grant execute on function public.salvar_preferencia_agenda(uuid, text) to authenticated;

notify pgrst, 'reload schema';
