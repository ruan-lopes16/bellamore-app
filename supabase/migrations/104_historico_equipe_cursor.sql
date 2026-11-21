-- ============================================================
-- MIGRATION 104 — Histórico da Equipe paginado por cursor
--
-- POR QUÊ: listar_historico_equipe (092) pagina por offset. Quando entram mais eventos novos do
-- que cabem numa página entre duas cargas, o "Carregar mais" voltava repetido (descartado no
-- cliente) e podia aparecer vazio. A função nova recebe o último item já mostrado
-- (criado_em, id) e devolve só o que vem depois dele: nunca repete nem pula.
--
-- Corpo igual ao da 092 (mesmas conferências de sessão e permissão, mesmo e-mail mascarado para quem
-- não é a dona), trocando o offset pelo filtro do cursor. A função da 092 fica (app antigo).
-- EXECUTE NO SUPABASE SQL EDITOR (migrations manuais; NÃO usar supabase db push). Idempotente.
-- Ordem livre: sem a 104 o app usa a função antiga (PGRST202).
--
-- CONFERÊNCIAS (só leitura):
--   select proname, prosecdef from pg_proc where proname = 'listar_historico_equipe_cursor';  -- 1 linha, true
--
-- ROLLBACK: drop function if exists public.listar_historico_equipe_cursor(uuid, integer, timestamptz, uuid);
-- ============================================================

create or replace function public.listar_historico_equipe_cursor(p_empresa uuid, p_limite integer, p_antes_em timestamptz, p_antes_id uuid)
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
       -- 104: só o que vem depois do último item já mostrado (ordem criado_em desc, id desc).
       and (p_antes_em is null or (h.criado_em, h.id) < (p_antes_em, p_antes_id))
     order by h.criado_em desc, h.id desc
     limit greatest(least(coalesce(p_limite, 50), 200), 1);
end;
$$;

revoke all on function public.listar_historico_equipe_cursor(uuid, integer, timestamptz, uuid) from public, anon;
grant execute on function public.listar_historico_equipe_cursor(uuid, integer, timestamptz, uuid) to authenticated;

notify pgrst, 'reload schema';
