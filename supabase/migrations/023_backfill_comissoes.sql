-- Backfill: gera comissoes retroativas para agendamentos concluidos
-- que nao possuem registro na tabela comissoes.
--
-- Casos cobertos:
--   1. Agendamentos cujo profissional tinha role='gestor' (bug corrigido em 022)
--   2. Agendamentos concluidos antes da existencia do trigger
--
-- Seguro para rodar multiplas vezes: o NOT EXISTS garante idempotencia.

INSERT INTO public.comissoes
  (empresa_id, profissional_id, agendamento_id, valor_servico, percentual)
SELECT
  a.empresa_id,
  a.profissional_id,
  a.id          AS agendamento_id,
  a.valor       AS valor_servico,
  em.percentual_comissao AS percentual
FROM public.agendamentos a
JOIN public.empresa_membros em
  ON  em.empresa_id = a.empresa_id
  AND em.user_id    = a.profissional_id
  AND em.ativo      = true
WHERE a.status = 'concluido'
  AND em.percentual_comissao IS NOT NULL
  AND em.percentual_comissao > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.comissoes c
    WHERE c.agendamento_id = a.id
  );
