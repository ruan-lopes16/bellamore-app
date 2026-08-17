-- ============================================================
-- DESPESAS — quantidade de parcelas para recorrencia mensal
--
-- Alternativa a digitar `recorrencia_ate` diretamente: informando o
-- total de parcelas (e, se o contrato ja estava em andamento, em qual
-- parcela o cadastro comeca), o app calcula `recorrencia_ate` sozinho
-- e guarda aqui o progresso, incrementado em +1 a cada auto-lancamento
-- mensal, so para exibicao ("Parcela 6 de 12"). `recorrencia_ate`
-- continua sendo o unico campo que decide quando o auto-lancamento
-- para (logica inalterada).
-- ============================================================

alter table public.despesas
  add column parcela_atual integer,
  add column total_parcelas integer;
