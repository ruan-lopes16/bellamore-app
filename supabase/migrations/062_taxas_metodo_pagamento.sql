-- ============================================================
-- MIGRATION 062 — forma de pagamento das taxas de reserva/cancelamento
--
-- PROBLEMA
-- taxas_reserva e taxas_cancelamento tem status 'pago', mas nao guardam
-- COMO o cliente pagou. pagamentos.metodo ja existe para o pagamento
-- principal da comanda (dinheiro/pix/credito/debito/cortesia) — essas
-- duas tabelas ficaram de fora.
--
-- Coluna nullable e opcional, nos dois sentidos:
--   - retroativo: taxas ja marcadas 'pago' antes desta migration ficam
--     com metodo = null (nao ha como saber como foram pagas, e nao e
--     seguro adivinhar);
--   - dai pra frente: quem marca uma taxa como paga pode informar o
--     metodo, mas nao e obrigatorio — o dado so existe "quando houver"
--     (pedido do usuario), sem travar o fluxo de quem nao quiser
--     preencher.
--
-- Reaproveita o enum public.pagamento_metodo ja usado por pagamentos,
-- em vez de outro texto livre — mesmas 5 opcoes em todo o app.
-- ============================================================

alter table public.taxas_reserva
  add column metodo public.pagamento_metodo;

alter table public.taxas_cancelamento
  add column metodo public.pagamento_metodo;
