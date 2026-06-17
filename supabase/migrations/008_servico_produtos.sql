-- ============================================================
-- SERVICO_PRODUTOS — receita de insumos por serviço
-- Permite definir quais produtos são consumidos em cada
-- serviço e as quantidades padrão.
-- ============================================================

CREATE TABLE public.servico_produtos (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  servico_id  uuid        NOT NULL REFERENCES public.servicos(id)  ON DELETE CASCADE,
  produto_id  uuid        NOT NULL REFERENCES public.produtos(id)  ON DELETE CASCADE,
  quantidade  numeric(10,3) NOT NULL DEFAULT 1,
  UNIQUE (servico_id, produto_id)
);

ALTER TABLE public.servico_produtos ENABLE ROW LEVEL SECURITY;

-- Membros da empresa podem visualizar
CREATE POLICY "servico_produtos: membro ve"
  ON public.servico_produtos FOR SELECT
  USING (
    servico_id IN (
      SELECT id FROM public.servicos
      WHERE empresa_id IN (SELECT minha_empresas())
    )
  );

-- Owner/gestor gerencia
CREATE POLICY "servico_produtos: gestor gerencia"
  ON public.servico_produtos FOR ALL
  USING (
    servico_id IN (
      SELECT id FROM public.servicos
      WHERE empresa_id IN (
        SELECT id FROM public.empresas WHERE owner_id = auth.uid()
      )
    )
  );
