-- Adiciona comanda_id em estoque_movimentos, vendas e pacote_clientes.
--
-- Sem essas colunas não há como rastrear, com segurança, quais movimentos de
-- estoque, vendas avulsas e pacotes vendidos vieram de uma comanda específica
-- — o que é necessário para reabrir uma comanda fechada por engano e desfazer
-- automaticamente tudo o que ela gerou (baixa de estoque, venda avulsa,
-- venda de pacote) sem risco de atingir um registro de outra comanda.
--
-- Nullable e aditivo: registros antigos ficam com comanda_id = null (não
-- rastreáveis para reversão automática), nada existente quebra.

ALTER TABLE public.estoque_movimentos
  ADD COLUMN IF NOT EXISTS comanda_id uuid REFERENCES public.comandas(id);

ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS comanda_id uuid REFERENCES public.comandas(id);

ALTER TABLE public.pacote_clientes
  ADD COLUMN IF NOT EXISTS comanda_id uuid REFERENCES public.comandas(id);

-- Marca quando a taxa de parcelamento foi repassada para a cliente (o
-- `valor` já vem cobrado com o acréscimo nesse caso) — sem isso, reabrir uma
-- comanda para edição não teria como restaurar o estado do checkbox.
ALTER TABLE public.pagamentos
  ADD COLUMN IF NOT EXISTS repassar_taxa boolean NOT NULL DEFAULT false;
