-- ============================================================
-- MIGRATION 097 — Dispositivos de push (app nativo) e "marcar notificação como lida"
-- Spec: docs/superpowers/specs/2026-10-28-paridade-configuracoes-notificacoes-design.md ("Push")
-- Plano: Task 2 da Paridade Configurações, Notificações e Papéis.
--
-- EXECUTE NO SUPABASE SQL EDITOR (migrations manuais; NÃO usar `supabase db push`).
-- Idempotente: `create table if not exists`, `create or replace function`, `drop policy if exists`
-- + `create policy` com o MESMO nome, `drop trigger if exists`, backfill com `on conflict do nothing`.
-- Requer só a 001 (users, empresas, empresa_membros, notificacoes, minha_empresas) e a 005
-- (users.push_token). Ordem em relação ao deploy: livre. Sem a 097 o app segue pelo caminho
-- antigo (users.push_token) e o registro em push_dispositivos responde "função não existe"
-- (PGRST202), que shared/push-dispositivos.ts trata como "sem a 097". Recomendado: rodar ANTES.
--
-- POR QUE CADA PARTE
--
-- 1) push_dispositivos — um aparelho (token Expo, ou web no futuro) por linha, ligado à pessoa E à
--    empresa ativa dela. users.push_token guardava um token só por pessoa e sem empresa: com duas
--    empresas, o lembrete de uma ia para quem estava olhando a outra. `token` é único: um aparelho
--    pertence a uma conta e a uma empresa por vez (a que está aberta no app).
--    RLS: a pessoa vê e insere só os próprios registros, e só de empresa em que tem vínculo ativo
--    (minha_empresas(): vínculo ativo em empresa_membros ou dona por empresas.owner_id). Apagar
--    exige só ser o dono do registro: quem perdeu o vínculo ainda precisa conseguir tirar o próprio
--    aparelho ao sair (apagar o próprio token nunca expõe nada). Sem policy de UPDATE: trocar de
--    empresa passa pela função abaixo. Os crons leem com service_role (fora da RLS) e só mandam
--    para os dispositivos da empresa do aviso.
--
-- 2) registrar_push_dispositivo(p_empresa, p_plataforma, p_token) — security definer porque o mesmo
--    aparelho pode ter sido registrado antes por OUTRA conta (troca de login no mesmo celular): com
--    a RLS, quem chama não enxerga essa linha e o insert bateria no unique. A função confere a sessão,
--    o vínculo ativo com a empresa, a plataforma e o token, e grava com `on conflict (token) do update`
--    (passa o aparelho para quem acabou de ativar, na empresa ativa, e renova visto_em). Sem RETURNING
--    (padrão das funções do projeto). Risco aceito: quem souber o token de outro aparelho poderia
--    "puxá-lo" para si — os tokens não são legíveis por ninguém além do dono (RLS de SELECT) e da Expo.
--
-- 3) Backfill — cada users.push_token preenchido vira um dispositivo 'expo' na empresa MAIS ANTIGA da
--    pessoa (vínculo ativo mais antigo por empresa_membros.created_at, ou empresa de que é dona por
--    empresas.created_at). Quem não tem vínculo ativo fica de fora. Token repetido entre contas: fica
--    a primeira conta por id (não há como saber qual login está no aparelho hoje; o próximo "Ativar"
--    corrige). users.push_token NÃO é apagado: é o caminho do app antigo e o fallback dos crons.
--    web_push_subscriptions (019) continua como está.
--
-- 4) notificacoes — a policy de UPDATE "marcar como lida" existe só em produção, criada à mão, sem
--    migration. Esta versiona uma com nome NOVO ("notificacoes: marcar propria como lida": só a
--    própria linha) e o trigger trg_notificacoes_so_lida, que recusa (42501) qualquer mudança em
--    outra coluna que não `lida` quando quem chama é a API (roles authenticated/anon). service_role
--    (crons) e funções security definer (triggers 028/069) não são afetados. A comparação usa
--    `to_jsonb(row) - 'lida'`, então cobre também colunas que só existam em produção.
--    A policy manual de produção NÃO é derrubada (o nome dela não está versionado). Conferir depois
--    de rodar e derrubar a antiga com o nome exato se ela for mais ampla que esta:
--      select policyname, cmd, qual, with_check from pg_policies where tablename = 'notificacoes';
--
-- CONFERÊNCIAS (somente leitura, depois de rodar)
--   select count(*) from public.push_dispositivos;                                   -- ≈ users com push_token e vínculo
--   select count(*) from public.users where nullif(btrim(push_token), '') is not null;
--   select policyname, cmd from pg_policies where tablename in ('push_dispositivos', 'notificacoes');
--   select proname, prosecdef from pg_proc where proname in ('registrar_push_dispositivo', 'fn_notificacoes_so_lida');
--     -- registrar_push_dispositivo = true; fn_notificacoes_so_lida = false
--
-- ROLLBACK
--   drop trigger if exists trg_notificacoes_so_lida on public.notificacoes;
--   drop function if exists public.fn_notificacoes_so_lida();
--   drop policy if exists "notificacoes: marcar propria como lida" on public.notificacoes;
--   drop function if exists public.registrar_push_dispositivo(uuid, text, text);
--   drop table if exists public.push_dispositivos;
--   notify pgrst, 'reload schema';
-- ============================================================

-- ── 1) Tabela ────────────────────────────────────────────────

create table if not exists public.push_dispositivos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  plataforma  text not null check (plataforma in ('expo', 'web')),
  token       text not null unique,
  criado_em   timestamptz not null default now(),
  visto_em    timestamptz not null default now()
);

-- Os crons buscam os dispositivos dos destinatários de uma empresa.
create index if not exists idx_push_dispositivos_empresa_user
  on public.push_dispositivos (empresa_id, user_id);

alter table public.push_dispositivos enable row level security;

drop policy if exists "push_dispositivos: ver proprios" on public.push_dispositivos;
create policy "push_dispositivos: ver proprios" on public.push_dispositivos
  for select using (user_id = auth.uid() and empresa_id in (select minha_empresas()));

drop policy if exists "push_dispositivos: inserir proprios" on public.push_dispositivos;
create policy "push_dispositivos: inserir proprios" on public.push_dispositivos
  for insert with check (user_id = auth.uid() and empresa_id in (select minha_empresas()));

drop policy if exists "push_dispositivos: apagar proprios" on public.push_dispositivos;
create policy "push_dispositivos: apagar proprios" on public.push_dispositivos
  for delete using (user_id = auth.uid());

-- ── 2) Registro do aparelho ──────────────────────────────────

create or replace function public.registrar_push_dispositivo(p_empresa uuid, p_plataforma text, p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_token text := btrim(coalesce(p_token, ''));
begin
  if v_uid is null then
    raise exception 'Sessão expirada: entre de novo para ativar as notificações.' using errcode = '42501';
  end if;
  if p_plataforma is null or p_plataforma not in ('expo', 'web') then
    raise exception 'Plataforma de notificação inválida.' using errcode = '22023';
  end if;
  if v_token = '' then
    raise exception 'Token de notificação vazio.' using errcode = '22023';
  end if;
  if length(v_token) > 512 then
    raise exception 'Token de notificação inválido.' using errcode = '22023';
  end if;
  if p_empresa is null or p_empresa not in (select minha_empresas()) then
    raise exception 'Você não tem vínculo ativo com esta empresa.' using errcode = '42501';
  end if;

  insert into public.push_dispositivos (user_id, empresa_id, plataforma, token)
  values (v_uid, p_empresa, p_plataforma, v_token)
  on conflict (token) do update
    set user_id    = excluded.user_id,
        empresa_id = excluded.empresa_id,
        plataforma = excluded.plataforma,
        visto_em   = now();
end;
$$;

revoke all on function public.registrar_push_dispositivo(uuid, text, text) from public, anon;
grant execute on function public.registrar_push_dispositivo(uuid, text, text) to authenticated;

-- ── 3) Backfill de users.push_token ──────────────────────────

insert into public.push_dispositivos (user_id, empresa_id, plataforma, token)
select distinct on (btrim(u.push_token))
       u.id, e.empresa_id, 'expo', btrim(u.push_token)
  from public.users u
  cross join lateral (
    select v.empresa_id
      from (
        select m.empresa_id, m.created_at
          from public.empresa_membros m
         where m.user_id = u.id and m.ativo = true
        union all
        select x.id, x.created_at
          from public.empresas x
         where x.owner_id = u.id
      ) v
     order by v.created_at asc nulls last, v.empresa_id
     limit 1
  ) e
 where nullif(btrim(u.push_token), '') is not null
   and length(btrim(u.push_token)) <= 512
 order by btrim(u.push_token), u.id
on conflict (token) do nothing;

-- ── 4) notificacoes: marcar como lida ────────────────────────

drop policy if exists "notificacoes: marcar propria como lida" on public.notificacoes;
create policy "notificacoes: marcar propria como lida" on public.notificacoes
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Sem security definer: precisa enxergar o role de quem chama (authenticated/anon = API).
create or replace function public.fn_notificacoes_so_lida()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (to_jsonb(new) - 'lida') is distinct from (to_jsonb(old) - 'lida') then
    raise exception 'Você só pode marcar a notificação como lida.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notificacoes_so_lida on public.notificacoes;
create trigger trg_notificacoes_so_lida
  before update on public.notificacoes
  for each row execute function public.fn_notificacoes_so_lida();

notify pgrst, 'reload schema';
