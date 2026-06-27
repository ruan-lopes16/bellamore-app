-- ============================================================
-- Migration 030 — Camada de Crescimento
-- Tabela de avaliações (1-5 estrelas por atendimento)
-- Meta mensal de receita na tabela empresas
-- ============================================================

-- ── Tabela de avaliações ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.avaliacoes (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id      uuid        NOT NULL REFERENCES public.empresas(id)          ON DELETE CASCADE,
  agendamento_id  uuid        UNIQUE       REFERENCES public.agendamentos(id)  ON DELETE CASCADE,
  cliente_id      uuid        NOT NULL REFERENCES public.clientes(id)          ON DELETE CASCADE,
  profissional_id uuid                     REFERENCES public.empresa_membros(id) ON DELETE SET NULL,
  nota            smallint    NOT NULL     CHECK (nota BETWEEN 1 AND 5),
  comentario      text,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE public.avaliacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "empresa_all_avaliacoes" ON public.avaliacoes
  USING (
    empresa_id IN (
      SELECT empresa_id FROM public.empresa_membros
      WHERE user_id = auth.uid() AND ativo = true
    )
  )
  WITH CHECK (
    empresa_id IN (
      SELECT empresa_id FROM public.empresa_membros
      WHERE user_id = auth.uid() AND ativo = true
    )
  );

-- ── Meta mensal de receita ────────────────────────────────────

ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS meta_mensal numeric DEFAULT 0;

-- ── Índices ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_avaliacoes_empresa_data
  ON public.avaliacoes(empresa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_avaliacoes_profissional
  ON public.avaliacoes(empresa_id, profissional_id);

CREATE INDEX IF NOT EXISTS idx_avaliacoes_agendamento
  ON public.avaliacoes(agendamento_id);
