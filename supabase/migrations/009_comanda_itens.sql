-- ============================================================
-- COMANDA — ajustes de schema + itens de comanda
-- ============================================================

-- 1. Corrige comandas: remove FK obrigatória para users,
--    adiciona coluna clientes_id referenciando tabela clientes
-- ============================================================
ALTER TABLE public.comandas
  DROP CONSTRAINT IF EXISTS comandas_cliente_id_fkey;

ALTER TABLE public.comandas
  ALTER COLUMN cliente_id DROP NOT NULL;

ALTER TABLE public.comandas
  ADD COLUMN IF NOT EXISTS clientes_id uuid REFERENCES public.clientes(id);

-- 2. Tabela de itens de comanda
--    Armazena serviços e produtos adicionados manualmente durante o atendimento,
--    além dos agendamentos que já ficam linkados via agendamentos.comanda_id
-- ============================================================
CREATE TABLE IF NOT EXISTS public.comanda_itens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comanda_id      uuid NOT NULL REFERENCES public.comandas(id) ON DELETE CASCADE,
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id),
  tipo            text NOT NULL DEFAULT 'servico'
                    CHECK (tipo IN ('servico', 'produto')),
  descricao       text NOT NULL,
  servico_id      uuid REFERENCES public.servicos(id),
  produto_id      uuid REFERENCES public.produtos(id),
  profissional_id uuid REFERENCES public.users(id),
  quantidade      numeric(10,3) NOT NULL DEFAULT 1,
  valor_unit      numeric(10,2) NOT NULL,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE public.comanda_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comanda_itens: membro gerencia"
  ON public.comanda_itens FOR ALL
  USING   (empresa_id IN (SELECT minha_empresas()))
  WITH CHECK (empresa_id IN (SELECT minha_empresas()));

-- 3. RLS para comandas (pode não existir ainda)
-- ============================================================
DO $$ BEGIN
  CREATE POLICY "comandas: membro gerencia"
    ON public.comandas FOR ALL
    USING   (empresa_id IN (SELECT minha_empresas()))
    WITH CHECK (empresa_id IN (SELECT minha_empresas()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. RLS para pagamentos — INSERT e SELECT (podem não existir)
-- ============================================================
DO $$ BEGIN
  CREATE POLICY "pagamentos: membro insere"
    ON public.pagamentos FOR INSERT
    WITH CHECK (empresa_id IN (SELECT minha_empresas()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "pagamentos: membro ve"
    ON public.pagamentos FOR SELECT
    USING (empresa_id IN (SELECT minha_empresas()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
