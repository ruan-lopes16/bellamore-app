-- ============================================================
-- MIGRATION 064 — comissão não é gerada para sessão de pacote
--
-- EXECUTE NO SUPABASE SQL EDITOR (migrations são manuais).
--
-- PROBLEMA
-- Um agendamento vinculado a um pacote (pacote_cliente_id preenchido) é o
-- consumo de uma sessão já paga na venda do pacote. Ele não deve gerar
-- receita nova (tratado no app) nem comissão nova — senão o profissional
-- ganharia comissão a cada sessão de um pacote que foi pago uma única vez.
--
-- CORREÇÃO
-- gerar_comissao() passa a ignorar agendamento com pacote_cliente_id NOT NULL.
-- Só isso muda; o resto da função (SECURITY DEFINER, sem filtro de role) é
-- idêntico à migration 024.
--
-- Não faz backfill: comissões de sessões de pacote já geradas continuam como
-- estão (decisão de não reescrever histórico).
-- ============================================================

CREATE OR REPLACE FUNCTION public.gerar_comissao()
RETURNS trigger AS $$
DECLARE
  v_percentual numeric(5,2);
BEGIN
  IF NEW.status = 'concluido' AND OLD.status != 'concluido' THEN
    -- Sessão de pacote: já foi paga na venda do pacote, não gera comissão nova.
    IF NEW.pacote_cliente_id IS NOT NULL THEN
      RETURN NEW;
    END IF;

    SELECT percentual_comissao INTO v_percentual
    FROM public.empresa_membros
    WHERE empresa_id = NEW.empresa_id
      AND user_id    = NEW.profissional_id;

    IF v_percentual IS NOT NULL AND v_percentual > 0 THEN
      INSERT INTO public.comissoes
        (empresa_id, profissional_id, agendamento_id, valor_servico, percentual)
      VALUES
        (NEW.empresa_id, NEW.profissional_id, NEW.id, NEW.valor, v_percentual);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_gerar_comissao ON public.agendamentos;

CREATE TRIGGER trg_gerar_comissao
  AFTER UPDATE ON public.agendamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.gerar_comissao();
