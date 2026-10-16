-- ============================================================
-- MIGRATION 092 — Convite com aceite + histórico da Equipe
-- Spec: docs/superpowers/specs/2026-10-15-convite-aceite-historico-design.md
-- Contrato (Tasks 2–4): docs/superpowers/notes/2026-10-16-contrato-convites.md
--
-- Decisões do dono (2026-10-15): quem JÁ TEM CONTA só entra na equipe depois de aceitar o
-- convite (B); troca do e-mail de login e demais mudanças da equipe ficam num histórico (C).
--
-- O que faz:
--  1. convites_equipe: convite pendente para conta existente. Um `pendente` por (empresa, conta).
--     RLS: SELECT para a própria convidada e para quem tem `equipe.gerenciar`. Sem INSERT/UPDATE/
--     DELETE para anon/authenticated: a criação é só pelas rotas (service role) e a mudança de
--     status só pelas funções abaixo.
--  2. equipe_historico: convite enviado/aceito/recusado/cancelado, login trocado, desativado,
--     reativado, papel/comissão/contrato trocados. Leitura direta só da dona; quem tem
--     `equipe.gerenciar` lê pela função listar_historico_equipe, que mascara e-mails para quem não
--     é a dona (a máscara vale no banco, não só na tela). Escrita só por triggers/funções
--     (security definer) e pelas rotas (service role).
--  3. aceitar_convite / recusar_convite: só a conta convidada (user_id = auth.uid() E e-mail do
--     login = e-mail do convite) e só com o convite pendente. Aceitar cria (ou reativa) o vínculo
--     em empresa_membros com papel, comissão e contrato do convite e devolve a empresa.
--  4. cancelar_convite: quem tem `equipe.gerenciar`; convite de gestora só a dona cancela.
--  5. meus_convites: convites pendentes da conta logada, com o nome da empresa (a convidada ainda
--     não é membro e não lê `empresas` pela RLS).
--  6. Triggers de histórico em convites_equipe (envio e mudança de status) e em empresa_membros
--     (ativo, papel, comissão, contrato). Alteração feita pela rota com service role grava
--     `feito_por` nulo (a tela mostra "Alguém").
--  7. Derruba a policy de INSERT "membros: gestor ou owner convida" (083) de empresa_membros: com ela,
--     quem tem `equipe.gerenciar` vinculava qualquer conta direto pela API REST (o user_id da
--     convidada aparece em convites_equipe e na resposta da rota), sem aceite e até depois de uma
--     recusa. Nenhuma tela grava em empresa_membros com o client logado: o vínculo nasce só pela rota
--     (service role: conta nova ou vínculo ativo), por aceitar_convite e por criar_empresa_completo,
--     todos sem passar pela RLS. Reatribuir um vínculo a outra conta já é barrado pelo trigger da 043.
--
-- Sem expiração: a spec não define prazo; o convite vale até ser aceito, recusado ou cancelado.
-- Idempotente: create ... if not exists, create or replace, drop ... if exists antes de recriar.
-- Nunca mudar a assinatura das funções abaixo (o PostgREST resolve pelo nome dos parâmetros).
--
-- Rollback:
--   drop trigger if exists trg_equipe_historico_membro on public.empresa_membros;
--   drop trigger if exists trg_equipe_historico_convite on public.convites_equipe;
--   drop function if exists public.fn_equipe_historico_membro();
--   drop function if exists public.fn_equipe_historico_convite();
--   drop function if exists public.listar_historico_equipe(uuid, integer, integer);
--   drop function if exists public.meus_convites();
--   drop function if exists public.cancelar_convite(uuid, uuid);
--   drop function if exists public.recusar_convite(uuid);
--   drop function if exists public.aceitar_convite(uuid);
--   drop function if exists public.mascarar_email(text);
--   drop table if exists public.equipe_historico;
--   drop table if exists public.convites_equipe;
--   -- Só se alguma tela voltar a precisar (reabre o vínculo sem aceite pela API REST):
--   create policy "membros: gestor ou owner convida" on public.empresa_membros for insert with check (
--     role = any (array['gestor'::perfil_role, 'profissional'::perfil_role])
--     and tem_permissao(empresa_id, 'equipe.gerenciar')
--     and (role = 'profissional'::perfil_role
--          or exists (select 1 from public.empresas
--                     where empresas.id = empresa_membros.empresa_id and empresas.owner_id = auth.uid())));
--   notify pgrst, 'reload schema';
--   (As rotas da Task 2 voltam a responder 503 para conta existente — nunca vinculam sem aceite.)
-- ============================================================

-- ── 1. convites_equipe ────────────────────────────────────────
create table if not exists public.convites_equipe (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references public.empresas(id) on delete cascade,
  user_id             uuid not null references public.users(id) on delete cascade,
  email               text not null,
  nome                text,
  role                text not null check (role in ('gestor', 'profissional')),
  percentual_comissao numeric(5,2) not null default 0 check (percentual_comissao between 0 and 100),
  tipo_contrato       text check (tipo_contrato in ('pj', 'clt')),
  status              text not null default 'pendente'
                        check (status in ('pendente', 'aceito', 'recusado', 'cancelado')),
  convidado_por       uuid,
  criado_em           timestamptz not null default now(),
  respondido_em       timestamptz
);
create unique index if not exists convites_equipe_um_pendente
  on public.convites_equipe (empresa_id, user_id) where status = 'pendente';
create index if not exists idx_convites_equipe_user_pendente
  on public.convites_equipe (user_id) where status = 'pendente';

alter table public.convites_equipe enable row level security;
revoke insert, update, delete, truncate on public.convites_equipe from anon, authenticated;
revoke all on public.convites_equipe from anon;
grant select on public.convites_equipe to authenticated;

drop policy if exists "convites_equipe: convidada ou equipe ve" on public.convites_equipe;
create policy "convites_equipe: convidada ou equipe ve" on public.convites_equipe for select
  using (user_id = auth.uid() or tem_permissao(empresa_id, 'equipe.gerenciar'));

-- ── 2. equipe_historico ───────────────────────────────────────
create table if not exists public.equipe_historico (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  alvo_user_id uuid,
  acao         text not null check (acao in (
                 'convite_enviado', 'convite_aceito', 'convite_recusado', 'convite_cancelado',
                 'login_trocado', 'desativado', 'reativado',
                 'papel_trocado', 'comissao_trocada', 'contrato_trocado')),
  detalhe      jsonb not null default '{}'::jsonb,
  feito_por    uuid,
  criado_em    timestamptz not null default now()
);
create index if not exists idx_equipe_historico_empresa
  on public.equipe_historico (empresa_id, criado_em desc, id desc);

alter table public.equipe_historico enable row level security;
revoke insert, update, delete, truncate on public.equipe_historico from anon, authenticated;
revoke all on public.equipe_historico from anon;
grant select on public.equipe_historico to authenticated;

-- Leitura direta só da dona (e-mails sem máscara). Quem tem equipe.gerenciar lê pela função
-- listar_historico_equipe, que mascara os e-mails.
drop policy if exists "equipe_historico: dona ve" on public.equipe_historico;
create policy "equipe_historico: dona ve" on public.equipe_historico for select
  using (eh_dona_da_empresa(empresa_id));

-- ── 2b. empresa_membros: sem INSERT pelo client logado ─────────
-- Conta existente nunca é vinculada sem aceite: o vínculo nasce só pela rota (service role), por
-- aceitar_convite e por criar_empresa_completo (security definer, sem RLS).
drop policy if exists "membros: gestor ou owner convida" on public.empresa_membros;

-- ── 3. Máscara de e-mail ──────────────────────────────────────
-- "thalia@gmail.com" → "th***@gmail.com"; "a@x.com" → "a***@x.com". Sem "@": como veio.
create or replace function public.mascarar_email(p text)
returns text language sql immutable set search_path = public as $$
  select case
    when p is null or position('@' in p) < 2 then p
    else left(split_part(p, '@', 1), case when length(split_part(p, '@', 1)) > 2 then 2 else 1 end)
         || '***@' || substr(p, position('@' in p) + 1)
  end;
$$;

-- ── 4. Aceitar / recusar (só a conta convidada) ───────────────
create or replace function public.aceitar_convite(p_convite uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v       public.convites_equipe%rowtype;
  v_email text;
  v_mem   record;
begin
  if v_uid is null then
    raise exception 'Sessão expirada. Entre de novo.';
  end if;
  select * into v from public.convites_equipe where id = p_convite for update;
  select lower(trim(email)) into v_email from auth.users where id = v_uid;
  if v.id is null or v.user_id <> v_uid
     or coalesce(v_email, '') <> lower(trim(v.email)) then
    raise exception 'Convite não encontrado.';
  end if;
  if v.status <> 'pendente' then
    raise exception 'Este convite já foi respondido ou cancelado.';
  end if;
  -- Mesma regra das rotas (podeAtribuirRole): gestora só por convite da dona.
  if v.role = 'gestor'
     and not exists (select 1 from public.empresas where id = v.empresa_id and owner_id = v.convidado_por)
     and not exists (select 1 from public.empresa_membros
                     where empresa_id = v.empresa_id and user_id = v.convidado_por
                       and ativo = true and role::text = 'owner') then
    raise exception 'Convite inválido: só a dona pode convidar uma gestora.';
  end if;

  select id, role::text as role, ativo into v_mem from public.empresa_membros
    where empresa_id = v.empresa_id and user_id = v_uid for update;

  -- O histórico registra só "convite_aceito"; o trigger de empresa_membros não duplica
  -- (reativado/comissão) dentro desta transação.
  perform set_config('bellamore.historico_silencioso', 'on', true);
  if v_mem.id is null then
    insert into public.empresa_membros (empresa_id, user_id, role, percentual_comissao, tipo_contrato, ativo)
      values (v.empresa_id, v_uid, v.role::perfil_role, v.percentual_comissao, v.tipo_contrato, true);
  elsif v_mem.ativo is true then
    -- Já entrou por outro caminho depois do convite: nada a mudar no vínculo.
    null;
  else
    -- Vínculo inativo: o papel não muda pelo aceite (só a dona muda papel; os triggers da
    -- 043/083 barrariam a própria pessoa). Papel diferente = convite desatualizado.
    if v_mem.role <> v.role then
      raise exception 'Este convite está desatualizado: o papel desta pessoa na equipe mudou. Peça um novo convite.';
    end if;
    update public.empresa_membros
      set ativo = true, percentual_comissao = v.percentual_comissao, tipo_contrato = v.tipo_contrato
      where id = v_mem.id;
  end if;
  perform set_config('bellamore.historico_silencioso', '', true);

  update public.convites_equipe set status = 'aceito', respondido_em = now() where id = v.id;
  return v.empresa_id;
end;
$$;

create or replace function public.recusar_convite(p_convite uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v       public.convites_equipe%rowtype;
  v_email text;
begin
  if v_uid is null then
    raise exception 'Sessão expirada. Entre de novo.';
  end if;
  select * into v from public.convites_equipe where id = p_convite for update;
  select lower(trim(email)) into v_email from auth.users where id = v_uid;
  if v.id is null or v.user_id <> v_uid or coalesce(v_email, '') <> lower(trim(v.email)) then
    raise exception 'Convite não encontrado.';
  end if;
  if v.status <> 'pendente' then
    raise exception 'Este convite já foi respondido ou cancelado.';
  end if;
  update public.convites_equipe set status = 'recusado', respondido_em = now() where id = v.id;
end;
$$;

-- ── 5. Cancelar (equipe.gerenciar; convite de gestora só a dona) ──
create or replace function public.cancelar_convite(p_empresa uuid, p_convite uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v public.convites_equipe%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre de novo.';
  end if;
  if not public.tem_permissao(p_empresa, 'equipe.gerenciar') then
    raise exception 'Sem permissão para gerenciar a equipe.' using errcode = '42501';
  end if;
  select * into v from public.convites_equipe where id = p_convite and empresa_id = p_empresa for update;
  if v.id is null then
    raise exception 'Convite não encontrado.';
  end if;
  if v.role = 'gestor' and not public.eh_dona_da_empresa(p_empresa) then
    raise exception 'Só a dona pode cancelar o convite de uma gestora.';
  end if;
  if v.status <> 'pendente' then
    raise exception 'Este convite já foi respondido ou cancelado.';
  end if;
  update public.convites_equipe set status = 'cancelado', respondido_em = now() where id = v.id;
end;
$$;

-- ── 6. Convites da conta logada (banner da convidada) ─────────
create or replace function public.meus_convites()
returns table (
  id uuid, empresa_id uuid, empresa_nome text, role text, percentual_comissao numeric,
  tipo_contrato text, criado_em timestamptz, convidado_por_nome text
)
language sql stable security definer set search_path = public
as $$
  select c.id, c.empresa_id, e.nome::text, c.role, c.percentual_comissao, c.tipo_contrato,
         c.criado_em, u.nome::text
    from public.convites_equipe c
    join public.empresas e on e.id = c.empresa_id
    left join public.users u on u.id = c.convidado_por
   where auth.uid() is not null
     and c.user_id = auth.uid()
     and c.status = 'pendente'
     and lower(trim(c.email)) = coalesce((select lower(trim(au.email)) from auth.users au where au.id = auth.uid()), '')
   order by c.criado_em desc, c.id;
$$;

-- ── 7. Histórico paginado (e-mail mascarado para quem não é a dona) ──
create or replace function public.listar_historico_equipe(p_empresa uuid, p_limite integer, p_offset integer)
returns table (
  id uuid, empresa_id uuid, alvo_user_id uuid, acao text, detalhe jsonb, feito_por uuid,
  criado_em timestamptz, alvo_nome text, feito_por_nome text
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_dona boolean;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre de novo.';
  end if;
  if not public.tem_permissao(p_empresa, 'equipe.gerenciar') then
    raise exception 'Sem permissão para ver o histórico da equipe.' using errcode = '42501';
  end if;
  v_dona := public.eh_dona_da_empresa(p_empresa);
  return query
    select h.id, h.empresa_id, h.alvo_user_id, h.acao,
           case when v_dona then h.detalhe else (
             select coalesce(jsonb_object_agg(x.k,
                      case when x.k in ('de', 'para', 'email') and jsonb_typeof(x.v) = 'string'
                           then to_jsonb(public.mascarar_email(x.v #>> '{}'))
                           else x.v end), '{}'::jsonb)
               from jsonb_each(h.detalhe) as x(k, v)
           ) end,
           h.feito_por, h.criado_em,
           coalesce(ua.nome::text, h.detalhe->>'nome'), uf.nome::text
      from public.equipe_historico h
      left join public.users ua on ua.id = h.alvo_user_id
      left join public.users uf on uf.id = h.feito_por
     where h.empresa_id = p_empresa
     order by h.criado_em desc, h.id desc
     limit greatest(least(coalesce(p_limite, 50), 200), 1)
     offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ── 8. Triggers de histórico ──────────────────────────────────
create or replace function public.fn_equipe_historico_convite()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.equipe_historico (empresa_id, alvo_user_id, acao, detalhe, feito_por)
      values (new.empresa_id, new.user_id, 'convite_enviado',
              jsonb_build_object('email', new.email, 'nome', new.nome, 'role', new.role,
                                 'percentual_comissao', new.percentual_comissao,
                                 'tipo_contrato', new.tipo_contrato, 'convite_id', new.id),
              coalesce(new.convidado_por, auth.uid()));
  elsif new.status is distinct from old.status and new.status in ('aceito', 'recusado', 'cancelado') then
    insert into public.equipe_historico (empresa_id, alvo_user_id, acao, detalhe, feito_por)
      values (new.empresa_id, new.user_id, 'convite_' || new.status,
              jsonb_build_object('email', new.email, 'nome', new.nome, 'role', new.role,
                                 'percentual_comissao', new.percentual_comissao,
                                 'tipo_contrato', new.tipo_contrato, 'convite_id', new.id),
              auth.uid());
  end if;
  return null;
end;
$$;
drop trigger if exists trg_equipe_historico_convite on public.convites_equipe;
create trigger trg_equipe_historico_convite
  after insert or update of status on public.convites_equipe
  for each row execute function public.fn_equipe_historico_convite();

create or replace function public.fn_equipe_historico_membro()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(current_setting('bellamore.historico_silencioso', true), '') = 'on' then
    return null;
  end if;
  if new.ativo is distinct from old.ativo then
    insert into public.equipe_historico (empresa_id, alvo_user_id, acao, feito_por)
      values (new.empresa_id, new.user_id, case when new.ativo then 'reativado' else 'desativado' end, auth.uid());
  end if;
  if new.role is distinct from old.role then
    insert into public.equipe_historico (empresa_id, alvo_user_id, acao, detalhe, feito_por)
      values (new.empresa_id, new.user_id, 'papel_trocado',
              jsonb_build_object('de', old.role::text, 'para', new.role::text), auth.uid());
  end if;
  if new.percentual_comissao is distinct from old.percentual_comissao then
    insert into public.equipe_historico (empresa_id, alvo_user_id, acao, detalhe, feito_por)
      values (new.empresa_id, new.user_id, 'comissao_trocada',
              jsonb_build_object('de', old.percentual_comissao, 'para', new.percentual_comissao), auth.uid());
  end if;
  if new.tipo_contrato is distinct from old.tipo_contrato then
    insert into public.equipe_historico (empresa_id, alvo_user_id, acao, detalhe, feito_por)
      values (new.empresa_id, new.user_id, 'contrato_trocado',
              jsonb_build_object('de', old.tipo_contrato, 'para', new.tipo_contrato), auth.uid());
  end if;
  return null;
end;
$$;
drop trigger if exists trg_equipe_historico_membro on public.empresa_membros;
create trigger trg_equipe_historico_membro
  after update on public.empresa_membros
  for each row execute function public.fn_equipe_historico_membro();

-- ── 9. Execução das funções ───────────────────────────────────
revoke all on function public.aceitar_convite(uuid) from public, anon;
revoke all on function public.recusar_convite(uuid) from public, anon;
revoke all on function public.cancelar_convite(uuid, uuid) from public, anon;
revoke all on function public.meus_convites() from public, anon;
revoke all on function public.listar_historico_equipe(uuid, integer, integer) from public, anon;
revoke all on function public.fn_equipe_historico_convite() from public, anon, authenticated;
revoke all on function public.fn_equipe_historico_membro() from public, anon, authenticated;
grant execute on function public.aceitar_convite(uuid) to authenticated;
grant execute on function public.recusar_convite(uuid) to authenticated;
grant execute on function public.cancelar_convite(uuid, uuid) to authenticated;
grant execute on function public.meus_convites() to authenticated;
grant execute on function public.listar_historico_equipe(uuid, integer, integer) to authenticated;

notify pgrst, 'reload schema';
