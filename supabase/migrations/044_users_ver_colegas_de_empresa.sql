-- ============================================================
-- MIGRATION 044 — users: colegas de empresa podem ver o perfil básico
--
-- A única policy de SELECT em public.users (migration 001) era
-- "ver proprio" (id = auth.uid()). Isso nunca deu problema porque só
-- existia a dona em cada empresa; qualquer join user:users(...) feito
-- por ela mesma resolvia via id = auth.uid(). Assim que a equipe cresce
-- (feature deste branch), as telas de Equipe (web/mobile) e o seletor
-- de profissional no modal de novo agendamento (web) fazem esse mesmo
-- join para OUTROS membros — que sob RLS retornava null e quebrava a
-- tela. Esta migration adiciona uma policy adicional (permissiva, some
-- com a existente) liberando a leitura de colegas da mesma empresa.
-- ============================================================

CREATE POLICY "users: ver colegas de empresa"
  ON public.users
  FOR SELECT
  USING (
    id IN (
      SELECT em.user_id FROM public.empresa_membros em
      WHERE em.empresa_id IN (SELECT minha_empresas())
    )
  );
