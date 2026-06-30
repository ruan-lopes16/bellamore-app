-- ============================================================
-- MIGRATION 033 — Bloqueios de agenda
--
-- Tabela para registrar períodos bloqueados na agenda por
-- profissional (ou para toda a empresa quando profissional_id=NULL).
-- Exemplos: folgas, feriados, manutenção, reunião.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agenda_bloqueios (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id       UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  profissional_id  UUID REFERENCES public.users(id) ON DELETE CASCADE,
  titulo           TEXT DEFAULT 'Bloqueio',
  data_inicio      TIMESTAMPTZ NOT NULL,
  data_fim         TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_bloqueio_periodo CHECK (data_fim > data_inicio)
);

ALTER TABLE public.agenda_bloqueios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bloqueios_select" ON public.agenda_bloqueios
  FOR SELECT USING (empresa_id = ANY(minha_empresas()));

CREATE POLICY "bloqueios_insert" ON public.agenda_bloqueios
  FOR INSERT WITH CHECK (empresa_id = ANY(minha_empresas()));

CREATE POLICY "bloqueios_update" ON public.agenda_bloqueios
  FOR UPDATE USING (empresa_id = ANY(minha_empresas()));

CREATE POLICY "bloqueios_delete" ON public.agenda_bloqueios
  FOR DELETE USING (empresa_id = ANY(minha_empresas()));

CREATE INDEX IF NOT EXISTS idx_bloqueios_empresa_data
  ON public.agenda_bloqueios (empresa_id, data_inicio, data_fim);
