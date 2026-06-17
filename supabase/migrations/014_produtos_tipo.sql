-- ============================================================
-- PRODUTOS: coluna tipo (material | venda)
--
-- Separa o estoque de insumos/materiais (usados em atendimentos)
-- do estoque de produtos para revenda (PDV / vendas avulsas).
--
-- Impacto zero em dados existentes: default = 'material'
-- (todos os produtos antigos continuam como insumos).
-- ============================================================

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS tipo text
  NOT NULL DEFAULT 'material'
  CHECK (tipo IN ('material', 'venda'));

-- Índice composto para as queries filtradas por tipo
CREATE INDEX IF NOT EXISTS idx_produtos_empresa_tipo_ativo
  ON public.produtos (empresa_id, tipo, ativo);

-- Comentário documental
COMMENT ON COLUMN public.produtos.tipo IS
  'material = insumo usado em atendimentos (debitado via ConsumoModal/trigger); '
  'venda = produto para revenda no PDV (debitado ao finalizar venda)';
