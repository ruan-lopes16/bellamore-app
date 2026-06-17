-- ============================================================
-- PACOTES — venda para clientes + controle de uso de sessões
-- ============================================================

-- 1. Pacotes vendidos (atribuídos a um cliente)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pacote_clientes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  pacote_id       uuid NOT NULL REFERENCES public.pacotes(id),
  cliente_id      uuid NOT NULL REFERENCES public.clientes(id),
  data_inicio     date NOT NULL DEFAULT current_date,
  data_validade   date NOT NULL,
  valor_pago      numeric(10,2),
  status          text NOT NULL DEFAULT 'ativo'
                    CHECK (status IN ('ativo', 'concluido', 'expirado', 'cancelado')),
  observacao      text,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE public.pacote_clientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pacote_clientes: membro gerencia"
  ON public.pacote_clientes FOR ALL
  USING   (empresa_id IN (SELECT minha_empresas()))
  WITH CHECK (empresa_id IN (SELECT minha_empresas()));

-- 2. Uso de sessões (uma linha por sessão consumida)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pacote_uso (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES public.empresas(id),
  pacote_cliente_id   uuid NOT NULL REFERENCES public.pacote_clientes(id) ON DELETE CASCADE,
  servico_id          uuid REFERENCES public.servicos(id),
  agendamento_id      uuid REFERENCES public.agendamentos(id),
  observacao          text,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE public.pacote_uso ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pacote_uso: membro gerencia"
  ON public.pacote_uso FOR ALL
  USING   (empresa_id IN (SELECT minha_empresas()))
  WITH CHECK (empresa_id IN (SELECT minha_empresas()));

-- 3. RLS de escrita nos pacotes (INSERT/UPDATE/DELETE)
--    Complementa a migration 005 que só tinha SELECT/INSERT
-- ============================================================
DO $$ BEGIN
  CREATE POLICY "pacotes: membro insere"
    ON public.pacotes FOR INSERT
    WITH CHECK (empresa_id IN (SELECT minha_empresas()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "pacotes: membro atualiza"
    ON public.pacotes FOR UPDATE
    USING (empresa_id IN (SELECT minha_empresas()))
    WITH CHECK (empresa_id IN (SELECT minha_empresas()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "pacote_servicos: membro gerencia insert"
    ON public.pacote_servicos FOR INSERT
    WITH CHECK (
      EXISTS (SELECT 1 FROM public.pacotes p WHERE p.id = pacote_id AND p.empresa_id IN (SELECT minha_empresas()))
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "pacote_servicos: membro gerencia delete"
    ON public.pacote_servicos FOR DELETE
    USING (
      EXISTS (SELECT 1 FROM public.pacotes p WHERE p.id = pacote_id AND p.empresa_id IN (SELECT minha_empresas()))
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
