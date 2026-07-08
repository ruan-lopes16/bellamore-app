-- Corrige alerta do Supabase Advisor: Security Definer View.
-- A view deve respeitar as permissoes/RLS do usuario que consulta, nao do dono.
alter view public.v_produtos_estoque_baixo
  set (security_invoker = true);
