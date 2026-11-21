-- ============================================================
-- MIGRATION 102 — Push do bloqueio de agenda e recibos da Expo (C14, B14)
-- Spec:  docs/superpowers/specs/2026-11-20-push-graficos-design.md (seções C14 e B14)
-- Plano: docs/superpowers/plans/2026-11-20-push-graficos.md (Task 1)
-- Deploy: docs/superpowers/notes/2026-11-20-deploy-102.md
--
-- EXECUTE NO SUPABASE SQL EDITOR (migrations manuais; NÃO usar `supabase db push`).
-- Idempotente: `add column if not exists`, `create index if not exists`, `create table if not exists`,
-- `drop policy`/revoke repetíveis. O backfill só roda na PRIMEIRA execução (quando a coluna ainda não
-- existe): rodar de novo nunca marca como "enviada" uma notificação nova que ainda espera o push.
-- Requer a 101 (a seção 0 recusa rodar sem ela) e a 097 (trigger de `notificacoes`).
-- Ordem em relação ao deploy: livre. Sem a 102 o cron pula o push de bloqueio e a leitura de
-- recibos em silêncio (coluna/tabela inexistente) e o envio dos lembretes segue como antes.
--
-- POR QUE CADA PARTE
--
-- 1) notificacoes.push_enviado_em — o cron de 5 em 5 minutos envia o push dos avisos de bloqueio
--    (`bloqueio_pendente`, `bloqueio_aprovado`, `bloqueio_recusado`, gravados pelo trigger da 069) e
--    marca esta coluna ANTES de enviar, só se ainda estiver nula: o aviso nunca repete.
--    Backfill com now() em toda linha que já existe, para o cron não disparar avisos antigos.
--    Índice parcial (created_at) where push_enviado_em is null: a consulta do cron só olha as pendentes.
--
-- 2) Trigger da 097 (trg_notificacoes_so_lida) — CONFERIDO, NÃO MUDA. Ele só barra quem chama como
--    `authenticated`/`anon` (current_user). O cron usa service role (outro role) e funções
--    security definer rodam como o dono: nenhum dos dois é barrado, então gravar push_enviado_em
--    funciona sem mexer no trigger. Pela API a pessoa continua podendo mudar SÓ `lida`: como o
--    trigger compara `to_jsonb(row) - 'lida'`, mudar push_enviado_em (ou qualquer outra coluna)
--    continua recusado com 42501. Coberto em web/tests/unit/push-102-pglite.test.ts.
--
-- 3) push_recibos (ticket_id, token, criado_em) — a Expo devolve `DeviceNotRegistered` também mais
--    tarde, no RECIBO. O envio grava o par (ticket, token) de cada ticket ok; o cron lê os recibos
--    com mais de 15 min, apaga o aparelho em `DeviceNotRegistered` e limpa a tabela (lidos e com
--    mais de 24 h). RLS ligada e NENHUMA policy: só o service role (que ignora RLS) acessa; os
--    privilégios de anon/authenticated são revogados por garantia. O token é um dado sensível do
--    aparelho: nunca vai para log.
--
-- CONFERÊNCIAS (somente leitura, depois de rodar):
--   select column_name from information_schema.columns
--    where table_name = 'notificacoes' and column_name = 'push_enviado_em';        -- 1 linha
--   select count(*) from public.notificacoes where push_enviado_em is null;      -- 0 logo após a primeira execução
--   select indexname from pg_indexes where indexname = 'idx_notificacoes_push_pendente';  -- 1 linha
--   select relrowsecurity from pg_class where relname = 'push_recibos';           -- true
--   select count(*) from pg_policies where tablename = 'push_recibos';            -- 0
--   select tgname from pg_trigger where tgname = 'trg_notificacoes_so_lida';      -- 1 linha (da 097, intacto)
--
-- ROLLBACK:
--   drop table if exists public.push_recibos;
--   drop index if exists public.idx_notificacoes_push_pendente;
--   alter table public.notificacoes drop column if exists push_enviado_em;
--   notify pgrst, 'reload schema';
-- ============================================================

-- ── 0. Pré-requisito: 101 ─────────────────────────────────────
do $$
begin
  if to_regprocedure('public.fn_cartao_mesma_empresa()') is null then
    raise exception 'Rode a 101 antes da 102.';
  end if;
  if to_regprocedure('public.fn_notificacoes_so_lida()') is null then
    raise exception 'Rode a 097 antes da 102.';
  end if;
end $$;

-- ── 1. notificacoes.push_enviado_em (+ backfill só na primeira vez) ──
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'notificacoes' and column_name = 'push_enviado_em'
  ) then
    alter table public.notificacoes add column push_enviado_em timestamptz;
    -- Avisos que já existem não disparam push: só os criados daqui em diante.
    update public.notificacoes set push_enviado_em = now();
  end if;
end $$;

create index if not exists idx_notificacoes_push_pendente
  on public.notificacoes (created_at) where push_enviado_em is null;

-- ── 2. push_recibos ───────────────────────────────────────────
create table if not exists public.push_recibos (
  ticket_id text primary key,
  token     text not null,
  criado_em timestamptz not null default now()
);

create index if not exists idx_push_recibos_criado_em on public.push_recibos (criado_em);

alter table public.push_recibos enable row level security;
-- Nenhuma policy de propósito: só o service role (cron) acessa.
revoke all on public.push_recibos from anon, authenticated;

notify pgrst, 'reload schema';
