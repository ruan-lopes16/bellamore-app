-- Migration 020: Suporte a múltiplos serviços por agendamento
--
-- Mudanças:
-- 1. Cria tabela `agendamento_servicos` para linhas de serviço adicionais
-- 2. Remove o trigger de bloqueio de sobreposição de horário
--    (substituído por aviso client-side, que permite sobreposição com confirmação)

-- ── 1. Tabela de serviços por agendamento ──────────────────────

CREATE TABLE IF NOT EXISTS public.agendamento_servicos (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id   uuid         NOT NULL REFERENCES public.agendamentos(id) ON DELETE CASCADE,
  servico_id       uuid         NOT NULL REFERENCES public.servicos(id),
  valor            numeric(10,2) NOT NULL DEFAULT 0,
  duracao_minutos  int          NOT NULL DEFAULT 60,
  ordem            int          NOT NULL DEFAULT 0,
  empresa_id       uuid         NOT NULL REFERENCES public.empresas(id)
);

ALTER TABLE public.agendamento_servicos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agendamento_servicos: membro gerencia"
  ON public.agendamento_servicos FOR ALL
  USING  (empresa_id IN (SELECT unnest(minha_empresas())))
  WITH CHECK (empresa_id IN (SELECT unnest(minha_empresas())));

-- ── 2. Substituir bloqueio de conflito por aviso client-side ───
-- O trigger impedia qualquer sobreposição; agora o client avisa
-- e deixa o usuário decidir se deseja agendar mesmo assim.

DROP TRIGGER IF EXISTS trg_check_conflito_horario ON public.agendamentos;
DROP FUNCTION IF EXISTS public.check_conflito_horario();
