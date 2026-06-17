-- ============================================================
-- MÓDULO DE VENDAS AVULSAS
-- Venda de produtos/bebidas fora de agendamentos
-- ============================================================

-- 1. Tabela de vendas
CREATE TABLE public.vendas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  cliente_id  uuid REFERENCES public.clientes(id),
  valor_total numeric(10,2) NOT NULL DEFAULT 0,
  desconto    numeric(10,2) NOT NULL DEFAULT 0,
  valor_final numeric(10,2) GENERATED ALWAYS AS (valor_total - desconto) STORED,
  observacao  text,
  created_at  timestamptz DEFAULT now()
);

-- 2. Itens da venda
CREATE TABLE public.venda_itens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id),
  venda_id        uuid NOT NULL REFERENCES public.vendas(id) ON DELETE CASCADE,
  produto_id      uuid NOT NULL REFERENCES public.produtos(id),
  quantidade      numeric(10,3) NOT NULL DEFAULT 1,
  preco_unitario  numeric(10,2) NOT NULL,
  created_at      timestamptz DEFAULT now()
);

-- 3. Vincular pagamentos a vendas
ALTER TABLE public.pagamentos
  ADD COLUMN IF NOT EXISTS venda_id uuid REFERENCES public.vendas(id);

-- 4. RLS
ALTER TABLE public.vendas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venda_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vendas: membro gerencia"
  ON public.vendas FOR ALL
  USING   (empresa_id IN (SELECT minha_empresas()))
  WITH CHECK (empresa_id IN (SELECT minha_empresas()));

CREATE POLICY "venda_itens: membro gerencia"
  ON public.venda_itens FOR ALL
  USING   (empresa_id IN (SELECT minha_empresas()))
  WITH CHECK (empresa_id IN (SELECT minha_empresas()));

-- 5. Garantir políticas de pagamentos (pode já existir da 009)
DO $$ BEGIN
  CREATE POLICY "pagamentos: membro seleciona"
    ON public.pagamentos FOR SELECT
    USING (empresa_id IN (SELECT minha_empresas()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "pagamentos: membro insere"
    ON public.pagamentos FOR INSERT
    WITH CHECK (empresa_id IN (SELECT minha_empresas()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
